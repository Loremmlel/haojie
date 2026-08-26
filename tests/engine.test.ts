/* ═══════════════ engine.test.ts · 引擎回归权威套件（node:test） ═══════════════
 * 1) 九个定向场景：穿透阻挡 / 厚脸皮 / 名刀 / 投石机标记 / 策反 /
 *    大肉比蓄势 / 直行侠 / 杀手升级 / 死吧与金身（31 断言）
 * 2) 随机整局模拟：自动决策打完整局，校验状态不变量（含悔棋逐字节还原）
 * 功能体自 v1 test/smoke.js 逐行平移（v1 API 替换对照见各注释）。
 * 运行：npm test
 * ══════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/engine/game.ts';
import type { Game } from '../src/engine/types.ts';
import { getDef, type Cell } from '../src/engine/data.ts';
import type { Piece, GameState, ChoiceSpec, ChoiceResult } from '../src/engine/state.ts';
import { pieceAt } from '../src/engine/state.ts';
import { SPELL_TARGETS } from '../src/engine/spells.ts';

/**
 * 极简断言器（非断言函数——直接 assert.ok 带 `asserts value`，
 * 会把 `big.x === 3` 之类比较收窄为字面量类型，后续 `big.x === 4` 被判为
 * “无重叠”而 typecheck 失败；v1 smoke.js 的 ok 亦为普通函数，平移保持原样）。
 */
function ok(cond: unknown, name: string): void {
  assert.ok(cond, name);
}

/** 自动目标选择器：与旧 smoke.js API.env.choose 逐字同策略 */
const autoChoose = async (spec: ChoiceSpec): Promise<ChoiceResult> => {
  if (spec.kind === 'option') return spec.options[0].value;
  if (spec.kind === 'cell') return spec.cells[0] ?? null;
  if (spec.kind === 'piece') return spec.cancelable ? null : (spec.pieces[0] ?? null);
  return null;
};

async function freshGame(): Promise<Game> {
  const g = await createGame(20260826, { choose: autoChoose });
  // 单元场景准备：进入行动阶段并移除双方基地（与旧 reset() 等效，但多局互不干扰）
  g.state.phase = 'action';
  g.state.pieces = g.state.pieces.filter((p) => p.defId !== -1);
  g.state.winner = null;
  return g;
}

/** 快捷造子（与旧 spawn 逐字等效，补全 Piece 全字段） */
function spawn(g: Game, owner: 0 | 1, defId: number, x: number, y: number,
               patch: Partial<Piece> = {}): Piece {
  const st = g.state;
  const p: Piece = {
    uid: ++st.uidSeq, owner, defId, x, y,
    hp: 30, maxHp: 30, atk: 20, range: 4, mv: 1, big: false,
    justDeployed: false, apLeft: 1, charge: 0, skillUses: 0, killCount: 0,
    guardUsed: false, mark10: null, shieldUntil: 0,
    reaperFrom: 0, reaperTo: 0, charmFrom: 0, charmTo: 0,
    atkBuffs: [], beatCount: 0, diesAt: 0, hitThisTurn: [],
  };
  Object.assign(p, patch);
  st.pieces.push(p);
  return p;
}

/* ── 场A：穿透阻挡 ──
 * 阵型（射手射程 3）：射手(1,7) 敌墙A(2,7) 敌近标(3,7) 敌斜标(3,8)
 * (3,7) 的 3 步内路径必经唯一格 (2,7)，被封死；
 * (3,8) 可经 (2,8) 三步绕行；补上敌墙B(2,8) 后全部路径封死。 */
test('穿透阻挡', async () => {
  const g = await freshGame();
  const archerA = spawn(g, 0, 9, 1, 7, { range: 3, apLeft: 5 });   // 射手
  const wallA = spawn(g, 1, 26, 2, 7);                             // 敌方前排墙
  const closeT = spawn(g, 1, 26, 3, 7);                            // 同排贴墙目标
  const diagT = spawn(g, 1, 26, 3, 8);                             // 斜后目标（可绕）
  let targets = g.rules.attackTargets(archerA);
  ok(targets.includes(wallA), '射程内的前排敌人可被攻击');
  ok(!targets.includes(closeT), '唯一必经格被占，贴墙后排无法穿透');
  ok(targets.includes(diagT), '存在绕行路径时斜后目标仍可被攻击');
  const wallB = spawn(g, 1, 26, 2, 8);                             // 补上第二面墙
  targets = g.rules.attackTargets(archerA);
  ok(!targets.includes(diagT), '双墙封死全部 ≤射程 路径后斜后目标不可攻击');
});

