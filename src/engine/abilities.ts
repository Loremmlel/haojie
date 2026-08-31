/* ═══════════════ abilities.ts · 主动技能 & 死亡遗言 ═══════════════
 * SKILLS[defId] = {
 *   label   : 界面按钮文字
 *   usable(p)          : 是否可发动
 *   targetSpec(st,p)   : 选择规格（交给 UI/测试环境解析）
 *   exec(ctx,s,p,got)  : got 为玩家选择结果
 * }
 * DEATHRATTLES[defId] = async (ctx, s, victim, killer) => {}
 * ═══════════════════════════════════════════════════════════════ */

import { getDef, W, H, type Cell } from './data.ts';
import { PNAME, ev, pushLog, makePiece, pieceAt,
         type Session, type GameState, type Piece, type ChoiceSpec, type ChoiceResult } from './state.ts';
import { inBoard, mdist, nearestDist, effRange, effAtk, bfsEmptyCells, attackTargets } from './rules.ts';
import { dealDamage, killPiece, flushDeaths, performAttack } from './engine.ts';
import { blocksAlly } from './effects.ts';
import type { HandlerCtx, SkillInfo } from './types.ts';

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

export const SKILLS: Record<number, SkillInfo> = {};

/* ── 4 定炮 · 蓄力 ── */
SKILLS[4] = {
  label: '⚡ 蓄力',
  usable: (p) => p.charge < 5,
  targetSpec: () => ({ kind: 'none' }),
  async exec(ctx, s, p) {
    p.charge++;
    ev(s, { type: 'buff', uid: p.uid });
    pushLog(s.state, `🎯 定炮蓄力中……（${p.charge}/5）`);
  },
};

/* ── 6 BUFF怪 · 战吼增益 ── */
SKILLS[6] = {
  label: '📣 增益 +10攻',
  usable: (p) => true,
  targetSpec: (st, p) => ({
    kind: 'piece',
    pieces: myFollowers(st, p.owner).filter((q) => q.defId !== 10 && nearestDist(p, q) <= effRange(st, p)),
    hint: '选择射程内的一名友方棋子获得下回合 +10 攻击（对投石机无效）',
  }),
  async exec(ctx, s, p, got) {
    const target = got as Piece; // 目标规格为 piece，got 必为棋子
    target.atkBuffs.push({ amt: 10, until: s.state.turnCounter + 3 });
    ev(s, { type: 'buff', uid: target.uid });
    pushLog(s.state, `📣 【${getDef(target.defId).name}】获得下回合 +10 攻击力！`, 'l-impt');
  },
};

/* ── 7 钩子 · 拉拽 ── */
SKILLS[7] = {
  label: '🪝 钩拉',
  usable: () => true,
  targetSpec: (st, p) => ({
    kind: 'piece',
    pieces: foeFollowers(st, p.owner).filter((q) => !q.big && nearestDist(p, q) <= effRange(st, p)),
    hint: '选择攻击范围内的一名敌方棋子，将其钩到身边',
  }),
  async exec(ctx, s, p, got) {
    const target = got as Piece; // 目标规格为 piece，got 必为棋子
    // 第二段：选拉到的落点（钩子周围一圈空格）
    const spots: Cell[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const x = p.x + dx, y = p.y + dy;
      if (!inBoard(x, y) || pieceAt(s.state, x, y)) continue;
      spots.push({ x, y });
    }
    let dest: Cell;
    if (spots.length === 0) { pushLog(s.state, '🪝 钩子周围没有空格，钩拉失败。'); return; }
    else if (spots.length === 1) dest = spots[0];
    else dest = (await ctx.choose({ kind: 'cell', cells: spots, hint: '选择把敌人钩到哪个位置' })) as Cell;
    ev(s, { type: 'hook', uid: target.uid, fx: p.x, fy: p.y, x0: target.x, y0: target.y, tx: dest.x, ty: dest.y });
    target.x = dest.x; target.y = dest.y;
    pushLog(s.state, `🪝 【${getDef(target.defId).name}】被钩到了 (${dest.x},${dest.y})！`, 'l-impt');
  },
};

