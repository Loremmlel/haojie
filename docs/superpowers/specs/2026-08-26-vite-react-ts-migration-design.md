# 「浩劫」迁移设计：Vite + React + TypeScript 单包重构

- **日期**：2026-08-26（v3，同日修订）
- **状态**：设计已与用户逐节确认；v2 依据独立架构评审修订，v3 依据第二轮复核收尾（见附录 A）
- **前置状态**：v1.0 静态版（commit `00bb878`），31 项冒烟测试全绿，仓库 `github.com/Loremmlel/haojie`（main）
- **后续流程**：本规格经用户审阅后，由 superpowers:writing-plans 产出实施计划

---

## 1. 背景与目标

现状为零依赖拼接构建：`build.js` 将 13 个 JS 文件按序拼接内联进 `template.html`，产出单文件 `dist/haojie.html`（135 KB）。逻辑层（rng→game 八文件）零 DOM、可在 Node 直接驱动整局；表现层（ui/input/codex/main）为手写 DOM 同步。

**目标**：迁移为正规前端工程形态——Vite + React 19 + TypeScript strict，同时保持「编译为单个 HTML 文件」的交付能力不变。

## 2. 范围与非目标

### 2.1 范围内

- 表现层整体重写为 React 组件树（一次性重写，非渐进替换）
- engine 八文件 ESM 化 + 深度类型建模（含消灭隐藏全局耦合，见 §5.3）
- 构建链从 build.js 换为 Vite，产物为单文件 `dist/index.html`
- 测试加载方式从字符串拼接 + `new Function` 改为 ES module `import`
- e2e 脚本**新建**入库（v1.0 的 e2e 为一次性临时产物，未纳入 git，见 §10）

### 2.2 明确不做（非目标）

- **联机对战 / WS 服务本期不做，协议层也不设计**。架构按「未来接入既有 Next.js 项目、独立游戏房间」预留了已知最难的两个接缝（引擎零 DOM 可服务端运行、异步目标选择器注入），但命令/事件协议 schema、房间与鉴权、断线重连语义均留待联机立项时另行设计（见 §5.2）
- 不引入 Next、vinext 或任何 web 框架
- **等价重构总则**：玩法规则、数值、交互行为全部冻结；视觉外观冻结，仅允许 §6.4 逐条记录的毫秒级可见时序差异
- 不引入 eslint、tailwind、jsdom、vitest
- **部署流水线不在本规格范围**：产物形态已满足 GitHub Pages 要求（无外链的单文件 index.html），发布方式（Actions 工作流 / 手动上传 / 暂不发布）另行决定
- **目标环境边界**：桌面浏览器 + 鼠标交互为一等公民（快捷键 E/U/Esc、右键取消为增强项）；移动端/触屏专项适配非本期目标（与 v1.0 现状一致，响应式 CSS 断点原样保留）

## 3. 技术栈与版本基线

版本对齐 `D:\personal\zhilin-writing\package.json`（npm registry 已逐一验证存在，2026-08-26）：

| 依赖 | 版本 |
|---|---|
| react / react-dom | 19.2.6 |
| @types/react / @types/react-dom | 19.2.14 / 19.2.3 |
| vite | 8.0.13（pin；peer range `^8.0.0`，后续可无痛升 8.x） |
| @vitejs/plugin-react | 6.0.2（peer `vite: ^8.0.0`，其余 peer 均 optional） |
| vite-plugin-singlefile | ^2.3.3（peer 含 `vite: ^8.0.0`，兼容性已核实，风险解除） |
| typescript | 5.9.3，strict 全开 + `erasableSyntaxOnly` |
| engines.node | >=22.13.0 |

工程约定：

