/* ═══════════════ rules.ts · 几何与合法性判定 ═══════════════
 * 所有“格数”均为曼哈顿距离 |Δx| + |Δy|。
 * 攻击穿透规则：若到目标所有 ≤射程 的路径都被其他敌方棋子
 * 封死，则无法攻击（BFS 判可达）。
 * ═══════════════════════════════════════════════════════════ */
import { getDef, W, H, type Cell } from './data.ts';
import { pieceAt, type GameState, type Owner, type Piece } from './state.ts';
import { inBoard, nearestDist } from './geometry.ts';
import { blocksAlly, effRange } from './effects.ts';

/** 保持外部（UI / 测试）既有 import 面零改动 */
export { mdist, inBoard, pieceCells, nearestDist, bfsEmptyCells, DIRS, isFrontal } from './geometry.ts';
export { effRange, effAtk, effActions, effMv, moveTargets, attackTargets } from './effects.ts';

/* ─────────── 部署 ─────────── */

export function baseDeployRows(owner: Owner): number[] {
  const rows: number[] = [];
  for (let y = 1; y <= H; y++) {
    if (owner === 0 ? y <= 8 : y >= 6) rows.push(y);
  }
  return rows;
}

/**
 * 回合开始时结算“推进许可”：在本方不可部署的行中，
 * 己方该行棋子数 ≥ 对方该行棋子数 + 2，则该行本回合可部署。
 */
export function computeExtraRows(state: GameState, owner: Owner): void {
  const base = new Set<number>(baseDeployRows(owner));
  const rows: number[] = [];
  for (let y = 1; y <= H; y++) {
    if (base.has(y)) continue;
    let own = 0, opp = 0;
    for (const p of state.pieces) {
      if (p.dead || getDef(p.defId).type === 'base') continue;
      if (p.y === y || (p.big && y >= p.y && y <= p.y + 1)) {
        if (p.owner === owner) own++; else opp++;
      }
    }
    if (own >= opp + 2) rows.push(y);
  }
  state.extraRows[owner] = rows;
}

export function deployRows(state: GameState, owner: Owner): Set<number> {
  const all = baseDeployRows(owner).concat(state.extraRows[owner] || []);
  return new Set<number>(all);
}

/** (x,y) 为锚点能否部署该棋子 */
export function canDeployAt(state: GameState, defId: number, owner: Owner, x: number, y: number): boolean {
  const def = getDef(defId);
  const cells = def.big
    ? [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }]
    : [{ x, y }];
  const rows = deployRows(state, owner);
  for (const c of cells) {
    if (!inBoard(c.x, c.y)) return false;
    if (!rows.has(c.y)) return false;               // 大肉比跨行的两行都需合法
    if (pieceAt(state, c.x, c.y)) return false;
    if (blocksAlly(state, c.x, c.y, owner)) return false; // 独行侠禁入圈
  }
  return true;
}

/** 全部合法部署锚点 */
export function deployCells(state: GameState, defId: number, owner: Owner): Cell[] {
  const out: Cell[] = [];
  for (let y = 1; y <= H; y++) for (let x = 1; x <= W; x++) {
    if (canDeployAt(state, defId, owner, x, y)) out.push({ x, y });
  }
  return out;
}

/* ─────────── 治疗 ─────────── */

/** 奶妈的可治疗对象（射程内血量未满的己方） */
export function healTargets(state: GameState, p: Piece): Piece[] {
  return state.pieces.filter((q) =>
    !q.dead && q.owner === p.owner && q.hp < q.maxHp &&
    nearestDist(p, q) <= effRange(state, p));
}
