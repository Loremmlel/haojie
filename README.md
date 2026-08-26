# 浩劫 · 双人对战回合制棋盘游戏

9 列 × 13 行的 117 格战场上，蓝红双方围绕 300 血的基地展开攻防——
从 26 种棋子库中随机召唤、部署、行动、施法，率先摧毁对方基地者获胜。

Vite + React 19 + TypeScript strict 单包工程，构建产物为**零外链的单个 HTML 文件**，双击即可离线游玩。
逻辑层（引擎）零 DOM 依赖，可在 Node 里直接驱动整局，为未来联机预留了最难的接缝。

## 快速开始

```bash
npm install        # 安装依赖（react 19 / vite 8 / typescript 5.9）
npm run dev        # 本地开发服务器
npm test           # 逻辑层回归测试（node:test 直跑 TS）
npm run build      # 构建单文件产物 -> dist/index.html（含外链校验）
```

## 产物说明

- `npm run build` 产出 `dist/index.html`：**零外链、零依赖的单个 HTML 文件**，双击即可在浏览器离线游玩；本地双人同屏对战，两位玩家轮流操作鼠标即可。
- 产物满足 **GitHub Pages 开箱即用**（发布方式由部署流水线另行决定）。
- `scripts/verify-singlefile.mjs` 在构建后校验产物中不存在任何外链 script/link/资源引用，杜绝「看似构建成功实则外链断裂」。
- 发布前全链路验收：`npm run build && node tests/e2e/smoke.e2e.mjs`（Edge headless 真实浏览器冒烟：清手牌 → 跨回合 → 选子 → 攻击/移动）。

## 目录结构

```
haojie/
├─ index.html               # Vite 入口模板
├─ vite.config.ts
├─ tsconfig.json
├─ package.json             # type: module
├─ scripts/
│  └─ verify-singlefile.mjs # 校验 dist/index.html 无外链引用
├─ src/
│  ├─ engine/               # 纯逻辑层（零 DOM / 零 React / 零模块级可变全局）
│  │  ├─ rng.ts             # mulberry32 种子随机
│  │  ├─ data.ts            # DEFS 26 棋子档案 + 特殊 id 分发
│  │  ├─ state.ts           # Piece/GameState 类型 + 快照悔棋
│  │  ├─ types.ts           # Game/GameDeps 纯类型（UI 无副作用导入）
│  │  ├─ rules.ts           # 移动/攻击/治疗/部署目标计算、穿透 BFS
│  │  ├─ engine.ts          # dealDamage 管线 / killPiece / 死亡遗言
│  │  ├─ abilities.ts       # SKILLS / DEATHRATTLES 注册表（handler 带 ctx 首参）
│  │  ├─ spells.ts          # SPELL_TARGETS / CAST 注册表（handler 带 ctx 首参）
│  │  └─ game.ts            # createGame 会话工厂（API 门面 + 组装 ctx）
│  ├─ ui/
│  │  ├─ gameStore.ts       # version store + 当前 Game 持有（useSyncExternalStore 桥）
│  │  ├─ interactionStore.ts# 交互状态机（mode/selUid/choice/busy + act/ask）
│  │  ├─ toastBus.ts        # 轻提示模块级总线
│  │  ├─ geometry.ts        # posOf/metrics 计算（FX 与 React 共用唯一权威）
│  │  ├─ hooks/             # useBoardMetrics
│  │  ├─ fx/
│  │  │  ├─ fx.ts           # 命令式动画内核（依赖注入化，零 React import）
│  │  │  └─ registry.ts     # 棋子 DOM ref 注册表
│  │  └─ components/        # React 组件（各配 *.module.css）
│  │     ├─ TopBar  BoardArea  CellsGrid  PiecesLayer  FxLayer
│  │     ├─ SidePanel  PhaseHint  Hand  Stored  InspectPanel
│  │     ├─ SkillBox  ActionBar  LogPanel
│  │     └─ CodexModal  WinMask  ToastHost  OptionFloat
│  ├─ styles/global.css     # :root token + FX keyframes + 棋盘网格
│  ├─ App.tsx
│  └─ main.tsx
├─ tests/
│  ├─ engine.test.ts        # 31 断言平移 + 随机整局模拟
│  └─ e2e/smoke.e2e.mjs     # Edge headless 全链路冒烟（发布验收）
└─ dist/index.html          # 构建产物（不入库）
```

## 架构要点

- **engine 零 DOM**：`src/engine/**` 八个文件不触碰 DOM/React/window，Node 可直接 import 驱动整局；未来联机可机械平移为独立 package。UI 对引擎的一切**写操作**必须经 Game 实例公开方法，只读计算经 `game.rules` 命名空间或纯函数具名导入。
- **会话工厂**：`createGame(seed, deps)` 每次开局新建完整会话——state、事件队列、悔棋快照栈、死亡遗言队列全部收进闭包，支持多局并存，重开不再依赖 `location.reload()`；目标选择经 `deps.choose` 注入（浏览器注入 UI ask，测试注入自动选择器），函数值严禁进入 GameState。
- **受控提交**：引擎保持原地变异，React 经 `useSyncExternalStore` 以 version 号订阅。一条操作产生的整条事件链由 FX 逐事件播放，默认**链尾单次提交**（数值/样式级刷新延迟到链尾），deploy 类事件带同步点（受控 bump + 双 rAF）保证后继节点及时物化。与旧版的毫秒级时序差异逐条记录在规格 §6.4。
- **FX 特区**：`src/ui/fx/fx.ts` 是命令式领地——零 React import，通过注入的宿主元素、棋子 DOM ref 注册表与 Game 只读访问器工作；死亡节点删除权归 React（FX 只播 dying 动画）。
- **调试钩子**：始终暴露 `window.__HJ_DEBUG__ = { game }`（getter 恒指向当前局），e2e 与人工排障依赖。

## 快捷键

| 键 | 功能 |
|----|------|
| `E` | 结束回合 |
| `U` | 悔棋 |
| `Esc` | 三级取消：关闭模态框 → 取消可取消的目标选择 → 复位当前选择 |
| 右键 | 取消可取消的目标选择 / 复位当前选择 |

## 设计文档

- [设计规格（v3）](docs/superpowers/specs/2026-08-26-vite-react-ts-migration-design.md) —— Vite + React + TS 迁移设计：目录分层铁律、引擎会话工厂、React 桥接策略、FX 改造、有意变更豁免清单（§6.4）
- [实施计划](docs/superpowers/plans/2026-08-26-vite-react-ts-migration.md) —— 10 任务实施计划（含裁定记录与三轮自审）
