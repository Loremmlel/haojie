# 「浩劫」棋子效果钩子系统设计

- **日期**：2026-08-31（v2：子代理评审修订）
- **基线**：`plan/modern-motion-style-system-impl` @ `2755d39`
- **分支**：`feat/hook-effects`
- **范围**：引擎效果分发机制重构（`src/engine/**`）
- **总原则**：钩子只收编「以 `defId` 分发的硬编码分支」；状态驱动的通用管线步骤不迁移；测试优先复用与改造现有套件，不铺新文件

**v2 修订摘要**（对应评审发现）：特殊单位兜底 `getEffect`；16 号 `attackableByAlly` 机制剔除（登记后续债务）；`onAttack` 拆分为 doAttack/performAttack 两层钩子；`modifyIncomingDamage` 返回 `{amount, frontal}`；新增 `attackRange` 接缝；新增 `geometry.ts` 打破 rules↔effects 循环；`blocksAllyCell` 补棋子参数；五处 `=== -1` 分支改数据驱动；硬编码棋子数修正为 15；注册表条目数修正为 22；spells.ts 改两处；测试基线补 fx.test.ts；删除目标弱化为可核验口径。

## 1. 现状与问题

效果没有类型模型：`Def` 无 ability 字段，效果身份是裸整数 `defId`，语义只写在中文描述字符串里。两套机制并存：

- **表驱动（干净）**：`SKILLS`（7 主动技能）/ `DEATHRATTLES`（4 遗言）/ `CAST` + `SPELL_TARGETS`（5 法术）
- **硬编码（脏）**：以 `defId ===/!==` 字面量分发的棋子共 **15 个**（1, 2, 3, 4, 5, 9, 10, 12, 13, 16, 21, 23, 24, 26, 33；加上基地 -1 的四处分支则 16），散落 5 个文件——engine.ts（伤害/攻击管线）、rules.ts（有效值计算）、game.ts（回合流/行动）、spells.ts（重铸召唤）、state.ts（big 标记）

已知重复：12 号贴脸惩罚在 `effActions` 与 `effMv` 各一份（rules.ts:163-175 / 178-187）；3→33 名刀形态判定在 game.ts:26 与 spells.ts:129 逐字符相同。

## 2. 目标

1. 全部棋子效果收编进 `effects.ts`：基类 `PieceEffect` + 注册表 `EFFECTS[defId]` + `getEffect` 兜底（特殊单位走默认实例）
2. `src/engine/**` 中 `defId ===/!==` 字面量归零（唯一豁免：data.ts `getDef` 的数据查找）
3. 行为逐字节不变：现有测试 + e2e 全绿；悔棋（JSON 快照）与随机数（种子推进）机制不动
4. 加新棋子 = 一个类 + 一行注册
5. 法术保持独立 `CAST` 表（不并入）
6. **删除可核验**：`abilities.ts` 整体删除；除 `effects.ts` 与 `geometry.ts` 外，其余引擎文件合计净删行数 > 0

## 3. 非目标

不做：法术并入统一模型、阶段系统重构、结算阶段、GameEvent 变更、`Piece` 字段变更、rng 机制变更。

**16 号「可被友方指定为攻击目标」机制**：评审核实为当前未实现的死代码（`attackTargets` 从不含友方、`doAttack` 拒绝友方、`dealDamage` 的友伤分支结构性不可达）。本次不实现，登记为后续债务；`onDamaged` 钩子忠实迁移现有逻辑。

**UI 层**：零改动（`HandlerCtx`/`SkillInfo` 为纯类型，UI 无人 import，仅 SkillBox.tsx 注释提及）。UI 自带 defId 分支（highlights.ts / BoardArea.tsx / SkillBox.tsx / CellsGrid.tsx / TopBar.tsx / fx.ts）登记为后续债务，本次不动。

## 4. 核心模型

