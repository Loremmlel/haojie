/* ═══════════════ game.js · 回合流程 & 动作 API ═══════════════
 * 所有玩家操作入口都遵循同一节奏：
 *    snap() 快照（供悔棋） → 校验 → 执行 → 结算遗言 → 检查胜负
 * ═════════════════════════════════════════════════════════════ */

/** 抽牌（名刀抽到时立即进行形态判定，手牌中直接呈现最终形态） */
function drawCards(state, owner, n) {
  for (let i = 0; i < n; i++) {
    let defId = rndInt(state, 1, 26);
    if (defId === 3 && rnd(state) >= 1 / 3) defId = 33;
    state.hand[owner].push({ uid: ++state.uidSeq, defId });
    const def = getDef(defId);
    pushLog(state, `${PNAME[owner]}召唤了【${def.name}】${def.emoji}${def.type === 'spell' ? '（法术）' : ''}`);
  }
}

/** 底层部署：放置棋子并处理冲锋询问 */
async function deployPiece(state, owner, defId, x, y) {
  const p = makePiece(state, owner, defId, x, y);
  state.pieces.push(p);
  ev('deploy', { uid: p.uid });
  pushLog(state, `${PNAME[owner]}部署【${getDef(defId).name}】于 (${x},${y})`);
  if (defId === 1) {
    const choice = await ENV.choose({
      kind: 'option',
      options: [
        { label: '⚡ 获得冲锋（−10 血）', value: 'charge' },
        { label: '🛡️ 保持满血', value: 'normal' },
      ],
      hint: '冲锋怪：是否牺牲 10 血量换取部署当回合即可行动？',
    });
    if (choice === 'charge') {
      p.hp -= 10;
      p.justDeployed = false;
      p.apLeft = effActions(p);
      pushLog(state, '⚔️ 冲锋怪嘶吼着冲入了战场！（本回合即可行动）', 'l-impt');
      ev('buff', { uid: p.uid });
    }
  }
  return p;
}

/** 部署阶段 → 行动阶段推进 */
function checkPhaseAdvance() {
  if (S.phase === 'deploy' && S.hand[S.curPlayer].length === 0 && !S.winner) {
    S.phase = 'action';
    ev('phase', { phase: 'action' });
  }
}

/* ─────────── 回合流转 ─────────── */

async function startTurnInternal() {
  S.turnCounter++;
  const me = S.curPlayer;

  // 全局时效清理（标记 / 金身 / 斩杀 / 策反 / 攻击增益 / 到期单位）
  for (const p of S.pieces) {
    if (p.dead) continue;
    if (p.mark10 && S.turnCounter >= p.mark10.expires) p.mark10 = null;
    if (p.shieldUntil && S.turnCounter >= p.shieldUntil) p.shieldUntil = 0;
    if (p.reaperTo && S.turnCounter > p.reaperTo) { p.reaperFrom = 0; p.reaperTo = 0; }
    if (p.charmTo && S.turnCounter >= p.charmTo) { p.charmFrom = 0; p.charmTo = 0; }
    if (p.atkBuffs.length) p.atkBuffs = p.atkBuffs.filter((b) => b.until > S.turnCounter);
    if (p.diesAt && S.turnCounter >= p.diesAt) {
      pushLog(S, `⌛ 【${getDef(p.defId).name}】的召唤物耗尽了时限，化为尘埃。`);
      await killPiece(S, p, null);
    }
  }
  await flushDeaths(S);

  // 己方棋子：节拍推进 + 行动次数重置
  for (const p of S.pieces) {
    if (p.dead || p.owner !== me) continue;
    p.justDeployed = false;
    if (p.defId === 23) p.beatCount++;
    p.apLeft = effActions(p);
    p.hitThisTurn = [];
  }

  computeExtraRows(S, me);

  // 储存栏期限递减（remain < 0 销毁）
  const kept = [];
  for (const card of S.stored[me]) {
    card.remain--;
    if (card.remain < 0) {
      pushLog(S, `⌛ 法术【${getDef(card.defId).name}】超过储存期限，消散了……`, 'l-impt');
      ev('expire', { owner: me });
    } else kept.push(card);
  }
  S.stored[me] = kept;

  // 抽牌：基础 2 张 + 白嫖怪加成
  const n = 2 + S.extraDraw[me];
  S.extraDraw[me] = 0;
  drawCards(S, me, n);

  S.phase = 'deploy';
  ev('turn', { player: me, turn: S.turnCounter });
  checkPhaseAdvance();
}

