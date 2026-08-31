/* effects.ts · 棋子效果之家：PieceEffect 基类 + EFFECTS 注册表 + 全局助手
 * 钩子只收编「以 defId 分发的硬编码分支」；状态驱动的通用管线步骤留在 engine。
 * 与 engine.ts 存在调用时循环引用（旧 abilities.ts↔engine.ts 同构）：
 * EFFECTS 顶层只做纯构造，交叉调用一律发生在运行时。 */

import { getDef, W, H, type Cell } from './data.ts';
import { rnd } from './rng.ts';
import { PNAME, ev, pushLog, makePiece, pieceAt,
         type Session, type GameState, type Piece, type Owner, type ChoiceSpec, type ChoiceResult } from './state.ts';
import { mdist, inBoard, pieceCells, nearestDist, bfsEmptyCells, DIRS, isFrontal } from './geometry.ts';
import type { HandlerCtx } from './types.ts';
import { dealDamage, killPiece, heal, flushDeaths, performAttack } from './engine.ts';

/* ── 通用助手 ── */
function foesOf(state: GameState, owner: number): Piece[] {
  return state.pieces.filter((q) => !q.dead && q.owner !== owner);
}
/** 敌方随从（不含基地） */
function foeFollowers(state: GameState, owner: number): Piece[] {
  return foesOf(state, owner).filter((q) => getDef(q.defId).type === 'follower' || getDef(q.defId).type === 'grave');
}
/** 己方随从（不含基地） */
function myFollowers(state: GameState, owner: number): Piece[] {
  return state.pieces.filter((q) => !q.dead && q.owner === owner &&
    (getDef(q.defId).type === 'follower' || getDef(q.defId).type === 'grave'));
}
/** 12 号贴脸：与任意敌方距离 1 格 */
function adjacentFoe(st: GameState, p: Piece): boolean {
  return st.pieces.some((q) => !q.dead && q.owner !== p.owner && nearestDist(p, q) === 1);
}
/** 33 号刀魂的 n：以其为中心 3×3 内随从数量（双方、含自身、实时计算） */
function bladeN(st: GameState, p: Piece): number {
  let n = 0;
  for (const q of st.pieces) {
    if (q.dead) continue;
    const t = getDef(q.defId).type;
    if (t !== 'follower' && t !== 'grave') continue;
    for (const c of pieceCells(q)) {
      if (Math.abs(c.x - p.x) <= 1 && Math.abs(c.y - p.y) <= 1) { n++; break; }
    }
  }
  return Math.max(1, n);
}

/* ═════════════ 基类：默认实现 = 无特殊棋子的旧行为 ═════════════ */
export class PieceEffect {
  // ── 静态属性（定义性事实）──
  buffable = true;          // 10 投石机 = false（6 BUFF怪 增益过滤）
  isCatapult = false;       // 10 投石机 = true（标记引爆防御性守卫）

