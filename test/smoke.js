/* ═══════════════ smoke.js · 逻辑层冒烟测试（Node 直接运行） ═══════════════
 * 1) 定向单元场景：穿透阻挡 / 厚脸皮 / 名刀 / 投石机标记 / 策反 /
 *    大肉比蓄势 / 直行侠 / 杀手升级 / 死吧与金身 / 悔棋确定性
 * 2) 随机整局模拟：自动决策打完整局，校验状态不变量
 * 运行：npm test
 * ══════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');

/* ── 拼接逻辑层并捕获 API ── */
const FILES = ['rng.js', 'data.js', 'state.js', 'rules.js', 'engine.js',
               'abilities.js', 'spells.js', 'game.js'];
let captured = null;
const src = FILES
  .map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', f), 'utf8'))
  .join('\n\n');
new Function('__HAOJIE_EXPORT__', src)((obj) => { captured = obj; });
const API = captured; // 导出钩子直接传递 API 本体

/* 自动目标选择：option 取第一项，cell 取第一格，piece 默认取首个（可取消则取消） */
API.env.choose = async (spec) => {
  if (spec.kind === 'option') return spec.options[0].value;
  if (spec.kind === 'cell') return spec.cells[0] || null;
  if (spec.kind === 'piece') return spec.cancelable ? null : (spec.pieces[0] || null);
  return null;
};