async function endTurn() {
  if (!S || S.winner != null) return;
  if (S.phase !== 'action') return;
  snap();
  S.hand[S.curPlayer] = [];
  S.curPlayer = 1 - S.curPlayer;
  await startTurnInternal();
}

/* ─────────── 部署阶段动作 ─────────── */

async function deployFollower(handIdx, x, y) {
  const card = S.hand[S.curPlayer][handIdx];
  if (!card || getDef(card.defId).type === 'spell') return false;
  if (!canDeployAt(S, card.defId, S.curPlayer, x, y)) return false;
  snap();
  S.hand[S.curPlayer].splice(handIdx, 1);
  await deployPiece(S, S.curPlayer, card.defId, x, y);
  checkPhaseAdvance();
  return true;
}

/** 无处可放的随从被迫弃置（仅当没有合法位置时允许） */
function discardUnplaceable(handIdx) {
  const card = S.hand[S.curPlayer][handIdx];
  if (!card || getDef(card.defId).type === 'spell') return false;
  if (deployCells(S, card.defId, S.curPlayer).length > 0) return false;
  snap();
  S.hand[S.curPlayer].splice(handIdx, 1);
  pushLog(S, `⚠️ 战场无处安放【${getDef(card.defId).name}】，只能忍痛放弃。`, 'l-impt');
  checkPhaseAdvance();
  return true;
}

async function storeHandSpell(handIdx) {
  const card = S.hand[S.curPlayer][handIdx];
  if (!card || getDef(card.defId).type !== 'spell') return false;
  snap();
  S.hand[S.curPlayer].splice(handIdx, 1);
  S.stored[S.curPlayer].push({ defId: card.defId, remain: getDef(card.defId).limit });
  pushLog(S, `🧪 【${getDef(card.defId).name}】存入储存栏（期限 ${getDef(card.defId).limit} 回合）。`);
  checkPhaseAdvance();
  return true;
}

async function castHandSpell(handIdx, got) {
  const card = S.hand[S.curPlayer][handIdx];
  if (!card || getDef(card.defId).type !== 'spell') return false;
  snap();
  S.hand[S.curPlayer].splice(handIdx, 1);
  await CAST[card.defId](S, S.curPlayer, got);
  await flushDeaths(S);
  checkWin(S);
  checkPhaseAdvance();
  return true;
}

async function castStored(idx, got) {
  const card = S.stored[S.curPlayer][idx];
  if (!card) return false;
  snap();
  S.stored[S.curPlayer].splice(idx, 1);
  pushLog(S, `✨ ${PNAME[S.curPlayer]}释放了储存的法术【${getDef(card.defId).name}】！`, 'l-impt');
  await CAST[card.defId](S, S.curPlayer, got);
  await flushDeaths(S);
  checkWin(S);
  return true;
}

/* ─────────── 行动阶段动作 ─────────── */

async function doMove(uid, x, y) {
  const p = pieceByUid(S, uid);
  if (!p || p.owner !== S.curPlayer || S.phase !== 'action') return false;
  if (p.justDeployed || p.apLeft <= 0) return false;

  // 大肉比：先蓄势再平移
  if (p.defId === 5) {
    if (p.charge <= 0) {
      snap();
      p.charge = 1;
      p.apLeft--;
      ev('buff', { uid: p.uid });
      pushLog(S, '🐘 大肉比深深蓄势……下次选择移动才会真正挪动！');
      return true;
    }
    const legal = moveTargets(S, p).some((c) => c.x === x && c.y === y);
    if (!legal) return false;
    snap();
    p.charge = 0;
    ev('move', { uid: p.uid, tx: x, ty: y });
    p.x = x; p.y = y;
    p.apLeft--;
    pushLog(S, `🐘 大肉比轰隆隆地挪到了 (${x},${y})！`);
    return true;
  }

  const legal = moveTargets(S, p).some((c) => c.x === x && c.y === y);
  if (!legal) return false;
  snap();
  ev('move', { uid: p.uid, tx: x, ty: y });
  p.x = x; p.y = y;
  p.apLeft--;
  return true;
}

/**
 * 攻击核心：结算即死斩杀 / 冲锋怪掷骰 / 投石机挂标 / 射手记录 / 定炮清充能
 */
