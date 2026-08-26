# 「浩劫」迁移设计：Vite + React + TypeScript 单包重构

- **日期**：2026-08-26
- **状态**：设计已与用户逐节确认
- **前置状态**：v1.0 静态版（commit `00bb878`），31 项冒烟测试全绿，仓库 `github.com/Loremmlel/haojie`（main）
- **后续流程**：本规格经用户审阅后，由 superpowers:writing-plans 产出实施计划

---

## 1. 背景与目标

现状为零依赖拼接构建：`build.js` 将 13 个 JS 文件按序拼接内联进 `template.html`，产出单文件 `dist/haojie.html`（135 KB）。逻辑层（rng→game 八文件）零 DOM、可在 Node 直接驱动整局；表现层（ui/input/codex/main）为手写 DOM 同步。

**目标**：迁移为正规前端工程形态——Vite + React 19 + TypeScript strict，同时保持「编译为单个 HTML 文件」的交付能力不变。

## 2. 范围与非目标

### 2.1 范围内

- 表现层整体重写为 React 组件树（一次性重写，非渐进替换）
- engine 八文件 ESM 化 + 深度类型建模
- 构建链从 build.js 换为 Vite，产物为单文件 `dist/index.html`
- 测试加载方式从字符串拼接 + `new Function` 改为 ES module `import`

### 2.2 明确不做（非目标）

- **联机对战 / WS 服务本期不做**，但架构按「未来接入既有 Next.js 项目、独立游戏房间、WS 联机」预留接口（见 §5、§6）
- 不引入 Next、vinext 或任何 web 框架
- **等价重构总则**：玩法规则、数值、交互行为、视觉外观全部冻结，本迁移不改变任何玩家可感知行为
- 不引入 eslint、tailwind、jsdom、vitest

## 3. 技术栈与版本基线

版本对齐 `D:\personal\zhilin-writing\package.json`：

| 依赖 | 版本 |
|---|---|
| react / react-dom | 19.2.6 |
| @types/react / @types/react-dom | 19.2.14 / 19.2.3 |
| vite | 8.0.13 |
| @vitejs/plugin-react | 6.0.2 |
| typescript | 5.9.3，strict 全开 |
| engines.node | >=22.13.0 |

工程约定：

- `"type": "module"`
- TS 遵守 **erasable-syntax-only**（node 直跑 TS 的要求）：禁用 enum / namespace / 构造函数参数属性，以 `as const` 对象与联合类型替代。现有引擎代码已满足该约束。
- 已知风险：`vite-plugin-singlefile` 对 Vite 8 的兼容性未验证 → 采用 §9 的主案 + 兜底双轨策略。

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
│  ├─ engine/               # 纯逻辑层（零 DOM / 零 React）
│  │  ├─ rng.ts             # mulberry32 种子随机
│  │  ├─ data.ts            # DEFS 26 棋子档案 + 特殊 id 分发
│  │  ├─ state.ts           # Piece/GameState 类型 + 快照悔棋
│  │  ├─ rules.ts           # 移动/攻击/治疗/部署目标计算、穿透 BFS
│  │  ├─ engine.ts          # dealDamage 管线 / killPiece / 死亡遗言
│  │  ├─ abilities.ts       # SKILLS / DEATHRATTLES 注册表
│  │  ├─ spells.ts          # SPELL_TARGETS / CAST 注册表
│  │  └─ game.ts            # createGame 会话工厂（API 门面）
│  ├─ ui/
│  │  ├─ components/        # React 组件（各配 *.module.css）
│  │  ├─ hooks/             # useGame / useInteraction / useBoardMetrics
│  │  └─ fx/
│  │     ├─ fx.ts           # 命令式动画内核（自旧 fx.js 平移）
│  │     └─ registry.ts     # 棋子 DOM ref 注册表
│  ├─ styles/
│  │  └─ global.css         # :root token + FX keyframes + 棋盘网格
│  ├─ App.tsx
│  └─ main.tsx
└─ tests/
   ├─ engine.test.ts        # 31 断言平移 + 随机整局模拟
   └─ e2e/                  # Edge headless 链路脚本
