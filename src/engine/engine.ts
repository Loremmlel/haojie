/* ═══════════════ engine.ts · 伤害 / 治疗 / 死亡管线 ═══════════════
 * 所有伤害统一经过 dealDamage，依次结算：
 *   金身免疫 → 策反倒戈 → 厚脸皮正面减免 → 扣血 →
 *   投石机标记引爆 → 名刀守护 → 死亡遗言入队 → 转化器反弹
 * （管线顺序注释以代码实际顺序为准，评审 m2）
 * ═══════════════════════════════════════════════════════════════ */

import { getDef } from './data.ts';
import { rnd } from './rng.ts';
import { PNAME, ev, pushLog, makePiece, pieceByUid,
         type Session, type GameState, type Piece, type Owner } from './state.ts';
import { effAtk, effRange, effActions, isFrontal, nearestDist } from './rules.ts';
import { DEATHRATTLES, type HandlerCtx } from './abilities.ts';

/**
 * 对目标造成伤害。
 * @param src  来源棋子（可为 null，如法术直接伤害）
 * @param opts {hit:是否为攻击命中, isMark:标记引爆, noCounter:禁止反弹,
 *              noGuard:无视名刀守护, crit:暴击标记（performAttack 掷骰后传入）}
 * 注：opts.crit 为 brief Interfaces 未列但 performAttack 必需的最小补项（代码否则无法编译）。
 */