/* ── 极简断言器 ── */
let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}`); }
}
function section(name) { console.log(`\n◆ ${name}`); }
/** 测试本地占位查询（逻辑层闭包内的 pieceAt 不可直接访问） */
function cellOwner(state, x, y) {
  const q = state.pieces.find((p) => !p.dead &&
    ((p.x === x && p.y === y) ||
     (p.big && x >= p.x && x <= p.x + 1 && y >= p.y && y <= p.y + 1)));
  return q || null;
}
/* 棋盘尺寸（逻辑层闭包内的 W/H 不可直接访问） */
const BW = 9, BH = 13;

/** 快捷造子 */
function spawn(owner, defId, x, y, patch) {
  const st = API.state();
  const p = {
    uid: ++st.uidSeq, owner, defId, x, y,
    hp: 30, maxHp: 30, atk: 20, range: 4, mv: 1, big: false,
    justDeployed: false, apLeft: 1, charge: 0, skillUses: 0, killCount: 0,
    guardUsed: false, mark10: null, shieldUntil: 0,
    reaperFrom: 0, reaperTo: 0, charmFrom: 0, charmTo: 0,
    atkBuffs: [], beatCount: 0, diesAt: 0, hitThisTurn: [],
  };
  Object.assign(p, patch || {});
  st.pieces.push(p);
  return p;
}
function reset() {
  return API.init(20260826).then(() => {
    const S = API.state();
    S.phase = 'action';          // 单元测试直接进入行动阶段
    S.pieces = S.pieces.filter((p) => p.defId !== -1); // 单元场景先清掉基地避免误判胜负
    S.winner = null;
  });
}

async function unitTests() {
  /* ── 场A：穿透阻挡 ──
   * 阵型（射手射程 3）：射手(1,7) 敌墙A(2,7) 敌近标(3,7) 敌斜标(3,8)
   * (3,7) 的 3 步内路径必经唯一格 (2,7)，被封死；
   * (3,8) 可经 (2,8) 三步绕行；补上敌墙B(2,8) 后全部路径封死。 */
  section('穿透规则：敌方棋子挡住弹道');
  await reset();
  let S = API.state();
  const archerA = spawn(0, 9, 1, 7, { range: 3, apLeft: 5 });   // 射手
  const wallA = spawn(1, 26, 2, 7);                             // 敌方前排墙
  const closeT = spawn(1, 26, 3, 7);                            // 同排贴墙目标
  const diagT = spawn(1, 26, 3, 8);                             // 斜后目标（可绕）
  let targets = API.rules.attackTargets(archerA);
  ok(targets.includes(wallA), '射程内的前排敌人可被攻击');
  ok(!targets.includes(closeT), '唯一必经格被占，贴墙后排无法穿透');
  ok(targets.includes(diagT), '存在绕行路径时斜后目标仍可被攻击');
  const wallB = spawn(1, 26, 2, 8);                             // 补上第二面墙
  targets = API.rules.attackTargets(archerA);
  ok(!targets.includes(diagT), '双墙封死全部 ≤射程 路径后斜后目标不可攻击');

  /* ── 场B：厚脸皮正面/背面 ── */
  section('厚脸皮：正面伤害上限 10');
  await reset();
  S = API.state();
  const turtle = spawn(0, 24, 5, 5, { hp: 50, maxHp: 50 });     // 蓝方厚脸皮（基地在 y=1）
  const foeHi = spawn(1, 26, 5, 8, { atk: 40 });                // 从前线方向（y 更大）袭来
  const hpBefore = turtle.hp;
  API.state().curPlayer = 1; foeHi.apLeft = 1;
  await API.doAttack(foeHi.uid, turtle.uid);
  ok(turtle.hp === hpBefore - 10, `正面 40 攻只造成 10 伤（${hpBefore}→${turtle.hp}）`);
  const foeBack = spawn(1, 26, 5, 3, { atk: 40 });              // 从背后（y 更小）袭来
  foeBack.apLeft = 1;
  const hpMid = turtle.hp;
  await API.doAttack(foeBack.uid, turtle.uid);
  ok(turtle.hp === hpMid - 40, `背面偷袭全额 40 伤（${hpMid}→${turtle.hp}）`);

  /* ── 场C：名刀守护 ── */
  section('名刀：一次性致命保护');
  await reset();
  S = API.state();
  const blade = spawn(0, 3, 5, 6);                              // 名刀本体
  const fragile = spawn(0, 11, 5, 4, { hp: 10, maxHp: 20 });    // 脆弱友军
  const killer = spawn(1, 26, 5, 2, { atk: 99 });
  killer.apLeft = 1; API.state().curPlayer = 1;
  await API.doAttack(killer.uid, fragile.uid);
  ok(fragile.hp === 1 && !fragile.dead && fragile.guardUsed, '致命伤被名刀转化为 1 血存活');
  ok(!blade.dead, '名刀本体不受影响');
  killer.apLeft = 1;
  await API.doAttack(killer.uid, fragile.uid);
  ok(fragile.dead, '第二次致命伤不再受保护');

  /* ── 场D：投石机标记 ── */
  section('投石机：标记引爆');
  await reset();
  S = API.state();
  API.state().curPlayer = 0;
  const treb = spawn(0, 10, 1, 7, { apLeft: 5, range: 100 });   // 投石机（射程全场）
  const victim = spawn(1, 26, 8, 7, { hp: 50, maxHp: 50 });
  await API.doAttack(treb.uid, victim.uid);                     // 零伤挂标
  ok(victim.mark10 != null && victim.hp === 50, '命中后挂上标记且无直接伤害');
  const allyHit = spawn(0, 26, 7, 7, { atk: 12 });
  await API.doAttack(allyHit.uid, victim.uid);                  // 友方再命中 → 引爆
  ok(victim.hp === 50 - 12 - 5 && victim.mark10 === null, `再次被非投石机友军命中引爆 5 伤（${victim.hp}/50）`);
  // 回满血引爆：红方自己的奶妈把挂标目标奶满 → 标记触发
  const victim2 = spawn(1, 26, 8, 3, { hp: 20, maxHp: 30 });
  treb.apLeft = 1;
  await API.doAttack(treb.uid, victim2.uid);
  API.state().curPlayer = 1;
  const medic = spawn(1, 2, 8, 5, { range: 3 });                // 红方奶妈
  await API.doAttack(medic.uid, victim2.uid);                   // 治疗 +20 → 回满 → 引爆 5
  API.state().curPlayer = 0;
  ok(victim2.hp === 30 - 5 && !victim2.dead && victim2.mark10 === null, `回满血瞬间标记引爆（${victim2.hp}/30）`);
  // 投石机自己的重复命中不应引爆
  const victim3 = spawn(1, 26, 8, 9, { hp: 50, maxHp: 50 });
  treb.apLeft = 1;
  await API.doAttack(treb.uid, victim3.uid);
  treb.apLeft = 1;
  await API.doAttack(treb.uid, victim3.uid);
  ok(victim3.mark10 != null && victim3.hp === 50, '投石机自身反复命中不会引爆标记');

  /* ── 场E：策反 ── */
  section('策反：首次受击收编攻击者');
  await reset();
  S = API.state();
  const bait = spawn(0, 26, 5, 7);
  bait.charmFrom = 1; bait.charmTo = 2;                         // 窗口 [T+1, T+2)
  API.state().turnCounter = 1;                                  // 处于窗口内
  const traitor = spawn(1, 26, 5, 9, { atk: 15 });
  traitor.apLeft = 1; API.state().curPlayer = 1;
  const baitHp = bait.hp;
  await API.doAttack(traitor.uid, bait.uid);
  ok(traitor.owner === 0, '攻击者临阵倒戈变为蓝方');
  ok(bait.hp === baitHp, '策反化解了本次伤害');
  ok(traitor.apLeft === 0, '倒戈者当回合剩余行动作废');

  /* ── 场F：大肉比蓄势移动（跨回合两段式） ── */
  section('大肉比：蓄势一回合、下回合一挪');
  await reset();
  S = API.state();
  const big = spawn(0, 5, 3, 3, { hp: 111, maxHp: 111, big: true, mv: 0 });
  API.state().curPlayer = 0;
  ok(await API.doMove(big.uid, 4, 3), '第一次移动指令执行为蓄势');
  ok(big.charge === 1 && big.x === 3 && big.y === 3, '蓄势后原地不动、获得蓄力条');
  big.apLeft = 1;                                               // 模拟进入下一个己方回合
  ok(await API.doMove(big.uid, 4, 3), '蓄势完成后向右平移一格');
  ok(big.x === 4 && big.y === 3 && big.charge === 0, '整体平移成功且蓄力清零');
  ok(cellOwner(API.state(), 4, 3) === big && cellOwner(API.state(), 5, 4) === big, '占据格随整体平移更新');

  /* ── 场G：直行侠直线三格 ── */
  section('直行侠：必须直线恰好三格');
  await reset();
  S = API.state();
  const straight = spawn(0, 13, 3, 7, { mv: 3 });
  API.state().curPlayer = 0;
  const mt = API.rules.moveTargets(straight);
  const keys = mt.map((c) => c.x + ',' + c.y).sort().join(' ');
  ok(keys === '3,10 3,4 6,7', `仅四个方向的三格落点（${keys}）`);
  ok(await API.doMove(straight.uid, 6, 7) && straight.x === 6, '横向冲刺三格成功');

  /* ── 场H：杀手升级循环 ── */
  section('杀手：四段升级循环');
  await reset();
  S = API.state();
  const slayer = spawn(0, 26, 5, 7, { atk: 100, hp: 45, maxHp: 45, range: 4 });
  const preySpots = [[5, 6], [5, 5], [5, 4], [5, 3], [6, 7]];   // 全部 ≤ 射程且互不重叠
  for (const [px, py] of preySpots) {
    const prey = spawn(1, 11, px, py, { hp: 10, maxHp: 10 });
    slayer.apLeft = 1; API.state().curPlayer = 0;
    await API.doAttack(slayer.uid, prey.uid);
  }
  ok(slayer.killCount === 5, '累计五杀');
  ok(slayer.atk === 100 + 5 && slayer.range === 4 + 1, '第二杀+5攻、第三杀+1射程已生效');
  // 五杀的升级序列为 血/攻/射程/血/血 → 共三次 +10 上限
  ok(slayer.maxHp === 45 + 30, `三次 +10 血量上限生效（${slayer.maxHp}/75）`);

  /* ── 场I：死吧 & 金身 ── */
  section('死吧！与金身的交互');
  await reset();
  S = API.state();
  const reaper = spawn(0, 26, 5, 7, { atk: 30 });
  const doomed = spawn(1, 26, 5, 9, { hp: 60, maxHp: 60 });
  reaper.reaperFrom = 3; reaper.reaperTo = 3;
  API.state().turnCounter = 3;
  API.state().curPlayer = 0;
  await API.doAttack(reaper.uid, doomed.uid);
  ok(doomed.dead, '斩杀窗口内命中的第一个敌人立即死亡');
  // 金身抵挡
  const reaper2 = spawn(0, 26, 5, 3, { atk: 30 });
  const golden = spawn(1, 26, 5, 5, { hp: 60, maxHp: 60, shieldUntil: 99 });
  reaper2.reaperFrom = 3; reaper2.reaperTo = 3;
  await API.doAttack(reaper2.uid, golden.uid);
  ok(!golden.dead && golden.reaperImmune !== true, '金身挡下即死');
  ok(golden.hp === 60, '被金身抵挡的攻击不另算伤害');
}

/* ═══════════ 随机整局模拟 ═══════════ */

function checkInvariants(tag) {
  const S = API.state();
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
const pickRnd = (arr) => arr[Math.floor(rndTest() * arr.length)];

async function randomBattle(maxSteps) {
  section(`随机整局模拟（上限 ${maxSteps} 步）`);
  await API.init(777777);
  let undosVerified = 0;
  for (let step = 0; step < maxSteps; step++) {
    const S = API.state();
    checkInvariants(`step ${step}`);
    if (S.winner != null) break;

    // ── 悔棋确定性抽样验证：记录快照 → 执行一步 → 撤销 → 必须逐字节还原
    if (step % 25 === 5) {
      const before = JSON.stringify(S);
      const depth = API.undoDepth();
      // 执行一个“必定成功”的小操作：结束回合（若可）；否则跳过
      if (S.phase === 'action') {
        await API.endTurn();
        checkInvariants(`step ${step} after endTurn`);
        await API.undo();
        if (JSON.stringify(API.state()) !== before) throw new Error(`step ${step}: 悔棋未精确还原`);
        undosVerified++;
        void depth;
      }
    }

    if (S.phase === 'deploy') {
      const me = S.curPlayer;
      // 始终处理手牌首张，避免索引漂移；上限兜底防意外死循环
      let guard = 0;
      while (API.state().phase === 'deploy' &&
             (API.state().hand[me] || []).length > 0 && guard++ < 20) {
        const card = API.state().hand[me][0];
        const def = API.getDef(card.defId);
        if (def.type === 'follower') {
          const cells = API.rules.deployCells(card.defId, me);
          if (!cells.length) { await API.discardUnplaceable(0); continue; }
          const spot = pickRnd(cells);
          if (!(await API.deployFollower(0, spot.x, spot.y))) {
            throw new Error(`deployFollower 校验失败: ${JSON.stringify({ defId: card.defId, spot })}`);
          }
        } else if (rndTest() < 0.5) {
          // 法术：尝试释放（拿不到合法目标就储存）
          const spec = API.spellTargets[card.defId](API.state(), me);
          let got = null;
          if (spec.kind === 'option') got = spec.options[0].value;
          else if (spec.kind === 'cell') got = spec.cells[0] || null;
          else if (spec.kind === 'piece') got = spec.pieces[0] || null;
          if (got != null) await API.castHandSpell(0, got);
          else await API.storeHandSpell(0);
        } else {
          await API.storeHandSpell(0);
        }
      }
      if (API.state().phase === 'deploy' && (API.state().hand[me] || []).length > 0) {
        throw new Error('部署阶段卡死：手牌无法处理');
      }
      continue;
    }

    // ── 行动阶段
    if (rndTest() < 0.15) { await API.endTurn(); continue; }
    const me = S.curPlayer;
    const actable = API.state().pieces.filter((p) =>
      !p.dead && p.owner === me && !p.justDeployed && p.apLeft > 0);
    if (!actable.length) { await API.endTurn(); continue; }
    const p = pickRnd(actable);

    const moves = API.rules.moveTargets(p);
    const atks = API.rules.attackTargets(p);
    const sk = API.rules.skillInfo(p);
    const roll = rndTest();

    if (p.defId === 5 && p.charge <= 0 && roll < 0.6) {
      await API.doMove(p.uid, p.x, p.y);            // 蓄势
    } else if (roll < 0.4 && moves.length) {
      const t = pickRnd(moves);
      await API.doMove(p.uid, t.x, t.y);
    } else if (roll < 0.75 && atks.length) {
      await API.doAttack(p.uid, pickRnd(atks).uid);
    } else if (sk && sk.usable(p)) {
      await API.useSkill(p.uid);
    } else if (moves.length) {
      const t = pickRnd(moves);
      await API.doMove(p.uid, t.x, t.y);
    } else if (atks.length) {
      await API.doAttack(p.uid, pickRnd(atks).uid);
    } else {
      await API.endTurn();
    }
  }
  const fin = API.state();
  console.log(`  ➜ 模拟结束：回合 ${fin.turnCounter}，存活棋子 ${fin.pieces.filter((p) => !p.dead).length}，悔棋验证 ${undosVerified} 次`);
  ok(undosVerified >= 3, '悔棋快照多次精确还原');
  ok(fin.turnCounter > 4, '整局推进超过 4 个回合（流程没有卡死）');
}

(async () => {
  console.log('⚔️ 浩劫 · 逻辑层冒烟测试');
  try {
    await unitTests();
    await randomBattle(3000);
    console.log(`\n结果：${passed} 通过，${failed} 失败`);
    process.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('\n💥 测试抛出异常：', err);
    process.exit(1);
  }
})();