```ts
/* effects.ts —— 全引擎唯一的棋子效果之家 */
export class PieceEffect {            // 具体类（非 abstract），可直接实例化为 DEFAULT
  // ── 静态属性（定义性事实）──
  buffable = true;          // 10 投石机 = false（6 BUFF怪 增益过滤）
  isCatapult = false;       // 10 投石机 = true（标记引爆防御性守卫）

  // ── 查询钩子（纯函数）──
  effRange(st, p): number { return p.range; }                          // 33 刀魂
  effAtk(st, p): number { /* p.atk + atkBuffs 通用加成 */ }           // 33 刀魂
  effActions(st, p): number { return getDef(p.defId).acts; }           // 4/21/23/12
  effMv(st, p): number { return p.mv; }                                // 12
  attackRange(st, p): number { return this.effRange(st, p); }          // 4 蓄满+1 接缝（不外泄）
  moveTargets(st, p): Cell[] { /* p.big→整体平移；否则 bfsEmptyCells(走 this.effMv) */ } // 13
  attackTargets(st, p): Piece[] { /* 通用穿透 BFS，射程走 this.attackRange */ }          // 4/9
  modifyIncomingDamage(st, target, amount, src, opts): { amount: number; frontal: boolean }
    { return { amount, frontal: false }; }                             // 24 厚脸皮
  modifyAttackDamage(st, p, target, dmg): { dmg: number; crit: boolean }
    { return { dmg, crit: false }; }                                   // 1 冲锋怪掷骰

  // ── 触发器钩子（副作用）──
  onDeploy(ctx, s, p): Promise<void> {}                                // 1 冲锋怪
  onTurnStart(ctx, s, p): Promise<void> {}                             // 23 节拍+1
  onMoveCommand(ctx, s, p, x, y): Promise<boolean> { return false; }   // 5 蓄势/平移（true=接管移动）
  onAttackSelected(ctx, s, p, target): Promise<boolean> { return false; } // doAttack 层、校验前；2 治疗
  onAttack(ctx, s, p, target): Promise<boolean> { return false; }      // performAttack 层、ev+死吧后；10 挂标
  onAttackDone(ctx, s, p, target): Promise<void> {}                    // 9 记录 / 4 清充能
  onDamaged(ctx, s, target, amount, src, opts): Promise<void> {}       // 16 转化器
  onKill(ctx, s, killer, victim): Promise<void> {}                     // 26 杀手
  onDeath(ctx, s, victim, killer): Promise<void> {}                    // 2/11/12/20

  // ── 全局查询钩子（引擎遍历全场棋子逐个询问）──
  blocksAllyCell(st, p, x, y, owner): boolean { return false; }        // 23 禁入圈
  guardsAlly(st, blade, ally): boolean { return false; }               // 3 名刀守护

  // ── 主动技能（吸收 SKILLS 表）──
  skillLabel?: string;
  skillUsable?(p): boolean;
  skillTargetSpec?(st, p): ChoiceSpec;
  skillExec?(ctx, s, p, got): Promise<void>;
}

const EFFECTS: Record<number, PieceEffect> = { /* 22 条（DEFS 内 21 个 follower + 33 刀魂） */ };
const DEFAULT = new PieceEffect();
/** 未注册的特殊单位（-1 基地 / -2 墓地 / -3 路障）兜底返回默认实例，杜绝 undefined 崩溃 */
export function getEffect(defId: number): PieceEffect { return EFFECTS[defId] ?? DEFAULT; }
```

**钩子清单及消费者**（每条至少一个真实消费者）：

