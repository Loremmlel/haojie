/* fx.ts · 特效引擎（v1 src/js/fx.js 逐字平移 + §7.2 结构性改动，Task 2 迁移 Motion）
 * 命令式特区：零 React import，仅靠 initFx 注入的 FxCtx 工作。
 * Task 2 结构性改动（对照本任务前）：
 *   - per-run 生命周期：initFx 建立 FxRun（alive/controls/nodes），resetFx 取消；
 *     transient/blocking 原语经 track() 登记 controls，动画停掉即清理节点；
 *   - 现役原语改 Motion animate()：flyNum/projectileTo/ring/boomAt/spellIcon/banner/shake；
 *     slash/lunge/pop-in/dying/hit-jolt 仍为 CSS/timer（Task 3 接手）；
 *   - playChain(g) 入口捕获当前 run；run.alive=false（restart 取消）后链尾静默返回，
 *     旧 completion 只写自身捕获的旧元素，不触碰重启后的新 DOM。
 * playChain(g) 消费 g.events（同一数组引用）按游标逐条播放，act/runSpellCast 链尾 await 后 bump。
 * （承接 §7.2 既有约束……以下原注保留）
 *   - deploy：syncPieces() → await ctx.onSyncPoint()（受控提交物化新节点），pop-in 由 fx 接手（v1 buildPieceEl）；
 *   - death：删 el.remove() 与 UI.syncPieces()，节点由 React 链尾卸载（.dying 终态 opacity:0 无跳变）；
 *   - move/hook：registry 取节点直写 left/top（geometry.posOf 公式，与 React 终态数值恒等）；
 *   - turn/attack/charm：refreshTop/syncStatFlash/refreshAll 删除（链尾 bump 统一刷新，豁免表 1-3 条）；
 *   - win：fx 先自行播胜利横幅（对齐 v1 main.js:22 行为），再调 ctx.onWin（横幅归 FX、遮罩归 React）。 */
import { animate } from 'motion';
import type { Game } from '../../engine/types.ts';
import { W, H, getDef } from '../../engine/data.ts';
import { PNAME, type GameEvent } from '../../engine/state.ts';
import { nearestDist } from '../../engine/rules.ts';
import { posOf, type Metrics } from '../geometry.ts';
import { pieceRegistry } from './registry.ts';

export interface FxCtx {
  hosts: { boardOuter: HTMLElement; fxLayer: HTMLElement; banner: HTMLElement };
  registry: typeof pieceRegistry;
  onWin: (winner: number) => void;
  onSyncPoint: () => Promise<void>;   // deploy 受控提交（bump + 双 rAF）
}

type FxControls = ReturnType<typeof animate>;
type FxRun = {
  ctx: FxCtx;
  alive: boolean;
  controls: Set<FxControls>;
  nodes: Set<HTMLElement>;
};

/** 当前 run：initFx 建立（宿主就绪/重开重建），resetFx 取消并清空。 */
let currentRun: FxRun | null = null;

/** controls 登记：成功/失败（含 stop 取消）后都从集合移除。
 *  Motion 的 controls 是 Promise-like（只有 then(onResolve,onReject)），
 *  没有 .catch()/.finally()，一律经 Promise.resolve 包装后再链式处理。 */
function track(run: FxRun, controls: FxControls): FxControls {
  run.controls.add(controls);
  void controls.then(
    () => run.controls.delete(controls),
    () => run.controls.delete(controls),
  );
  return controls;
}

/** 后台动画（宿主元素上，无节点可清理）：取消后静默（run 已死不报错）。 */
function background(run: FxRun, controls: FxControls): void {
  void Promise.resolve(track(run, controls)).catch((err) => {
    if (run.alive) console.error('fx background error', err);
  });
}

/** 结点登记：resetFx 按集合整批移除，transient 正常播完后从集合与 DOM 双双摘除。 */
function addEl(run: FxRun, cls: string, styles: Record<string, string>, text?: string) {
  const el = document.createElement('div');
  el.className = cls;
  if (text != null) el.textContent = text;
  for (const k in styles) el.style.setProperty(k, styles[k]); // setProperty 兼容 --rot/--ring-w 等自定义属性
  run.ctx.hosts.fxLayer.appendChild(el);
  run.nodes.add(el);
  return el;
}
function dropEl(run: FxRun, el: HTMLElement): void {
  run.nodes.delete(el);
  el.remove();
}

