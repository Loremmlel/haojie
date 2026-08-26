/* ═══════════════ engine.js · 伤害 / 治疗 / 死亡管线 ═══════════════
 * 所有伤害统一经过 dealDamage，依次结算：
 *   金身免疫 → 厚脸皮正面减免 → 策反倒戈 → 扣血 →
 *   投石机标记引爆 → 名刀守护 → 死亡与遗言 → 伤害转化器反弹
 * ═══════════════════════════════════════════════════════════════ */

/** 待结算的死亡遗言队列 */
const pendingDeaths = [];

/**
 * 对目标造成伤害。
 * @param src  来源棋子（可为 null，如法术直接伤害）
 * @param opts {hit:是否为攻击命中, isMark:标记引爆, noCounter:禁止反弹,
 *              noGuard:无视名刀守护, silent:不播受击特效}
 */
async function dealDamage(state, target, amount, src, opts) {
  opts = opts || {};
  if (!target || target.dead || !(amount > 0)) return;

  // ── 金身：不受任何伤害
  if (target.shieldUntil > state.turnCounter) {
    ev('block', { uid: target.uid });
    pushLog(state, `🛡️ ${getDef(target.defId).name} 处于金身状态，免疫了 ${amount} 点伤害！`, 'l-impt');
    return;
  }

  // ── 策反：首次受击时收编攻击者（本次伤害落空）
  if (src && target.charmFrom && state.turnCounter >= target.charmFrom && state.turnCounter < target.charmTo
      && src.owner !== target.owner && src.defId !== -1) {
    target.charmFrom = 0; target.charmTo = 0;
    const oldOwner = src.owner;
    src.owner = target.owner;
    src.apLeft = 0;
    ev('charm', { uid: src.uid });
    pushLog(state, `🎭 策反成功！${PNAME[oldOwner]}的【${getDef(src.defId).name}】临阵倒戈，加入${PNAME[target.owner]}！`, 'l-impt');
    return;
  }

  // ── 厚脸皮：来自正面的攻击伤害至多 10
  let dmg = amount;
  let frontal = false;
  if (src && opts.hit && target.defId === 24 && isFrontal(src, target)) {
    dmg = Math.min(dmg, 10);
    frontal = true;
  }

  target.hp -= dmg;
  ev('damage', { uid: target.uid, amount: dmg, frontal, crit: opts.crit || false });

  // ── 投石机标记：被“标记方另一枚非投石机棋子”再次命中时引爆
  if (opts.hit && src && target.mark10 && !opts.isMark &&
      src.owner === target.mark10.owner && src.defId !== 10 && !target.dead) {
    const mk = target.mark10;
    target.mark10 = null;
    pushLog(state, `🪨 投石机标记被引爆！`);
    await dealDamage(state, target, 5, pieceByUid(state, mk.srcUid), { isMark: true });
  }
  if (target.dead) return;

  // ── 致命伤害：名刀守护
  if (target.hp <= 0) {
    if (!opts.noGuard && !target.guardUsed && hasBladeGuard(state, target)) {
      target.guardUsed = true;
      target.hp = 1;
      ev('guard', { uid: target.uid });
      pushLog(state, `🗡️ 名刀之佑！【${getDef(target.defId).name}】避免了一次致命伤害，以 1 血存活。`, 'l-impt');
      return;
    }
    await killPiece(state, target, src);
    return;
  }

  // ── 伤害转化器：受到友方棋子伤害时反弹等量给射程内敌人
  if (src && target.defId === 16 && src.owner === target.owner && !opts.noCounter) {
    ev('counter', { uid: target.uid });
    pushLog(state, `🔄 伤害转化器将 ${dmg} 点友方伤害转化为反击！`);
    const foes = state.pieces.filter((q) => !q.dead && q.owner !== target.owner &&
                                           nearestDist(target, q) <= effRange(target));
    for (const f of foes) await dealDamage(state, f, dmg, target, { noCounter: true });
  }
}

/** 目标是否有己方名刀（本体形态）守护 */
function hasBladeGuard(state, target) {
  return state.pieces.some((q) => !q.dead && q.defId === 3 && q.owner === target.owner &&
                                  nearestDist(q, target) <= 6);
}

/** 治疗（回满血会引爆投石机标记） */
async function heal(state, target, amount) {
  if (!target || target.dead || !(amount > 0)) return;
  const real = Math.min(amount, target.maxHp - target.hp);
  if (real <= 0) return;
  target.hp += real;
  ev('heal', { uid: target.uid, amount: real });
  // 回满血触发投石机标记
  if (target.hp >= target.maxHp && target.mark10) {
    const mk = target.mark10;
    target.mark10 = null;
    pushLog(state, `🪨 【${getDef(target.defId).name}】回满血，投石机标记引爆！`);
    await dealDamage(state, target, 5, pieceByUid(state, mk.srcUid), { isMark: true });
  }
}

/** 击杀：标记死亡 + 记录遗言 + 杀手升级 */
async function killPiece(state, victim, killer) {
  if (victim.dead) return;
  victim.dead = true;
  victim.hp = 0;
  ev('death', { uid: victim.uid, defId: victim.defId });

  // 杀手击杀升级
  if (killer && !killer.dead && killer.defId === 26 && victim.owner !== killer.owner) {
    killer.killCount++;
    const stage = ((killer.killCount - 1) % 4) + 1;
    if (stage === 1 || stage === 4) {
      killer.maxHp += 10;
      killer.hp = Math.min(killer.maxHp, killer.hp + 10);
      pushLog(state, `🔪 杀手完成第 ${killer.killCount} 杀：+10 血量上限并回复 10 血！（${killer.hp}/${killer.maxHp}）`, 'l-impt');
    } else if (stage === 2) {
      killer.atk += 5;
      pushLog(state, `🔪 杀手完成第 ${killer.killCount} 杀：+5 攻击力！（atk ${killer.atk}）`, 'l-impt');
    } else {
      killer.range += 1;
      pushLog(state, `🔪 杀手完成第 ${killer.killCount} 杀：+1 攻击范围！（射程 ${killer.range}）`, 'l-impt');
    }
    ev('buff', { uid: killer.uid });
  }

  if (getDef(victim.defId).type !== 'base' && getDef(victim.defId).type !== 'grave') {
    pendingDeaths.push({ victim, killer });
  } else if (victim.defId === -1) {
    checkWin(state);
  }
}

/** 逐个结算死亡遗言（可能异步等待玩家选择） */
async function flushDeaths(state) {
  while (pendingDeaths.length) {
    const { victim, killer } = pendingDeaths.shift();
    const fn = DEATHRATTLES[victim.defId];
    if (fn) await fn(state, victim, killer);
  }
}

function checkWin(state) {
  const b0 = state.pieces.find((p) => p.defId === -1 && p.owner === 0);
  const b1 = state.pieces.find((p) => p.defId === -1 && p.owner === 1);
  if (!b0 || !b1) return; // 单元测试等无基地场景不判负
  const d0 = b0.hp <= 0, d1 = b1.hp <= 0;
  if (d0 && d1) { state.winner = 1 - state.curPlayer; }
  else if (d0) { state.winner = 1; }
  else if (d1) { state.winner = 0; }
  if (state.winner != null) {
    state.phase = 'over';
    pushLog(state, `🏆 ${PNAME[state.winner]}摧毁了对方基地，获得胜利！`, 'l-impt');
    ev('win', { winner: state.winner });
  }
}
