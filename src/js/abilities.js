/* ═══════════════ abilities.js · 主动技能 & 死亡遗言 ═══════════════
 * SKILLS[defId] = {
 *   label   : 界面按钮文字
 *   usable(p)          : 是否可发动
 *   targetSpec(state,p): 选择规格（交给 UI/测试环境解析）
 *   exec(state,p,got)  : got 为玩家选择结果
 * }
 * DEATHRATTLES[defId] = async (state, victim, killer) => {}
 * ═══════════════════════════════════════════════════════════════ */

function foesOf(state, owner) {
  return state.pieces.filter((q) => !q.dead && q.owner !== owner);
}
/** 敌方随从（不含基地） */
function foeFollowers(state, owner) {
  return foesOf(state, owner).filter((q) => getDef(q.defId).type === 'follower' || getDef(q.defId).type === 'grave');
}
/** 己方随从（不含基地） */
function myFollowers(state, owner) {
  return state.pieces.filter((q) => !q.dead && q.owner === owner &&
    (getDef(q.defId).type === 'follower' || getDef(q.defId).type === 'grave'));
}

const SKILLS = {};

/* ── 4 定炮 · 蓄力 ── */
SKILLS[4] = {
  label: '⚡ 蓄力',
  usable: (p) => p.charge < 5,
  targetSpec: () => ({ kind: 'none' }),
  async exec(state, p) {
    p.charge++;
    ev('buff', { uid: p.uid });
    pushLog(state, `🎯 定炮蓄力中……（${p.charge}/5）`);
  },
};

/* ── 6 BUFF怪 · 战吼增益 ── */
SKILLS[6] = {
  label: '📣 增益 +10攻',
  usable: (p) => true,
  targetSpec: (state, p) => ({
    kind: 'piece',
    pieces: myFollowers(state, p.owner).filter((q) => q.defId !== 10 && nearestDist(p, q) <= effRange(p)),
    hint: '选择射程内的一名友方棋子获得下回合 +10 攻击（对投石机无效）',
  }),
  async exec(state, p, got) {
    got.atkBuffs.push({ amt: 10, until: state.turnCounter + 3 });
    ev('buff', { uid: got.uid });
    pushLog(state, `📣 【${getDef(got.defId).name}】获得下回合 +10 攻击力！`, 'l-impt');
  },
};

/* ── 7 钩子 · 拉拽 ── */
SKILLS[7] = {
  label: '🪝 钩拉',
  usable: () => true,
  targetSpec: (state, p) => ({
    kind: 'piece',
    pieces: foeFollowers(state, p.owner).filter((q) => !q.big && nearestDist(p, q) <= effRange(p)),
    hint: '选择攻击范围内的一名敌方棋子，将其钩到身边',
  }),
  async exec(state, p, got) {
    // 第二段：选拉到的落点（钩子周围一圈空格）
    const spots = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const x = p.x + dx, y = p.y + dy;
      if (!inBoard(x, y) || pieceAt(state, x, y)) continue;
      spots.push({ x, y });
    }
    let dest;
    if (spots.length === 0) { pushLog(state, '🪝 钩子周围没有空格，钩拉失败。'); return; }
    else if (spots.length === 1) dest = spots[0];
    else dest = await ENV.choose({ kind: 'cell', cells: spots, hint: '选择把敌人钩到哪个位置' });
    ev('hook', { uid: got.uid, fx: p.x, fy: p.y, x0: got.x, y0: got.y, tx: dest.x, ty: dest.y });
    got.x = dest.x; got.y = dest.y;
    pushLog(state, `🪝 【${getDef(got.defId).name}】被钩到了 (${dest.x},${dest.y})！`, 'l-impt');
  },
};