/** 非阻塞瞬时节点：动画完成后清理；被 resetFx 取消时不再二次操作。 */
function transient(run: FxRun, el: HTMLElement, controls: FxControls): void {
  void Promise.resolve(track(run, controls))
    .catch((err) => { if (run.alive) console.error('fx background error', err); })
    .finally(() => dropEl(run, el));
}

/** 阻塞式等待动画完成（仅回调节点/宿主）。Motion promise 由 rAF/WAAPI 驱动，
 *  headless（--virtual-time-budget）下动画时钟与虚拟定时器不同步、promise 可能
 *  永不结算（实测）；以同量级 sleep 兜底——真实浏览器总是动画先完成，兜底即弃。 */
function settle(run: FxRun, controls: FxControls, ms: number): Promise<void> {
  const finished: Promise<void> = Promise.resolve(track(run, controls)).then(
    () => {}, () => {},
  );
  return Promise.race([finished, sleep(ms)]);
}

/** 重开/宿主失效：急停当前 run 的动画、移除瞬时节点、隐藏横幅、清空游标源。 */
export function resetFx(): void {
  const run = currentRun;
  if (!run) return;
  run.alive = false;
  for (const controls of run.controls) controls.stop();
  run.controls.clear();
  for (const node of run.nodes) node.remove();
  run.nodes.clear();
  run.ctx.hosts.banner.className = 'hidden';
  if (currentRun === run) currentRun = null;
}

export function initFx(c: FxCtx): void {
  resetFx();
  currentRun = { ctx: c, alive: true, controls: new Set(), nodes: new Set() };
  evCursor = 0; // 重开（seq 重建通道）时 initFx 重装配，游标必须归零——否则新局首个 act 链会跳过开头事件
}

let evCursor = 0;         // 已播放游标（undo 清空 events 后经 > 防御重置）
let M: Metrics = { size: 48, gap: 3, pad: 10 };
export function setMetrics(m: Metrics): void { M = m; }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(() => r(), ms));

/** 格子中心相对 #board-outer 的像素坐标 */
function centerOf(x: number, y: number) {
  return {
    cx: M.pad + (x - 0.5) * (M.size + M.gap),
    cy: M.pad + (H - y + 0.5) * (M.size + M.gap), // y=1 渲染在最下行
  };
}
function boardOuterOf(run: FxRun) { return run.ctx.hosts.boardOuter; }

/* ─────────── 特效原语 ─────────── */

function flyNum(run: FxRun, uid: number, text: string, cls: string) {
  const pEl = run.ctx.registry.get(uid);
  const box = boardOuterOf(run).getBoundingClientRect();
  const r = pEl ? pEl.getBoundingClientRect() : box;
  const el = addEl(run, 'fly-num ' + cls, {
    left: (r.left - box.left + r.width / 2) + 'px',
    top: (r.top - box.top + r.height * 0.35) + 'px',
  }, text);
  // 静态居中走 CSS translate(-50%,-50%)，Motion 只写 transform：
  // 总位移 = translate(-50%) + y（与旧 keyframes 终态 -30%/-60%/-190% 同值）。
  // keyframes/options 用 const 变量传递：motion 的 DOMKeyframesDefinition/AnimationOptions
  // 为交叉/联合类型，字面量直传会触发 excess-property 检查而拒绝（实测）。
  const kf = { opacity: [0, 1, 1, 0], y: ['20%', '-10%', '-140%'], scale: [0.5, 1.15, 1] };
  const opts = { duration: 0.7, easing: 'easeOut' };
  const controls = animate(el, kf, opts);
  transient(run, el, controls);
}