- `"type": "module"`
- TS 遵守 **erasable-syntax-only**（TS 5.8+ 编译选项，node 直跑 TS 的语法要求）：禁用 enum / namespace / 构造函数参数属性，以 `as const` 对象与联合类型替代。现有引擎为普通 script JS，天然满足。
- 测试命令保留显式 `--experimental-strip-types` flag：该 flag 自 node v22.6.0 存在、v22.18.0 起默认开启——保留是为与 engines 下限 22.13 及 zhilin-writing 脚本保持一致，属有意冗余。

## 4. 目录结构与分层铁律

单包 + 清晰分层（已确认，不引入 workspace；将来联机时 `src/engine/` 可机械平移为独立 package）：

```
haojie/
├─ index.html               # Vite 入口模板（取代 template.html）
├─ vite.config.ts
├─ tsconfig.json
├─ package.json             # type: module
├─ scripts/
│  └─ verify-singlefile.mjs # 校验 dist/index.html 无外链引用
├─ src/
│  ├─ engine/               # 纯逻辑层（零 DOM / 零 React / 零模块级可变全局）
│  │  ├─ rng.ts             # mulberry32 种子随机
│  │  ├─ data.ts            # DEFS 26 棋子档案 + 特殊 id 分发（getDef 具名导出）
│  │  ├─ state.ts           # Piece/GameState 类型 + 快照悔棋
│  │  ├─ rules.ts           # 移动/攻击/治疗/部署目标计算、穿透 BFS
│  │  ├─ engine.ts          # dealDamage 管线 / killPiece / 死亡遗言
│  │  ├─ abilities.ts       # SKILLS / DEATHRATTLES 注册表（handler 带 ctx 首参）
│  │  ├─ spells.ts          # SPELL_TARGETS / CAST 注册表（handler 带 ctx 首参）
│  │  └─ game.ts            # createGame 会话工厂（API 门面 + 组装 ctx）
│  ├─ ui/
│  │  ├─ components/        # React 组件（各配 *.module.css）
│  │  ├─ hooks/             # useGame / useInteraction / useBoardMetrics
│  │  └─ fx/
│  │     ├─ fx.ts           # 命令式动画内核（自旧 fx.js 平移，依赖注入化）
│  │     └─ registry.ts     # 棋子 DOM ref 注册表
│  ├─ styles/
│  │  └─ global.css         # :root token + FX keyframes + 棋盘网格
│  ├─ App.tsx
│  └─ main.tsx
└─ tests/
   ├─ engine.test.ts        # 31 断言平移 + 随机整局模拟
   └─ e2e/                  # Edge headless 链路脚本（新建入库）
```

分层铁律：

1. `src/engine/**` 零 DOM、零 React、零 `window/document` 引用，Node 可直接 import；
2. `src/ui/**` 对引擎的一切**写操作**必须经 Game 实例公开方法；**只读计算**经 `game.rules` 命名空间或 engine 纯函数具名导入（如 `getDef`），不得直改 state；
3. `fx.ts` 是命令式特区：不 import React，通过初始化时注入的宿主元素、registry 与 game 只读访问器工作（见 §7.2）。

## 5. 引擎形态：会话工厂 + 选择器依赖注入

### 5.1 createGame 工厂

```ts
export function createGame(seed: number, deps?: GameDeps): Game;

interface GameDeps {
  /** 异步目标选择器（浏览器注入 UI ask；测试注入自动选择器） */
  choose?: Chooser;
}
```