  // ── 查询钩子（纯函数）──
  effRange(_st: GameState, p: Piece): number { return p.range; }
  effAtk(st: GameState, p: Piece): number {
    let a = p.atk;
    for (const b of p.atkBuffs) if (st.turnCounter < b.until) a += b.amt;
    return a;
  }
  effActions(_st: GameState, p: Piece): number { return getDef(p.defId).acts; }
  effMv(_st: GameState, p: Piece): number { return p.mv; }
  /** 攻击目标计算用的射程（4 号蓄满 +1 的接缝，不外泄到 effRange 消费方） */
  attackRange(st: GameState, p: Piece): number { return this.effRange(st, p); }
  moveTargets(st: GameState, p: Piece): Cell[] {
    if (p.big) {
      const out: Cell[] = [];
      const occupied = new Set<string>();
      for (const q of st.pieces) {
        if (q.dead || q.uid === p.uid) continue;
        for (const c of pieceCells(q)) occupied.add(c.x + ',' + c.y);
      }
      for (const [dx, dy] of DIRS) {
        let ok = true;
        for (const c of pieceCells(p)) {
          const nx = c.x + dx, ny = c.y + dy;
          if (!inBoard(nx, ny) || occupied.has(nx + ',' + ny) || blocksAlly(st, nx, ny, p.owner)) { ok = false; break; }
        }
        if (ok) out.push({ x: p.x + dx, y: p.y + dy });
      }
      return out;
    }
    return bfsEmptyCells(st, p, this.effMv(st, p), (x, y) => blocksAlly(st, x, y, p.owner));
  }
  attackTargets(st: GameState, p: Piece): Piece[] {
    const out: Piece[] = [];
    const rngEff = this.attackRange(st, p);
    const myCells = new Set<string>(pieceCells(p).map((c) => c.x + ',' + c.y));
    const candidates = st.pieces.filter((q) =>
      !q.dead && q.owner !== p.owner && nearestDist(p, q) <= rngEff);
    for (const t of candidates) {
      const tKeys = new Set<string>(pieceCells(t).map((c) => c.x + ',' + c.y));
      const dist = new Map<string, number>();
      let frontier: string[] = [];
      for (const k of myCells) { dist.set(k, 0); frontier.push(k); }
      let reach = -1;
      bfs:
      while (frontier.length) {
        const next: string[] = [];
        for (const key of frontier) {
          const d0 = dist.get(key)!;
          if (d0 >= rngEff) continue;
          const [cx, cy] = key.split(',').map(Number);
          for (const [dx, dy] of DIRS) {
            const nx = cx + dx, ny = cy + dy;
            if (!inBoard(nx, ny)) continue;
            const nk = nx + ',' + ny;
            if (dist.has(nk)) continue;
            if (tKeys.has(nk)) { if (d0 + 1 <= rngEff) { reach = d0 + 1; break bfs; } continue; }
            const occ = pieceAt(st, nx, ny);
            if (occ && occ.owner !== p.owner) continue;
            dist.set(nk, d0 + 1);
            next.push(nk);
          }
        }
        frontier = next;
      }
      if (reach >= 0) out.push(t);
    }
    return out;
  }
  modifyIncomingDamage(_st: GameState, _target: Piece, amount: number,
                       _src: Piece | null, _opts: { hit?: boolean }): { amount: number; frontal: boolean } {
    return { amount, frontal: false };
  }
  modifyAttackDamage(_st: GameState, _p: Piece, _target: Piece, dmg: number): { dmg: number; crit: boolean } {
    return { dmg, crit: false };
  }

  // ── 触发器钩子（副作用，默认空）──
  async onDeploy(_ctx: HandlerCtx, _s: Session, _p: Piece): Promise<void> {}
  async onTurnStart(_ctx: HandlerCtx, _s: Session, _p: Piece): Promise<void> {}
  async onMoveCommand(_ctx: HandlerCtx, _s: Session, _p: Piece, _x: number, _y: number): Promise<boolean> { return false; }
  async onAttackSelected(_ctx: HandlerCtx, _s: Session, _p: Piece, _t: Piece): Promise<boolean> { return false; }
  async onAttack(_ctx: HandlerCtx, _s: Session, _p: Piece, _target: Piece): Promise<boolean> { return false; }
  async onAttackDone(_ctx: HandlerCtx, _s: Session, _p: Piece, _target: Piece): Promise<void> {}
  async onDamaged(_ctx: HandlerCtx, _s: Session, _target: Piece, _amount: number,
                  _src: Piece | null, _opts: { noCounter?: boolean }): Promise<void> {}
  async onKill(_ctx: HandlerCtx, _s: Session, _killer: Piece, _victim: Piece): Promise<void> {}
  async onDeath(_ctx: HandlerCtx, _s: Session, _victim: Piece, _killer: Piece | null): Promise<void> {}

  // ── 全局查询钩子 ──
  blocksAllyCell(_st: GameState, _p: Piece, _x: number, _y: number, _owner: Owner): boolean { return false; }
  guardsAlly(_st: GameState, _blade: Piece, _ally: Piece): boolean { return false; }

  // ── 主动技能（无则缺省）──
  skillLabel?: string;
  skillUsable?(_p: Piece): boolean { return true; }
  skillTargetSpec?(_st: GameState, _p: Piece): ChoiceSpec { return { kind: 'none' }; }
  async skillExec?(_ctx: HandlerCtx, _s: Session, _p: Piece, _got: ChoiceResult): Promise<void> {}
}