/** 近战冲刺：攻击者扑向目标再弹回（slash/棋子 transform 为 Task 3 领地，此处仅接 run 后原样保留） */
async function lunge(run: FxRun, pEl: HTMLElement, tEl: HTMLElement) {
  const b = boardOuterOf(run).getBoundingClientRect();
  const pr = pEl.getBoundingClientRect(), tr = tEl.getBoundingClientRect();
  const dx = (tr.left + tr.width / 2) - (pr.left + pr.width / 2);
  const dy = (tr.top + tr.height / 2) - (pr.top + pr.height / 2);
  pEl.style.transition = 'transform .12s cubic-bezier(.5,0,.8,1)';
  pEl.style.transform = `translate(${dx * 0.55}px, ${dy * 0.55}px) scale(1.08)`;
  pEl.style.zIndex = '15'; // v1 数值 15，CSSOM 等义字符串
  await sleep(120);
  // 斩击线
  const ang = Math.atan2(dy, dx) * 180 / Math.PI + 90;
  const slash = addEl(run, 'slash', {
    left: (pr.left - b.left + pr.width / 2 + dx * 0.25 - 26) + 'px',
    top: (pr.top - b.top + pr.height / 2 + dy * 0.25 - 2) + 'px',
    width: '52px',
    '--rot': ang + 'deg',
  });
  setTimeout(() => dropEl(run, slash), 300);
  pEl.style.transition = 'left .32s cubic-bezier(.34,1.3,.5,1), top .32s cubic-bezier(.34,1.3,.5,1), transform .22s';
  pEl.style.transform = '';
  setTimeout(() => { pEl.style.zIndex = ''; }, 350);
  await sleep(160);
}

/** 远程弹道（棋子 → 棋子） */
async function projectile(run: FxRun, fromUid: number, toUid: number, color?: string, healMode?: boolean) {
  const pEl = run.ctx.registry.get(fromUid), tEl = run.ctx.registry.get(toUid);
  if (!pEl || !tEl) return;
  const b = boardOuterOf(run).getBoundingClientRect();
  const pr = pEl.getBoundingClientRect(), tr = tEl.getBoundingClientRect();
  const x1 = pr.left - b.left + pr.width / 2, y1 = pr.top - b.top + pr.height / 2;
  const x2 = tr.left - b.left + tr.width / 2, y2 = tr.top - b.top + tr.height / 2;
  await projectileTo(run, x1, y1, x2, y2, color);
  if (!healMode) hitRing(run, toUid, color || '#f87171');
}

/** 远程弹道原语（像素坐标 → 像素坐标）：阻塞到落点；取消（stop → then 拒绝）后静默返回。 */
async function projectileTo(run: FxRun, x1: number, y1: number, x2: number, y2: number, color?: string) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const dur = Math.min(420, Math.max(140, dist * 1.4));
  const el = addEl(run, 'bolt', { left: x1 + 'px', top: y1 + 'px', color: color || '#fbbf24' });
  const kf = { left: x2 + 'px', top: y2 + 'px' };
  const opts = { duration: dur / 1000, easing: 'linear' };
  const controls = animate(el, kf, opts);
  await settle(run, controls, dur + 150);
  if (run.alive) dropEl(run, el);
}

function hitRing(run: FxRun, uid: number, color?: string) {
  const tEl = run.ctx.registry.get(uid);
  if (!tEl) return;
  const r = tEl.getBoundingClientRect();
  tEl.classList.remove('hit-jolt'); void tEl.offsetWidth; tEl.classList.add('hit-jolt');
  const ring = addEl(run, 'ring', {
    left: (r.left - boardOuterOf(run).getBoundingClientRect().left + r.width / 2) + 'px',
    top: (r.top - boardOuterOf(run).getBoundingClientRect().top + r.height / 2) + 'px',
    color: color || '',
  });
  const kf = { width: [8, r.width * 1.7 + 'px'], height: [8, r.width * 1.7 + 'px'], opacity: [1, 0] };
  const opts = { duration: 0.55, easing: 'cubic-bezier(.2,.8,.3,1)' };
  const controls = animate(ring, kf, opts);
  transient(run, ring, controls);
}

/** 爆炸粒子（爆弹/死亡等） */
function boomAt(run: FxRun, px: number, py: number, color: string, n?: number) {
  for (let i = 0; i < (n || 8); i++) {
    const ang = Math.random() * Math.PI * 2;
    const d = 24 + Math.random() * 42;
    const b = addEl(run, 'boom', {
      left: px + 'px', top: py + 'px', color,
      background: color,
      width: 5 + Math.random() * 7 + 'px', height: 5 + Math.random() * 7 + 'px',
    });
    const kf = { x: Math.cos(ang) * d + 'px', y: Math.sin(ang) * d + 'px', rotate: [45, 345], scale: [1, 0.3], opacity: [1, 0] };
    const opts = { duration: 0.7, easing: 'cubic-bezier(.15,.6,.4,1)' };
    const controls = animate(b, kf, opts);
    transient(run, b, controls);
  }
}