- 取消模块级 `let S = null` 全局单例：state、EV 事件队列、undo 快照栈、**pendingDeaths 死亡遗言队列**全部收进 `createGame` 闭包。迁入时顺带修复 v1.0 隐患：`newGame` 不清空 `pendingDeaths` 可能造成的跨局残留。
- Game 实例暴露 API 门面（state / canUndo / undo / deployFollower / discardUnplaceable / storeHandSpell / castHandSpell / castStored / doMove / doAttack / useSkill / endTurn / rules 只读命名空间）；原 `API.init()` 并入构造，原 `API.env.choose` 改由 `deps.choose` 注入。
- 其余机制语义逐字保留：JSON 快照悔棋、mulberry32 种子随机原地推进、EV 事件队列、回合时效字段体系，以及 dealDamage 完整管线——**顺序以代码为准**：金身免疫 → 策反倒戈（伤害落空）→ 厚脸皮正面减免 → 扣血 → 投石机标记引爆 → 名刀守护（致命转 1 血）→ 死亡遗言队列 → 16 号转化器反弹。
- 收益即时兑现：smoke 测试多局并存，删除现有 `reset()` hack；重开一局不再依赖 `location.reload()`。
- ESM 化后删除 `game.js` 尾部的 `__HAOJIE_EXPORT__` 测试导出钩子（测试改为直接 `import { createGame }`）；浏览器调试钩子收敛为 `window.__HJ_DEBUG__ = { game }`（原 `{ api, ui, uist }` 三元组随旧层一并退役）。

### 5.2 选择器注入的传递通道（评审 M3 的裁定）

`ENV.choose` 在 v1.0 有 9 个调用点，归属分两类：**7 处**位于 SKILLS / DEATHRATTLES / CAST 注册表 handler 内或经 `summonOnce`（CAST[25] 的辅助函数）间接调用（钩拉落点、献祭选祭品与选列、神行落点与补刀、奶妈遗言反击、重铸双召等），handler 现有签名 `(state, p, got)` 无法触达 createGame 闭包中的 chooser；**另 2 处**（冲锋询问在 `deployPiece` 流程内、技能询问在 API 动作函数 `useSkill` 内）本就在闭包流程中，迁移后天然直连 `deps.choose`，无需 ctx。裁定：

- **ctx 首参方案**：全部注册表 handler 统一改为 `(ctx, state, …)` 签名，`ctx = { choose }` 由 createGame 组装后传入每次调用。约 20 个 handler 的机械改造，换来类型显式、注册表保持模块级纯函数、测试可注入假 ctx；中间辅助层（`flushDeaths` 向 DEATHRATTLES handler 透传、`summonOnce` 向其内部 choose 调用透传）同样显式携带 ctx。
- **明文禁止**：chooser、回调等任何函数值进入 GameState——快照 `JSON.stringify(state)` 会静默丢弃函数字段，导致 undo 后 chooser 凭空消失且逐字节校验照样通过的延后爆发故障（类型层面的保障见 §5.4）。
- **联机视角的诚实评估**：此注入点解决了「远端玩家的目标选择如何进入引擎」这一最难接缝之一；但命令协议、choose 网络往返的超时/取消语义、房间鉴权等属联机立项范围，本期不设计（§2.2）。

### 5.3 消灭隐藏全局耦合（评审 M3 附带发现）

以下五处在 v1.0 中偷读模块级全局 `S`，并非真纯函数，TS 化时一律改为显式收 state 参数：

- `rules.ts`：`bladeN`、`inLonerZone`、`effActions`、`effMv`
- `state.ts`：`effAtk`

### 5.4 类型建模深度

深度建模（已确认）：`GameState` / `Piece` 完整接口化；EV 事件流改判别联合（`{type:'damage';…} | {type:'death';…} | …`）；SKILLS / DEATHRATTLES / SPELL_TARGETS 注册表以类型约束键值对应。统一命名为 **`ChoiceSpec<T>`** 的泛型同时显式化三件事：`cancelable` 为 true 时返回类型含 `null`，不可取消的选择器返回非空（消除 v1.0 中 `summonOnce` 取 `spot.x` 前无空值保障一类隐患）；类型层面排除函数成员——与 §5.2「禁止函数入 GameState」形成静态保障。目的：26 技能系统是全项目最易改崩处，让编译器承担回归防线。

## 6. React 桥接：可变引擎 × 声明式渲染

engine 保持 mutation 风格不做 immutable 化。桥接层为极小外部 store：