export async function dealDamage(s: Session, target: Piece, amount: number,
  src: Piece | null,
  opts?: { hit?: boolean; isMark?: boolean; noCounter?: boolean; noGuard?: boolean; crit?: boolean }): Promise<void> {
  opts = opts || {};
  if (!target || target.dead || !(amount > 0)) return;

  // ── 金身：不受任何伤害
  if (target.shieldUntil > s.state.turnCounter) {
    ev(s, { type: 'block', uid: target.uid });
    pushLog(s.state, `🛡️ ${getDef(target.defId).name} 处于金身状态，免疫了 ${amount} 点伤害！`, 'l-impt');
    return;
  }

  // ── 策反：首次受击时收编攻击者（本次伤害落空）
  if (src && target.charmFrom && s.state.turnCounter >= target.charmFrom && s.state.turnCounter < target.charmTo
      && src.owner !== target.owner && src.defId !== -1) {
    target.charmFrom = 0; target.charmTo = 0;
    const oldOwner = src.owner;
    src.owner = target.owner;
    src.apLeft = 0;
    ev(s, { type: 'charm', uid: src.uid });
    pushLog(s.state, `🎭 策反成功！${PNAME[oldOwner]}的【${getDef(src.defId).name}】临阵倒戈，加入${PNAME[target.owner]}！`, 'l-impt');
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
  ev(s, { type: 'damage', uid: target.uid, amount: dmg, frontal, crit: opts.crit || false });

  // ── 投石机标记：被“标记方另一枚非投石机棋子”再次命中时引爆
  if (opts.hit && src && target.mark10 && !opts.isMark &&
      src.owner === target.mark10.owner && src.defId !== 10 && !target.dead) {
    const mk = target.mark10;
    target.mark10 = null;
    pushLog(s.state, `🪨 投石机标记被引爆！`);
    await dealDamage(s, target, 5, pieceByUid(s.state, mk.srcUid), { isMark: true });
  }
  if (target.dead) return;

  // ── 致命伤害：名刀守护
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

  // ── 伤害转化器：受到友方棋子伤害时反弹等量给射程内敌人
  if (src && target.defId === 16 && src.owner === target.owner && !opts.noCounter) {
    ev(s, { type: 'counter', uid: target.uid });
    pushLog(s.state, `🔄 伤害转化器将 ${dmg} 点友方伤害转化为反击！`);
    const foes = s.state.pieces.filter((q) => !q.dead && q.owner !== target.owner &&
                                           nearestDist(target, q) <= effRange(s.state, target));
    for (const f of foes) await dealDamage(s, f, dmg, target, { noCounter: true });
  }
}

/** 目标是否有己方名刀（本体形态）守护 */
export function hasBladeGuard(st: GameState, target: Piece): boolean {
  return st.pieces.some((q) => !q.dead && q.defId === 3 && q.owner === target.owner &&
                                  nearestDist(q, target) <= 6);
}

/** 治疗（回满血会引爆投石机标记） */
export async function heal(s: Session, target: Piece, amount: number): Promise<void> {
  if (!target || target.dead || !(amount > 0)) return;
  const real = Math.min(amount, target.maxHp - target.hp);
  if (real <= 0) return;
  target.hp += real;
  ev(s, { type: 'heal', uid: target.uid, amount: real });
  // 回满血触发投石机标记
  if (target.hp >= target.maxHp && target.mark10) {
    const mk = target.mark10;
    target.mark10 = null;
    pushLog(s.state, `🪨 【${getDef(target.defId).name}】回满血，投石机标记引爆！`);
    await dealDamage(s, target, 5, pieceByUid(s.state, mk.srcUid), { isMark: true });
  }
}

/** 击杀：标记死亡 + 记录遗言 + 杀手升级 */
export async function killPiece(s: Session, victim: Piece, killer: Piece | null): Promise<void> {
  if (victim.dead) return;
  victim.dead = true;
  victim.hp = 0;
  ev(s, { type: 'death', uid: victim.uid, defId: victim.defId });

  // 杀手击杀升级
  if (killer && !killer.dead && killer.defId === 26 && victim.owner !== killer.owner) {
    killer.killCount++;
    const stage = ((killer.killCount - 1) % 4) + 1;
    if (stage === 1 || stage === 4) {
      killer.maxHp += 10;
      killer.hp = Math.min(killer.maxHp, killer.hp + 10);
      pushLog(s.state, `🔪 杀手完成第 ${killer.killCount} 杀：+10 血量上限并回复 10 血！（${killer.hp}/${killer.maxHp}）`, 'l-impt');
    } else if (stage === 2) {
      killer.atk += 5;
      pushLog(s.state, `🔪 杀手完成第 ${killer.killCount} 杀：+5 攻击力！（atk ${killer.atk}）`, 'l-impt');
    } else {
      killer.range += 1;
      pushLog(s.state, `🔪 杀手完成第 ${killer.killCount} 杀：+1 攻击范围！（射程 ${killer.range}）`, 'l-impt');
    }
    ev(s, { type: 'buff', uid: killer.uid });
  }

  if (getDef(victim.defId).type !== 'base' && getDef(victim.defId).type !== 'grave') {
    s.pendingDeaths.push({ victim, killer });
  } else if (victim.defId === -1) {
    checkWin(s.state);
    // win 事件：v1 在 checkWin 内 ev('win')，但 checkWin 现为 (st) 纯查询、无 Session 通道，
    // 故补发于调用方（此处即基地阵亡的唯一判定点；其余 checkWin 调用方同样补发，保持 v1 事件流）。
    if (s.state.winner != null) ev(s, { type: 'win', winner: s.state.winner });
  }
}

/** 逐个结算死亡遗言（可能异步等待玩家选择） */
export async function flushDeaths(ctx: HandlerCtx, s: Session): Promise<void> {
  while (s.pendingDeaths.length) {
    const { victim, killer } = s.pendingDeaths.shift()!; // while 条件保证非空
    const fn = DEATHRATTLES[victim.defId];
    if (fn) await fn(ctx, s, victim, killer);
  }
}

/** 胜负判定：纯 (st) 查询。v1 的 ev('win') 已上移至调用方（见 killPiece/performAttack 及各动作函数）。 */
export function checkWin(st: GameState): void {
  const b0 = st.pieces.find((p) => p.defId === -1 && p.owner === 0);
  const b1 = st.pieces.find((p) => p.defId === -1 && p.owner === 1);
  if (!b0 || !b1) return; // 单元测试等无基地场景不判负
  const d0 = b0.hp <= 0, d1 = b1.hp <= 0;
  if (d0 && d1) { st.winner = 1 - st.curPlayer; }
  else if (d0) { st.winner = 1; }
  else if (d1) { st.winner = 0; }
  if (st.winner != null) {
    st.phase = 'over';
    pushLog(st, `🏆 ${PNAME[st.winner]}摧毁了对方基地，获得胜利！`, 'l-impt');
  }
}

/** 自 game.js 上移：攻击结算核心（死吧/掷骰/投石机挂标/射手记录/定炮清充能）。
 *  需要 ctx：内部经 flushDeaths 结算死亡遗言（奶妈遗言要 choose）。
 *  无返回值（v1 语义）；成功与否由 state 变化体现。 */
export async function performAttack(ctx: HandlerCtx, s: Session, p: Piece, target: Piece): Promise<void> {
  ev(s, { type: 'attack', uid: p.uid, tuid: target.uid });

  // ── 死吧！：下回合命中的第一个敌方立即死亡
  if (p.reaperFrom && s.state.turnCounter === p.reaperFrom &&
      getDef(target.defId).type !== 'base') {
    p.reaperFrom = 0; p.reaperTo = 0;
    if (target.shieldUntil > s.state.turnCounter) {
      pushLog(s.state, `💀 斩杀之光撞上了金身！【${getDef(target.defId).name}】侥幸存活！`, 'l-impt');
    } else {
      pushLog(s.state, `💀 死吧！！【${getDef(target.defId).name}】当场毙命！`, 'l-impt');
      await killPiece(s, target, p);
      await flushDeaths(ctx, s);
      checkWin(s.state);
      if (s.state.winner != null) ev(s, { type: 'win', winner: s.state.winner });
      return;
    }
  }

  // ── 伤害掷骰
  let dmg = effAtk(s.state, p);
  let crit = false;
  if (p.defId === 1) {
    const r = rnd(s.state);
    if (r < 1 / 12) { dmg += 60; crit = true; }
    else if (r < 1 / 4) { dmg += 20; }
  }

  // ── 投石机：零伤挂标
  if (p.defId === 10) {
    pushLog(s.state, `🪨 投石机砸中了【${getDef(target.defId).name}】，附上引信标记！`);
    if (!target.dead) {
      target.mark10 = { owner: p.owner, srcUid: p.uid, expires: s.state.turnCounter + 2 };
      ev(s, { type: 'mark', uid: target.uid });
    }
  } else {
    await dealDamage(s, target, dmg, p, { hit: true, crit });
  }

  if (p.defId === 9) p.hitThisTurn.push(target.uid);
  if (p.defId === 4) p.charge = 0;
  await flushDeaths(ctx, s);
  checkWin(s.state);
  if (s.state.winner != null) ev(s, { type: 'win', winner: s.state.winner });
}

/** 自 game.js 上移：底层落子 + 冲锋询问。需要 ctx：询问走 ctx.choose。
 *  spells.ts 的 summonOnce 与 game.ts 的 deployFollower 都调用它。 */
export async function deployPiece(ctx: HandlerCtx, s: Session, owner: number,
  defId: number, x: number, y: number): Promise<Piece> {
  const p = makePiece(s.state, owner as Owner, defId, x, y);
  s.state.pieces.push(p);
  ev(s, { type: 'deploy', uid: p.uid });
  pushLog(s.state, `${PNAME[owner]}部署【${getDef(defId).name}】于 (${x},${y})`);
  if (defId === 1) {
    const choice = await ctx.choose({
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
      p.apLeft = effActions(s.state, p);
      pushLog(s.state, '⚔️ 冲锋怪嘶吼着冲入了战场！（本回合即可行动）', 'l-impt');
      ev(s, { type: 'buff', uid: p.uid });
    }
  }
  return p;
}