/** 法术图标：阻塞到弹出完成。 */
async function spellIcon(run: FxRun, text: string, x: number, y: number) {
  const { cx, cy } = centerOf(x, y);
  const el = addEl(run, 'spell-cast', { left: cx + 'px', top: cy + 'px' }, text);
  const kf = {
    opacity: [0, 1, 1, 0],
    scale: [0.2, 1.3, 1, 1],
    rotate: [-30, 6, 0, 0],
    y: ['0%', '0%', '0%', '-40%'],
  };
  const opts = { duration: 0.75, easing: 'easeOut' };
  const controls = animate(el, kf, opts);
  await settle(run, controls, 900);
  if (run.alive) dropEl(run, el);
}

export async function banner(run: FxRun, text: string, cls: string): Promise<void> {
  const el = run.ctx.hosts.banner; // 捕获旧横幅：取消后 completion 只写自身旧元素
  el.textContent = text;
  el.className = cls || '';
  const kf = { opacity: [0, 1, 1, 0], scaleX: [0.2, 1, 1, 1.05] };
  const opts = { duration: 1.05, easing: 'easeOut' };
  const controls = animate(el, kf, opts);
  await settle(run, controls, 1250);
  if (run.alive) el.className = 'hidden';
}

/** 棋盘震动：boardOuter x/y keyframes（替代 body.shake + CSS keyframes）。 */
function shake(run: FxRun) {
  const el = boardOuterOf(run);
  const kf = { x: [0, -7, 6, -4, 0], y: [0, 4, -5, 2, 0] };
  const opts = { duration: 0.38, easing: 'easeOut' };
  const controls = animate(el, kf, opts);
  background(run, controls);
}

/* ─────────── 事件 → 动画调度 ─────────── */

export async function playChain(g: Game): Promise<void> {
  const run = currentRun;
  if (!run) return; // 未装配（或已被 resetFx 取消）→ 静默
  const events = g.events;
  if (evCursor > events.length) evCursor = 0; // 悔棋清空事件队列后重置游标
  while (evCursor < events.length && run.alive) {
    const e = events[evCursor++];
    try { await playOne(run, g, e); } catch (err) { if (run.alive) console.error('fx error', e, err); }
  }
}

