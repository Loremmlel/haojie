/* fx.ts · 特效引擎（v1 src/js/fx.js 逐字平移 + §7.2 结构性改动）
 * 命令式特区：零 React import，仅靠 initFx 注入的 FxCtx 工作。
 * playChain(g) 消费 g.events（同一数组引用）按游标逐条播放，act/runSpellCast 链尾 await 后 bump。
 * 结构性改动（对照 v1）：
 *   - deploy：syncPieces() → await ctx.onSyncPoint()（受控提交物化新节点），pop-in 由 fx 接手（v1 buildPieceEl）；
 *   - death：删 el.remove() 与 UI.syncPieces()，节点由 React 链尾卸载（.dying 终态 opacity:0 无跳变）；
 *   - move/hook：registry 取节点直写 left/top（geometry.posOf 公式，与 React 终态数值恒等）；
 *   - turn/attack/charm：refreshTop/syncStatFlash/refreshAll 删除（链尾 bump 统一刷新，豁免表 1-3 条）；
 *   - win：fx 先自行播胜利横幅（对齐 v1 main.js:22 行为），再调 ctx.onWin（横幅归 FX、遮罩归 React）。 */
import type { Game } from '../../engine/types.ts';
import { W, H, getDef } from '../../engine/data.ts';
import { PNAME, type GameEvent } from '../../engine/state.ts';
import { nearestDist } from '../../engine/rules.ts';
import { posOf, type Metrics } from '../geometry.ts';
import { pieceRegistry } from './registry.ts';

export interface FxCtx {
  hosts: { boardOuter: HTMLElement; fxLayer: HTMLElement; banner: HTMLElement };
  registry: typeof pieceRegistry;
  getGame: () => Game;
  onWin: (winner: number) => void;
  onSyncPoint: () => Promise<void>;   // deploy 受控提交（bump + 双 rAF）
}

let ctx: FxCtx | null = null;
export function initFx(c: FxCtx): void { ctx = c; }
function fx(): FxCtx {
  if (!ctx) throw new Error('initFx 未装配——App 装配前不得调用特效');
  return ctx;
}

let evCursor = 0;         // 已播放游标（undo 清空 events 后经 > 防御重置）
let M: Metrics = { size: 48, gap: 3, pad: 10 };
export function setMetrics(m: Metrics): void { M = m; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 格子中心相对 #board-outer 的像素坐标 */
function centerOf(x: number, y: number) {
  return {
    cx: M.pad + (x - 0.5) * (M.size + M.gap),
    cy: M.pad + (H - y + 0.5) * (M.size + M.gap), // y=1 渲染在最下行
  };
}
function boardOuter() { return fx().hosts.boardOuter; }

function addEl(cls: string, styles: Record<string, string>, text?: string) {
  const el = document.createElement('div');
  el.className = cls;
  if (text != null) el.textContent = text;
  for (const k in styles) el.style.setProperty(k, styles[k]); // setProperty 兼容 --rot/--ring-w 等自定义属性
  fx().hosts.fxLayer.appendChild(el);
  return el;
}

/* ─────────── 特效原语 ─────────── */

async function flyNum(uid: number, text: string, cls: string) {
  const pEl = fx().registry.get(uid);
  const box = boardOuter().getBoundingClientRect();
  const r = pEl ? pEl.getBoundingClientRect() : box;
  const el = addEl('fly-num ' + cls, {
    left: (r.left - box.left + r.width / 2) + 'px',
    top: (r.top - box.top + r.height * 0.35) + 'px',
  }, text);
  await sleep(950);
  el.remove();
}

/** 近战冲刺：攻击者扑向目标再弹回 */
async function lunge(pEl: HTMLElement, tEl: HTMLElement) {
  const b = boardOuter().getBoundingClientRect();
  const pr = pEl.getBoundingClientRect(), tr = tEl.getBoundingClientRect();
  const dx = (tr.left + tr.width / 2) - (pr.left + pr.width / 2);
  const dy = (tr.top + tr.height / 2) - (pr.top + pr.height / 2);
  pEl.style.transition = 'transform .12s cubic-bezier(.5,0,.8,1)';
  pEl.style.transform = `translate(${dx * 0.55}px, ${dy * 0.55}px) scale(1.08)`;
  pEl.style.zIndex = '15'; // v1 数值 15，CSSOM 等义字符串
  await sleep(120);
  // 斩击线
  const ang = Math.atan2(dy, dx) * 180 / Math.PI + 90;
  const slash = addEl('slash', {
    left: (pr.left - b.left + pr.width / 2 + dx * 0.25 - 26) + 'px',
    top: (pr.top - b.top + pr.height / 2 + dy * 0.25 - 2) + 'px',
    width: '52px',
    '--rot': ang + 'deg',
  });
  setTimeout(() => slash.remove(), 300);
  pEl.style.transition = 'left .32s cubic-bezier(.34,1.3,.5,1), top .32s cubic-bezier(.34,1.3,.5,1), transform .22s';
  pEl.style.transform = '';
  setTimeout(() => { pEl.style.zIndex = ''; }, 350);
  await sleep(160);
}

/** 远程弹道（棋子 → 棋子） */
async function projectile(fromUid: number, toUid: number, color?: string, healMode?: boolean) {
  const pEl = fx().registry.get(fromUid), tEl = fx().registry.get(toUid);
  if (!pEl || !tEl) return;
  const b = boardOuter().getBoundingClientRect();
  const pr = pEl.getBoundingClientRect(), tr = tEl.getBoundingClientRect();
  const x1 = pr.left - b.left + pr.width / 2, y1 = pr.top - b.top + pr.height / 2;
  const x2 = tr.left - b.left + tr.width / 2, y2 = tr.top - b.top + tr.height / 2;
  await projectileTo(x1, y1, x2, y2, color);
  if (!healMode) hitRing(toUid, color || '#f87171');
}

/** 远程弹道原语（像素坐标 → 像素坐标） */
async function projectileTo(x1: number, y1: number, x2: number, y2: number, color?: string) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const dur = Math.min(420, Math.max(140, dist * 1.4));
  const bolt = addEl('bolt', { left: x1 + 'px', top: y1 + 'px', color: color || '#fbbf24' });
  bolt.style.transition = `left ${dur}ms linear, top ${dur}ms linear`;
  void bolt.offsetWidth;
  bolt.style.left = x2 + 'px'; bolt.style.top = y2 + 'px';
  await sleep(dur + 30);
  bolt.remove();
}