```
用户点击 → act(fn) 加锁（busy=true）
         → fn 执行 game.doMove(...)        ← 变异 state + 写 EV
         → await playEvChain()              ← 按 EV 逐事件播放（见 §6.2 提交点规则）
         → bump version                     ← useSyncExternalStore 触发组件树按终态重渲染
         → finally 解锁
```

### 6.1 身份比较铁律（评审 M4）

原地变异使对象引用相等性失真（常规操作改字段不改引用），undo 又经 `JSON.parse` 整树换新引用——两种路径行为不一致，任何基于 piece/state 对象身份的 memoization 都不可靠。铁律：

1. 组件读取游戏状态一律经 `useGame()`（getSnapshot 返回 version 号，version 变即重渲染）；
2. **禁止**以 piece / state 对象作为 `React.memo` 的 props 比较依据或 `useMemo` / effect deps 的身份依据；需要子组件性能优化时以 uid、原始值字段为 deps；
3. choice 的 `{ spec, resolve }` 存于 ref 而非依赖 state 稳定性；
4. tearing 评估：busy 单飞锁保证同一时刻只有一条变异链，引擎变异仅发生在锁内的 fn() 阶段（choose 只在 fn 阶段暂停引擎）；播放期与 §6.2 同步点的任何 bump 均处于引擎静默窗口，观察到的都是一致状态，无需额外并发约束（此论断写入规格供实施时复核）。

### 6.2 播放期内受控提交策略（评审 M1 的裁定）

v1.0 的 FX 在动画链中段存在 5 类命令式刷新（death 删节点、deploy 物化节点、turn 刷面板、charm 翻阵营色、attack 刷行动点），「全程冻结渲染」会造成死棋子挺过整条事件链等可见回归。裁定如下：

- **默认链尾单次提交**：一条操作产生的整条 EV 链播完后 bump 一次，数值/样式级中途刷新（行动点、血条数字、阵营色）不再逐事件执行，其延迟到链尾的差异逐条记录为**有意变更**（§6.4）；
- **deploy 结构同步点**：EV 的 `deploy` 类事件声明 `syncAfter` 标记，播放到此类事件后插入一次受控 bump 并等待一帧——保证链式场景（如「跑得快阵亡 → 墓地生成」）中后继事件依赖的新节点及时物化。实现为 act 循环内的安全提交点（busy 锁仍在，无并发），不用 flushSync；提交完成判定须确保 registry 已物化新节点（双 rAF 或等效调度手法，细节归实施计划）；
- **死亡节点的删除权归 React**：fx 的 death 分支不再 `el.remove()`、不再手动 syncPieces——只播 dying 动画（480ms）；动画结束时节点仍在，链尾 bump 后 React 按终态卸载该 uid，视觉无跳变且不与 reconciliation 冲突；
- **move 位移权威归属**：动画期内由 fx 经 registry 直写 left/top（CSS transition 立即生效）；React 渲染时以同一 posOf 公式输出终态 style，两者数值恒等故无跳变；禁止把位移留给 bump 后的 React 提交（否则 340ms 的等待白费、transition 延迟起播）。

### 6.3 交互状态机迁移

- mode / cardIdx / selUid / inspectUid / choice 与 busy 锁整体迁入 `useInteraction` hook，成为普通 React state / ref；
- 「choice 存在时点击处理优先放行」的死锁防御经验平移：choice 分支先于 busy 检查；
- PiecesLayer 以 `key={uid}` 渲染存活棋子列表，跨渲染 DOM 节点稳定，CSS transition 位移动画不被打断。

### 6.4 有意变更记录（等价重构的豁免清单）