```

分层铁律：

1. `src/engine/**` 零 DOM、零 React、零 `window/document` 引用，Node 可直接 import；
2. `src/ui/**` 对引擎的一切**写操作**必须经 Game 实例公开方法；**只读计算**经 `game.rules` 命名空间或 engine 纯函数具名导入（如 `getDef`），不得直改 state；
3. `fx.ts` 是命令式特区，仅消费 EV 事件流与 registry 提供的 DOM ref。

## 5. 引擎形态：会话工厂 + 选择器依赖注入

### 5.1 createGame 工厂

```ts
type Chooser = <T>(spec: ChoiceSpec<T>) => Promise<T>;

export function createGame(seed: number, deps?: { choose?: Chooser }): Game;
```

- 取消模块级 `let S = null` 全局单例：state、EV 事件队列、undo 快照栈全部收进 `createGame` 闭包。
- Game 实例暴露现有 API 门面（state / canUndo / undo / deployFollower / discardUnplaceable / storeHandSpell / castHandSpell / castStored / doMove / doAttack / useSkill / endTurn / rules 只读命名空间）；原 `API.init()` 并入构造，原 `API.env.choose` 改由 `deps.choose` 注入。
- 纯函数（getDef / spellTargets 等）改为 data.ts / spells.ts 的具名导出，不再挂实例。
- 其余机制语义逐字保留：JSON 快照悔棋、mulberry32 种子随机原地推进、EV 事件队列、dealDamage 完整管线（金身→厚脸皮→策反→扣血→投石机标记→名刀→死亡遗言→转化器反弹）、回合时效字段体系。
- 收益即时兑现：smoke 测试可多局并存，删除现有 `reset()` hack；重开一局不再依赖 `location.reload()`。

### 5.2 选择器注入 = 联机接口预留

逻辑层需要玩家选目标时 `await deps.choose(spec)`：

- 浏览器：注入 UI 的 ask()（高亮 + 等待点击，见 §6）；
- Node 测试：注入自动选择器（option 取首项 / cell 取首个合法格 / piece 按 cancelable 决定取消或取首个）——即现 smoke.js 的策略平移；
- 未来服务端联机：同一签名可注入 AI 或网络远端玩家。**本期只做浏览器与测试两个实现。**

### 5.3 类型建模深度

深度建模（已确认）：`GameState` / `Piece` 完整接口化；EV 事件流改判别联合（`{type:'damage';…} | {type:'death';…} | …`）；SKILLS / DEATHRATTLES / SPELL_TARGETS 注册表以类型约束键值对应。目的：26 技能系统是全项目最易改崩处，让编译器承担回归防线。

## 6. React 桥接：可变引擎 × 声明式渲染

engine 保持 mutation 风格不做 immutable 化。桥接层为极小外部 store：

```
用户点击 → act(fn) 加锁（busy=true）
         → fn 执行 game.doMove(...)   ← 变异 state + 写 EV
         → await FX.playNew()          ← 按 EV 游标播动画；此期间 version 不动，React 不渲染
         → bump version                ← useSyncExternalStore 触发组件树按新 state 重渲染
         → finally 解锁
```

要点：

- **动画期间 React 不插手**是防闪烁关键。「先动画、后提交」时序自旧 act() 平移，全量刷新动作由手写 diff 变为 React 提交。
- 交互状态机（mode / cardIdx / selUid / inspectUid / choice 与 busy 锁）整体迁入 `useInteraction` hook，成为普通 React state。
- 「choice 存在时点击处理优先放行」的死锁防御经验平移：choice 分支先于 busy 检查。
- PiecesLayer 以 `key={uid}` 渲染列表，跨渲染 DOM 节点稳定，CSS transition 位移动画不被打断。
- 调试钩子保留：始终暴露 `window.__HJ_DEBUG__ = { game }`（e2e 与人工排障依赖，后续可按需增补字段，不影响游玩）。

## 7. FX 层改造

命令式内核（FX.playNew 消费 EV 游标逐事件播放：移动 lunge/projectile、飘伤害数字、shake、ringGrow、boom、banner 等）**原样平移**，仅换两处挂点：

1. 棋子 DOM 查找由私有 pieceMap 改为 `registry.ts`：PiecesLayer 以 ref 回调在 mount 时登记 uid→HTMLElement、unmount 时注销；
2. 几何测量（格 size/gap/pad）收进 `useBoardMetrics`，resize 时重测并触发重排；FX 与棋子定位共用同一份 metrics。

## 8. 组件清单与样式体系

```
App
├─ TopBar            血条×2 · 回合数 · 行动方高亮
├─ BoardArea
│  ├─ CellsGrid      117 格 + 高亮类（dep/mv/atk/sk/heal/sel）
│  ├─ PiecesLayer    key={uid} 棋子层，ref 注册给 registry
│  └─ FxLayer        特效容器（命令式领地）
├─ SidePanel
│  ├─ PhaseHint      阶段提示 / choice 引导语
│  ├─ Hand           手牌卡（释放·储存·弃置按钮，selected/awaiting 态）
│  ├─ Stored         储存栏（剩余回合徽标）
│  ├─ InspectPanel   棋子详情（五维 + 状态行）
│  ├─ SkillBox       蓄势 / 技能按钮
│  ├─ ActionBar      结束回合·悔棋·图鉴·规则·重开（快捷键 E/U/Esc、右键取消在此绑定）
│  └─ LogPanel       战斗日志
├─ CodexModal        图鉴 + 规则书 双 tab
├─ WinMask           胜利遮罩（复盘战场 / 再来一局）
└─ ToastHost         轻提示队列（模块级 toast 总线驱动）
```

样式体系（已确认）：`global.css` 仅含三样——`:root` 设计 token（--cell 尺寸、配色变量）、FX 动画 keyframes 及其类名、棋盘网格基础布局；其余组件样式拆入同名 `*.module.css`，类名构建期哈希作用域。目的：未来嵌入任意 Next 项目零样式互染。

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

单文件产物双轨策略：

- **主案**：若 `vite-plugin-singlefile` 兼容 Vite 8 则直接采用；
- **兜底**：自写 ~20 行 closeBundle 内联插件，读取构建产物 js/css 塞回 html 模板；
- 无论主案兜底，`verify-singlefile.mjs` 均校验 `dist/index.html` 中不存在任何外链 script/link/资源引用，失败即构建失败（学知临 build-verified 思路）。

退役物：`build.js`、`src/template.html`、旧 `src/js/*.js` 全部十三文件。产物定为 **`dist/index.html`**——GitHub Pages 开箱即用。e2e 直接对 `dist/index.html` 运行。

## 10. 测试策略

- `tests/engine.test.ts`：31 项断言**全量平移**——穿透封锁、厚脸皮正背面、名刀守护一次性、投石机三触发场景、策反倒戈、大肉比跨回合蓄势、直行侠直线、杀手五杀升级序列、死吧×金身交互……+ 随机整局模拟（含操作后悔棋的逐字节快照对比）。加载方式改为 `import { createGame }` + 自动选择器注入。
- e2e 保留：Edge headless 打开 `dist/index.html`，经 `__HJ_DEBUG__` 驱动真实 DOM 点击，验证「部署落子 → 选中己方 → 攻击掉血」链路，结果落 DOM 后提取断言（沿用现有方法）。
- UI 组件不上 jsdom 单测：零测试依赖哲学不变，UI 正确性由 e2e 把关。

## 11. 错误处理

- act 包装器捕获引擎异常 → toast 展示并复位交互态（沿用现有模式）；
- 防御性判断保留：基地缺失时血条不动、checkWin 早退等；
- verify-singlefile 失败即 fail build，杜绝「看似构建成功实则外链断裂」的产物。

## 12. 施工顺序（每步一 commit）

1. **脚手架**：Vite + tsconfig + package.json 改造，index.html 入口，旧源码原位共存；
2. **引擎类型化**：engine 八文件 ESM + 完整类型建模 → tests/engine.test.ts 全绿；
3. **React 骨架**：桥接层（gameStore/useGame/useInteraction）+ 棋盘静态渲染；
4. **交互迁移**：部署/移动/攻击/治疗/技能/法术/目标选择器全部接通；
5. **特效与外围**：FX 接管 + SidePanel 全家/CodexModal/WinMask/ToastHost；
6. **收尾**：删旧渲染层与 build.js、README 重写、e2e 全链路验证、随机整局回归。

## 13. 已确认决策记录

| 决策点 | 结论 | 备注 |
|---|---|---|
| 工程组织 | 单包 + 清晰分层 | 不引入 workspace，将来机械拆包 |
| 样式体系 | global token/FX + CSS Modules | 防未来嵌 Next 样式互染 |
| 测试跑法 | node:test + --experimental-strip-types | 对齐 zhilin-writing，零新增依赖 |
| 迁移节奏 | 一次性重写表现层 | 31 测试 + e2e 护航 |
| TS 深度 | 深度类型建模 | EV 判别联合、注册表类型约束 |
| 版本基线 | 对齐 zhilin-writing | react 19.2.6 / vite 8.0.13 / ts 5.9.3 |
| 联机 | 本期不做，接口预留 | choose 注入 + engine 零 DOM 即预留本体 |
