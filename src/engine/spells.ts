/* ═══════════════ spells.ts · 法术释放 ═══════════════
 * SPELL_TARGETS[defId](st, owner) → 选择规格
 * CAST[defId] = async (ctx, s, owner, got) => {}
 * ═════════════════════════════════════════════════ */

import { getDef, W, H, type Cell } from './data.ts';
import { PNAME, ev, pushLog, pieceAt,
         type Session, type GameState, type Piece, type ChoiceSpec, type ChoiceResult, type Owner } from './state.ts';
import { deployCells } from './rules.ts';
import { dealDamage, killPiece, flushDeaths, deployPiece } from './engine.ts';
import { rnd, rndInt } from './rng.ts';
import type { HandlerCtx } from './abilities.ts';

/** 己方随从（不含基地）——v1 与 abilities.js 共享作用域，ESM 下 spells.ts 各自持有同构副本 */
function myFollowers(state: GameState, owner: number): Piece[] {
  return state.pieces.filter((q) => !q.dead && q.owner === owner &&
    (getDef(q.defId).type === 'follower' || getDef(q.defId).type === 'grave'));
}

export const SPELL_TARGETS: Record<number, (st: GameState, owner: number) => ChoiceSpec> = {};
export const CAST: Record<number,
  (ctx: HandlerCtx, s: Session, owner: number, got: ChoiceResult) => Promise<void>> = {};

/* ── 8 爆弹 · 田字 2×2 AOE ── */
SPELL_TARGETS[8] = (st, owner) => {
  const cells: Cell[] = [];
  for (let y = 1; y < H; y++) for (let x = 1; x < W; x++) {
    let hasUnit = false;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      if (pieceAt(st, x + dx, y + dy)) { hasUnit = true; break; }
    }
    if (hasUnit) cells.push({ x, y });
  }
  return { kind: 'cell', cells, hint: '选择“田”字格锚点（左上格），引爆 2×2 区域内所有目标' };
};
CAST[8] = async (ctx, s, owner, got) => {
  const c = got as Cell; // 目标规格为 cell，got 必为格子
  pushLog(s.state, `💣 爆弹在 (${c.x},${c.y}) 引爆！`, 'l-impt');
  ev(s, { type: 'spell', defId: 8, x: c.x, y: c.y });
  const hits = new Set<number>();
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const t = pieceAt(s.state, c.x + dx, c.y + dy);
    if (t && !hits.has(t.uid)) hits.add(t.uid);
  }
  for (const uid of hits) {
    const t = s.state.pieces.find((p) => p.uid === uid)!; // pieces 从不 splice，uid 必命中
    await dealDamage(s, t, 20, null, {});
  }
};

/* ── 17 金身 ── */
SPELL_TARGETS[17] = (st, owner) => ({
  kind: 'piece',
  pieces: myFollowers(st, owner),
  hint: '选择一名友方棋子获得金身（免疫伤害直到你的下回合开始）',
});
CAST[17] = async (ctx, s, owner, got) => {
  const target = got as Piece; // 目标规格为 piece，got 必为棋子
  target.shieldUntil = s.state.turnCounter + 2;
  ev(s, { type: 'spell', defId: 17, uid: target.uid });
  pushLog(s.state, `🛡️ 金身加护！【${getDef(target.defId).name}】免疫一切伤害直到${PNAME[owner]}下回合开始。`, 'l-impt');
};

/* ── 18 死吧！── */
SPELL_TARGETS[18] = (st, owner) => ({
  kind: 'piece',
  pieces: myFollowers(st, owner).filter((q) => getDef(q.defId).type === 'follower'),
  hint: '选择一名友方：你的下回合它命中的第一个敌方棋子立即死亡',
});
CAST[18] = async (ctx, s, owner, got) => {
  const target = got as Piece; // 目标规格为 piece，got 必为棋子
  target.reaperFrom = s.state.turnCounter + 2;
  target.reaperTo = s.state.turnCounter + 2;
  ev(s, { type: 'spell', defId: 18, uid: target.uid });
  pushLog(s.state, `💀 死吧！【${getDef(target.defId).name}】眼中燃起幽光——你下回合它命中的第一个敌方将立即死亡。`, 'l-impt');
};

/* ── 22 策反 ── */
SPELL_TARGETS[22] = (st, owner) => ({
  kind: 'piece',
  pieces: myFollowers(st, owner),
  hint: '选择一名友方：到你的下回合开始前，首次攻击它的敌人将被策反',
});
CAST[22] = async (ctx, s, owner, got) => {
  const target = got as Piece; // 目标规格为 piece，got 必为棋子
  target.charmFrom = s.state.turnCounter + 1;
  target.charmTo = s.state.turnCounter + 2;
  ev(s, { type: 'spell', defId: 22, uid: target.uid });
  pushLog(s.state, `🎭 策反陷阱布下！【${getDef(target.defId).name}】静待敌人自投罗网。`, 'l-impt');
};

/* ── 25 重铸 ── */
SPELL_TARGETS[25] = () => ({
  kind: 'option',
  options: [
    { label: '♻️ 召唤一次', value: 'one' },
    { label: '⚔️ 献祭两召', value: 'two' },
  ],
  hint: '重铸：直接召唤一次；或消灭两名血量≥上限一半的友方棋子，召唤两次',
});
CAST[25] = async (ctx, s, owner, got) => {
  if (got === 'one') {
    await summonOnce(ctx, s, owner);
    return;
  }
  // 献祭双召
  const eligible = myFollowers(s.state, owner)
    .filter((q) => getDef(q.defId).type === 'follower' && q.hp >= q.maxHp / 2);
  if (eligible.length < 2) {
    pushLog(s.state, '♻️ 血量过半的友方不足两名，献祭失败（法术仍被消耗）。');
    return;
  }
  for (let i = 0; i < 2; i++) {
    const pool = myFollowers(s.state, owner)
      .filter((q) => getDef(q.defId).type === 'follower' && q.hp >= q.maxHp / 2 && !q.dead);
    if (!pool.length) break;
    const v = await ctx.choose({ kind: 'piece', pieces: pool, hint: `选择第 ${i + 1} 名献祭的友方棋子` });
    if (!v) break;
    await killPiece(s, v as Piece, null);
  }
  await flushDeaths(ctx, s);
  await summonOnce(ctx, s, owner);
  if (s.state.winner == null) await summonOnce(ctx, s, owner);
};

/** 抽一枚并处理（随从→部署 / 法术→入库）。供 25 号使用。 */
async function summonOnce(ctx: HandlerCtx, s: Session, owner: number): Promise<void> {
  let defId = rndInt(s.state, 1, 26);
  if (defId === 3 && rnd(s.state) >= 1 / 3) defId = 33; // 名刀形态判定
  const def = getDef(defId);
  pushLog(s.state, `♻️ 重铸召唤：【${def.name}】${def.emoji}`, 'l-impt');
  if (def.type === 'spell') {
    s.state.stored[owner].push({ defId, remain: def.limit! }); // 法术卡必有 limit
    pushLog(s.state, `📜 法术【${def.name}】自动存入储存栏（期限 ${def.limit} 回合）。`);
    return;
  }
  const cells = deployCells(s.state, defId, owner as Owner);
  if (!cells.length) { pushLog(s.state, `⚠️ 无处可部署【${def.name}】，被迫放弃。`); return; }
  const spot = (await ctx.choose({
    kind: 'cell', cells,
    hint: `为重铸召唤的【${def.name}】选择部署位置`,
  })) as Cell;
  deployPiece(ctx, s, owner, defId, spot.x, spot.y);
}