| 钩子 | 消费者 |
|---|---|
| effRange / effAtk | 33 刀魂 |
| effActions | 4 / 21 / 23 / 12 |
| effMv | 12（消灭重复） |
| attackRange | 4 蓄满 +1（内部接缝，不外泄） |
| moveTargets | 13 直线三格；默认含 big 平移 |
| attackTargets | 4 门槛 / 9 不重复；默认穿透 |
| modifyIncomingDamage | 24 厚脸皮（返回 `{amount, frontal}` 保住事件字段） |
| modifyAttackDamage | 1 冲锋怪掷骰 |
| onDeploy | 1 冲锋怪 |
| onTurnStart | 23 节拍 +1 |
| onMoveCommand | 5 大肉比蓄势/平移 |
| onAttackSelected | 2 奶妈治疗（doAttack 层） |
| onAttack | 10 投石机挂标（performAttack 层，死吧之后） |
| onAttackDone | 9 射手记录 / 4 定炮清充能 |
| onDamaged | 16 转化器（忠实迁移，含不可达友伤分支） |
| onKill | 26 杀手升级 |
| onDeath | 2 / 11 / 12 / 20（吸收 DEATHRATTLES） |
| blocksAllyCell | 23 独行侠禁入圈 |
| guardsAlly | 3 名刀守护 |
| buffable 属性 | 6 增益目标过滤（10 = false） |
| isCatapult 属性 | 投石机标记引爆守卫（10 = true，防御性保留） |
| skill 组 | 4 / 6 / 7 / 14 / 15 / 19 / 21 |

**两个非钩子特例**：

1. **3→33 抽牌形态判定**不是棋子钩子（抽牌时场上还没有棋子）——导出函数 `resolveDrawDefId(state, defId)` 放 effects.ts，game.ts 与 spells.ts 共用，消灭重复。
2. **状态驱动的通用管线步骤不迁移**（金身 `shieldUntil` / 死吧 `reaperFrom` / 回合开始时效清理）。**修正表述**：策反与投石机标记引爆各含一个 defId 守卫——策反的 `src.defId !== -1`（engine.ts:37）改为数据驱动 `getDef(src.defId).type !== 'base'`；标记引爆的 `src.defId !== 10`（engine.ts:60）用 `!getEffect(src.defId).isCatapult` 表达（评审核实该守卫为防御性死代码，保留以保护"SKILLS 按自身 defId 分发"的隐式不变量）。

## 5. 跨棋子效果落位

1. **3 名刀守护** → `guardsAlly` 全局查询。`dealDamage` 致命判定处：遍历 target 友方，`getEffect(q.defId).guardsAlly(st, q, target)`；`guardUsed=1 / hp=1 / ev('guard')` 留管线。3（守护灵，guardsAlly）与 33（刀魂，effRange/effAtk）同棋双形、两条注册。
2. **23 独行侠禁入圈** → `blocksAlly` 助手（遍历询问 `getEffect(q.defId).blocksAllyCell(st, q, x, y, owner)`），调用点**四处**：`bfsEmptyCells`（geometry）、13 号 moveTargets 覆写、基类 moveTargets big 平移分支、`canDeployAt`。
3. **10 投石机标记** → `onAttack`（performAttack 层）覆写挂 `mark10` 并返回 true；标记引爆留 `dealDamage`（读状态无 defId 分支）；`!== 10` 守卫用 `isCatapult` 属性表达；heal 回满引爆保持通用。
4. **16 转化器** → `onDamaged` 覆写，**忠实迁移现有逻辑**（含目前不可达的友伤反弹分支）；`attackableByAlly` 机制剔除，登记后续债务。
5. **22 策反** → 状态驱动不迁移；其 `!== -1` 守卫改 `type !== 'base'`（见 §4 特例 2）。
6. **24 厚脸皮** → `modifyIncomingDamage` 覆写：`opts.hit && isFrontal(src, target)` 时压到 10，返回 `{amount, frontal: true}`。`isFrontal` 移入 geometry。
7. **6 BUFF怪** → `skillTargetSpec` 过滤从 `q.defId !== 10` 改为 `q.buffable !== false`。
8. **2 奶妈** → 一个类同时覆写 `onAttackSelected`（治疗模式）与 `onDeath`（遗言反击），收拢现在横跨 doAttack 硬编码 + DEATHRATTLES 的两处逻辑。

## 6. 引擎改造点

