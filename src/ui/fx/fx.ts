/* fx.ts · 特效引擎（v1 src/js/fx.js 平移 + Motion 迁移后的现役实现）
 * 命令式特区：零 React import，仅靠 initFx 注入的 FxCtx 工作；playChain(g) 消费
 * g.events（同一数组引用）按游标逐条播放，act/runSpellCast 链尾 await 后 bump 统一刷新
 * （事件段不直接调 refreshStat）。
 * 生命周期：initFx 建立 FxRun（alive/controls/nodes），resetFx 取消——controls 停止、
 * 节点整批移除；run.alive=false 后链尾静默返回，旧 completion 只写自身捕获的旧元素。
 * 结构：棋子 root 只动 left/top（movePieceTo 的 Motion 驱动，posOf 公式与 React 终态
 * 数值恒等）与持久态 CSS；lunge/hit/deploy/death 的 temporary transform 只写内层
 * [data-piece-motion]（pieceMotion），与 React 持久态互不踩写。
 * reduced-motion（prefersReducedMotion）只参数化时长/兜底，不改 playOne 分支与 await 顺序。
 * Motion promise 由 rAF 驱动；settle 以同量级 sleep 兜底（headless 虚拟时间下动画时钟与
 * 虚拟定时器不同步、promise 可能不结算；真实浏览器动画恒先完成，兜底即弃）。 */
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
    () => {},
    (err) => { if (run.alive) console.error('fx settle error', err); }, // 真实动画失败可见（headless 兜底赢时此支恒不触发）
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

/** 只读查询：uid 是否为「死亡事件已入列、尚未被链消费」的尸体（PiecesLayer 过滤用）。
 *  引擎从不从 pieces 移除死亡棋子（killPiece 只设 dead=true），只能按「事件游标」判定
 *  暂挂窗：死亡事件由 fn 同步入列（早于 React 对 busy/dead 的批量渲染），
 *  playChain 消费后才过游标——链首到链尾全程命中，链尾之后（含任意后续 busy 链，
 *  旧 !p.dead || ia.busy 过滤会在每条后续链开头把 0HP 尸体重新挂载）不再命中。 */
/** 纯扫描：events[cursor…length) 是否存在 uid 的未消费死亡事件（零 DOM/模块态依赖，
 *  导出供 node 单元测试直测）。游标越界（undo 截断 events 而模块级 evCursor 保持高位
 *  ——仅 initFx/playChain 的 > 防御重写，且后者落在链尾）时 clamp 回 0 重扫，与 playChain
 *  的 > 防御同语义（越界即视为从 0 重扫）：否则新链的死亡事件回填 index 0..N 时，照
 *  [evCursor…length) 扫描是空集，尸体会在死亡 FX 前被卸载。 */
export function deathPending(events: readonly GameEvent[], cursor: number, uid: number): boolean {
  for (let i = (cursor > events.length ? 0 : cursor); i < events.length; i++) {
    const e = events[i];
    if (e.type === 'death' && e.uid === uid) return true;
  }
  return false;
}

export function isDying(g: Game, uid: number): boolean {
  return deathPending(g.events, evCursor, uid);
}

let evCursor = 0;         // 已播放游标（undo 清空 events 后经 > 防御重置）
let M: Metrics = { size: 48, gap: 3, pad: 10 };
export function setMetrics(m: Metrics): void { M = m; }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(() => r(), ms));

/** Task 5：系统 reduced-motion 偏好。只参数化演出时长/兜底时长，一律不改控制流。 */
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 格子中心相对 #board-outer 的像素坐标 */
function centerOf(x: number, y: number) {
  return {
    cx: M.pad + (x - 0.5) * (M.size + M.gap),
    cy: M.pad + (H - y + 0.5) * (M.size + M.gap), // y=1 渲染在最下行
  };
}
function boardOuterOf(run: FxRun) { return run.ctx.hosts.boardOuter; }

/** 棋子的 inner motion 节点（Task 3）：root 由 registry 持有（布局/点击/持久态），
 *  temporary transform 一律写内层 [data-piece-motion]，与 React 持久态 CSS 互不踩写。 */
function pieceMotion(run: FxRun, uid: number): HTMLElement | null {
  return run.ctx.registry.get(uid)?.querySelector<HTMLElement>('[data-piece-motion]') ?? null;
}

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
  const opts = { duration: prefersReducedMotion() ? 0.05 : 0.7, ease: 'easeOut' as const };
  const controls = animate(el, kf, opts);
  transient(run, el, controls);
}

/** 近战冲刺（Task 3）：inner 扑向目标再弹回（x/y/scale 单动画 out-and-back），
 *  zIndex 由 root 提升（finally 恢复）；斩击线 slash 为 transient Motion。 */