/* ── 14 献祭炮 · 献祭齐射 ── */
SKILLS[14] = {
  label: '🔥 献祭齐射',
  usable: () => true,
  targetSpec: (state, p) => ({
    kind: 'piece',
    pieces: myFollowers(state, p.owner).filter((q) => q.uid !== p.uid && nearestDist(p, q) <= effRange(p)),
    hint: '选择要献祭的友方棋子（将扣除你 10 点血量上限）',
  }),
  async exec(state, p, victim) {
    p.maxHp -= 10;
    p.hp = Math.min(p.hp, p.maxHp);
    ev('damage', { uid: p.uid, amount: 0, silentNum: true });
    pushLog(state, `🔥 献祭炮扣除了自己 10 点血量上限（上限 ${p.maxHp}）。`);
    const vAtk = effAtk(victim);
    await killPiece(state, victim, null);
    await flushDeaths(state);
    // 第二段：选一列（射程覆盖的列），点该列任意格代表选列
    const cols = [];
    const rng = effRange(p);
    for (let c = Math.max(1, p.x - rng); c <= Math.min(W, p.x + rng); c++) cols.push(c);
    const colCells = [];
    for (const c of cols) for (let y = 1; y <= H; y++) colCells.push({ x: c, y, col: c });
    const picked = await ENV.choose({
      kind: 'cell', cells: colCells,
      hint: `选择轰击哪一列（对距你最近的敌方造成 ${vAtk} 伤害）`,
    });
    // 该列上最近的敌方单位
    let best = null, bestD = Infinity;
    for (const q of foesOf(state, p.owner)) {
      const covers = q.big ? (picked.col >= q.x && picked.col <= q.x + 1) : q.x === picked.col;
      if (!covers) continue;
      const d = nearestDist(p, q);
      if (d < bestD) { bestD = d; best = q; }
    }
    if (!best) { pushLog(state, `🔥 第 ${picked.col} 列上没有敌方单位，炮击落空……`); return; }
    pushLog(state, `🔥 献祭齐射命中第 ${picked.col} 列的【${getDef(best.defId).name}】，造成 ${vAtk} 伤害！`, 'l-impt');
    await dealDamage(state, best, vAtk, p, { hit: true });
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
  async exec(state, p, got) {
    p.skillUses++;
    if (got === 'atk') { p.atk += 10; pushLog(state, `🔋 蓄力怪强化：攻击力提升至 ${p.atk}！（剩余 ${3 - p.skillUses} 次）`); }
    else { p.range += 1; pushLog(state, `🔋 蓄力怪强化：射程提升至 ${p.range}！（剩余 ${3 - p.skillUses} 次）`); }
    ev('buff', { uid: p.uid });
  },
};

/* ── 19 路障小法师 · 召唤路障 ── */
SKILLS[19] = {
  label: '🚧 召唤路障',
  usable: () => true,
  targetSpec: (state, p) => {
    const cells = [];
    for (let y = 1; y <= H; y++) for (let x = 1; x <= W; x++) {
      if (!pieceAt(state, x, y) && mdist(p.x, p.y, x, y) <= effRange(p)) cells.push({ x, y });
    }
    return { kind: 'cell', cells, hint: '选择放置路障的空格（存活到你的下回合开始）' };
  },
  async exec(state, p, got) {
    const bar = makePiece(state, p.owner, -3, got.x, got.y);
    bar.diesAt = state.turnCounter + 2;
    bar.justDeployed = false;
    state.pieces.push(bar);
    ev('deploy', { uid: bar.uid });
    pushLog(state, `🚧 路障小法师在 (${got.x},${got.y}) 召唤了路障（它撑不过你的下回合开始）。`);
  },
};

/* ── 21 神行千里 ── */
SKILLS[21] = {
  label: '🌀 神行千里',
  usable: (p) => p.charge >= 2 && p.hp > 10,
  targetSpec: () => ({ kind: 'none' }),
  async exec(state, p) {
    p.hp -= 10;
    p.charge = 0;
    ev('damage', { uid: p.uid, amount: 10 });
    pushLog(state, `🌀 神行千里发动！扣除 10 血（${p.hp}/${p.maxHp}），请选择落点（≤6 格）。`, 'l-impt');
    const cells = bfsEmptyCells(state, p, 6);
    const dest = await ENV.choose({ kind: 'cell', cells, hint: '神行：选择落点（可原地不动）' });
    if (dest.x !== p.x || dest.y !== p.y) {
      ev('move', { uid: p.uid, tx: dest.x, ty: dest.y });
      p.x = dest.x; p.y = dest.y;
    }
    // 移动后可进行一次攻击
    const targets = attackTargets(state, p);
    if (!targets.length) { pushLog(state, '🌀 周围没有可攻击的目标，神行结束。'); return; }
    const t = await ENV.choose({
      kind: 'piece',
      pieces: targets,
      hint: '进行一次攻击（取消则放弃）',
      cancelable: true,
    });
    if (!t) { pushLog(state, '🌀 放弃了攻击。'); return; }
    await performAttack(state, p, t);
  },
};

/* ═════════════ 死亡遗言 ═════════════ */

const DEATHRATTLES = {};

/* 2 奶妈：死亡时无视距离反击一次 */
DEATHRATTLES[2] = async (state, victim) => {
  const foes = foesOf(state, victim.owner);
  if (!foes.length) return;
  const t = await ENV.choose({
    kind: 'piece', pieces: foes, cancelable: true,
    hint: `奶妈的遗言：选择一名敌方单位进行无视距离的反击（20 伤害，可取消）`,
  });
  if (!t) { pushLog(state, '💉 奶妈安详地离去了……'); return; }
  pushLog(state, `💉 奶妈的遗言发动！无视距离对【${getDef(t.defId).name}】造成 20 伤害！`, 'l-impt');
  await dealDamage(state, t, victim.atk, null, {});
};

/* 11 白嫖怪：下回合额外召唤一次 */
DEATHRATTLES[11] = async (state, victim) => {
  state.extraDraw[victim.owner]++;
  pushLog(state, `🆓 白嫖怪死亡：${PNAME[victim.owner]}下回合将额外召唤一枚棋子！`, 'l-impt');
};

/* 12 跑得快：留下墓地 */
DEATHRATTLES[12] = async (state, victim) => {
  const grave = makePiece(state, victim.owner, -2, victim.x, victim.y);
  grave.justDeployed = false;
  state.pieces.push(grave);
  ev('deploy', { uid: grave.uid });
  pushLog(state, `👟 跑得快倒下了，原地留下一座墓地（0/70）。`);
};

/* 20 超级跑得快：反咬击杀者 */
DEATHRATTLES[20] = async (state, victim, killer) => {
  if (!killer || killer.dead || killer.owner === victim.owner) return;
  pushLog(state, `💥 超级跑得快的遗言：对击杀者【${getDef(killer.defId).name}】造成 20 伤害！`, 'l-impt');
  await dealDamage(state, killer, 20, null, {});
};