| 现状行为 | 迁移后行为 | 差异 |
|---|---|---|
| attack 命中瞬间行动点角标即减 | 行动点在事件链尾统一刷新 | 通常数百 ms，长击杀链下可达 ~2s |
| turn 横幅弹出瞬间右侧面板整体刷新 | 面板随链尾 bump 刷新 | 数百 ms 量级 |
| charm 倒戈瞬间阵营配色翻转 | 配色随链尾 bump 翻转 | 数百 ms 量级（倒戈特效本身不受影响） |
| death 后节点由 FX 立即移除 | dying 动画播完后由 React 卸载 | 无可见差异（时序所有权变更） |
| death 后 FX 附带的全场棋子徽标/状态类即时刷新 | 随链尾 bump 统一刷新 | 数百 ms 徽标类延迟（同链尾规则兜底） |

除上述各条外，一切玩家可感知行为不得变化；实施中发现新的差异点须补录本表并经确认。

### 6.5 调试钩子

始终暴露 `window.__HJ_DEBUG__ = { game }`（e2e 与人工排障依赖，后续可按需增补字段，不影响游玩）。

## 7. FX 层改造

### 7.1 内核平移原则

`playNew` 按 EV 游标逐事件播放的核心编排（move lunge/projectile、飘伤害数字、shake、ringGrow、boom、banner、win 等）**逐字平移**；§6.2 的四条结构性改动除外（death 删节点、deploy 同步点等）。

### 7.2 完整挂点清单（评审 M2 的裁定，取代「仅换两处挂点」的表述）

| v1.0 依赖（fx.js 引用点） | v2 归属 |
|---|---|
| `UI.pieceEl(uid)` ×6 | `registry.get(uid)` |
| `UI.movePieceTo` ×2 | registry 取节点后直写 left/top（逻辑平移） |
| `UI.syncPieces` ×2 | **删除**：deploy 走同步点、death 删除权归 React（§6.2） |
| `UI.syncStatFlash` ×1 | **删除**：链尾 bump 统一刷新 |
| `UI.refreshAll` / `refreshTop()` | **删除**：链尾 bump 统一刷新；banner 由 FX 自治绘制 |
| `showWinMask`（main.js） | **唯一属主**：initFx 注入 `onWin(winner)` 回调——FX 播放 win 横幅后调用之，React 层据此挂 WinMask；引擎侧无第二通道，防双挂载/丢失 |
| `API.state()` ×3 | createGame 实例的只读快照访问器，经 initFx 注入 |
| `#board-outer` / `#fxlayer` / `#banner` 三个 DOM 宿主 | FxLayer 组件渲染的宿主元素，initFx 时注入引用 |
| `document.body` 抖屏类 | 原样保留（body 级 class 无冲突） |
| 全局 `EV` / `W` / `H` / `PNAME` / `getDef` / `nearestDist` | engine/data 具名导入；EV 经 game 实例读取 |

`initFx(ctx)` 依赖注入：`{ hostEls, registry, getGame, onWin }`——fx.ts 保持零 React import。

## 8. 组件清单与样式体系

```
App
├─ TopBar            血条×2 · 回合数 · 行动方高亮
├─ BoardArea
│  ├─ CellsGrid      117 格 + 高亮类（dep/mv/atk/sk/heal/sel）
│  ├─ PiecesLayer    key={uid} 存活棋子层，ref 注册给 registry
│  └─ FxLayer        特效容器（命令式领地，挂载时向 initFx 注入宿主引用）
├─ SidePanel
│  ├─ PhaseHint      阶段提示 / choice 引导语
│  ├─ Hand           手牌卡（释放·储存·弃置按钮，selected/awaiting 态）
│  ├─ Stored         储存栏（剩余回合徽标）
│  ├─ InspectPanel   棋子详情（五维 + 状态行）
│  ├─ SkillBox       蓄势 / 技能按钮
│  ├─ ActionBar      结束回合·悔棋·图鉴·规则·重开（快捷键 E/U/Esc、右键取消在此绑定）
│  └─ LogPanel       战斗日志
├─ CodexModal        图鉴 + 规则书 双 tab
├─ WinMask           胜利遮罩（复盘战场 / 再来一局；由 onWin 驱动显示）
└─ ToastHost         轻提示队列（模块级 toast 总线驱动）
```

