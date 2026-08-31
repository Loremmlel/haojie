# 「浩劫」棋子效果钩子系统设计

- **日期**：2026-08-31
- **基线**：`plan/modern-motion-style-system-impl` @ `2755d39`
- **分支**：新开 `feat/hook-effects`
- **范围**：引擎效果分发机制重构（`src/engine/**`）
- **总原则**：钩子只收编「以 `defId` 分发的硬编码分支」；状态驱动的通用管线步骤不迁移；新代码保持最简；测试优先复用与改造现有套件，不铺新文件

## 1. 现状与问题

效果没有类型模型：`Def` 无 ability 字段，效果身份是裸整数 `defId`，语义只写在中文描述字符串里。两套机制并存：

- **表驱动（干净）**：`SKILLS`（7 主动技能）/ `DEATHRATTLES`（4 遗言）/ `CAST` + `SPELL_TARGETS`（5 法术）
- **硬编码（脏）**：约 18 个棋子的 `if (p.defId === N)` 散落 5 个文件——engine.ts（伤害/攻击管线）、rules.ts（有效值计算）、game.ts（回合流/行动）、spells.ts（重铸召唤）、state.ts（big 标记）

已知重复：12 号贴脸惩罚在 `effActions` 与 `effMv` 各一份；3→33 名刀形态判定在 game.ts 与 spells.ts 各一份。

## 2. 目标

1. 全部棋子效果收编进单一 `effects.ts`：抽象基类 `PieceEffect` + 静态注册表 `EFFECTS[defId]`
2. 引擎各触发点改为调用钩子，`src/engine/**` 中 `defId ===` 字面量归零
3. 行为逐字节不变：现有测试 + e2e 全绿；悔棋（JSON 快照）与随机数（种子推进）机制不动
4. 加新棋子 = 一个类 + 一行注册
5. 法术保持独立 `CAST` 表（不并入）
6. **删除行数必须大于新增行数**（不统计测试与文档）

## 3. 非目标

不做：法术并入统一模型、阶段系统重构、结算阶段、GameEvent 变更、`Piece` 字段变更、rng 机制变更、UI 层改动（仅 `HandlerCtx` import 路径）、spells.ts 逻辑改动。

## 4. 核心模型

```ts
/* effects.ts —— 全引擎唯一的棋子效果之家 */
export abstract class PieceEffect {
  // ── 静态属性（定义性事实）──
  buffable = true;            // 可否被增益（10 投石机 = false）
  attackableByAlly = false;   // 可否被友方指定为攻击目标（16 转化器 = true）

  // ── 查询钩子（纯函数）──
  effRange(st, p): number;                            // 默认 p.range
  effAtk(st, p): number;                              // 默认 p.atk + atkBuffs
  effActions(st, p): number;                          // 默认 def.acts
  effMv(st, p): number;                               // 默认 p.mv
  moveTargets(st, p): Cell[];                         // 默认通用 BFS（内部走 this.effMv）
  attackTargets(st, p): Piece[];                      // 默认通用穿透（内部走 this.effRange）
  modifyIncomingDamage(st, target, amount, src, opts): number;   // 默认原样
  modifyAttackDamage(st, p, target, dmg): { dmg: number; crit: boolean }; // 默认原样

  // ── 触发器钩子（副作用）──
  onDeploy(ctx, s, p): Promise<void>;
  onTurnStart(ctx, s, p): Promise<void>;
  onMoveCommand(ctx, s, p, x, y): Promise<boolean>;   // true=已接管（不走默认移动）
  onAttack(ctx, s, p, target): Promise<boolean>;      // true=已接管（跳过默认伤害）
  onAttackDone(ctx, s, p, target): Promise<void>;
  onDamaged(ctx, s, target, amount, src, opts): Promise<void>;
  onKill(ctx, s, killer, victim): Promise<void>;
  onDeath(ctx, s, victim, killer): Promise<void>;

  // ── 全局查询钩子（引擎遍历全场棋子逐个询问）──
  blocksAllyCell(st, x, y, owner): boolean;           // 默认 false
  guardsAlly(st, blade, ally): boolean;               // 默认 false

  // ── 主动技能（吸收 SKILLS 表）──
  skillLabel?: string;
  skillUsable?(p): boolean;
  skillTargetSpec?(st, p): ChoiceSpec;
  skillExec?(ctx, s, p, got): Promise<void>;
}

const EFFECTS: Record<number, PieceEffect> = { /* 26 条，每个棋子一个实例 */ };
```

**钩子清单及消费者**（每条至少一个真实消费者，ponytail 原则）：