async function lunge(run: FxRun, pEl: HTMLElement, tEl: HTMLElement) {
  const rm = prefersReducedMotion();
  const b = boardOuterOf(run).getBoundingClientRect();
  const pr = pEl.getBoundingClientRect(), tr = tEl.getBoundingClientRect();
  const dx = (tr.left + tr.width / 2) - (pr.left + pr.width / 2);
  const dy = (tr.top + tr.height / 2) - (pr.top + pr.height / 2);
  const body = pEl.querySelector<HTMLElement>('[data-piece-motion]');
  pEl.style.zIndex = '15'; // v1 数值 15，CSSOM 等义字符串
  try {
    if (body) {
      const kf = { x: [0, dx * 0.55, 0], y: [0, dy * 0.55, 0], scale: [1, 1.08, 1] };
      const opts = { duration: rm ? 0.06 : 0.28, ease: 'easeOut' as const };
      await settle(run, animate(body, kf, opts), rm ? 200 : 430);
    } else {
      await sleep(rm ? 40 : 120);
    }
    if (run.alive) {
      // 斩击线（transient Motion：与旧 keyframes slashGo 等值——scaleX 0→1、opacity 渐隐，角度恒常）
      const ang = Math.atan2(dy, dx) * 180 / Math.PI + 90;
      const slash = addEl(run, 'slash', {
        left: (pr.left - b.left + pr.width / 2 + dx * 0.25 - 26) + 'px',
        top: (pr.top - b.top + pr.height / 2 + dy * 0.25 - 2) + 'px',
        width: '52px',
      });
      const kf = { scaleX: [0, 1], rotate: [ang + 'deg', ang + 'deg'], opacity: [0, 1, 0.1] };
      const opts = { duration: rm ? 0.05 : 0.26, ease: 'easeOut' as const };
      transient(run, slash, animate(slash, kf, opts)); // slash 为 transient（非阻塞），无必要尾等
    }
  } finally {
    pEl.style.zIndex = ''; // finally 恒恢复：即便 body 分支异常/取消也不残留提升层
  }
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
  const rm = prefersReducedMotion();
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const dur = rm ? 60 : Math.min(420, Math.max(140, dist * 1.4));
  const el = addEl(run, 'bolt', { left: x1 + 'px', top: y1 + 'px', color: color || '#fbbf24' });
  const kf = { left: x2 + 'px', top: y2 + 'px' };
  const opts = { duration: dur / 1000, ease: 'linear' as const };
  const controls = animate(el, kf, opts);
  await settle(run, controls, rm ? 200 : dur + 150);
  if (run.alive) dropEl(run, el);
}

function hitRing(run: FxRun, uid: number, color?: string) {
  const rm = prefersReducedMotion();
  const tEl = run.ctx.registry.get(uid);
  if (!tEl) return;
  const r = tEl.getBoundingClientRect();
  // 受击抖动（非阻塞，与旧 jolt keyframes 等值）：只写 inner，不动 root 持久态样式。
  const body = pieceMotion(run, uid);
  if (body) {
    const kf = { x: [0, -4, 4, 0], y: [0, 2, -2, 0], scale: [1, 0.95, 0.97, 1] };
    const opts = { duration: rm ? 0.05 : 0.3, ease: 'easeOut' as const };
    background(run, animate(body, kf, opts));
  }
  const ring = addEl(run, 'ring', {
    left: (r.left - boardOuterOf(run).getBoundingClientRect().left + r.width / 2) + 'px',
    top: (r.top - boardOuterOf(run).getBoundingClientRect().top + r.height / 2) + 'px',
    color: color || '',
  });
  const kf = { width: [8, r.width * 1.7 + 'px'], height: [8, r.width * 1.7 + 'px'], opacity: [1, 0] };
  const opts = { duration: rm ? 0.05 : 0.55, ease: [0.2, 0.8, 0.3, 1] as const };
  const controls = animate(ring, kf, opts);
  transient(run, ring, controls);
}

/** 爆炸粒子（爆弹/死亡等） */
function boomAt(run: FxRun, px: number, py: number, color: string, n?: number) {
  const rm = prefersReducedMotion();
  for (let i = 0; i < (n || 8); i++) {
    const ang = Math.random() * Math.PI * 2;
    const d = 24 + Math.random() * 42;
    const b = addEl(run, 'boom', {
      left: px + 'px', top: py + 'px', color,
      background: color,
      width: 5 + Math.random() * 7 + 'px', height: 5 + Math.random() * 7 + 'px',
    });
    const kf = { x: Math.cos(ang) * d + 'px', y: Math.sin(ang) * d + 'px', rotate: [45, 345], scale: [1, 0.3], opacity: [1, 0] };
    const opts = { duration: rm ? 0.05 : 0.7, ease: [0.15, 0.6, 0.4, 1] as const };
    const controls = animate(b, kf, opts);
    transient(run, b, controls);
  }
}

/** 法术图标：阻塞到弹出完成。 */
async function spellIcon(run: FxRun, text: string, x: number, y: number) {
  const rm = prefersReducedMotion();
  const { cx, cy } = centerOf(x, y);
  const el = addEl(run, 'spell-cast', { left: cx + 'px', top: cy + 'px' }, text);
  const kf = {
    opacity: [0, 1, 1, 0],
    scale: [0.2, 1.3, 1, 1],
    rotate: [-30, 6, 0, 0],
    y: ['0%', '0%', '0%', '-40%'],
  };
  const opts = { duration: rm ? 0.06 : 0.75, ease: 'easeOut' as const };
  const controls = animate(el, kf, opts);
  await settle(run, controls, rm ? 200 : 900);
  if (run.alive) dropEl(run, el);
}

