/* geometry.ts · 纯几何助手（零 effects 依赖，打破 rules↔effects 环） */
import { W, H, type Cell } from './data.ts';
import type { GameState, Piece, Owner } from './state.ts';

export const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function inBoard(x: number, y: number): boolean { return x >= 1 && x <= W && y >= 1 && y <= H; }
export function mdist(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** 棋子占据的全部格子 */
export function pieceCells(p: Piece): Cell[] {
  if (!p.big) return [{ x: p.x, y: p.y }];
  const c: Cell[] = [];
  for (const dx of [0, 1]) for (const dy of [0, 1]) c.push({ x: p.x + dx, y: p.y + dy });
  return c;
}

/** 两棋子间的最近格距（按各自占据格两两求最小） */
export function nearestDist(a: Piece, b: Piece): number {
  let best = Infinity;
  for (const ca of pieceCells(a)) for (const cb of pieceCells(b)) {
    const d = mdist(ca.x, ca.y, cb.x, cb.y);
    if (d < best) best = d;
  }
  return best;
}

/** 24 号厚脸皮：来自正面的伤害至多 10。正面 = 攻击者位于受害者朝前线一侧。 */
export function isFrontal(attacker: Piece, victim: Piece): boolean {
  return victim.owner === 0 ? attacker.y > victim.y : attacker.y < victim.y;
}

/** 通用可达空格 BFS（≤maxStep 步，途经不可穿子），含起点。
 *  isBlocked 为逐格禁止谓词（如 effects.blocksAlly 的独行侠禁入圈）。 */
export function bfsEmptyCells(state: GameState, p: Piece, maxStep: number,
                              isBlocked: (x: number, y: number) => boolean): Cell[] {
  const out: Cell[] = [{ x: p.x, y: p.y }];
  if (maxStep <= 0) return out;
  const occupied = new Set<string>();
  for (const q of state.pieces) {
    if (q.dead || q.uid === p.uid) continue;
    for (const c of pieceCells(q)) occupied.add(c.x + ',' + c.y);
  }
  const seen = new Set<string>([p.x + ',' + p.y]);
  let frontier: Cell[] = [{ x: p.x, y: p.y }];
  for (let step = 0; step < maxStep; step++) {
    const next: Cell[] = [];
    for (const cur of frontier) {
      for (const [dx, dy] of DIRS) {
        const nx = cur.x + dx, ny = cur.y + dy;
        const key = nx + ',' + ny;
        if (!inBoard(nx, ny) || seen.has(key) || occupied.has(key)) continue;
        seen.add(key);
        if (isBlocked(nx, ny)) continue;
        next.push({ x: nx, y: ny });
        out.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }
  return out;
}
