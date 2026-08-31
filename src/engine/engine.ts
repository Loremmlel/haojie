/* ═══════════════ engine.ts · 伤害 / 治疗 / 死亡管线 ═══════════════
 * 所有伤害统一经过 dealDamage，依次结算（顺序与 v1 逐字节一致）：
 *   金身免疫 → 策反倒戈 → 厚脸皮正面减免（钩子）→ 扣血 →
 *   投石机标记引爆（通用状态步骤）→ 名刀守护（全局钩子询问）→
 *   死亡遗言入队 → 转化器反弹（钩子）
 * 效果分发一律经 getEffect(defId)，defId 字面量已归零（见 data.ts 守卫）。
 * ═══════════════════════════════════════════════════════════════ */

import { getDef } from './data.ts';
import { PNAME, ev, pushLog, makePiece, pieceByUid,
         type Session, type GameState, type Piece, type Owner } from './state.ts';
import { getEffect, effAtk } from './effects.ts';
import type { HandlerCtx } from './types.ts';

/**
 * 对目标造成伤害。
 * @param src  来源棋子（可为 null，如法术直接伤害）
 * @param opts {hit:是否为攻击命中, isMark:标记引爆, noCounter:禁止反弹,
 *              noGuard:无视名刀守护, crit:暴击标记}
 */
export async function dealDamage(s: Session, target: Piece, amount: number,
  src: Piece | null,
  opts?: { hit?: boolean; isMark?: boolean; noCounter?: boolean; noGuard?: boolean; crit?: boolean }): Promise<void> {
  opts = opts || {};
  if (!target || target.dead || !(amount > 0)) return;

  // ── 金身：不受任何伤害（通用状态步骤）
  if (target.shieldUntil > s.state.turnCounter) {
    ev(s, { type: 'block', uid: target.uid });
    pushLog(s.state, `🛡️ ${getDef(target.defId).name} 处于金身状态，免疫了 ${amount} 点伤害！`, 'l-impt');
    return;
  }

  // ── 策反：首次受击时收编攻击者（通用状态步骤；基地不可被策反）
  if (src && target.charmFrom && s.state.turnCounter >= target.charmFrom && s.state.turnCounter < target.charmTo
      && src.owner !== target.owner && getDef(src.defId).type !== 'base') {
    target.charmFrom = 0; target.charmTo = 0;
    const oldOwner = src.owner;
    src.owner = target.owner;
    src.apLeft = 0;
    ev(s, { type: 'charm', uid: src.uid });
    pushLog(s.state, `🎭 策反成功！${PNAME[oldOwner]}的【${getDef(src.defId).name}】临阵倒戈，加入${PNAME[target.owner]}！`, 'l-impt');
    return;
  }

  // ── 厚脸皮：来自正面的攻击伤害至多 10（钩子）
  const mod = getEffect(target.defId).modifyIncomingDamage(s.state, target, amount, src, opts);
  const dmg = mod.amount;
  const frontal = mod.frontal;

  target.hp -= dmg;
  ev(s, { type: 'damage', uid: target.uid, amount: dmg, frontal, crit: opts.crit || false });

  // ── 投石机标记：被“标记方另一枚非投石机棋子”再次命中时引爆（通用状态步骤）
  if (opts.hit && src && target.mark10 && !opts.isMark &&
      src.owner === target.mark10.owner && !getEffect(src.defId).isCatapult && !target.dead) {
    const mk = target.mark10;
    target.mark10 = null;
    pushLog(s.state, `🪨 投石机标记被引爆！`);
    await dealDamage(s, target, 5, pieceByUid(s.state, mk.srcUid), { isMark: true });
  }
  if (target.dead) return;

  // ── 致命伤害：名刀守护（全局钩子询问）
  if (target.hp <= 0) {
    if (!opts.noGuard && !target.guardUsed && hasBladeGuard(s.state, target)) {
      target.guardUsed = true;
      target.hp = 1;
      ev(s, { type: 'guard', uid: target.uid });
      pushLog(s.state, `🗡️ 名刀之佑！【${getDef(target.defId).name}】避免了一次致命伤害，以 1 血存活。`, 'l-impt');
      return;
    }
    await killPiece(s, target, src);
    return;
  }

  // ── 伤害转化器（钩子；友伤分支按规格剔除“可被友方攻击”机制、忠实迁移现有逻辑）
  await getEffect(target.defId).onDamaged(s, target, dmg, src, opts);
}

/** 目标是否有己方名刀（本体形态）守护 —— 遍历询问全局钩子 */
export function hasBladeGuard(st: GameState, target: Piece): boolean {
  for (const q of st.pieces) {
    if (q.dead || q.owner !== target.owner) continue;
    if (getEffect(q.defId).guardsAlly(st, q, target)) return true;
  }
  return false;
}