/* ── 场B：厚脸皮正面/背面 ── */
test('厚脸皮正面/背面', async () => {
  const g = await freshGame();
  const turtle = spawn(g, 0, 24, 5, 5, { hp: 50, maxHp: 50 });     // 蓝方厚脸皮（基地在 y=1）
  const foeHi = spawn(g, 1, 26, 5, 8, { atk: 40 });                // 从前线方向（y 更大）袭来
  const hpBefore = turtle.hp;
  g.state.curPlayer = 1; foeHi.apLeft = 1;
  await g.doAttack(foeHi.uid, turtle.uid);
  ok(turtle.hp === hpBefore - 10, `正面 40 攻只造成 10 伤（${hpBefore}→${turtle.hp}）`);
  const foeBack = spawn(g, 1, 26, 5, 3, { atk: 40 });              // 从背后（y 更小）袭来
  foeBack.apLeft = 1;
  const hpMid = turtle.hp;
  await g.doAttack(foeBack.uid, turtle.uid);
  ok(turtle.hp === hpMid - 40, `背面偷袭全额 40 伤（${hpMid}→${turtle.hp}）`);
});

/* ── 场C：名刀守护 ── */
test('名刀守护', async () => {
  const g = await freshGame();
  const blade = spawn(g, 0, 3, 5, 6);                              // 名刀本体
  const fragile = spawn(g, 0, 11, 5, 4, { hp: 10, maxHp: 20 });    // 脆弱友军
  const killer = spawn(g, 1, 26, 5, 2, { atk: 99 });
  killer.apLeft = 1; g.state.curPlayer = 1;
  await g.doAttack(killer.uid, fragile.uid);
  ok(fragile.hp === 1 && !fragile.dead && fragile.guardUsed, '致命伤被名刀转化为 1 血存活');
  ok(!blade.dead, '名刀本体不受影响');
  killer.apLeft = 1;
  await g.doAttack(killer.uid, fragile.uid);
  ok(fragile.dead, '第二次致命伤不再受保护');
});

/* ── 场D：投石机标记 ── */
test('投石机标记', async () => {
  const g = await freshGame();
  g.state.curPlayer = 0;
  const treb = spawn(g, 0, 10, 1, 7, { apLeft: 5, range: 100 });   // 投石机（射程全场）
  const victim = spawn(g, 1, 26, 8, 7, { hp: 50, maxHp: 50 });
  await g.doAttack(treb.uid, victim.uid);                          // 零伤挂标
  ok(victim.mark10 != null && victim.hp === 50, '命中后挂上标记且无直接伤害');
  const allyHit = spawn(g, 0, 26, 7, 7, { atk: 12 });
  await g.doAttack(allyHit.uid, victim.uid);                       // 友方再命中 → 引爆
  ok(victim.hp === 50 - 12 - 5 && victim.mark10 === null, `再次被非投石机友军命中引爆 5 伤（${victim.hp}/50）`);
  // 回满血引爆：红方自己的奶妈把挂标目标奶满 → 标记触发
  const victim2 = spawn(g, 1, 26, 8, 3, { hp: 20, maxHp: 30 });
  treb.apLeft = 1;
  await g.doAttack(treb.uid, victim2.uid);
  g.state.curPlayer = 1;
  const medic = spawn(g, 1, 2, 8, 5, { range: 3 });                // 红方奶妈
  await g.doAttack(medic.uid, victim2.uid);                        // 治疗 +20 → 回满 → 引爆 5
  g.state.curPlayer = 0;
  ok(victim2.hp === 30 - 5 && !victim2.dead && victim2.mark10 === null, `回满血瞬间标记引爆（${victim2.hp}/30）`);
  // 投石机自己的重复命中不应引爆
  const victim3 = spawn(g, 1, 26, 8, 9, { hp: 50, maxHp: 50 });
  treb.apLeft = 1;
  await g.doAttack(treb.uid, victim3.uid);
  treb.apLeft = 1;
  await g.doAttack(treb.uid, victim3.uid);
  ok(victim3.mark10 != null && victim3.hp === 50, '投石机自身反复命中不会引爆标记');
});

/* ── 场E：策反 ── */
test('策反', async () => {
  const g = await freshGame();
  const bait = spawn(g, 0, 26, 5, 7);
  bait.charmFrom = 1; bait.charmTo = 2;                            // 窗口 [T+1, T+2)
  g.state.turnCounter = 1;                                         // 处于窗口内
  const traitor = spawn(g, 1, 26, 5, 9, { atk: 15 });
  traitor.apLeft = 1; g.state.curPlayer = 1;
  const baitHp = bait.hp;
  await g.doAttack(traitor.uid, bait.uid);
  ok(traitor.owner === 0, '攻击者临阵倒戈变为蓝方');
  ok(bait.hp === baitHp, '策反化解了本次伤害');
  ok(traitor.apLeft === 0, '倒戈者当回合剩余行动作废');
});