async function performAttack(state, p, target) {
  ev('attack', { uid: p.uid, tuid: target.uid });

  // ── 死吧！：下回合命中的第一个敌方立即死亡
  if (p.reaperFrom && state.turnCounter === p.reaperFrom &&
      getDef(target.defId).type !== 'base') {
    p.reaperFrom = 0; p.reaperTo = 0;
    if (target.shieldUntil > state.turnCounter) {
      pushLog(state, `💀 斩杀之光撞上了金身！【${getDef(target.defId).name}】侥幸存活！`, 'l-impt');
    } else {
      pushLog(state, `💀 死吧！！【${getDef(target.defId).name}】当场毙命！`, 'l-impt');
      await killPiece(state, target, p);
      await flushDeaths(state);
      checkWin(state);
      return;
    }
  }

  // ── 伤害掷骰
  let dmg = effAtk(p);
  let crit = false;
  if (p.defId === 1) {
    const r = rnd(state);
    if (r < 1 / 12) { dmg += 60; crit = true; }
    else if (r < 1 / 4) { dmg += 20; }
  }

  // ── 投石机：零伤挂标
  if (p.defId === 10) {
    pushLog(state, `🪨 投石机砸中了【${getDef(target.defId).name}】，附上引信标记！`);
    if (!target.dead) {
      target.mark10 = { owner: p.owner, srcUid: p.uid, expires: state.turnCounter + 2 };
      ev('mark', { uid: target.uid });
    }
  } else {
    await dealDamage(state, target, dmg, p, { hit: true, crit });
  }

  if (p.defId === 9) p.hitThisTurn.push(target.uid);
  if (p.defId === 4) p.charge = 0;
  await flushDeaths(state);
  checkWin(state);
}

async function doAttack(uid, targetUid) {
  const p = pieceByUid(S, uid);
  const t = pieceByUid(S, targetUid);
  if (!p || !t || p.owner !== S.curPlayer || S.phase !== 'action') return false;
  if (p.justDeployed || p.apLeft <= 0) return false;

  // 奶妈：可指定己方残血棋子改为治疗
  if (p.defId === 2 && t.owner === p.owner) {
    if (t.hp >= t.maxHp) return false;
    if (nearestDist(p, t) > p.range) return false;
    snap();
    p.apLeft--;
    pushLog(S, `💉 奶妈为【${getDef(t.defId).name}】回复了 20 血量。`);
    ev('attack', { uid: p.uid, tuid: t.uid, healMode: true });
    await heal(S, t, 20);
    return true;
  }

  if (!attackTargets(S, p).includes(t)) return false;
  snap();
  p.apLeft--;
  await performAttack(S, p, t);
  return true;
}

async function useSkill(uid) {
  const p = pieceByUid(S, uid);
  const sk = SKILLS[p.defId];
  if (!p || !sk || p.owner !== S.curPlayer || S.phase !== 'action') return false;
  if (p.justDeployed || p.apLeft <= 0 || !sk.usable(p)) return false;
  const spec = sk.targetSpec(S, p);
  let got = null;
  if (spec.kind !== 'none') {
    got = await ENV.choose(spec);
    if (got == null) return false; // 玩家取消了
  }
  snap();
  p.apLeft--;
  await sk.exec(S, p, got);
  await flushDeaths(S);
  checkWin(S);
  return true;
}

/* ═════════════ 对外 API ═════════════ */

const API = {
  async init(seed) {
    newGame(seed);
    S.curPlayer = rnd(S) < 0.5 ? 0 : 1;
    pushLog(S, `🎲 天命所归：${PNAME[S.curPlayer]}执掌先行之权！`, 'l-impt');
    await startTurnInternal();
    return S;
  },
  state: () => S,
  getDef,
  spellTargets: SPELL_TARGETS,
  canUndo,
  async undo() {
    if (!canUndo()) return false;
    undo();
    return true;
  },
  undoDepth: () => undoStack.length,

  // 部署阶段
  deployFollower,
  discardUnplaceable,
  storeHandSpell,
  castHandSpell,
  castStored,

  // 行动阶段
  doMove,
  doAttack,
  useSkill,
  endTurn,

  // 规则查询（供 UI 高亮）
  rules: {
    moveTargets: (p) => moveTargets(S, p),
    attackTargets: (p) => attackTargets(S, p),
    healTargets: (p) => healTargets(S, p),
    deployCells: (defId, owner) => deployCells(S, defId, owner),
    skillInfo: (p) => SKILLS[p.defId] || null,
    effActions,
    effRange: (p) => effRange(p),
    bigCharge: (p) => p.charge,
  },

  // 表现层注入点（测试环境替换 choose）
  env: ENV,
};

// 测试环境导出钩子（浏览器 IIFE 中 __HAOJIE_EXPORT__ 未定义则跳过）
if (typeof __HAOJIE_EXPORT__ === 'function') __HAOJIE_EXPORT__(API);