/* ── 14 献祭炮 · 献祭齐射 ── */
SKILLS[14] = {
  label: '🔥 献祭齐射',
  usable: () => true,
  targetSpec: (st, p) => ({
    kind: 'piece',
    pieces: myFollowers(st, p.owner).filter((q) => q.uid !== p.uid && nearestDist(p, q) <= effRange(st, p)),
    hint: '选择要献祭的友方棋子（将扣除你 10 点血量上限）',
  }),
  async exec(ctx, s, p, got) {
    const victim = got as Piece; // 目标规格为 piece，got 必为棋子
    p.maxHp -= 10;
    p.hp = Math.min(p.hp, p.maxHp);
    ev(s, { type: 'damage', uid: p.uid, amount: 0, silentNum: true });
    pushLog(s.state, `🔥 献祭炮扣除了自己 10 点血量上限（上限 ${p.maxHp}）。`);
    const vAtk = effAtk(s.state, victim);
    await killPiece(s, victim, null);
    await flushDeaths(ctx, s);
    // 第二段：选一列（射程覆盖的列），点该列任意格代表选列
    const cols: number[] = [];
    const rng = effRange(s.state, p);
    for (let c = Math.max(1, p.x - rng); c <= Math.min(W, p.x + rng); c++) cols.push(c);
    const colCells: (Cell & { col: number })[] = [];
    for (const c of cols) for (let y = 1; y <= H; y++) colCells.push({ x: c, y, col: c });
    const picked = (await ctx.choose({
      kind: 'cell', cells: colCells,
      hint: `选择轰击哪一列（对距你最近的敌方造成 ${vAtk} 伤害）`,
    })) as Cell & { col: number };
    // 该列上最近的敌方单位
    let best: Piece | null = null, bestD = Infinity;
    for (const q of foesOf(s.state, p.owner)) {
      const covers = q.big ? (picked.col >= q.x && picked.col <= q.x + 1) : q.x === picked.col;
      if (!covers) continue;
      const d = nearestDist(p, q);
      if (d < bestD) { bestD = d; best = q; }
    }
    if (!best) { pushLog(s.state, `🔥 第 ${picked.col} 列上没有敌方单位，炮击落空……`); return; }
    pushLog(s.state, `🔥 献祭齐射命中第 ${picked.col} 列的【${getDef(best.defId).name}】，造成 ${vAtk} 伤害！`, 'l-impt');
    await dealDamage(s, best, vAtk, p, { hit: true });
  },
};

/* ── 15 蓄力怪 · 强化 ── */
SKILLS[15] = {
  label: '🔋 强化(限3次)',
  usable: (p) => p.skillUses < 3,
  targetSpec: () => ({
    kind: 'option',
    options: [{ label: '+10 攻击力', value: 'atk' }, { label: '+1 攻击范围', value: 'rng' }],
    hint: '选择强化方式（整场限 3 次）',
  }),
  async exec(ctx, s, p, got) {
    p.skillUses++;
    if (got === 'atk') { p.atk += 10; pushLog(s.state, `🔋 蓄力怪强化：攻击力提升至 ${p.atk}！（剩余 ${3 - p.skillUses} 次）`); }
    else { p.range += 1; pushLog(s.state, `🔋 蓄力怪强化：射程提升至 ${p.range}！（剩余 ${3 - p.skillUses} 次）`); }
    ev(s, { type: 'buff', uid: p.uid });
  },
};