/* ═════════════ 查询层棋子效果 ═════════════ */

/** 33 刀魂：随 3×3 内随从数实时波动攻/射程（名刀的另一形态，见 3 号 form） */
class BladeEffect extends PieceEffect {
  effRange(st: GameState, p: Piece): number { return bladeN(st, p); }
  effAtk(st: GameState, p: Piece): number {
    const now = st.turnCounter;
    let a = bladeN(st, p) * 40;
    for (const b of p.atkBuffs) if (now < b.until) a += b.amt;
    return a;
  }
}

/** 12 跑得快：贴脸减速减攻速（一个实现，旧 effActions/effMv 双份重复的收敛点）；遗言留墓地 */
class SpeedyEffect extends PieceEffect {
  effActions(st: GameState, p: Piece): number {
    let n = getDef(p.defId).acts;
    if (adjacentFoe(st, p)) n -= 1;
    return Math.max(0, n);
  }
  effMv(st: GameState, p: Piece): number {
    let m = p.mv;
    if (adjacentFoe(st, p)) m -= 1;
    return Math.max(0, m);
  }
  async onDeath(_ctx: HandlerCtx, s: Session, victim: Piece): Promise<void> {
    const grave = makePiece(s.state, victim.owner, -2, victim.x, victim.y);
    grave.justDeployed = false;
    s.state.pieces.push(grave);
    ev(s, { type: 'deploy', uid: grave.uid });
    pushLog(s.state, `👟 跑得快倒下了，原地留下一座墓地（0/70）。`);
  }
}

/** 13 直行侠：每次移动必须直线冲整整三格 */
class StraightEffect extends PieceEffect {
  moveTargets(st: GameState, p: Piece): Cell[] {
    const out: Cell[] = [];
    const occupied = new Set<string>();
    for (const q of st.pieces) {
      if (q.dead || q.uid === p.uid) continue;
      for (const c of pieceCells(q)) occupied.add(c.x + ',' + c.y);
    }
    for (const [dx, dy] of DIRS) {
      let ok = true;
      for (let i = 1; i <= 3; i++) {
        const nx = p.x + dx * i, ny = p.y + dy * i;
        if (!inBoard(nx, ny) || occupied.has(nx + ',' + ny) || blocksAlly(st, nx, ny, p.owner)) { ok = false; break; }
      }
      if (ok) out.push({ x: p.x + dx * 3, y: p.y + dy * 3 });
    }
    return out;
  }
}

/** 9 射手：一回合两次攻击不可指定同一目标 */
class ArcherEffect extends PieceEffect {
  attackTargets(st: GameState, p: Piece): Piece[] {
    return super.attackTargets(st, p).filter((t) => !p.hitThisTurn.includes(t.uid));
  }
  async onAttackDone(_ctx: HandlerCtx, _s: Session, p: Piece, target: Piece): Promise<void> {
    p.hitThisTurn.push(target.uid);
  }
}

/** 4 定炮：蓄力两回合才能开炮，蓄满 5 格射程 +1；行动仅蓄力/开炮 */
class CannonEffect extends PieceEffect {
  attackRange(st: GameState, p: Piece): number {
    return this.effRange(st, p) + (p.charge >= 5 ? 1 : 0);
  }
  attackTargets(st: GameState, p: Piece): Piece[] {
    if (p.charge < 2) return [];
    return super.attackTargets(st, p);
  }
  async onAttackDone(_ctx: HandlerCtx, _s: Session, p: Piece): Promise<void> { p.charge = 0; }
  skillLabel = '⚡ 蓄力';
  skillUsable(p: Piece): boolean { return p.charge < 5; }
  skillTargetSpec(): ChoiceSpec { return { kind: 'none' }; }
  async skillExec(_ctx: HandlerCtx, s: Session, p: Piece): Promise<void> {
    p.charge++;
    ev(s, { type: 'buff', uid: p.uid });
    pushLog(s.state, `🎯 定炮蓄力中……（${p.charge}/5）`);
  }
}

