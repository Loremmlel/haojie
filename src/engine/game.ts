/* game.ts · createGame 会话工厂（对外 API 门面） */
import { rnd, rndInt } from './rng.ts';
import { getDef, W, H, type Cell } from './data.ts';
import { PNAME, ev, snap, undo, canUndo, pushLog, makePiece, newGame,
         pieceAt, pieceByUid,
         type Session, type GameEvent, type ChoiceResult, type Chooser,
         type GameState, type Piece, type Card, type StoredCard, type Owner } from './state.ts';
import { effActions, effRange, moveTargets, attackTargets, healTargets,
         deployCells, canDeployAt, nearestDist, computeExtraRows } from './rules.ts';
import { dealDamage, killPiece, heal, flushDeaths, checkWin, deployPiece, performAttack } from './engine.ts';
import { SKILLS, type HandlerCtx } from './abilities.ts';
import { SPELL_TARGETS, CAST } from './spells.ts';
import type { Game, GameDeps } from './types.ts';

const rejectChooser: Chooser = (spec) =>
  Promise.reject(new Error(`未注入目标选择器却发起了 ${spec.kind} 选择——请通过 createGame(seed, { choose }) 注入`));

export async function createGame(seed: number, deps?: GameDeps): Promise<Game> {
  const sess: Session = { state: newGame(seed), events: [], undoStack: [], pendingDeaths: [] };
  const ctx: HandlerCtx = { choose: deps?.choose ?? rejectChooser };

  /** 抽牌（名刀抽到时立即进行形态判定，手牌中直接呈现最终形态） */
  const drawCards = (state: GameState, owner: Owner, n: number): void => {
    for (let i = 0; i < n; i++) {
      let defId = rndInt(state, 1, 26);
      if (defId === 3 && rnd(state) >= 1 / 3) defId = 33;
      state.hand[owner].push({ uid: ++state.uidSeq, defId });
      const def = getDef(defId);
      pushLog(state, `${PNAME[owner]}召唤了【${def.name}】${def.emoji}${def.type === 'spell' ? '（法术）' : ''}`);
    }
  };

  /** 部署阶段 → 行动阶段推进 */
  const checkPhaseAdvance = (): void => {
    if (sess.state.phase === 'deploy' && sess.state.hand[sess.state.curPlayer].length === 0 && !sess.state.winner) {
      sess.state.phase = 'action';
      ev(sess, { type: 'phase', phase: 'action' });
    }
  };

  /* ─────────── 回合流转 ─────────── */

  const startTurnInternal = async (): Promise<void> => {
    sess.state.turnCounter++;
    const me = sess.state.curPlayer as Owner;

    // 全局时效清理（标记 / 金身 / 斩杀 / 策反 / 攻击增益 / 到期单位）
    for (const p of sess.state.pieces) {
      if (p.dead) continue;
      if (p.mark10 && sess.state.turnCounter >= p.mark10.expires) p.mark10 = null;
      if (p.shieldUntil && sess.state.turnCounter >= p.shieldUntil) p.shieldUntil = 0;
      if (p.reaperTo && sess.state.turnCounter > p.reaperTo) { p.reaperFrom = 0; p.reaperTo = 0; }
      if (p.charmTo && sess.state.turnCounter >= p.charmTo) { p.charmFrom = 0; p.charmTo = 0; }
      if (p.atkBuffs.length) p.atkBuffs = p.atkBuffs.filter((b) => b.until > sess.state.turnCounter);
      if (p.diesAt && sess.state.turnCounter >= p.diesAt) {
        pushLog(sess.state, `⌛ 【${getDef(p.defId).name}】的召唤物耗尽了时限，化为尘埃。`);
        await killPiece(sess, p, null);
      }
    }
    await flushDeaths(ctx, sess);

    // 己方棋子：节拍推进 + 行动次数重置
    for (const p of sess.state.pieces) {
      if (p.dead || p.owner !== me) continue;
      p.justDeployed = false;
      if (p.defId === 23) p.beatCount++;
      p.apLeft = effActions(sess.state, p);
      p.hitThisTurn = [];
    }

    computeExtraRows(sess.state, me);

    // 储存栏期限递减（remain < 0 销毁）
    const kept: StoredCard[] = [];
    for (const card of sess.state.stored[me]) {
      card.remain--;
      if (card.remain < 0) {
        pushLog(sess.state, `⌛ 法术【${getDef(card.defId).name}】超过储存期限，消散了……`, 'l-impt');
        ev(sess, { type: 'expire', owner: me });
      } else kept.push(card);
    }
    sess.state.stored[me] = kept;

    // 抽牌：基础 2 张 + 白嫖怪加成
    const n = 2 + sess.state.extraDraw[me];
    sess.state.extraDraw[me] = 0;
    drawCards(sess.state, me, n);

    sess.state.phase = 'deploy';
    ev(sess, { type: 'turn', player: me, turn: sess.state.turnCounter });
    checkPhaseAdvance();
  };

  const endTurn = async (): Promise<void> => {
    if (!sess.state || sess.state.winner != null) return;
    if (sess.state.phase !== 'action') return;
    snap(sess);
    sess.state.hand[sess.state.curPlayer] = [];
    sess.state.curPlayer = 1 - sess.state.curPlayer;
    await startTurnInternal();
  };

  /* ─────────── 部署阶段动作 ─────────── */

  const deployFollower = async (handIdx: number, x: number, y: number): Promise<boolean> => {
    const card: Card | undefined = sess.state.hand[sess.state.curPlayer][handIdx];
    if (!card || getDef(card.defId).type === 'spell') return false;
    if (!canDeployAt(sess.state, card.defId, sess.state.curPlayer as Owner, x, y)) return false;
    snap(sess);
    sess.state.hand[sess.state.curPlayer].splice(handIdx, 1);
    await deployPiece(ctx, sess, sess.state.curPlayer, card.defId, x, y);
    checkPhaseAdvance();
    return true;
  };

  /** 无处可放的随从被迫弃置（仅当没有合法位置时允许） */
  const discardUnplaceable = (handIdx: number): boolean => {
    const card: Card | undefined = sess.state.hand[sess.state.curPlayer][handIdx];
    if (!card || getDef(card.defId).type === 'spell') return false;
    if (deployCells(sess.state, card.defId, sess.state.curPlayer as Owner).length > 0) return false;
    snap(sess);
    sess.state.hand[sess.state.curPlayer].splice(handIdx, 1);
    pushLog(sess.state, `⚠️ 战场无处安放【${getDef(card.defId).name}】，只能忍痛放弃。`, 'l-impt');
    checkPhaseAdvance();
    return true;
  };

  const storeHandSpell = async (handIdx: number): Promise<boolean> => {
    const card: Card | undefined = sess.state.hand[sess.state.curPlayer][handIdx];
    if (!card || getDef(card.defId).type !== 'spell') return false;
    snap(sess);
    sess.state.hand[sess.state.curPlayer].splice(handIdx, 1);
    sess.state.stored[sess.state.curPlayer].push({ defId: card.defId, remain: getDef(card.defId).limit! }); // 法术卡必有 limit
    pushLog(sess.state, `🧪 【${getDef(card.defId).name}】存入储存栏（期限 ${getDef(card.defId).limit} 回合）。`);
    checkPhaseAdvance();
    return true;
  };

  const castHandSpell = async (handIdx: number, got: ChoiceResult): Promise<boolean> => {
    const card: Card | undefined = sess.state.hand[sess.state.curPlayer][handIdx];
    if (!card || getDef(card.defId).type !== 'spell') return false;
    snap(sess);
    sess.state.hand[sess.state.curPlayer].splice(handIdx, 1);
    await CAST[card.defId](ctx, sess, sess.state.curPlayer, got);
    await flushDeaths(ctx, sess);
    checkWin(sess.state);
    if (sess.state.winner != null) ev(sess, { type: 'win', winner: sess.state.winner });
    checkPhaseAdvance();
    return true;
  };

  const castStored = async (idx: number, got: ChoiceResult): Promise<boolean> => {
    const card: StoredCard | undefined = sess.state.stored[sess.state.curPlayer][idx];
    if (!card) return false;
    snap(sess);
    sess.state.stored[sess.state.curPlayer].splice(idx, 1);
    pushLog(sess.state, `✨ ${PNAME[sess.state.curPlayer]}释放了储存的法术【${getDef(card.defId).name}】！`, 'l-impt');
    await CAST[card.defId](ctx, sess, sess.state.curPlayer, got);
    await flushDeaths(ctx, sess);
    checkWin(sess.state);
    if (sess.state.winner != null) ev(sess, { type: 'win', winner: sess.state.winner });
    return true;
  };

  /* ─────────── 行动阶段动作 ─────────── */

  const doMove = async (uid: number, x: number, y: number): Promise<boolean> => {
    const p = pieceByUid(sess.state, uid);
    if (!p || p.owner !== sess.state.curPlayer || sess.state.phase !== 'action') return false;
    if (p.justDeployed || p.apLeft <= 0) return false;

    // 大肉比：先蓄势再平移
    if (p.defId === 5) {
      if (p.charge <= 0) {
        snap(sess);
        p.charge = 1;
        p.apLeft--;
        ev(sess, { type: 'buff', uid: p.uid });
        pushLog(sess.state, '🐘 大肉比深深蓄势……下次选择移动才会真正挪动！');
        return true;
      }
      const legal = moveTargets(sess.state, p).some((c) => c.x === x && c.y === y);
      if (!legal) return false;
      snap(sess);
      p.charge = 0;
      ev(sess, { type: 'move', uid: p.uid, tx: x, ty: y });
      p.x = x; p.y = y;
      p.apLeft--;
      pushLog(sess.state, `🐘 大肉比轰隆隆地挪到了 (${x},${y})！`);
      return true;
    }

    const legal = moveTargets(sess.state, p).some((c) => c.x === x && c.y === y);
    if (!legal) return false;
    snap(sess);
    ev(sess, { type: 'move', uid: p.uid, tx: x, ty: y });
    p.x = x; p.y = y;
    p.apLeft--;
    return true;
  };

  const doAttack = async (uid: number, targetUid: number): Promise<boolean> => {
    const p = pieceByUid(sess.state, uid);
    const t = pieceByUid(sess.state, targetUid);
    if (!p || !t || p.owner !== sess.state.curPlayer || sess.state.phase !== 'action') return false;
    if (p.justDeployed || p.apLeft <= 0) return false;

    // 奶妈：可指定己方残血棋子改为治疗
    if (p.defId === 2 && t.owner === p.owner) {
      if (t.hp >= t.maxHp) return false;
      if (nearestDist(p, t) > p.range) return false;
      snap(sess);
      p.apLeft--;
      pushLog(sess.state, `💉 奶妈为【${getDef(t.defId).name}】回复了 20 血量。`);
      ev(sess, { type: 'attack', uid: p.uid, tuid: t.uid, healMode: true });
      await heal(sess, t, 20);
      return true;
    }

    if (!attackTargets(sess.state, p).includes(t)) return false;
    snap(sess);
    p.apLeft--;
    await performAttack(ctx, sess, p, t);
    return true;
  };

  const useSkill = async (uid: number): Promise<boolean> => {
    const p = pieceByUid(sess.state, uid);
    const sk = SKILLS[p!.defId]; // v1 先取技能后判 p 为空（调用方必传合法 uid），`!` 仅类型适配
    if (!p || !sk || p.owner !== sess.state.curPlayer || sess.state.phase !== 'action') return false;
    if (p.justDeployed || p.apLeft <= 0 || !sk.usable(p)) return false;
    const spec = sk.targetSpec(sess.state, p);
    let got: ChoiceResult = null;
    if (spec.kind !== 'none') {
      got = await ctx.choose(spec);
      if (got == null) return false; // 玩家取消了
    }
    snap(sess);
    p.apLeft--;
    await sk.exec(ctx, sess, p, got);
    await flushDeaths(ctx, sess);
    checkWin(sess.state);
    if (sess.state.winner != null) ev(sess, { type: 'win', winner: sess.state.winner });
    return true;
  };

  /* ═════════════ 工厂主体：原 API.init(seed) ═════════════ */

  sess.state.curPlayer = rnd(sess.state) < 0.5 ? 0 : 1;
  pushLog(sess.state, `🎲 天命所归：${PNAME[sess.state.curPlayer]}执掌先行之权！`, 'l-impt');
  await startTurnInternal();

  return {
    get state() { return sess.state; },
    get events() { return sess.events; },
    canUndo: (): boolean => canUndo(sess),
    undo: (): boolean => {
      if (!canUndo(sess)) return false;
      undo(sess);
      return true;
    },
    deployFollower,
    discardUnplaceable,
    storeHandSpell,
    castHandSpell,
    castStored,
    doMove,
    doAttack,
    useSkill,
    endTurn,
    rules: {
      moveTargets: (p: Piece) => moveTargets(sess.state, p),
      attackTargets: (p: Piece) => attackTargets(sess.state, p),
      healTargets: (p: Piece) => healTargets(sess.state, p),
      deployCells: (defId: number, owner: number) => deployCells(sess.state, defId, owner as Owner),
      skillInfo: (p: Piece) => SKILLS[p.defId] ?? null,
      effActions: (p: Piece) => effActions(sess.state, p),
      effRange: (p: Piece) => effRange(sess.state, p),
      bigCharge: (p: Piece) => p.charge,
    },
  };
}