**文件分层（打破循环）**：`data ← state ← geometry ← effects ← {rules, engine, game, spells}`。effects ↔ engine 双向环沿用现状（调用时引用）；rules → effects 单向无回边。

- **geometry.ts（新）**：`mdist / inBoard / pieceCells / nearestDist / bfsEmptyCells / DIRS / isFrontal` 纯几何助手从 rules.ts 迁出，供 effects 与 rules 共用且不产生环。
- **data.ts**：5 号加 `big: true`（2×2 是定义性数据）。
- **state.ts**：`makePiece` 的 `|| defId === 5`（state.ts:92）删除，由 `def.big` 接管（原代码已读 `def.big`，行为逐字节等价）。
- **effects.ts（新）**：基类 + `EFFECTS` + `getEffect` + 转发/全局助手（effRange/effAtk/effActions/effMv/moveTargets/attackTargets/blocksAlly）+ `resolveDrawDefId`；import geometry/state/data/rng/engine。
- **rules.ts**：只留 `baseDeployRows / computeExtraRows / deployRows / canDeployAt / deployCells / healTargets` + 转发层；**re-export geometry 保持 UI import 兼容**；`computeExtraRows` 的 `=== -1`（rules.ts:120）改 `getDef(p.defId).type === 'base'`。
- **engine.ts**：`dealDamage` 顺序（金身→策反→厚脸皮→扣血→标记引爆→名刀→遗言→转化器）保留，厚脸皮改 `modifyIncomingDamage`、名刀改 `guardsAlly` 全局询问、转化器改 `onDamaged`；`performAttack` 的掷骰改 `modifyAttackDamage`、10 号挂标改 `onAttack`（死吧判定之后）、射手/定炮改 `onAttackDone`；`deployPiece` 冲锋询问改 `onDeploy`；`killPiece` 杀手升级改 `onKill`、`=== -1`（engine.ts:140）改 `type === 'base'`；`checkWin` 两处（engine.ts:167-168）改 `type === 'base'`；`flushDeaths` 改查 `getEffect(victim.defId).onDeath`。
- **game.ts**：`doMove` 先问 `onMoveCommand`（true 则结束）；`doAttack` 删 2 号特判、改用 `onAttackSelected`——在 `attackTargets` 校验**之前**调用（不消耗行动点），钩子返回 `true` 后由 `doAttack` 统一 `snap + apLeft--`（保住"奶妈对满血/超距友方拒绝时不消耗 ap"的现有语义）；`drawCards` 与回合开始用 `resolveDrawDefId` / `onTurnStart`；时效清理循环原样保留；`useSkill` 改查技能方法组。
- **abilities.ts**：删除。`SKILLS`/`DEATHRATTLES` 并入 effects.ts；**`HandlerCtx` 与 `SkillInfo` 一并移入 types.ts**（types.ts:4 引用 SkillInfo，UI SkillBox 依赖 `Game.rules.skillInfo` 返回类型）。
- **spells.ts**：仅改两处——129 行改 `resolveDrawDefId` 调用（rnd 消耗顺序逐字节保持）、`HandlerCtx` import 路径；其余逻辑零改动。
- **import 环纪律**：`EFFECTS` 注册表顶层**只做纯构造**（`new XxxEffect()`），绝不顶层触碰 engine/rules 函数；一切交叉引用发生在调用时。

## 7. 红线约束

1. **随机数顺序**：钩子必须挂在与现在 if 链完全相同的位置，钩子内不增删 `rnd()` 调用。顺序漂移会被确定性种子测试抓住。
2. **JSON 快照悔棋**：`Piece` 字段一个不动，效果状态继续平铺；`EFFECTS`/`DEFAULT` 为无状态单例。
3. **import 环纪律**：见第 6 节。新增的 rules → effects 依赖为单向；effects ↔ engine 环保持"调用时引用、顶层纯构造"。

## 8. 测试策略（复用优先）