/* ── 场F：大肉比蓄势移动（跨回合两段式） ── */
test('大肉比蓄势移动', async () => {
  const g = await freshGame();
  const big = spawn(g, 0, 5, 3, 3, { hp: 111, maxHp: 111, big: true, mv: 0 });
  g.state.curPlayer = 0;
  ok(await g.doMove(big.uid, 4, 3), '第一次移动指令执行为蓄势');
  ok(big.charge === 1 && big.x === 3 && big.y === 3, '蓄势后原地不动、获得蓄力条');
  big.apLeft = 1;                                               // 模拟进入下一个己方回合
  ok(await g.doMove(big.uid, 4, 3), '蓄势完成后向右平移一格');
  ok(big.x === 4 && big.y === 3 && big.charge === 0, '整体平移成功且蓄力清零');
  ok(pieceAt(g.state, 4, 3) === big && pieceAt(g.state, 5, 4) === big, '占据格随整体平移更新');
});

/* ── 场G：直行侠直线三格 ── */
test('直行侠直线三格', async () => {
  const g = await freshGame();
  const straight = spawn(g, 0, 13, 3, 7, { mv: 3 });
  g.state.curPlayer = 0;
  const mt = g.rules.moveTargets(straight);
  const keys = mt.map((c) => c.x + ',' + c.y).sort().join(' ');
  ok(keys === '3,10 3,4 6,7', `仅四个方向的三格落点（${keys}）`);
  ok(await g.doMove(straight.uid, 6, 7) && straight.x === 6, '横向冲刺三格成功');
});

/* ── 场H：杀手升级循环 ── */
test('杀手升级循环', async () => {
  const g = await freshGame();
  const slayer = spawn(g, 0, 26, 5, 7, { atk: 100, hp: 45, maxHp: 45, range: 4 });
  const preySpots = [[5, 6], [5, 5], [5, 4], [5, 3], [6, 7]];   // 全部 ≤ 射程且互不重叠
  for (const [px, py] of preySpots) {
    const prey = spawn(g, 1, 11, px, py, { hp: 10, maxHp: 10 });
    slayer.apLeft = 1; g.state.curPlayer = 0;
    await g.doAttack(slayer.uid, prey.uid);
  }
  ok(slayer.killCount === 5, '累计五杀');
  ok(slayer.atk === 100 + 5 && slayer.range === 4 + 1, '第二杀+5攻、第三杀+1射程已生效');
  // 五杀的升级序列为 血/攻/射程/血/血 → 共三次 +10 上限
  ok(slayer.maxHp === 45 + 30, `三次 +10 血量上限生效（${slayer.maxHp}/75）`);
});

/* ── 场I：死吧 & 金身 ── */
test('死吧与金身', async () => {
  const g = await freshGame();
  const reaper = spawn(g, 0, 26, 5, 7, { atk: 30 });
  const doomed = spawn(g, 1, 26, 5, 9, { hp: 60, maxHp: 60 });
  reaper.reaperFrom = 3; reaper.reaperTo = 3;
  g.state.turnCounter = 3;
  g.state.curPlayer = 0;
  await g.doAttack(reaper.uid, doomed.uid);
  ok(doomed.dead, '斩杀窗口内命中的第一个敌人立即死亡');
  // 金身抵挡
  const reaper2 = spawn(g, 0, 26, 5, 3, { atk: 30 });
  const golden = spawn(g, 1, 26, 5, 5, { hp: 60, maxHp: 60, shieldUntil: 99 });
  reaper2.reaperFrom = 3; reaper2.reaperTo = 3;
  await g.doAttack(reaper2.uid, golden.uid);
  // v1 的 golden.reaperImmune 从未被任何引擎代码赋值（恒 undefined），
  // v2 Piece 亦无此字段——该半句在 v1 恒真，平移时略去，保留核心条件
  ok(!golden.dead, '金身挡下即死');
  ok(golden.hp === 60, '被金身抵挡的攻击不另算伤害');
});

/* ═══════════ 随机整局模拟 ═══════════ */

const BW = 9, BH = 13;

function checkInvariants(g: Game, tag: string): void {
  const S = g.state;
  for (const p of S.pieces) {
    if (p.dead) continue;
    if (!(p.x >= 1 && p.x <= BW && p.y >= 1 && p.y <= BH)) throw new Error(`${tag}: 棋子越界 (${p.x},${p.y})`);
    if (!Number.isFinite(p.hp) || p.hp > p.maxHp) throw new Error(`${tag}: 血量异常 ${p.hp}/${p.maxHp}`);
    if (!Number.isFinite(p.atk)) throw new Error(`${tag}: 攻击力 NaN`);
  }
  const b0 = S.pieces.find((p) => p.defId === -1 && p.owner === 0);
  const b1 = S.pieces.find((p) => p.defId === -1 && p.owner === 1);
  if (!b0 || !b1) throw new Error(`${tag}: 基地丢失`);
}