export async function banner(run: FxRun, text: string, cls: string): Promise<void> {
  const rm = prefersReducedMotion();
  const el = run.ctx.hosts.banner; // 捕获旧横幅：取消后 completion 只写自身旧元素
  el.textContent = text;
  el.className = cls || '';
  const kf = { opacity: [0, 1, 1, 0], scaleX: [0.2, 1, 1, 1.05] };
  const opts = { duration: rm ? 0.06 : 1.05, ease: 'easeOut' as const };
  const controls = animate(el, kf, opts);
  await settle(run, controls, rm ? 200 : 1250);
  if (run.alive) el.className = 'hidden';
}

/** 棋盘震动：boardOuter x/y keyframes（替代 body.shake + CSS keyframes）。 */
function shake(run: FxRun) {
  const el = boardOuterOf(run);
  const kf = { x: [0, -7, 6, -4, 0], y: [0, 4, -5, 2, 0] };
  const opts = { duration: prefersReducedMotion() ? 0.05 : 0.38, ease: 'easeOut' as const };
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
      await banner(run, `第 ${e.turn} 回合 · ${PNAME[e.player]}行动`, e.player === 0 ? 'b1' : 'b2');
      break;
    }
    case 'deploy': {
      await run.ctx.onSyncPoint(); // 受控提交：bump + 双 rAF 确保新节点物化、注册表就绪
      if (!run.alive) break; // 取消/重启后注册表可能已换局（uid 复用）——守卫，不碰新 DOM
      // v1 buildPieceEl 的 pop-in 由 fx 接手（React 只物化节点）：非阻塞 inner 入场
      const body = pieceMotion(run, e.uid);
      if (body) {
        const kf = { scale: [0.15, 1], y: ['-14px', '0px'], opacity: [0, 1] };
        const opts = { duration: prefersReducedMotion() ? 0.05 : 0.42, ease: [0.34, 1.56, 0.64, 1] as const };
        background(run, animate(body, kf, opts));
      }
      break;
    }
    case 'move': {
      await movePieceTo(run, g, e.uid, e.tx, e.ty);
      break;
    }
    case 'hook': {
      // 钩链飞向目标原位置 → 勾住拉回
      const h = centerOf(e.fx, e.fy), t = centerOf(e.x0, e.y0);
      await projectileTo(run, h.cx, h.cy, t.cx, t.cy, '#fda4af');
      await movePieceTo(run, g, e.uid, e.tx, e.ty);
      break;
    }
    case 'attack': {
      const atkP = g.state.pieces.find((q) => q.uid === e.uid);
      const tEl = run.ctx.registry.get(e.tuid);
      if (!atkP || !tEl) break;
      if (e.healMode) { await projectile(run, e.uid, e.tuid, '#34d399', true); break; }
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
      break;
    }
    case 'death': {
      const rm = prefersReducedMotion();
      const el = run.ctx.registry.get(e.uid);
      if (el) {
        const r = el.getBoundingClientRect();
        const b = boardOuterOf(run).getBoundingClientRect();
        boomAt(run, r.left - b.left + r.width / 2, r.top - b.top + r.height / 2, getDef(e.defId).type === 'base' ? '#fbbf24' : '#94a3b8', 12);
        // 死亡动画（inner，阻塞到完成）：节点保留，由 React 链尾卸载（终态 opacity:0 无跳变）
        const body = pieceMotion(run, e.uid);
        if (body) {
          const kf = {
            scale: [1, 0.2], rotate: [0, 80], opacity: [1, 0],
            filter: ['brightness(2)', 'brightness(3) blur(2px)'],
          };
          const opts = { duration: rm ? 0.06 : 0.48, ease: 'easeIn' as const };
          await settle(run, animate(body, kf, opts), rm ? 200 : 720);
        } else {
          await sleep(rm ? 80 : 480);
        }
      }
      // 基地阵亡震屏：await 后的写入点，重启取消时不得震新局棋盘
      if (run.alive && getDef(e.defId).type === 'base') shake(run);
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
        await sleep(prefersReducedMotion() ? 60 : 250);
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

/** move/hook 的位移权威归属（§6.2 第 4 条）：Motion 动 root 的 left/top，
 *  与 React 链尾以同一 posOf 公式输出的终态数值恒等，故无跳变；root 无 CSS left/top transition。 */
async function movePieceTo(run: FxRun, g: Game, uid: number, x: number, y: number) {
  const rm = prefersReducedMotion();
  const p = g.state.pieces.find((q) => q.uid === uid);
  const root = run.ctx.registry.get(uid);
  if (!p || !root) return;
  const pos = posOf(x, y, !!p.big, M);
  const kf = { left: pos.left + 'px', top: pos.top + 'px' };
  const opts = { duration: rm ? 0.06 : 0.32, ease: [0.34, 1.3, 0.5, 1] as const };
  await settle(run, animate(root, kf, opts), rm ? 200 : 500);
}