function hitRing(uid: number, color?: string) {
  const tEl = fx().registry.get(uid);
  if (!tEl) return;
  const r = tEl.getBoundingClientRect();
  tEl.classList.remove('hit-jolt'); void tEl.offsetWidth; tEl.classList.add('hit-jolt');
  const ring = addEl('ring', {
    left: (r.left - boardOuter().getBoundingClientRect().left + r.width / 2) + 'px',
    top: (r.top - boardOuter().getBoundingClientRect().top + r.height / 2) + 'px',
    color: color || '',
    '--ring-w': r.width * 1.7 + 'px',
  });
  setTimeout(() => ring.remove(), 600);
}

/** 爆炸粒子（爆弹/死亡等） */
function boomAt(px: number, py: number, color: string, n?: number) {
  for (let i = 0; i < (n || 8); i++) {
    const ang = Math.random() * Math.PI * 2;
    const d = 24 + Math.random() * 42;
    const b = addEl('boom', {
      left: px + 'px', top: py + 'px', color,
      background: color,
      '--dx': Math.cos(ang) * d + 'px', '--dy': Math.sin(ang) * d + 'px',
      width: 5 + Math.random() * 7 + 'px', height: 5 + Math.random() * 7 + 'px',
    });
    setTimeout(() => b.remove(), 750);
  }
}

async function spellIcon(text: string, x: number, y: number) {
  const { cx, cy } = centerOf(x, y);
  const el = addEl('spell-cast', { left: cx + 'px', top: cy + 'px' }, text);
  await sleep(750);
  el.remove();
}

export async function banner(text: string, cls: string): Promise<void> {
  const el = fx().hosts.banner;
  el.textContent = text;
  el.className = cls || '';
  await sleep(1050);
  el.className = 'hidden';
}

export function shake() {
  document.body.classList.remove('shake');
  void document.body.offsetWidth;
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 420);
}

/* ─────────── 事件 → 动画调度 ─────────── */

export async function playChain(g: Game): Promise<void> {
  const events = g.events;
  if (evCursor > events.length) evCursor = 0; // 悔棋清空事件队列后重置游标
  while (evCursor < events.length) {
    const e = events[evCursor++];
    try { await playOne(e); } catch (err) { console.error('fx error', e, err); }
  }
}

