/* ═══════════════ spells.js · 法术释放 ═══════════════
 * SPELL_TARGETS[defId](state, owner) → 选择规格
 * CAST[defId] = async (state, owner, got) => {}
 * ═════════════════════════════════════════════════ */

const SPELL_TARGETS = {};
const CAST = {};

/* ── 8 爆弹 · 田字 2×2 AOE ── */
SPELL_TARGETS[8] = (state, owner) => {
  const cells = [];
  for (let y = 1; y < H; y++) for (let x = 1; x < W; x++) {
    let hasUnit = false;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      if (pieceAt(state, x + dx, y + dy)) { hasUnit = true; break; }
    }
    if (hasUnit) cells.push({ x, y });
  }
  return { kind: 'cell', cells, hint: '选择“田”字格锚点（左上格），引爆 2×2 区域内所有目标' };
};
CAST[8] = async (state, owner, got) => {
  pushLog(state, `💣 爆弹在 (${got.x},${got.y}) 引爆！`, 'l-impt');
  ev('spell', { defId: 8, x: got.x, y: got.y });
  const hits = new Set();
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const t = pieceAt(state, got.x + dx, got.y + dy);
    if (t && !hits.has(t.uid)) hits.add(t.uid);
  }
  for (const uid of hits) {
    const t = state.pieces.find((p) => p.uid === uid);
    await dealDamage(state, t, 20, null, {});
  }
};

/* ── 17 金身 ── */
SPELL_TARGETS[17] = (state, owner) => ({
  kind: 'piece',
  pieces: myFollowers(state, owner),
  hint: '选择一名友方棋子获得金身（免疫伤害直到你的下回合开始）',
});
CAST[17] = async (state, owner, got) => {
  got.shieldUntil = state.turnCounter + 2;
  ev('spell', { defId: 17, uid: got.uid });
  pushLog(state, `🛡️ 金身加护！【${getDef(got.defId).name}】免疫一切伤害直到${PNAME[owner]}下回合开始。`, 'l-impt');
};

/* ── 18 死吧！── */
SPELL_TARGETS[18] = (state, owner) => ({
  kind: 'piece',
  pieces: myFollowers(state, owner).filter((q) => getDef(q.defId).type === 'follower'),
  hint: '选择一名友方：你的下回合它命中的第一个敌方棋子立即死亡',
});
CAST[18] = async (state, owner, got) => {
  got.reaperFrom = state.turnCounter + 2;
  got.reaperTo = state.turnCounter + 2;
  ev('spell', { defId: 18, uid: got.uid });
  pushLog(state, `💀 死吧！【${getDef(got.defId).name}】眼中燃起幽光——你下回合它命中的第一个敌方将立即死亡。`, 'l-impt');
};

/* ── 22 策反 ── */
SPELL_TARGETS[22] = (state, owner) => ({
  kind: 'piece',
  pieces: myFollowers(state, owner),
  hint: '选择一名友方：到你的下回合开始前，首次攻击它的敌人将被策反',
});
CAST[22] = async (state, owner, got) => {
  got.charmFrom = state.turnCounter + 1;
  got.charmTo = state.turnCounter + 2;
  ev('spell', { defId: 22, uid: got.uid });
  pushLog(state, `🎭 策反陷阱布下！【${getDef(got.defId).name}】静待敌人自投罗网。`, 'l-impt');
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
CAST[25] = async (state, owner, got) => {
  if (got === 'one') {
    await summonOnce(state, owner);
    return;
  }
  // 献祭双召
  const eligible = myFollowers(state, owner)
    .filter((q) => getDef(q.defId).type === 'follower' && q.hp >= q.maxHp / 2);
  if (eligible.length < 2) {
    pushLog(state, '♻️ 血量过半的友方不足两名，献祭失败（法术仍被消耗）。');
    return;
  }
  for (let i = 0; i < 2; i++) {
    const pool = myFollowers(state, owner)
      .filter((q) => getDef(q.defId).type === 'follower' && q.hp >= q.maxHp / 2 && !q.dead);
    if (!pool.length) break;
    const v = await ENV.choose({ kind: 'piece', pieces: pool, hint: `选择第 ${i + 1} 名献祭的友方棋子` });
    if (!v) break;
    await killPiece(state, v, null);
  }
  await flushDeaths(state);
  await summonOnce(state, owner);
  if (state.winner == null) await summonOnce(state, owner);
};

/** 抽一枚并处理（随从→部署 / 法术→入库）。供 25 号使用。 */
async function summonOnce(state, owner) {
  let defId = rndInt(state, 1, 26);
  if (defId === 3 && rnd(state) >= 1 / 3) defId = 33; // 名刀形态判定
  const def = getDef(defId);
  pushLog(state, `♻️ 重铸召唤：【${def.name}】${def.emoji}`, 'l-impt');
  if (def.type === 'spell') {
    state.stored[owner].push({ defId, remain: def.limit });
    pushLog(state, `📜 法术【${def.name}】自动存入储存栏（期限 ${def.limit} 回合）。`);
    return;
  }
  const cells = deployCells(state, defId, owner);
  if (!cells.length) { pushLog(state, `⚠️ 无处可部署【${def.name}】，被迫放弃。`); return; }
  const spot = await ENV.choose({
    kind: 'cell', cells,
    hint: `为重铸召唤的【${def.name}】选择部署位置`,
  });
  deployPiece(state, owner, defId, spot.x, spot.y);
}