async function playOne(run: FxRun, g: Game, e: GameEvent): Promise<void> {
  switch (e.type) {
    case 'turn': {
      // refreshTop 删除（链尾 bump 统一刷新，豁免表第 2 条）
      await banner(run, `第 ${e.turn} 回合 · ${PNAME[e.player]}行动`, e.player === 0 ? 'b1' : 'b2');
      break;
    }
    case 'deploy': {
      await run.ctx.onSyncPoint(); // 受控提交：bump + 双 rAF 确保新节点物化、注册表就绪
      const el = run.ctx.registry.get(e.uid);
      if (el) { // v1 buildPieceEl 的 pop-in 由 fx 接手（React 只物化节点，不加 fx 命令式类）
        el.classList.add('pop-in');
        setTimeout(() => el.classList.remove('pop-in'), 500);
      }
      break;
    }
    case 'move': {
      movePieceTo(run, g, e.uid, e.tx, e.ty);
      await sleep(340);
      break;
    }
    case 'hook': {
      // 钩链飞向目标原位置 → 勾住拉回
      const h = centerOf(e.fx, e.fy), t = centerOf(e.x0, e.y0);
      await projectileTo(run, h.cx, h.cy, t.cx, t.cy, '#fda4af');
      movePieceTo(run, g, e.uid, e.tx, e.ty);
      await sleep(340);
      break;
    }
    case 'attack': {
      const atkP = g.state.pieces.find((q) => q.uid === e.uid);
      const tEl = run.ctx.registry.get(e.tuid);
      if (!atkP || !tEl) break;
      if (e.healMode) { await projectile(run, e.uid, e.tuid, '#34d399', true); break; }
      // syncStatFlash 删除（链尾 bump 统一刷新，豁免表第 1 条）
      const isRanged = nearestDist(
        atkP,
        g.state.pieces.find((q) => q.uid === e.tuid)! // tEl 在注册表 ⇒ 目标存活，必在 state
      ) > 1;
      if (isRanged) await projectile(run, e.uid, e.tuid, '#fbbf24');
      else await lunge(run, run.ctx.registry.get(e.uid)!, tEl);
      break;
    }
    case 'damage': {
      const st = g.state;
      const victim = st.pieces.find((q) => q.uid === e.uid);
      if (victim && !e.silentNum) {
        flyNum(run, e.uid, '-' + e.amount + (e.frontal ? '（正面）' : ''), e.crit ? 'crit' : 'dmg');
        if (e.amount >= 60 || e.crit) shake(run);
      }
      break;
    }
    case 'heal': {
      flyNum(run, e.uid, '+' + e.amount, 'heal');
      break;
    }
    case 'buff': {
      flyNum(run, e.uid, '▲ 强化', 'buff');
      break;
    }
    case 'guard': {
      const tEl = run.ctx.registry.get(e.uid);
      if (tEl) {
        const r = tEl.getBoundingClientRect();
        boomAt(run, r.left - boardOuterOf(run).getBoundingClientRect().left + r.width / 2,
               r.top - boardOuterOf(run).getBoundingClientRect().top + r.height / 2,
               '#7dd3fc', 10);
      }
      flyNum(run, e.uid, '🗡️ 名刀！', 'buff');
      break;
    }
    case 'block': {
      flyNum(run, e.uid, '🛡️ 免疫', 'buff');
      break;
    }
    case 'mark': {
      flyNum(run, e.uid, '🎯 引信', 'buff');
      break;
    }
    case 'counter': {
      flyNum(run, e.uid, '🔄 反弹！', 'buff');
      shake(run);
      break;
    }
    case 'charm': {
      flyNum(run, e.uid, '🎭 倒戈！', 'buff');
      shake(run);
      // refreshAll 删除（链尾 bump 统一刷新，豁免表第 3 条）
      break;
    }
    case 'death': {
      const el = run.ctx.registry.get(e.uid);
      if (el) {
        const r = el.getBoundingClientRect();
        const b = boardOuterOf(run).getBoundingClientRect();
        boomAt(run, r.left - b.left + r.width / 2, r.top - b.top + r.height / 2, getDef(e.defId).type === 'base' ? '#fbbf24' : '#94a3b8', 12);
        el.classList.add('dying');
        await sleep(480); // 节点保留：由 React 链尾卸载（.dying 终态 opacity:0，无跳变）
      }
      if (getDef(e.defId).type === 'base') shake(run);
      break;
    }
    case 'spell': {
      const def = getDef(e.defId);
      if (e.defId === 8) {
        await spellIcon(run, '💣', e.x! + 0.5, e.y! + 0.5); // defId 8 的 spell 事件必带 x/y（spells.ts:39）
        // 田字四格（锚点为左上格）中心各炸一次
        for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) {
          const { cx, cy } = centerOf(e.x! + dx, e.y! + dy);
          boomAt(run, cx, cy, '#fb923c', 7);
        }
        shake(run);
        await sleep(250);
      } else if (e.uid != null) {
        const icons: Record<number, string> = { 17: '🛡️', 18: '💀', 22: '🎭' };
        await spellIcon(run, icons[e.defId] || def.emoji,
          g.state.pieces.find((q) => q.uid === e.uid)?.x || W / 2,
          g.state.pieces.find((q) => q.uid === e.uid)?.y || H / 2);
      }
      break;
    }
    case 'expire': break;
    case 'win': {
      // 横幅归 FX、遮罩归 React：与 v1 main.js:4-23 同帧——banner 不 await（后台播完），
      // onWin 同帧触发，遮罩与横幅同现、链尾 bump 不被横幅拖迟
      void banner(run, `${PNAME[e.winner]}胜利！`, 'bwin');
      run.ctx.onWin(e.winner);
      break;
    }
    case 'phase': break;
    default: break;
  }
}

/** move/hook 的位移权威归属（§6.2 第 4 条）：registry 取节点直写 left/top，
 *  与 React 链尾以同一 posOf 公式输出的终态数值恒等，故无跳变。 */
function movePieceTo(run: FxRun, g: Game, uid: number, x: number, y: number) {
  const p = g.state.pieces.find((q) => q.uid === uid);
  const el = run.ctx.registry.get(uid);
  if (!p || !el) return;
  const pos = posOf(x, y, !!p.big, M);
  el.style.left = pos.left + 'px';
  el.style.top = pos.top + 'px';
}