| 钩子 | 消费者 |
|---|---|
| effRange | 33 刀魂 |
| effAtk | 33 刀魂 |
| effActions | 4 / 21 / 23 / 12 |
| effMv | 12（消灭重复） |
| moveTargets | 13 直线三格 |
| attackTargets | 4 定炮门槛+射程 / 9 射手不重复 |
| modifyIncomingDamage | 24 厚脸皮 |
| modifyAttackDamage | 1 冲锋怪掷骰 |
| onDeploy | 1 冲锋怪 |
| onTurnStart | 23 节拍+1 |
| onMoveCommand | 5 大肉比蓄势/平移 |
| onAttack | 2 奶妈治疗 / 10 投石机挂标 |
| onAttackDone | 9 射手记录 / 4 定炮清充能 |
| onDamaged | 16 转化器反弹 |
| onKill | 26 杀手升级 |
| onDeath | 2 / 11 / 12 / 20（吸收 DEATHRATTLES） |
| blocksAllyCell | 23 独行侠禁入圈 |
| guardsAlly | 3 名刀守护 |
| buffable 属性 | 6 增益目标过滤（10 = false） |
| attackableByAlly 属性 | 通用 attackTargets 过滤（16 = true） |
| skill 组 | 4 / 6 / 7 / 14 / 15 / 19 / 21 |

**两个非钩子特例**：

1. **3→33 抽牌形态判定**不是棋子钩子（抽牌时场上还没有棋子）——导出函数 `resolveDrawDefId(state, defId)` 放 effects.ts，game.ts 与 spells.ts 共用，消灭重复。
2. **状态驱动的通用管线步骤不迁移**：金身（`shieldUntil`）、策反（`charmFrom/To`）、投石机标记引爆（`mark10`）、死吧（`reaperFrom`）、回合开始时效清理——这些本就不含 `defId` 判定，留在原地。

## 5. 跨棋子效果落位

1. **3 名刀守护** → `guardsAlly` 全局查询。`dealDamage` 致命判定处：遍历 target 友方问 `EFFECTS[q.defId].guardsAlly?.(st, q, target)`；`guardUsed=1 / hp=1 / ev('guard')` 留管线。3（守护灵，guardsAlly）与 33（刀魂，effRange/effAtk）是同棋双形、两条注册。
2. **23 独行侠禁入圈** → 封装助手 `blocksAlly(st, x, y, owner)`（遍历询问），三个调用点统一：BFS 可达格、默认 moveTargets、canDeployAt。
3. **10 投石机标记** → `onAttack` 覆写挂 `mark10` 并返回 true；标记引爆留 `dealDamage`（读状态无 defId）。`src.defId !== 10` 守卫：因 10 的攻击被接管后不进 dealDamage，实为死代码——验证删除后测试仍绿则删，绿不了保留为防御性一行。
4. **16 转化器** → `onDamaged` 覆写反弹（`noCounter` 递归守卫在钩子内）；`attackableByAlly = true` 让友方可指定攻击。
5. **22 策反** → 不迁移，CAST[22] 设状态，dealDamage 策反分支是通用步骤。
6. **24 厚脸皮** → `modifyIncomingDamage` 覆写：`opts.hit && isFrontal(src, target)` 时压到 10。
7. **6 BUFF怪** → `skillTargetSpec` 过滤从 `q.defId !== 10` 改为 `q.buffable !== false`。
8. **2 奶妈** → 一个类同时覆写 `onAttack`（治疗模式）与 `onDeath`（遗言反击），收拢现在横跨 doAttack 硬编码 + DEATHRATTLES 的两处逻辑。

## 6. 引擎改造点

- **data.ts**：5 号加 `big: true`（2×2 是定义性数据，不是行为）。其余不动。
- **state.ts**：`makePiece` 的 `|| defId === 5` 删除（由 `def.big` 接管，原代码已读 `def.big`）。
- **rules.ts**：`effRange/effAtk/effActions/effMv` 变一行转发；`moveTargets/attackTargets` 通用算法下沉基类默认实现，对外留转发层；`inLonerZone` 改为 `blocksAlly` 全局询问；`canDeployAt` 2×2 直接用 `getDef(defId).big`；纯几何助手（mdist/inBoard/pieceCells/nearestDist/bfsEmptyCells/DIRS）原样保留。
- **engine.ts**：`dealDamage` 顺序（金身→策反→厚脸皮→扣血→标记引爆→名刀→遗言→转化器）保留，厚脸皮改 `modifyIncomingDamage`、名刀改 `guardsAlly` 全局询问、转化器改 `onDamaged`；`performAttack` 的掷骰改 `modifyAttackDamage`、奶妈治疗与投石机挂标合并为 `onAttack`、射手/定炮改 `onAttackDone`；`deployPiece` 冲锋询问改 `onDeploy`；`killPiece` 杀手升级改 `onKill`；`flushDeaths` 改查 `EFFECTS[victim.defId].onDeath`。
- **game.ts**：`doMove` 先问 `onMoveCommand`（true 则结束）；`doAttack` 删 `defId === 2` 特判（并入 onAttack）；`drawCards` 与回合开始用 `resolveDrawDefId` / `onTurnStart`；时效清理循环原样保留；`useSkill` 改查技能方法组。
- **abilities.ts**：删除。`SKILLS`/`DEATHRATTLES` 并入 effects.ts；`HandlerCtx` 移入 types.ts（spells.ts 改 import 路径，逻辑零改动）。
- **spells.ts**：逻辑零改动。