const rndTest = (() => { let s = 987654321; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
const pickRnd = <T>(arr: T[]): T => arr[Math.floor(rndTest() * arr.length)];

test('随机整局模拟', async () => {
  const g = await createGame(777777, { choose: autoChoose });
  let undosVerified = 0;
  for (let step = 0; step < 3000; step++) {
    const S = g.state;
    checkInvariants(g, `step ${step}`);
    if (S.winner != null) break;

    // ── 悔棋确定性抽样验证：记录快照 → 执行一步 → 撤销 → 必须逐字节还原
    if (step % 25 === 5) {
      const before = JSON.stringify(S);
      // v1 的 API.undoDepth()（depth 变量）在 v2 Game 门面不存在——按 brief 删除该变量及 void depth 行
      if (S.phase === 'action') {
        await g.endTurn();
        checkInvariants(g, `step ${step} after endTurn`);
        g.undo();
        if (JSON.stringify(g.state) !== before) throw new Error(`step ${step}: 悔棋未精确还原`);
        undosVerified++;
      }
    }

    if (S.phase === 'deploy') {
      const me = S.curPlayer;
      // 始终处理手牌首张，避免索引漂移；上限兜底防意外死循环
      let guard = 0;
      while (g.state.phase === 'deploy' &&
             (g.state.hand[me] || []).length > 0 && guard++ < 20) {
        const card = g.state.hand[me][0];
        const def = getDef(card.defId);
        if (def.type === 'follower') {
          const cells = g.rules.deployCells(card.defId, me);
          if (!cells.length) { g.discardUnplaceable(0); continue; }
          const spot = pickRnd(cells);
          if (!(await g.deployFollower(0, spot.x, spot.y))) {
            throw new Error(`deployFollower 校验失败: ${JSON.stringify({ defId: card.defId, spot })}`);
          }
        } else if (rndTest() < 0.5) {
          // 法术：尝试释放（拿不到合法目标就储存）
          const spec = SPELL_TARGETS[card.defId](g.state, me);
          let got: ChoiceResult = null;
          if (spec.kind === 'option') got = spec.options[0].value;
          else if (spec.kind === 'cell') got = spec.cells[0] || null;
          else if (spec.kind === 'piece') got = spec.pieces[0] || null;
          if (got != null) await g.castHandSpell(0, got);
          else await g.storeHandSpell(0);
        } else {
          await g.storeHandSpell(0);
        }
      }
      if (g.state.phase === 'deploy' && (g.state.hand[me] || []).length > 0) {
        throw new Error('部署阶段卡死：手牌无法处理');
      }
      continue;
    }

    // ── 行动阶段
    if (rndTest() < 0.15) { await g.endTurn(); continue; }
    const me = S.curPlayer;
    const actable = g.state.pieces.filter((p) =>
      !p.dead && p.owner === me && !p.justDeployed && p.apLeft > 0);
    if (!actable.length) { await g.endTurn(); continue; }
    const p = pickRnd(actable);

    const moves = g.rules.moveTargets(p);
    const atks = g.rules.attackTargets(p);
    const sk = g.rules.skillInfo(p);
    const roll = rndTest();

    if (p.defId === 5 && p.charge <= 0 && roll < 0.6) {
      await g.doMove(p.uid, p.x, p.y);            // 蓄势
    } else if (roll < 0.4 && moves.length) {
      const t = pickRnd(moves);
      await g.doMove(p.uid, t.x, t.y);
    } else if (roll < 0.75 && atks.length) {
      await g.doAttack(p.uid, pickRnd(atks).uid);
    } else if (sk && sk.usable(p)) {
      await g.useSkill(p.uid);
    } else if (moves.length) {
      const t = pickRnd(moves);
      await g.doMove(p.uid, t.x, t.y);
    } else if (atks.length) {
      await g.doAttack(p.uid, pickRnd(atks).uid);
    } else {
      await g.endTurn();
    }
  }
  const fin = g.state;
  console.log(`  ➜ 模拟结束：回合 ${fin.turnCounter}，存活棋子 ${fin.pieces.filter((p) => !p.dead).length}，悔棋验证 ${undosVerified} 次`);
  ok(undosVerified >= 3, '悔棋快照多次精确还原');
  ok(fin.turnCounter > 4, '整局推进超过 4 个回合（流程没有卡死）');
});