样式体系（已确认）：`global.css` 仅含三样——`:root` 设计 token（--cell 尺寸、配色变量）、FX 动画 keyframes 及其类名、棋盘网格基础布局；其余组件样式拆入同名 `*.module.css`，类名构建期哈希作用域（Vite 默认零配置，官方特性已核实）。目的：未来嵌入任意 Next 项目零样式互染。

## 9. 构建链与单文件产物

scripts（package.json）：

```jsonc
{
  "dev": "vite",
  "build": "vite build && node scripts/verify-singlefile.mjs",
  "test": "node --experimental-strip-types --test tests/*.test.ts",
  "typecheck": "tsc --noEmit"
}
```

单文件产物：

- **主案**：`vite-plugin-singlefile@^2.3.3`（对 Vite 8 的 peer 兼容已核实，README 明确产物可 file:// 双击直开）；
- **保险丝**：若实施中遭遇上游回归，退路为自写 ~20 行 closeBundle 内联插件（设计已在案，预期不动用）;
- `verify-singlefile.mjs` 校验 `dist/index.html` 中不存在任何外链 script/link/资源引用，失败即构建失败——杜绝「看似构建成功实则外链断裂」的产物。

退役物：`build.js`、`src/template.html`、旧 `src/js/*.js` 全部十三文件、`__HAOJIE_EXPORT__` 钩子。产物定为 **`dist/index.html`**——GitHub Pages 开箱即用（发布方式另议，§2.2）。e2e 直接对 `dist/index.html` 运行。

## 10. 测试策略

- `tests/engine.test.ts`：31 项断言**全量平移**——穿透封锁、厚脸皮正背面、名刀守护一次性、投石机三触发场景、策反倒戈、大肉比跨回合蓄势、直行侠直线、杀手五杀升级序列、死吧×金身交互……+ 随机整局模拟（含操作后悔棋的逐字节快照对比）。加载方式改为 `import { createGame }` + 自动选择器注入（option 取首项 / cell 取首个合法格 / piece 按 cancelable 决定取消或取首个）；多局并存删除 `reset()` hack。
- e2e **新建入库**（v1.0 的 e2e 为一次性临时产物未入 git）：Edge headless 打开 `dist/index.html`，经 `__HJ_DEBUG__` 辅助驱动真实 DOM 点击，验证「部署落子 → 选中己方 → 攻击掉血」链路，结果落 DOM 后提取断言。
- UI 组件不上 jsdom 单测：零测试依赖哲学不变，UI 正确性由 e2e 把关。

## 11. 错误处理

- act 包装器捕获引擎异常 → toast 展示并复位交互态（沿用现有模式）；
- 防御性判断保留：基地缺失时血条不动、checkWin 早退等；
- verify-singlefile 失败即 fail build。

## 12. 施工顺序（每步一 commit）

1. **脚手架**：Vite + tsconfig + package.json 改造，index.html 入口，旧源码原位共存。注：npm scripts 切至 Vite 系后，过渡期（步骤 1–5）旧链路仍可通过 `node build.js` / `node test/smoke.js` 直跑验证，旧文件统一到步骤 6 才删除；
2. **引擎类型化**：engine 八文件 ESM + 完整类型建模 + ctx 化注册表 + 五处偷读函数改签名 → tests/engine.test.ts 全绿；
3. **React 骨架**：桥接层（gameStore/useGame/useInteraction/initFx/registry）+ 棋盘静态渲染；
4. **交互迁移**：部署/移动/攻击/治疗/技能/法术/目标选择器全部接通；
5. **特效与外围**：FX 平移（含 §6.2 四条结构改动）+ SidePanel 全家/CodexModal/WinMask/ToastHost；
6. **收尾**：删旧渲染层与 build.js、README 重写、e2e 入库跑通、随机整局回归。