**import 环纪律**：effects.ts ↔ engine.ts 双向循环与现有 abilities.ts ↔ engine.ts 同构，靠「所有交叉引用在调用时、不在模块求值时」支撑。`EFFECTS` 注册表顶层**只做纯构造**（`new XxxEffect()`），绝不顶层触碰 engine/rules 函数。

## 7. 红线约束

1. **随机数顺序**：钩子必须挂在与现在 if 链完全相同的位置，钩子内不增删 `rnd()` 调用。顺序漂移会被确定性种子测试抓住。
2. **JSON 快照悔棋**：`Piece` 字段一个不动，效果状态继续平铺；`EFFECTS` 对象为无状态单例。
3. **import 环纪律**：见第 6 节。

## 8. 测试策略（复用优先）

1. **基线**：先跑 `tests/engine.test.ts`（398 行，9 定向场景 + 随机整局 + 悔棋逐字节还原）+ `e2e/smoke`，确认重构前全绿。
2. **逐文件重构、每步回归**：依赖序 data.ts → effects.ts（骨架+查询钩子）→ rules.ts → engine.ts → game.ts → 删 abilities.ts；每步 `npm test` + `npm run typecheck`。
3. **现有测试基本零改动**（走 `createGame` 公共 API 与 rules 公开函数）。若某处直接引用了被删的 `SKILLS`/`DEATHRATTLES` 内部符号，做最小 import 修正（查证：当前测试仅引 `SPELL_TARGETS`、rules 公开函数、state 工具，预计无需改）。
4. **两个微型守卫测试折叠进现有 engine.test.ts**（非新文件）：① 注册表完备性——遍历 `DEFS` 断言每个 follower 的 defId 在 `EFFECTS` 有条目，**并显式断言 33 刀魂**（33 不在 `DEFS` 内，是独立 `DEF_BLADE`）；② 引擎源码无 `defId ===` 字面量残留（fs 扫描 src/engine/*.ts，**排除 data.ts**——`getDef` 内的 `defId === -1/-2/-3/33` 是合法的数据查找，不属硬编码分支）。

## 9. 成功标准

- 全部现有测试 + e2e 绿
- `src/engine/**` 中 `defId ===` 归零
- 删除行数 > 新增行数
- 12 贴脸惩罚与 3→33 判定各收敛为单点
- 新棋子 = 一个类 + 一行注册

## 附：迁移清单（defId → 钩子）

| defId | 棋子 | 迁入钩子 |
|---|---|---|
| 1 | 冲锋怪 | modifyAttackDamage + onDeploy |
| 2 | 奶妈 | onAttack（治疗）+ onDeath（遗言） |
| 3 | 名刀（守护灵） | guardsAlly；形态判定 → resolveDrawDefId |
| 4 | 定炮 | effActions + attackTargets + onAttackDone + skill |
| 5 | 大肉比 | onMoveCommand；2×2 → data.ts `big: true` |
| 6 | BUFF怪 | skill（目标过滤用 buffable） |
| 7 | 钩子 | skill |
| 9 | 射手 | attackTargets + onAttackDone |
| 10 | 投石机 | onAttack + buffable=false |
| 11 | 白嫖怪 | onDeath |
| 12 | 跑得快 | effActions + effMv + onDeath |
| 13 | 直行侠 | moveTargets |
| 14 | 献祭炮 | skill |
| 15 | 蓄力怪 | skill |
| 16 | 转化器 | onDamaged + attackableByAlly |
| 19 | 路障小法师 | skill |
| 20 | 超级跑得快 | onDeath |
| 21 | 神行千里 | effActions + skill |
| 23 | 独行侠 | effActions + onTurnStart + blocksAllyCell |
| 24 | 厚脸皮 | modifyIncomingDamage |
| 26 | 杀手 | onKill |
| 33 | 刀魂 | effRange + effAtk |
| 8/17/18/22/25 | 法术 | 不动（CAST 表） |