/** 23 独行侠：两回合一动爆发六次；周围一圈禁入友军 */
class LonerEffect extends PieceEffect {
  effActions(_st: GameState, p: Piece): number { return p.beatCount % 2 === 0 ? 6 : 0; }
  async onTurnStart(_ctx: HandlerCtx, _s: Session, p: Piece): Promise<void> { p.beatCount++; }
  blocksAllyCell(_st: GameState, p: Piece, x: number, y: number, owner: Owner): boolean {
    return p.owner === owner && mdist(x, y, p.x, p.y) <= 1;
  }
}

/** 21 神行千里：蓄气两回合后扣 10 血瞬移六格并出手一次 */
class TeleporterEffect extends PieceEffect {
  skillLabel = '🌀 神行千里';
  skillUsable(p: Piece): boolean { return p.charge >= 2 && p.hp > 10; }
  skillTargetSpec(): ChoiceSpec { return { kind: 'none' }; }
  async skillExec(ctx: HandlerCtx, s: Session, p: Piece): Promise<void> {
    p.hp -= 10;
    p.charge = 0;
    ev(s, { type: 'damage', uid: p.uid, amount: 10 });
    pushLog(s.state, `🌀 神行千里发动！扣除 10 血（${p.hp}/${p.maxHp}），请选择落点（≤6 格）。`, 'l-impt');
    const cells = bfsEmptyCells(s.state, p, 6, (x, y) => blocksAlly(s.state, x, y, p.owner));
    const dest = (await ctx.choose({ kind: 'cell', cells, hint: '神行：选择落点（可原地不动）' })) as Cell;
    if (dest.x !== p.x || dest.y !== p.y) {
      ev(s, { type: 'move', uid: p.uid, tx: dest.x, ty: dest.y });
      p.x = dest.x; p.y = dest.y;
    }
    const targets = attackTargets(s.state, p);
    if (!targets.length) { pushLog(s.state, '🌀 周围没有可攻击的目标，神行结束。'); return; }
    const t = await ctx.choose({ kind: 'piece', pieces: targets, hint: '进行一次攻击（取消则放弃）', cancelable: true });
    if (!t) { pushLog(s.state, '🌀 放弃了攻击。'); return; }
    await performAttack(ctx, s, p, t as Piece);
  }
}

/* ═════════════ 注册表 / 兜底 / 转发 / 全局助手 ═════════════ */
export const EFFECTS: Record<number, PieceEffect> = {
  4: new CannonEffect(), 9: new ArcherEffect(), 12: new SpeedyEffect(),
  13: new StraightEffect(), 21: new TeleporterEffect(), 23: new LonerEffect(),
  33: new BladeEffect(),
};

const DEFAULT = new PieceEffect();
/** 未注册的特殊单位（-1 基地 / -2 墓地 / -3 路障）兜底返回默认实例，杜绝 undefined 崩溃 */
export function getEffect(defId: number): PieceEffect { return EFFECTS[defId] ?? DEFAULT; }

export function effRange(st: GameState, p: Piece): number { return getEffect(p.defId).effRange(st, p); }
export function effAtk(st: GameState, p: Piece): number { return getEffect(p.defId).effAtk(st, p); }
export function effActions(st: GameState, p: Piece): number { return getEffect(p.defId).effActions(st, p); }
export function effMv(st: GameState, p: Piece): number { return getEffect(p.defId).effMv(st, p); }
export function moveTargets(st: GameState, p: Piece): Cell[] { return getEffect(p.defId).moveTargets(st, p); }
export function attackTargets(st: GameState, p: Piece): Piece[] { return getEffect(p.defId).attackTargets(st, p); }

/** 全局：某棋子效果是否阻止 owner 方进入 (x,y)（23 独行侠禁入圈） */
export function blocksAlly(st: GameState, x: number, y: number, owner: Owner): boolean {
  for (const q of st.pieces) {
    if (q.dead) continue;
    if (getEffect(q.defId).blocksAllyCell(st, q, x, y, owner)) return true;
  }
  return false;
}

/** 抽牌形态判定（名刀 → 刀魂）。game.ts 与 spells.ts 共用，消灭重复。 */
export function resolveDrawDefId(state: GameState, defId: number): number {
  const form = getDef(defId).form;
  if (form && rnd(state) >= form.keepProb) return form.to;
  return defId;
}