## 13. 已确认决策记录

| 决策点 | 结论 | 备注 |
|---|---|---|
| 工程组织 | 单包 + 清晰分层 | 不引入 workspace，将来机械拆包 |
| 样式体系 | global token/FX + CSS Modules | 防未来嵌 Next 样式互染 |
| 测试跑法 | node:test + --experimental-strip-types | 对齐 zhilin-writing，零新增依赖 |
| 迁移节奏 | 一次性重写表现层 | 31 测试 + e2e 护航 |
| TS 深度 | 深度类型建模 | EV 判别联合、注册表类型约束 |
| 版本基线 | 对齐 zhilin-writing | react 19.2.6 / vite 8.0.13 / ts 5.9.3 |
| chooser 通道 | 注册表 handler 增加 ctx 首参 | 禁止函数入 GameState |
| 播放期提交 | 链尾单次提交 + deploy 同步点 | 差异豁免见 §6.4 |
| 联机 | 本期不做，仅预留两个最难接缝 | 协议/房间/重连属联机立项范围 |

---

## 附录 A · 独立评审修订记录（v1 → v2）

评审结论：批准但需小修（2026-08-26，独立子代理执行，事实核对与 npm 外部核查均通过）。处置情况：

| 编号 | 问题 | 处置 |
|---|---|---|
| M1 | 「动画期间不渲染」与 5 类中途刷新冲突 | §6.2 受控提交策略 + §6.4 豁免清单 |
| M2 | FX「仅换两处挂点」低估耦合面 | §7.2 完整挂点归属清单（逐项给归属） |
| M3 | chooser 触达不到注册表；函数入 state 陷阱；五处偷读全局 | §5.2 ctx 方案 + §5.3 改签名清单 |
| M4 | memo 身份比较陷阱未识别 | §6.1 四条铁律 |
| m1 | e2e 实为新建而非保留 | §2.1 / §10 更正 |
| m2 | 伤害管线顺序写错（策反先于厚脸皮） | §5.1 以代码为准更正 |
| m3 | `__HAOJIE_EXPORT__` 去留未交代 | §5.1 明确删除 |
| m4 | 部署方式、浏览器/移动端边界缺失 | §2.2 补充 |
| m5 | 联机预留表述夸大 | §2.2 / §5.2 / §13 降格 |
| m6 | 施工第 1 步打断旧 scripts | §12 过渡期说明 |
| n1–n5 | vite pin 可升 / strip-types flag 冗余 / pendingDeaths 残留 / ChoiceSpec 非空契约 / 外部指代 | §3 注明、§5.1 修复、§5.4 显式化、§9 改写 |

**第二轮复核（v3）**：结论「批准但需小修」——15 条旧账全部实质处置；新增 6 条文面精度问题全部就地修复：

| 编号 | 问题 | 处置 |
|---|---|---|
| N1 | §5.2 调用点归属误述（冲锋询问/useSkill 实为闭包流程直连）、漏 flushDeaths/summonOnce 透传链 | §5.2 更正为「7 处注册表（含间接）+ 2 处闭包直连」并补中间层透传 |
| N2 | win 事件 onEvent/onWin 双通道歧义 | 删除 GameDeps.onEvent，onWin 为唯一属主 |
| N3 | §6.1「链完全结束后才 bump」与 §6.2 同步点矛盾 | 改为「引擎静默窗口」论证 |
| N4 | 附录计数失准 | 去除数字 |
| N5 | ChooserSpec/ChoiceSpec 名称不一致 | 统一 `ChoiceSpec<T>` 并入 §5.4 |
| N6 | 豁免量级乐观、第五类未单列 | §6.4 更正量级并补行 |

复核性提示移交实施计划：deploy 同步点的提交完成判定须确保 registry 已物化新节点（双 rAF 或等效手法）。
