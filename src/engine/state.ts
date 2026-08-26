/* state.ts · 游戏状态类型 / 会话体 / 快照悔棋 */
import { getDef, W, H, type Cell } from './data.ts';

export type Owner = 0 | 1;
export type Phase = 'deploy' | 'action' | 'over';

export interface Card { uid: number; defId: number }
export interface StoredCard { defId: number; remain: number }
export interface LogEntry { msg: string; cls: string }
export interface AtkBuff { amt: number; until: number }
export interface Mark10 { owner: Owner; srcUid: number; expires: number }

export interface Piece {
  uid: number; owner: Owner; defId: number; x: number; y: number;
  hp: number; maxHp: number; atk: number; range: number; mv: number;
  big: boolean; justDeployed: boolean; apLeft: number; charge: number;
  skillUses: number; killCount: number; guardUsed: boolean;
  mark10: Mark10 | null; shieldUntil: number;
  reaperFrom: number; reaperTo: number; charmFrom: number; charmTo: number;
  atkBuffs: AtkBuff[]; beatCount: number; diesAt: number;
  hitThisTurn: number[];
  /** killPiece 动态标记；JSON 序列化天然兼容 */
  dead?: boolean;
}

export interface GameState {
  seed: number; turnCounter: number; curPlayer: number; // curPlayer 初值为 -1（开局随机前）
  phase: Phase; winner: number | null;
  pieces: Piece[]; hand: [Card[], Card[]]; stored: [StoredCard[], StoredCard[]];
  extraDraw: [number, number]; extraRows: [number[], number[]];
  uidSeq: number; log: LogEntry[];
}

/* ── 事件流：判别联合（字段与 v1 各 emit 点逐一对齐）── */
export type GameEvent =
  | { type: 'turn'; player: number; turn: number }
  | { type: 'deploy'; uid: number }
  | { type: 'move'; uid: number; tx: number; ty: number }
  | { type: 'hook'; uid: number; fx: number; fy: number; x0: number; y0: number; tx: number; ty: number }
  | { type: 'attack'; uid: number; tuid: number; healMode?: boolean }
  | { type: 'damage'; uid: number; amount: number; frontal?: boolean; crit?: boolean; silentNum?: boolean }
  | { type: 'heal'; uid: number; amount: number }
  | { type: 'buff'; uid: number }
  | { type: 'guard'; uid: number }
  | { type: 'block'; uid: number }
  | { type: 'mark'; uid: number }
  | { type: 'counter'; uid: number }
  | { type: 'charm'; uid: number }
  | { type: 'death'; uid: number; defId: number }
  | { type: 'spell'; defId: number; x?: number; y?: number; uid?: number }
  | { type: 'expire'; owner: number }
  | { type: 'win'; winner: number }
  | { type: 'phase'; phase: Phase };

/* ── 目标选择契约（裁定 R2）── */
export type ChoiceSpec =
  | { kind: 'none' }
  | { kind: 'option'; options: { label: string; value: string }[]; hint?: string; cancelable?: boolean }
  | { kind: 'cell'; cells: Cell[]; hint?: string; cancelable?: boolean }
  | { kind: 'piece'; pieces: Piece[]; hint?: string; cancelable?: boolean };
export type ChoiceResult = Cell | Piece | string | null;
export type Chooser = (spec: ChoiceSpec) => Promise<ChoiceResult>;

/* ── 会话体：收拢 v1 的四个模块级全局（裁定 R1）── */
export interface PendingDeath { victim: Piece; killer: Piece | null }
export interface Session {
  state: GameState;
  events: GameEvent[];        // 易失队列，不入快照（undo 时清空）
  undoStack: string[];
  pendingDeaths: PendingDeath[];
}
export const UNDO_MAX = 600;
export function ev(s: Session, e: GameEvent): void { s.events.push(e); }

export function pushLog(state: GameState, msg: string, cls = ''): void {
  state.log.push({ msg, cls: cls || '' });
  if (state.log.length > 300) state.log.shift();
}
export function makePiece(state: GameState, owner: Owner, defId: number,
                          x: number, y: number, hpOver?: number): Piece {
  const def = getDef(defId);
  const p: Piece = {
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
export function newGame(seed: number): GameState {
  const st: GameState = {
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
  pushLog(st, '⚔️ 「浩劫」开局！先手由天命决定……');
  return st;
}

/* ── 快照悔棋（Session 化）── */
export function snap(s: Session): void {
  s.undoStack.push(JSON.stringify(s.state));
  if (s.undoStack.length > UNDO_MAX) s.undoStack.shift();
}
export function undo(s: Session): boolean {
  if (!s.undoStack.length) return false;
  s.state = JSON.parse(s.undoStack.pop()!);
  s.events.length = 0;
  return true;
}
export function canUndo(s: Session): boolean {
  return s.undoStack.length > 0 && !s.state.winner;
}

/* ── 常用查询 ── */
export function pieceAt(state: GameState, x: number, y: number): Piece | null {
  for (const p of state.pieces) {
    if (p.dead) continue;
    if (p.big) {
      if (x >= p.x && x <= p.x + 1 && y >= p.y && y <= p.y + 1) return p;
    } else if (p.x === x && p.y === y) return p;
  }
  return null;
}
export function pieceByUid(state: GameState, uid: number): Piece | null {
  return state.pieces.find((p) => p.uid === uid && !p.dead) || null;
}

export const PNAME = ['蓝方', '红方'] as const;