/** 治疗（回满血会引爆投石机标记）—— 通用，无 defId 分支 */
export async function heal(s: Session, target: Piece, amount: number): Promise<void> {
  if (!target || target.dead || !(amount > 0)) return;
  const real = Math.min(amount, target.maxHp - target.hp);
  if (real <= 0) return;
  target.hp += real;
  ev(s, { type: 'heal', uid: target.uid, amount: real });
  if (target.hp >= target.maxHp && target.mark10) {
    const mk = target.mark10;
    target.mark10 = null;
    pushLog(s.state, `🪨 【${getDef(target.defId).name}】回满血，投石机标记引爆！`);
    await dealDamage(s, target, 5, pieceByUid(s.state, mk.srcUid), { isMark: true });
  }
}

/** 击杀：标记死亡 + 记录遗言 + 杀手升级（钩子） */
export async function killPiece(s: Session, victim: Piece, killer: Piece | null): Promise<void> {
  if (victim.dead) return;
  victim.dead = true;
  victim.hp = 0;
  ev(s, { type: 'death', uid: victim.uid, defId: victim.defId });

  if (killer && !killer.dead && victim.owner !== killer.owner) {
    await getEffect(killer.defId).onKill(s, killer, victim);
  }

  if (getDef(victim.defId).type !== 'base' && getDef(victim.defId).type !== 'grave') {
    s.pendingDeaths.push({ victim, killer });
  } else if (getDef(victim.defId).type === 'base') {
    const w = checkWin(s.state);
    if (w != null) ev(s, { type: 'win', winner: w });
  }
}

/** 逐个结算死亡遗言（可能异步等待玩家选择）—— 经 getEffect 分发 */
export async function flushDeaths(ctx: HandlerCtx, s: Session): Promise<void> {
  while (s.pendingDeaths.length) {
    const { victim, killer } = s.pendingDeaths.shift()!;
    await getEffect(victim.defId).onDeath(ctx, s, victim, killer);
  }
}

/** 胜负判定：纯 (st) 查询，返回「本次调用新判定或变更出的 winner」 */
export function checkWin(st: GameState): number | null {
  const prev = st.winner;
  const b0 = st.pieces.find((p) => getDef(p.defId).type === 'base' && p.owner === 0);
  const b1 = st.pieces.find((p) => getDef(p.defId).type === 'base' && p.owner === 1);
  if (!b0 || !b1) return null;
  const d0 = b0.hp <= 0, d1 = b1.hp <= 0;
  if (d0 && d1) { st.winner = 1 - st.curPlayer; }
  else if (d0) { st.winner = 1; }
  else if (d1) { st.winner = 0; }
  if (st.winner !== prev) {
    const w = st.winner!;
    st.phase = 'over';
    pushLog(st, `🏆 ${PNAME[w]}摧毁了对方基地，获得胜利！`, 'l-impt');
    return w;
  }
  return null;
}

/** 攻击结算核心。钩子挂点：onAttack（接管）→ modifyAttackDamage（掷骰）→ dealDamage → onAttackDone */
export async function performAttack(ctx: HandlerCtx, s: Session, p: Piece, target: Piece): Promise<void> {
  ev(s, { type: 'attack', uid: p.uid, tuid: target.uid });

  // ── 死吧！：下回合命中的第一个敌方立即死亡（通用状态步骤）
  if (p.reaperFrom && s.state.turnCounter === p.reaperFrom &&
      getDef(target.defId).type !== 'base') {
    p.reaperFrom = 0; p.reaperTo = 0;
    if (target.shieldUntil > s.state.turnCounter) {
      pushLog(s.state, `💀 斩杀之光撞上了金身！【${getDef(target.defId).name}】侥幸存活！`, 'l-impt');
    } else {
      pushLog(s.state, `💀 死吧！！【${getDef(target.defId).name}】当场毙命！`, 'l-impt');
      await killPiece(s, target, p);
      await flushDeaths(ctx, s);
      const w = checkWin(s.state);
      if (w != null) ev(s, { type: 'win', winner: w });
      return;
    }
  }

  const eff = getEffect(p.defId);

  // ── 攻击接管（投石机挂标），未接管则走伤害掷骰 → 扣血
  const handled = await eff.onAttack(ctx, s, p, target);
  if (!handled) {
    const dmg = effAtk(s.state, p);
    const mod = eff.modifyAttackDamage(s.state, p, target, dmg);
    await dealDamage(s, target, mod.dmg, p, { hit: true, crit: mod.crit });
  }

  // ── 攻击后（射手记录 / 定炮清充能）
  await eff.onAttackDone(ctx, s, p, target);

  await flushDeaths(ctx, s);
  const w = checkWin(s.state);
  if (w != null) ev(s, { type: 'win', winner: w });
}

/** 底层落子 + 冲锋询问（钩子）。spells.ts 与 game.ts 都调用它。 */
export async function deployPiece(ctx: HandlerCtx, s: Session, owner: number,
  defId: number, x: number, y: number): Promise<Piece> {
  const p = makePiece(s.state, owner as Owner, defId, x, y);
  s.state.pieces.push(p);
  ev(s, { type: 'deploy', uid: p.uid });
  pushLog(s.state, `${PNAME[owner]}部署【${getDef(defId).name}】于 (${x},${y})`);
  await getEffect(defId).onDeploy(ctx, s, p);
  return p;
}