async function playOne(e: GameEvent): Promise<void> {
  const g = fx().getGame();
  switch (e.type) {
    case 'turn': {
      // refreshTop 删除（链尾 bump 统一刷新，豁免表第 2 条）
      await banner(`第 ${e.turn} 回合 · ${PNAME[e.player]}行动`, e.player === 0 ? 'b1' : 'b2');
      break;
    }
    case 'deploy': {
      await fx().onSyncPoint(); // 受控提交：bump + 双 rAF 确保新节点物化、注册表就绪
      const el = fx().registry.get(e.uid);
      if (el) { // v1 buildPieceEl 的 pop-in 由 fx 接手（React 只物化节点，不加 fx 命令式类）
        el.classList.add('pop-in');
        setTimeout(() => el.classList.remove('pop-in'), 500);
      }
      break;
    }
    case 'move': {
      movePieceTo(e.uid, e.tx, e.ty);
      await sleep(340);
      break;
    }
    case 'hook': {
      // 钩链飞向目标原位置 → 勾住拉回
      const h = centerOf(e.fx, e.fy), t = centerOf(e.x0, e.y0);
      await projectileTo(h.cx, h.cy, t.cx, t.cy, '#fda4af');
      movePieceTo(e.uid, e.tx, e.ty);
      await sleep(340);
      break;
    }
    case 'attack': {
      const atkP = g.state.pieces.find((q) => q.uid === e.uid);
      const tEl = fx().registry.get(e.tuid);
      if (!atkP || !tEl) break;
      if (e.healMode) { await projectile(e.uid, e.tuid, '#34d399', true); break; }
      // syncStatFlash 删除（链尾 bump 统一刷新，豁免表第 1 条）
      const isRanged = nearestDist(
        atkP,
        g.state.pieces.find((q) => q.uid === e.tuid)! // tEl 在注册表 ⇒ 目标存活，必在 state
      ) > 1;
      if (isRanged) await projectile(e.uid, e.tuid, '#fbbf24');
      else await lunge(fx().registry.get(e.uid)!, tEl);
      break;
    }
    case 'damage': {
      const st = g.state;
      const victim = st.pieces.find((q) => q.uid === e.uid);
      if (victim && !e.silentNum) {
        await flyNum(e.uid, '-' + e.amount + (e.frontal ? '（正面）' : ''), e.crit ? 'crit' : 'dmg');
        if (e.amount >= 60 || e.crit) shake();
      }
      break;
    }
    case 'heal': {
      await flyNum(e.uid, '+' + e.amount, 'heal');
      break;
    }
    case 'buff': {
      await flyNum(e.uid, '▲ 强化', 'buff');
      break;
    }
    case 'guard': {
      const tEl = fx().registry.get(e.uid);
      if (tEl) {
        const r = tEl.getBoundingClientRect();
        boomAt(r.left - boardOuter().getBoundingClientRect().left + r.width / 2,
               r.top - boardOuter().getBoundingClientRect().top + r.height / 2,
               '#7dd3fc', 10);
      }
      await flyNum(e.uid, '🗡️ 名刀！', 'buff');
      break;
    }
    case 'block': {
      await flyNum(e.uid, '🛡️ 免疫', 'buff');
      break;
    }
    case 'mark': {
      await flyNum(e.uid, '🎯 引信', 'buff');
      break;
    }
    case 'counter': {
      await flyNum(e.uid, '🔄 反弹！', 'buff');
      shake();
      break;
    }
    case 'charm': {
      await flyNum(e.uid, '🎭 倒戈！', 'buff');
      shake();
      // refreshAll 删除（链尾 bump 统一刷新，豁免表第 3 条）
      break;
    }
    case 'death': {
      const el = fx().registry.get(e.uid);
      if (el) {
        const r = el.getBoundingClientRect();
        const b = boardOuter().getBoundingClientRect();
        boomAt(r.left - b.left + r.width / 2, r.top - b.top + r.height / 2, getDef(e.defId).type === 'base' ? '#fbbf24' : '#94a3b8', 12);
        el.classList.add('dying');
        await sleep(480); // 节点保留：由 React 链尾卸载（.dying 终态 opacity:0，无跳变）
      }
      if (getDef(e.defId).type === 'base') shake();
      break;
    }
    case 'spell': {
      const def = getDef(e.defId);
      if (e.defId === 8) {
        await spellIcon('💣', e.x! + 0.5, e.y! + 0.5); // defId 8 的 spell 事件必带 x/y（spells.ts:39）
        // 田字四格（锚点为左上格）中心各炸一次
        for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) {
          const { cx, cy } = centerOf(e.x! + dx, e.y! + dy);
          boomAt(cx, cy, '#fb923c', 7);
        }
        shake();
        await sleep(250);
      } else if (e.uid != null) {
        const icons: Record<number, string> = { 17: '🛡️', 18: '💀', 22: '🎭' };
        await spellIcon(icons[e.defId] || def.emoji,
          g.state.pieces.find((q) => q.uid === e.uid)?.x || W / 2,
          g.state.pieces.find((q) => q.uid === e.uid)?.y || H / 2);
      }
      break;
    }
    case 'expire': break;
    case 'win': {
      // 横幅归 FX、遮罩归 React：与 v1 main.js:4-23 同帧——banner 不 await（后台播完），
      // onWin 同帧触发，遮罩与横幅同现、链尾 bump 不被横幅 1050ms 拖迟
      void banner(`${PNAME[e.winner]}胜利！`, 'bwin');
      fx().onWin(e.winner);
      break;
    }
    case 'phase': break;
    default: break;
  }
}

/** move/hook 的位移权威归属（§6.2 第 4 条）：registry 取节点直写 left/top，
 *  与 React 链尾以同一 posOf 公式输出的终态数值恒等，故无跳变。 */
function movePieceTo(uid: number, x: number, y: number) {
  const p = fx().getGame().state.pieces.find((q) => q.uid === uid);
  const el = fx().registry.get(uid);
  if (!p || !el) return;
  const pos = posOf(x, y, !!p.big, M);
  el.style.left = pos.left + 'px';
  el.style.top = pos.top + 'px';
}