/* ── 19 路障小法师 · 召唤路障 ── */
SKILLS[19] = {
  label: '🚧 召唤路障',
  usable: () => true,
  targetSpec: (st, p) => {
    const cells: Cell[] = [];
    for (let y = 1; y <= H; y++) for (let x = 1; x <= W; x++) {
      if (!pieceAt(st, x, y) && mdist(p.x, p.y, x, y) <= effRange(st, p)) cells.push({ x, y });
    }
    return { kind: 'cell', cells, hint: '选择放置路障的空格（存活到你的下回合开始）' };
  },
  async exec(ctx, s, p, got) {
    const cell = got as Cell; // 目标规格为 cell，got 必为格子
    const bar = makePiece(s.state, p.owner, -3, cell.x, cell.y);
    bar.diesAt = s.state.turnCounter + 2;
    bar.justDeployed = false;
    s.state.pieces.push(bar);
    ev(s, { type: 'deploy', uid: bar.uid });
    pushLog(s.state, `🚧 路障小法师在 (${cell.x},${cell.y}) 召唤了路障（它撑不过你的下回合开始）。`);
  },
};

/* ── 21 神行千里 ── */
SKILLS[21] = {
  label: '🌀 神行千里',
  usable: (p) => p.charge >= 2 && p.hp > 10,
  targetSpec: () => ({ kind: 'none' }),
  async exec(ctx, s, p) {
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
    // 移动后可进行一次攻击
    const targets = attackTargets(s.state, p);
    if (!targets.length) { pushLog(s.state, '🌀 周围没有可攻击的目标，神行结束。'); return; }
    const t = await ctx.choose({
      kind: 'piece',
      pieces: targets,
      hint: '进行一次攻击（取消则放弃）',
      cancelable: true,
    });
    if (!t) { pushLog(s.state, '🌀 放弃了攻击。'); return; }
    await performAttack(ctx, s, p, t as Piece);
  },
};

/* ═════════════ 死亡遗言 ═════════════ */

export const DEATHRATTLES: Record<number,
  (ctx: HandlerCtx, s: Session, victim: Piece, killer: Piece | null) => Promise<void>> = {};

/* 2 奶妈：死亡时无视距离反击一次 */
DEATHRATTLES[2] = async (ctx, s, victim) => {
  const foes = foesOf(s.state, victim.owner);
  if (!foes.length) return;
  const t = await ctx.choose({
    kind: 'piece', pieces: foes, cancelable: true,
    hint: `奶妈的遗言：选择一名敌方单位进行无视距离的反击（20 伤害，可取消）`,
  });
  if (!t) { pushLog(s.state, '💉 奶妈安详地离去了……'); return; }
  pushLog(s.state, `💉 奶妈的遗言发动！无视距离对【${getDef((t as Piece).defId).name}】造成 20 伤害！`, 'l-impt');
  await dealDamage(s, t as Piece, victim.atk, null, {});
};

/* 11 白嫖怪：下回合额外召唤一次 */
DEATHRATTLES[11] = async (ctx, s, victim) => {
  s.state.extraDraw[victim.owner]++;
  pushLog(s.state, `🆓 白嫖怪死亡：${PNAME[victim.owner]}下回合将额外召唤一枚棋子！`, 'l-impt');
};

/* 12 跑得快：留下墓地 */
DEATHRATTLES[12] = async (ctx, s, victim) => {
  const grave = makePiece(s.state, victim.owner, -2, victim.x, victim.y);
  grave.justDeployed = false;
  s.state.pieces.push(grave);
  ev(s, { type: 'deploy', uid: grave.uid });
  pushLog(s.state, `👟 跑得快倒下了，原地留下一座墓地（0/70）。`);
};

/* 20 超级跑得快：反咬击杀者 */
DEATHRATTLES[20] = async (ctx, s, victim, killer) => {
  if (!killer || killer.dead || killer.owner === victim.owner) return;
  pushLog(s.state, `💥 超级跑得快的遗言：对击杀者【${getDef(killer.defId).name}】造成 20 伤害！`, 'l-impt');
  await dealDamage(s, killer, 20, null, {});
};