1. **基线**：`tests/engine.test.ts`（398 行，9 定向场景 + 随机整局 + 悔棋逐字节还原）+ `tests/fx.test.ts` + `e2e/smoke` 全绿。
2. **逐文件重构、每步回归**：依赖序 data.ts → geometry.ts → effects.ts → rules.ts → engine.ts → game.ts → spells.ts（两行）→ 删 abilities.ts。**effects.ts 步骤必须一次性吸收 SKILLS 与 DEATHRATTLES 全部函数体**（避免 flushDeaths 新旧双触发的窗口），删 abilities.ts 只是收尾；每步 `npm test` + `npm run typecheck`。
3. **现有测试预计零改动**（走 `createGame` 公共 API 与 rules 公开函数；已核实无 SKILLS/DEATHRATTLES/engine 内部引用）。若某处直接引用了被删符号，做最小 import 修正。
4. **两个微型守卫测试折叠进现有 engine.test.ts**（非新文件）：
   - ① 注册表完备性——遍历 `DEFS` 断言每个 follower 的 defId 在 `EFFECTS` 有条目，**显式断言 33 刀魂**（33 不在 `DEFS` 内），并断言 `getEffect(-1/-2/-3)` 均返回非空（兜底生效）；
   - ② 引擎源码无 `defId ===/!==` 字面量残留（fs 扫描 src/engine/*.ts，**排除 data.ts**——`getDef` 内的 `=== -1/-2/-3/33` 是合法数据查找；正则覆盖 `===` 与 `!==` 两种运算符）。

## 9. 成功标准

- 全部现有测试 + e2e 绿
- `src/engine/**` 中 `defId ===/!==` 归零（data.ts 豁免）
- `abilities.ts` 删除；除 effects.ts 与 geometry.ts 外，其余引擎文件合计净删行数 > 0
- 12 贴脸惩罚与 3→33 判定各收敛为单点
- 新棋子 = 一个类 + 一行注册；`getEffect` 兜底保证忘注册不崩溃，守卫测试①兜住行为

## 附：迁移清单（defId → 钩子）

| defId | 棋子 | 迁入钩子 |
|---|---|---|
| 1 | 冲锋怪 | modifyAttackDamage + onDeploy |
| 2 | 奶妈 | onAttackSelected（治疗）+ onDeath（遗言） |
| 3 | 名刀（守护灵） | guardsAlly；形态判定 → resolveDrawDefId |
| 4 | 定炮 | effActions + attackRange + attackTargets（门槛覆写）+ onAttackDone + skill |
| 5 | 大肉比 | onMoveCommand；2×2 → data `big: true`；big 平移走基类默认 |
| 6 | BUFF怪 | skill（目标过滤用 buffable） |
| 7 | 钩子 | skill |
| 9 | 射手 | attackTargets（super 后 filter）+ onAttackDone |
| 10 | 投石机 | onAttack（挂标）+ buffable=false + isCatapult=true |
| 11 | 白嫖怪 | onDeath |
| 12 | 跑得快 | effActions + effMv + onDeath |
| 13 | 直行侠 | moveTargets |
| 14 | 献祭炮 | skill |
| 15 | 蓄力怪 | skill |
| 16 | 转化器 | onDamaged（忠实迁移，含不可达友伤分支） |
| 19 | 路障小法师 | skill |
| 20 | 超级跑得快 | onDeath |
| 21 | 神行千里 | effActions + skill |
| 23 | 独行侠 | effActions + onTurnStart + blocksAllyCell |
| 24 | 厚脸皮 | modifyIncomingDamage |
| 26 | 杀手 | onKill |
| 33 | 刀魂 | effRange + effAtk |
| -1 | 基地 | 无专属注册，走 DEFAULT；四处 `=== -1` 分支改 `type === 'base'` 数据驱动（computeExtraRows / 策反守卫 / killPiece / checkWin×2） |
| -2/-3 | 墓地/路障 | 无专属注册，走 DEFAULT（无行动、无钩子消费者） |
| 8/17/18/22/25 | 法术 | 不动（CAST 表） |
