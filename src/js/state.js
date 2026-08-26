/* ═══════════════ state.js · 游戏状态 / 快照悔棋 / 事件流 ═══════════════
 * 逻辑层不触碰 DOM：
 *   - 状态 S 是纯数据，可 JSON 序列化（悔棋 = 快照栈）
 *   - 动画通过事件队列 EV 传递给表现层
 *   - 需要玩家选择时通过 ENV.choose 异步注入（UI 或测试环境提供）
 * ═════════════════════════════════════════════════════════════════════ */

/** 表现层注入点：choose(spec) → Promise<target>；spec 形如
 *  {kind:'cell', cells:[{x,y}], kind2:'piece'|'cell'|'option', ...} */
const ENV = { choose: null };

/** 当前对局 */
let S = null;

/** 事件队列：逻辑层同步写入，UI 层在操作完成后异步播放。不入快照。 */
const EV = [];
function ev(type, data) { EV.push(Object.assign({ type }, data)); }

/** 悔棋快照栈（存序列化字符串，避免引用泄漏） */
const UNDO_MAX = 600;
let undoStack = [];

function pushLog(state, msg, cls) {
  state.log.push({ msg, cls: cls || '' });
  if (state.log.length > 300) state.log.shift();
}

/** 创建棋子（纯数据） */
function makePiece(state, owner, defId, x, y, hpOver) {
  const def = getDef(defId);
  const p = {
    uid: ++state.uidSeq,
    owner,
    defId,
    x, y,
    hp: hpOver != null ? hpOver : def.hp,
    maxHp: def.hp,
    atk: def.atk,
    range: def.rng,
    mv: def.mv,
    big: !!def.big || defId === 5,
    justDeployed: true,
    apLeft: 0,
    charge: 0,
    skillUses: 0,
    killCount: 0,
    guardUsed: false,
    mark10: null,
    shieldUntil: 0,
    reaperFrom: 0, reaperTo: 0,
    charmFrom: 0, charmTo: 0,
    atkBuffs: [],
    beatCount: 0,
    diesAt: 0,
    hitThisTurn: [],
  };
  return p;
}

/** 开新局。先手随机。 */
function newGame(seed) {
  undoStack = [];
  EV.length = 0;
  const st = {
    seed: seed >>> 0 || 1234567,
    turnCounter: 0,
    curPlayer: -1,
    phase: 'deploy',
    winner: null,
    pieces: [],
    hand: [[], []],
    stored: [[], []],
    extraDraw: [0, 0],
    extraRows: [[], []],
    uidSeq: 1000,
    log: [],
  };
  // 双方基地
  st.pieces.push(makePiece(st, 0, -1, 5, 1));
  st.pieces.push(makePiece(st, 1, -1, 5, H));
  S = st;
  pushLog(st, '⚔️ 「浩劫」开局！先手由天命决定……');
  return st;
}

/* ─────────── 悔棋 ─────────── */

/** 在一次玩家操作前调用：压入当前完整状态快照。 */
function snap() {
  undoStack.push(JSON.stringify(S));
  if (undoStack.length > UNDO_MAX) undoStack.shift();
}

/** 撤销最近一次操作；无可撤时返回 false。 */
function undo() {
  if (!undoStack.length) return false;
  S = JSON.parse(undoStack.pop());
  EV.length = 0; // 丢弃半途事件，直接整体重绘
  return true;
}

function canUndo() { return undoStack.length > 0 && !S.winner; }

/* ─────────── 常用查询 ─────────── */

function pieceAt(state, x, y) {
  for (const p of state.pieces) {
    if (p.dead) continue;
    if (p.big) {
      if (x >= p.x && x <= p.x + 1 && y >= p.y && y <= p.y + 1) return p;
    } else if (p.x === x && p.y === y) return p;
  }
  return null;
}

function pieceByUid(state, uid) {
  return state.pieces.find((p) => p.uid === uid && !p.dead) || null;
}

/** 有效攻击力（刀魂按周围人数实时计算，含临时增益） */
function effAtk(p) {
  const now = S.turnCounter;
  let a = p.defId === 33 ? bladeN(p) * 40 : p.atk;
  for (const b of p.atkBuffs) if (now < b.until) a += b.amt;
  return a;
}

const PNAME = ['蓝方', '红方'];
