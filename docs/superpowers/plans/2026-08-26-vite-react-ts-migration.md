# 「浩劫」Vite + React + TS 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把零依赖拼接构建的「浩劫」迁移为 Vite + React 19 + TypeScript strict 工程，保持编译为单个 HTML 文件的交付能力，玩家可感知行为不变（豁免清单除外）。

**Architecture:** 引擎八文件迁入 `src/engine/` 做 ESM + 深度类型化，模块级全局（S/EV/undoStack/pendingDeaths）收拢为 `createGame` 闭包持有的 Session 体；表现层整体重写为 React 组件树，经「version 外部 store + useSyncExternalStore」桥接可变引擎；FX 保持命令式特区，经 initFx 依赖注入宿主与 registry。旧 `src/js/` 全程不动，最后一次性删除。

**Tech Stack:** react/react-dom 19.2.6 · vite 8.0.13 · @vitejs/plugin-react 6.0.2 · vite-plugin-singlefile ^2.3.3 · typescript 5.9.3 (strict + erasableSyntaxOnly) · node:test (--experimental-strip-types) · Edge headless e2e

**Spec:** `docs/superpowers/specs/2026-08-26-vite-react-ts-migration-design.md`（v3）

## Global Constraints

以下约束来自规格 v3，**每个任务隐式包含本节**：

- 版本严格 pin：`react`/`react-dom` 19.2.6、`@types/react` 19.2.14、`@types/react-dom` 19.2.3、`vite` 8.0.13、`@vitejs/plugin-react` 6.0.2、`typescript` 5.9.3、`vite-plugin-singlefile` ^2.3.3；`engines.node >=22.13.0`
- `"type": "module"`；TS 遵守 **erasable-syntax-only**：禁 enum / namespace / 构造函数参数属性（node 直跑 TS 要求）
- 等价重构：玩法规则、数值、交互行为冻结；视觉差异仅限规格 §6.4 豁免表五条（行动点/面板/阵营色链尾刷新、death 所有权、徽标链尾刷新）
- 分层铁律：`src/engine/**` 零 DOM/零 React；UI 写操作必经 Game 方法，只读计算经 `g.rules` 或 engine 具名导入；`fx.ts` 零 React import，仅靠 initFx 注入工作
- **禁止任何函数值进入 GameState**（JSON 快照会静默丢函数）；组件禁止以 piece/state 对象身份作 memo/useMemo/deps 比较依据；choice 的 resolve 引用存于 interactionStore（模块级存储而非 React state，天然规避身份比较问题），resolve 不得经过任何渲染路径
- **选择器与类名可见性约定**（CSS Modules 哈希化的应对，e2e 与 FX 依赖此条）：
  1. 棋盘网格全家族**留 global.css**：`.cell` 及其全部状态类（`base-cell/dep-ok/mv-ok/atk-ok/sk-ok/heal-ok/sel-hl`）——它们是规格 §8 所指「棋盘网格基础布局」的一部分，且被 useBoardMetrics 与 e2e 直接按原始类名寻址；
  2. FX 命令式类**留 global.css**：`.piece.dying/.piece.hit-jolt/.piece.pop-in` 及其 keyframes（dieAnim/jolt/popIn）——fx.ts 以字符串硬编码挂类，哈希化即失效；
  3. e2e 钩子优先用 **DOM id 与 data-\* 属性**：`#hand`、`#stored`、`#panel`、`#board`、`#btn-end`、`#btn-undo` 等 id 在 JSX 中原样保留；卡片加 `data-card` 属性、格子加既有 `dataset.x/y`、棋子沿用 `data-uid`；
  4. 其余组件私有类才走 `*.module.css`
- **门禁强度说明**：Task 5–9 期间 `npm test` 只约束引擎回归、typecheck 只约束类型——UI 行为的正确性验收靠各任务的手测核对清单（已写入对应验证步骤）；首个自动化行为关卡是 Task 10 的 e2e，且其编写先于旧代码删除执行
- win 遮罩唯一通道：FX 的 `onWin` 回调，引擎无第二通道
- 产物 `dist/index.html` 必须无任何外链引用（verify 脚本把关，失败即 fail build）
- 每个 Task 至少一个 commit；commit 前 `npm run typecheck && npm test` 必须全绿
- 旧文件（`src/js/*.js`、`src/css/style.css`、`build.js`、`src/template.html`、`test/smoke.js`）在 Task 10 之前一律不修改、不删除；期间 `node build.js` 与 `node test/smoke.js` 随时可跑作对照

### 规格实现裁定记录（对规格字面的必要细化，均已记录理由）

| # | 规格原文 | 计划裁定 | 理由 |
|---|---|---|---|
| R1 | handler 签名 `(ctx, state, …)` | `(ctx, sess, …)`，sess 含 `.state/.events/.undoStack/.pendingDeaths` | handler 需要发事件（ev）与结算死亡（killPiece/flushDeaths）的通道，裸 state 给不了 |
| R2 | `ChoiceSpec<T>` 泛型 | 非泛型 `ChoiceSpec`，结果类型 `Cell \| Piece \| string \| null` | 现有全部 option value 均为 string（charge/normal/atk/rng/one/two），单臂泛型无收益 |
| R3 | effAtk 位于 state.ts | 移至 rules.ts，签名 `effAtk(st, p)` | effAtk 依赖 bladeN(rules)，留在 state 会造成 state↔rules 循环导入 |
| R4 | deploy syncAfter 标记 | 播放器按事件类型（deploy）自行插入同步点，引擎零改动 | 「表现策略归表现层」，引擎不必感知 |
| R5 | — | engine 迁移为**新建目录平行开发** | 旧链路全程可跑，消除规格 §12 过渡期风险 |
| R6 | `__HJ_DEBUG__ = { game }` 的生产侧未指派 | 挂载点定为 gameStore.`setGame()`，getter 形态保证恒读当前局 | 规格 §6.5 只写了形状没写挂载点；e2e 依赖它必须有人生产（评审 B1a） |
| R7 | performAttack/deployPiece 归属未声明 | 二者携 ctx 上移 engine.ts | spells.ts 的 summonOnce 触达不了 game 闭包内的 deployPiece（评审 M2）；performAttack 经 flushDeaths 需要 ctx |
| R8 | 重开/再来一局的机制未指明 | App 以 `seq` state 为 effect 依赖的重建通道，`restart` 回调经 props 下发 | `setGame(null)` 不触发 `deps=[]` effect 重跑（评审 M4） |

---

## File Structure（目标形态）

```
haojie/
├─ index.html                     # Vite 入口（Task 1）
├─ vite.config.ts                 # Task 1
├─ tsconfig.json                  # Task 1
├─ package.json                   # 重写（Task 1）
├─ scripts/
│  └─ verify-singlefile.mjs       # Task 1
├─ src/
│  ├─ main.tsx                    # Task 5
│  ├─ App.tsx                     # Task 5 起，逐步充实
│  ├─ styles/global.css           # Task 1 全量拷贝起步 → 各任务逐步摘薄
│  ├─ engine/                     # Task 2–3
│  │  ├─ rng.ts  data.ts  state.ts  rules.ts
│  │  ├─ types.ts                 # Game/GameDeps 纯类型（UI 无副作用导入）
│  │  ├─ engine.ts  abilities.ts  spells.ts  game.ts
│  ├─ ui/
│  │  ├─ gameStore.ts             # Task 5（version store + 当前 Game 持有）
│  │  ├─ interactionStore.ts      # Task 6（mode/selUid/choice/busy + act/ask）
│  │  ├─ toastBus.ts              # Task 8
│  │  ├─ geometry.ts              # Task 5（posOf/metrics 计算，FX 与 React 共用）
│  │  ├─ hooks/useBoardMetrics.ts # Task 5
│  │  ├─ fx/
│  │  │  ├─ fx.ts                 # Task 8（命令式内核）
│  │  │  └─ registry.ts           # Task 5（uid→HTMLElement）
│  │  └─ components/              # Task 5–9，每组件配 *.module.css
│  │     ├─ TopBar  BoardArea  CellsGrid  PiecesLayer  FxLayer
│  │     ├─ SidePanel  PhaseHint  Hand  Stored  InspectPanel
│  │     ├─ SkillBox  ActionBar  LogPanel
│  │     ├─ CodexModal  WinMask  ToastHost  OptionFloat
│  │  └─ highlights.ts            # Task 6（computeHighlights 纯函数）
│  └─ (旧 src/js/ src/css/ src/template.html 存续至 Task 10)
├─ tests/
│  ├─ engine.test.ts              # Task 2 起步 → Task 4 全量
│  └─ e2e/smoke.e2e.mjs           # Task 10
└─ dist/index.html                # 构建产物
```

**职责边界**：`geometry.ts` 是 posOf 公式的唯一权威（React 渲染与 FX 位移共用，防两套公式漂移）；`interactionStore` 是唯一持有 busy 锁与 choice 的地方；`gameStore` 是唯一持有当前 Game 实例的地方。

---

### Task 1: 脚手架 —— Vite + TS + React 起步与单文件构建链

**Files:**
- Modify: `package.json`（整文件重写）
- Create: `tsconfig.json`、`vite.config.ts`、`index.html`、`scripts/verify-singlefile.mjs`、`src/main.tsx`、`src/App.tsx`、`src/styles/global.css`

**Interfaces:**
- Produces: 可用的 `npm run dev / build / test / typecheck` 四命令；`dist/index.html` 单文件产物。后续所有 Task 依赖此工具链。

- [ ] **Step 1: 重写 package.json**

```json
{
  "name": "haojie",
  "version": "2.0.0",
  "description": "浩劫 —— 9x13 双人对战回合制棋盘游戏，可构建为单个 HTML 文件",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.13.0" },
  "scripts": {
    "dev": "vite",
    "build": "vite build && node scripts/verify-singlefile.mjs",
    "test": "node --experimental-strip-types --test tests/engine.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "19.2.6",
    "react-dom": "19.2.6"
  },
  "devDependencies": {
    "@types/react": "19.2.14",
    "@types/react-dom": "19.2.3",
    "@vitejs/plugin-react": "6.0.2",
    "typescript": "5.9.3",
    "vite": "8.0.13",
    "vite-plugin-singlefile": "^2.3.3"
  }
}
```

注意：`scripts.test` 暂指向尚不存在的文件——本任务末尾创建占位空测试使其可执行。

- [ ] **Step 2: 安装依赖**

Run: `npm install`
Expected: 无 peer 冲突警告（plugin-react@6 peer `vite ^8.0.0`、singlefile@2.3.3 peer 含 `^8.0.0`，已核实兼容）。

- [ ] **Step 3: 创建 tsconfig.json**

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "noEmit": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: 创建 vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
});
```

- [ ] **Step 5: 创建 index.html（Vite 入口，取代 template.html 的壳职责）**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>浩劫 · 双人对战棋</title>
</head>
<body>
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 6: 创建 scripts/verify-singlefile.mjs**

```js
/** 校验 dist/index.html 为自包含单文件：不允许任何外链资源引用。失败退出码 1。 */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const offenders = [];

for (const m of html.matchAll(/<(?:script|link|img|source|video|audio)\b[^>]*?\b(?:src|href)="([^"]+)"/gi)) {
  const url = m[1];
  if (/^(?:https?:)?\/\//i.test(url) || url.startsWith('/')) offenders.push(url);
}
for (const m of html.matchAll(/url\(\s*['"]?(https?:)?\/\/[^)'"]+/gi)) offenders.push(m[0]);
if (!/<script\b/i.test(html)) offenders.push('<script> 缺失——产物疑似为空');

if (offenders.length) {
  console.error('[verify-singlefile] 发现外链引用，产物不自包含：');
  for (const o of offenders) console.error('  ✗ ' + o);
  process.exit(1);
}
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`[verify-singlefile] OK -> dist/index.html 自包含 (${kb} KB)`);
```

- [ ] **Step 7: 创建样式与占位应用**

把 `src/css/style.css` **全量拷贝**为 `src/styles/global.css`（本任务只求 dev 有完整观感；后续任务按映射表逐步摘薄，最终只剩 token/FX/网格）。

`src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
```

`src/App.tsx`（占位，Task 5 重写）:

```tsx
export default function App() {
  return <div style={{ color: '#e2e8f0', padding: 40 }}>⚔️ 浩劫 · 迁移中</div>;
}
```

- [ ] **Step 8: 创建占位测试使 `npm test` 可运行**

`tests/engine.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('toolchain smoke', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 9: 四命令全验证**

Run: `npm run typecheck` → Expected: 无错误
Run: `npm test` → Expected: 1 passing
Run: `npm run build` → Expected: `vite build` 成功 + `[verify-singlefile] OK`，`dist/index.html` 生成且无外链（浏览器双击可直接打开显示占位文字）
Run: `npm run dev` → Expected: 页面正常显示占位文字（人工确认后 Ctrl+C）

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: Vite + React 19 + TS 脚手架与单文件构建链（含 verify 校验）"
```

---

### Task 2: 引擎基础四件 —— rng/data/state/rules 的 ESM + 类型化

**Files:**
- Create: `src/engine/rng.ts`、`src/engine/data.ts`、`src/engine/state.ts`、`src/engine/rules.ts`
- Test: `tests/engine.test.ts`（追加真实单元测试）

**Interfaces:**
- Produces（后续任务的全部依赖，签名必须一字不差）:

```ts
// rng.ts
export interface RngState { seed: number }
export function rnd(st: RngState): number;
export function rndInt(st: RngState, lo: number, hi: number): number;
export function rndPick<T>(st: RngState, arr: T[]): T;

// data.ts
export const W: number;   // 9
export const H: number;   // 13
export const BASE_HP: number; // 300
export interface Cell { x: number; y: number }
export interface Def { id:number; name:string; emoji:string;
  type:'follower'|'spell'|'base'|'grave';
  atk:number; hp:number; rng:number; acts:number; mv:number;
  short:string; desc:string; limit?:number; big?:boolean }
export const DEFS: Def[];
export function getDef(defId: number): Def;

// state.ts —— 见 Step 2 完整类型定义
// rules.ts —— 见 Step 4 签名清单
```

- [ ] **Step 1: 先写失败测试（追加到 tests/engine.test.ts）**

```ts
import { rndInt } from '../src/engine/rng.ts';
import { W, H, BASE_HP, DEFS, getDef } from '../src/engine/data.ts';
import { makePiece, pieceAt, pieceByUid, newGame } from '../src/engine/state.ts';
import { nearestDist, effRange } from '../src/engine/rules.ts';
// 注：本测试文件同时 import H 于 data 行（见下），state.ts 的 newGame 需要用它放红方基地
import type { Piece, GameState } from '../src/engine/state.ts';

test('data: 棋子库完整性', () => {
  assert.equal(W * H, 117); assert.equal(BASE_HP, 300); assert.equal(DEFS.length, 26);
  for (const d of DEFS) { assert.ok(getDef(d.id), `缺档案 ${d.id}`); }
  assert.equal(getDef(-1).type, 'base');
  assert.equal(getDef(-2).type, 'grave');
  assert.equal(getDef(-3).type, 'grave');
  assert.equal(getDef(33).name, '刀魂');
});

test('rng: 种子确定性', () => {
  const a = { seed: 42 }, b = { seed: 42 };
  for (let i = 0; i < 100; i++) assert.equal(rndInt(a, 1, 26), rndInt(b, 1, 26));
});

test('state: pieceAt 支持 big 与死亡过滤', () => {
  const st: GameState = newGame(7);
  const big = makePiece(st, 0, 5, 3, 3);
  big.big = true; st.pieces.push(big);
  assert.equal(pieceAt(st, 4, 4), big);           // 2×2 右下角
  assert.equal(pieceByUid(st, big.uid), big);
  big.dead = true;
  assert.equal(pieceAt(st, 3, 3), null);
});

test('rules: nearestDist 按占据格最近计算', () => {
  const st = newGame(1);
  const a = makePiece(st, 0, 26, 1, 1); st.pieces.push(a);
  const b = makePiece(st, 1, 5, 4, 4); b.big = true; st.pieces.push(b);
  // big 占 (4,4)(5,4)(4,5)(5,5)，最近格 (4,4)：|4-1|+|4-1|=6
  assert.equal(nearestDist(a, b), 6);
});

test('rules: effRange 非刀魂返回静态射程', () => {
  const st = newGame(2);
  const p = makePiece(st, 0, 9, 1, 1); st.pieces.push(p);   // 射手 rng=5
  assert.equal(effRange(st, p), 5);
});
```

- [ ] **Step 2: 实现 src/engine/state.ts（类型建模核心，完整给出）**

函数体自 `src/js/state.js` 平移，变化点：删除模块级 `S`/`EV`/`ENV`/`undoStack`（改由 Session 参数承载）；`newGame` 变纯函数（不再赋值 S，不再清 EV/undoStack——这些归 createGame）；`ev` 改为接收 Session；`effAtk` **迁出至 rules.ts**（裁定 R3）。

```ts
/* state.ts · 游戏状态类型 / 会话体 / 快照悔棋 */
import { getDef, W, H, type Cell } from './data.ts';

export type Owner = 0 | 1;
export type Phase = 'deploy' | 'action' | 'over';

export interface Card { uid: number; defId: number }
export interface StoredCard { defId: number; remain: number }
export interface LogEntry { msg: string; cls: string }
export interface AtkBuff { amt: number; until: number }
export interface Mark10 { owner: Owner; srcUid: number; expires: number }

export interface Piece {
  uid: number; owner: Owner; defId: number; x: number; y: number;
  hp: number; maxHp: number; atk: number; range: number; mv: number;
  big: boolean; justDeployed: boolean; apLeft: number; charge: number;
  skillUses: number; killCount: number; guardUsed: boolean;
  mark10: Mark10 | null; shieldUntil: number;
  reaperFrom: number; reaperTo: number; charmFrom: number; charmTo: number;
  atkBuffs: AtkBuff[]; beatCount: number; diesAt: number;
  hitThisTurn: number[];
  /** killPiece 动态标记；JSON 序列化天然兼容 */
  dead?: boolean;
}

export interface GameState {
  seed: number; turnCounter: number; curPlayer: number; // curPlayer 初值为 -1（开局随机前）
  phase: Phase; winner: number | null;
  pieces: Piece[]; hand: [Card[], Card[]]; stored: [StoredCard[], StoredCard[]];
  extraDraw: [number, number]; extraRows: [number[], number[]];
  uidSeq: number; log: LogEntry[];
}

/* ── 事件流：判别联合（字段与 v1 各 emit 点逐一对齐）── */
export type GameEvent =
  | { type: 'turn'; player: number; turn: number }
  | { type: 'deploy'; uid: number }
  | { type: 'move'; uid: number; tx: number; ty: number }
  | { type: 'hook'; uid: number; fx: number; fy: number; x0: number; y0: number; tx: number; ty: number }
  | { type: 'attack'; uid: number; tuid: number; healMode?: boolean }
  | { type: 'damage'; uid: number; amount: number; frontal?: boolean; crit?: boolean; silentNum?: boolean }
  | { type: 'heal'; uid: number; amount: number }
  | { type: 'buff'; uid: number }
  | { type: 'guard'; uid: number }
  | { type: 'block'; uid: number }
  | { type: 'mark'; uid: number }
  | { type: 'counter'; uid: number }
  | { type: 'charm'; uid: number }
  | { type: 'death'; uid: number; defId: number }
  | { type: 'spell'; defId: number; x?: number; y?: number; uid?: number }
  | { type: 'expire'; owner: number }
  | { type: 'win'; winner: number }
  | { type: 'phase'; phase: Phase };

/* ── 目标选择契约（裁定 R2）── */
export type ChoiceSpec =
  | { kind: 'none' }
  | { kind: 'option'; options: { label: string; value: string }[]; hint?: string; cancelable?: boolean }
  | { kind: 'cell'; cells: Cell[]; hint?: string; cancelable?: boolean }
  | { kind: 'piece'; pieces: Piece[]; hint?: string; cancelable?: boolean };
export type ChoiceResult = Cell | Piece | string | null;
export type Chooser = (spec: ChoiceSpec) => Promise<ChoiceResult>;

/* ── 会话体：收拢 v1 的四个模块级全局（裁定 R1）── */
export interface PendingDeath { victim: Piece; killer: Piece | null }
export interface Session {
  state: GameState;
  events: GameEvent[];        // 易失队列，不入快照（undo 时清空）
  undoStack: string[];
  pendingDeaths: PendingDeath[];
}
export const UNDO_MAX = 600;
export function ev(s: Session, e: GameEvent): void { s.events.push(e); }

export function pushLog(state: GameState, msg: string, cls = ''): void {
  /* 自 state.js pushLog 平移 */
}
export function makePiece(state: GameState, owner: Owner, defId: number,
                          x: number, y: number, hpOver?: number): Piece {
  /* 自 state.js makePiece 平移；字段清单逐字保留 */
}
export function newGame(seed: number): GameState {
  /* 自 state.js newGame 平移，去掉 S/EV/undoStack 触碰；
     保留 pushLog(st, '⚔️ 「浩劫」开局！先手由天命决定……') */
}

/* ── 快照悔棋（Session 化）── */
export function snap(s: Session): void {
  s.undoStack.push(JSON.stringify(s.state));
  if (s.undoStack.length > UNDO_MAX) s.undoStack.shift();
}
export function undo(s: Session): boolean {
  if (!s.undoStack.length) return false;
  s.state = JSON.parse(s.undoStack.pop()!);
  s.events.length = 0;
  return true;
}
export function canUndo(s: Session): boolean {
  return s.undoStack.length > 0 && !s.state.winner;
}

/* ── 常用查询 ── */
export function pieceAt(state: GameState, x: number, y: number): Piece | null { /* 平移 */ }
export function pieceByUid(state: GameState, uid: number): Piece | null { /* 平移 */ }

export const PNAME = ['蓝方', '红方'] as const;
```

- [ ] **Step 3: 实现 src/engine/data.ts 与 src/engine/rng.ts**

`rng.ts`：三个函数原样平移 + `export`，参数类型 `RngState`。
`data.ts`：常量 `W/H/BASE_HP` 与 `DEFS`（26 条）、`DEF_BASE/DEF_GRAVE/DEF_BARRIER/DEF_BLADE` 全部**逐字节原样搬运**（数值与文案一个字符不许变），补上上述 `Cell`/`Def` 接口与 `export`。`getDef` 照搬。

- [ ] **Step 4: 实现 src/engine/rules.ts**

全部函数自 `src/js/rules.js` 平移。签名变更总表（其余函数体逐字保留）：

| v1 | v2 |
|---|---|
| `bladeN(p)` 偷读 S | `bladeN(st: GameState, p: Piece)` |
| `effRange(p)` | `effRange(st, p)` |
| `inLonerZone(x,y,owner)` 偷读 S | `inLonerZone(st, x, y, owner)` |
| `effActions(p)` 偷读 S | `effActions(st, p)` |
| `effMv(p)` 偷读 S | `effMv(st, p)` |
| （state.js）`effAtk(p)` 偷读 S | `effAtk(st, p)`，迁入本文件 |

`bfsEmptyCells/moveTargets/attackTargets/healTargets/isFrontal/baseDeployRows/computeExtraRows/deployRows/canDeployAt/deployCells/inBoard/mdist/pieceCells/nearestDist/DIRS` 签名不变（本来就收 state），补类型与 `export`。

- [ ] **Step 5: 运行测试**

Run: `npm run typecheck && npm test`
Expected: 全部 PASS。若 `nearestDist` 用例与实现不符，以实现语义为准修正常数（big 取四格最近距）。

- [ ] **Step 6: 对照回归**

Run: `node test/smoke.js`（旧链路不受影响）
Expected: 仍全绿（证明本次改动零触碰旧代码）。

- [ ] **Step 7: Commit**

```bash
git add src/engine tests/engine.test.ts
git commit -m "feat(engine): rng/data/state/rules ESM+类型化，Session 体与判别联合事件建模"
```

---

### Task 3: 引擎收口四件 —— engine/abilities/spells/game 的 Session 化与 createGame 工厂

**Files:**
- Create: `src/engine/types.ts`（Game/GameDeps 纯类型，供 UI 无副作用导入）、`src/engine/engine.ts`、`src/engine/abilities.ts`、`src/engine/spells.ts`、`src/engine/game.ts`

**Interfaces:**
- Consumes: Task 2 全部导出
- Produces:

```ts
// engine.ts
export async function dealDamage(s: Session, target: Piece, amount: number,
  src: Piece | null,
  opts?: { hit?: boolean; isMark?: boolean; noCounter?: boolean; noGuard?: boolean }): Promise<void>;
export function hasBladeGuard(st: GameState, target: Piece): boolean;
export async function heal(s: Session, target: Piece, amount: number): Promise<void>;
export async function killPiece(s: Session, victim: Piece, killer: Piece | null): Promise<void>;
export async function flushDeaths(ctx: HandlerCtx, s: Session): Promise<void>;
export function checkWin(st: GameState): void;
/** 自 game.js 上移：攻击结算核心（死吧/掷骰/投石机挂标/射手记录/定炮清充能）。
 *  需要 ctx：内部经 flushDeaths 结算死亡遗言（奶妈遗言要 choose）。 */
export async function performAttack(ctx: HandlerCtx, s: Session, p: Piece, target: Piece): Promise<boolean>;
/** 自 game.js 上移：底层落子 + 冲锋询问。需要 ctx：询问走 ctx.choose。
 *  spells.ts 的 summonOnce 与 game.ts 的 deployFollower 都调用它。 */
export async function deployPiece(ctx: HandlerCtx, s: Session, owner: number,
  defId: number, x: number, y: number): Promise<Piece>;

// abilities.ts
export interface HandlerCtx { choose: Chooser }
export interface SkillInfo {
  label: string;
  usable(p: Piece): boolean;
  targetSpec(st: GameState, p: Piece): ChoiceSpec;
  exec(ctx: HandlerCtx, s: Session, p: Piece, got: ChoiceResult): Promise<void>;
}
export const SKILLS: Record<number, SkillInfo>;
export const DEATHRATTLES: Record<number,
  (ctx: HandlerCtx, s: Session, victim: Piece, killer: Piece | null) => Promise<void>>;

// spells.ts
export const SPELL_TARGETS: Record<number, (st: GameState, owner: number) => ChoiceSpec>;
export const CAST: Record<number,
  (ctx: HandlerCtx, s: Session, owner: number, got: ChoiceResult) => Promise<void>>;

// game.ts
export interface GameDeps { choose?: Chooser }
export interface Game {
  readonly state: GameState;
  readonly events: GameEvent[];         // 同一数组引用，供 FX 游标消费
  canUndo(): boolean;
  undo(): boolean;
  deployFollower(handIdx: number, x: number, y: number): Promise<boolean>;
  discardUnplaceable(handIdx: number): boolean;
  storeHandSpell(handIdx: number): Promise<boolean>;
  castHandSpell(handIdx: number, got: ChoiceResult): Promise<boolean>;
  castStored(idx: number, got: ChoiceResult): Promise<boolean>;
  doMove(uid: number, x: number, y: number): Promise<boolean>;
  doAttack(uid: number, targetUid: number): Promise<boolean>;
  useSkill(uid: number): Promise<boolean>;
  endTurn(): Promise<void>;
  rules: {
    moveTargets(p: Piece): Cell[];
    attackTargets(p: Piece): Piece[];
    healTargets(p: Piece): Piece[];
    deployCells(defId: number, owner: number): Cell[];
    skillInfo(p: Piece): SkillInfo | null;
    effActions(p: Piece): number;
    effRange(p: Piece): number;
    bigCharge(p: Piece): number;
  };
}
export async function createGame(seed: number, deps?: GameDeps): Promise<Game>;
```

- [ ] **Step 1: 实现 src/engine/engine.ts**

自 `src/js/engine.js` 平移，变化点：
- 删除模块级 `pendingDeaths` → `s.pendingDeaths`
- 所有 `ev(type,data)` → `ev(s, { type, ...data })`；`pushLog` 不变（本来就收 state）
- `dealDamage/heal/killPiece` 首参 `s: Session`（内部用 `s.state` 替代原 `state`）
- `flushDeaths` 增加 `ctx` 首参（奶妈遗言需要 choose）：`await fn(ctx, s, victim, killer)`
- `checkWin` 纯查询保持 `(st)`
- 文件头注释中的管线顺序注释**更正为代码实际顺序**：金身免疫 → 策反倒戈 → 厚脸皮正面减免 → 扣血 → 投石机标记引爆 → 名刀守护 → 死亡遗言入队 → 转化器反弹（评审 m2 已证实规格 v1 曾写反）

- [ ] **Step 2: 实现 src/engine/abilities.ts 与 src/engine/spells.ts**

平移规则（对两个文件一致）：
- `foesOf/foeFollowers/myFollowers` 照搬（本就收 state）
- `SKILLS[x].exec` / `DEATHRATTLES[x]` / `CAST[x]` 首二参改为 `(ctx, s)`，函数体内 `state` → `s.state`、`ENV.choose(...)` → `ctx.choose(...)`
- `SKILLS[x].targetSpec` / `SPELL_TARGETS[x]` 保持 `(st, owner)` 纯查询
- `summonOnce` 签名 `(ctx, s, owner)`（其内部 choose 调用走 ctx；其落子调用 `deployPiece(ctx, s, …)`——见下）
- **两个函数上移 engine.ts 的裁定**（消除 spells/abilities 对 game 闭包内函数的触达需求）：`performAttack(ctx, s, p, target)` 与 `deployPiece(ctx, s, owner, defId, x, y)` 自 game.js 上移至 engine.ts——前者是攻击结算核心（神行千里补刀也调用），后者是底层落子+冲锋询问（重铸召唤的 summonOnce 也调用）。二者都需要 ctx：performAttack 经 flushDeaths 触发遗言、deployPiece 直接触发冲锋询问
- **模块依赖图与循环说明（如实陈述，勿误读）**：engine.ts ↔ abilities.ts 存在**运行时相互引用**（engine 的 flushDeaths 查 DEATHRATTLES 表；abilities 的 handler 调 dealDamage/heal/killPiece）。该形状在「顶层 const 对象表 + 仅在函数调用期解引用」的前提下是安全的 ESM 用法（两侧都没有模块求值期的反向依赖）；若执行者想彻底消除，可把 DEATHRATTLES 查表改为 flushDeaths 接收表参数的注入式写法，属可选优化，非必需
- `dealDamage/killPiece/flushDeaths/makePiece/...` 相应 import 自 `./engine.ts` / `./state.ts`

- [ ] **Step 3: 实现 src/engine/game.ts（工厂收口，核心骨架完整给出）**

```ts
/* game.ts · createGame 会话工厂（对外 API 门面） */
import { rnd, rndInt } from './rng.ts';
import { getDef, W, H, type Cell } from './data.ts';
import { PNAME, ev, snap, undo, canUndo, pushLog, makePiece, newGame,
         pieceAt, pieceByUid,
         type Session, type GameEvent, type ChoiceResult, type Chooser,
         type GameState, type Piece } from './state.ts';
import { effActions, effRange, moveTargets, attackTargets, healTargets,
         deployCells, canDeployAt } from './rules.ts';
import { dealDamage, killPiece, heal, flushDeaths, checkWin } from './engine.ts';
import { SKILLS, type HandlerCtx } from './abilities.ts';
import { SPELL_TARGETS, CAST } from './spells.ts';
import type { Game, GameDeps } from './types.ts';
```

> 注：`Game`/`GameDeps` 接口放独立 `src/engine/types.ts`（纯类型文件，避免 UI import game.ts 时拖入实现——UI 只要类型）。上节 Interfaces 块的两个接口原文放入 types.ts。

内部结构与 v1 的对应关系（函数体逐字平移，仅做以下机械替换）：

| v1（game.js） | v2（game.ts 闭包内） |
|---|---|
| `let S` / `const EV` / `undoStack` / `pendingDeaths` | `const sess: Session = { state: newGame(seed), events: [], undoStack: [], pendingDeaths: [] }` |
| `ENV.choose` | `const ctx: HandlerCtx = { choose: deps.choose ?? rejectChooser }` |
| `API.init(seed)` | createGame 主体尾部：`sess.state.curPlayer = rnd(sess.state) < 0.5 ? 0 : 1; pushLog(...天命...); await startTurnInternal();` |
| `drawCards/checkPhaseAdvance/startTurnInternal/endTurn/deployFollower/discardUnplaceable/storeHandSpell/castHandSpell/castStored/doMove/doAttack/useSkill` | 成为闭包函数；`S`→`sess.state`、`snap()`→`snap(sess)`、`ev(...)`→`ev(sess,...)`；`useSkill`/`doAttack`/`deployFollower` 内部调用 engine.ts 的 `deployPiece/performAttack/flushDeaths` 时携带 `ctx` |
| `performAttack` / `deployPiece` | **不在本文件**——已按 Step 2 裁定上移 engine.ts，此处仅调用 |
| `__HAOJIE_EXPORT__` 钩子 | **删除** |

`rejectChooser`（防静默错局的默认值）:

```ts
const rejectChooser: Chooser = (spec) =>
  Promise.reject(new Error(`未注入目标选择器却发起了 ${spec.kind} 选择——请通过 createGame(seed, { choose }) 注入`));
```

`return { ... }` 组装 Game 门面：`state: sess.state`（getter 语义用 `get state() { return sess.state; }`——undo 后对象会被整体替换，必须 getter！）、`events: sess.events`（同一引用，getter 同理 `get events() { return sess.events; }`）、方法逐个箭头绑定闭包、`rules` 八个便捷包装（`moveTargets/attackTargets/healTargets/deployCells/skillInfo/effActions/effRange/bigCharge`，其中 `skillInfo: p => SKILLS[p.defId] ?? null`、`bigCharge: p => p.charge`）。

- [ ] **Step 4: 编译与旧链路双重验证**

Run: `npm run typecheck`
Expected: 无错误（engine 目录完整闭环）
Run: `node build.js && node test/smoke.js`
Expected: 旧链路仍绿（src/js 未被触碰）

- [ ] **Step 5: Commit**

```bash
git add src/engine
git commit -m "feat(engine): Session 化伤害管线与注册表 ctx 化，createGame 异步会话工厂收口"
```

---

### Task 4: 测试全量平移 —— 31 断言 + 随机整局

**Files:**
- Modify: `tests/engine.test.ts`（重写为完整套件）

**Interfaces:**
- Consumes: `createGame` 及 Task 2/3 全部导出
- Produces: `npm test` 成为引擎回归的权威关卡（后续所有 Task 的提交门槛）

- [ ] **Step 1: 数清基线**

Run: `grep -c "ok(" test/smoke.js`
记录数字 N（应为 31 左右，以实数为准）。平移后的断言总数必须 ≥ N。

- [ ] **Step 2: 编写公共设施（文件头）**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/engine/game.ts';
import type { Game } from '../src/engine/types.ts';
import { getDef } from '../src/engine/data.ts';
import type { Piece, GameState, Cell, ChoiceSpec, ChoiceResult } from '../src/engine/state.ts';
import { pieceAt } from '../src/engine/state.ts';

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
```

- [ ] **Step 3: 平移九个定向场景（场A–I）**

转换规则：旧 `await reset(); const S = API.state();` → `const g = await freshGame();`；`spawn(owner,…)` → `spawn(g, owner,…)`；`API.doX(...)` → `await g.doX(...)`；`API.rules.X(p)` → `g.rules.X(p)`；`ok(cond, name)` → `assert.ok(cond, name)`；`API.state().curPlayer = 1` → `g.state.curPlayer = 1`。**每个场景一个 `test('穿透阻挡', async () => {...})`，断言文案沿用旧名**。九场内容对照源 `test/smoke.js:71-224` 逐行搬运（穿透 4 断言、厚脸皮 2、名刀 3、投石机 4、策反 3、大肉比 **5**（smoke.js:172-177 含占据格校验）、直行侠 2、杀手 3、死吧金身 3）。

v1 API 与 v2 导入的替换对照表（随机整局场景同样适用）：

| v1 用法 | v2 替换 |
|---|---|
| `API.spellTargets[defId](state, me)` | `import { SPELL_TARGETS } from '../src/engine/spells.ts'` 后 `SPELL_TARGETS[card.defId](g.state, me)` |
| `API.getDef(id)` | `import { getDef } from '../src/engine/data.ts'` 后直接调用 |
| `API.undoDepth()`（depth 变量） | v2 Game 未暴露——删除该变量及 `void depth` 行，悔棋验证仅保留逐字节对比 |

- [ ] **Step 4: 平移随机整局模拟**

`test/smoke.js:228-337` 的 `checkInvariants/rndTest/pickRnd/randomBattle` 整体平移为一个 `test('随机整局模拟', ...)`：`API.init(777777)` → `await createGame(777777, { choose: autoChoose })`，其余逻辑逐字保留（悔棋抽样逐字节对比、部署首张循环、行动随机决策）。两个收尾断言（`undosVerified >= 3`、`fin.turnCounter > 4`）保留。

- [ ] **Step 5: 全量运行**

Run: `npm test`
Expected: 全部 PASS；断言计数 ≥ Step 1 基线。任一失败先怀疑平移笔误，其次才是引擎缺陷（引擎行为以旧链路 `node test/smoke.js` 为仲裁）。

- [ ] **Step 6: Commit**

```bash
git add tests/engine.test.ts
git commit -m "test: 引擎测试全量平移至 node:test——31 断言 + 随机整局 + 多局并存"
```

---

### Task 5: React 骨架 —— 桥接层与棋盘静态渲染

**Files:**
- Create: `src/ui/gameStore.ts`、`src/ui/geometry.ts`、`src/ui/hooks/useBoardMetrics.ts`、`src/ui/fx/registry.ts`、`src/ui/components/{TopBar,BoardArea,CellsGrid,PiecesLayer,FxLayer}.tsx`（各配 .module.css）
- Modify: `src/App.tsx`、`src/styles/global.css`（摘薄：移除已被 module 承接的段落）
- Rewrite: `src/main.tsx`（挂载真 App）

**Interfaces:**
- Produces:

```ts
// gameStore.ts
export function setGame(g: Game | null): void;       // 同时 bumpVersion
export function getGame(): Game | null;
export function bumpVersion(): void;
export function useGameTick(): number;               // useSyncExternalStore 订阅 version
export function useGame(): { game: Game; tick: number } | null;

// geometry.ts
export interface Metrics { size: number; gap: number; pad: number }
export function posOf(x: number, y: number, big: boolean, m: Metrics):
  { left: number; top: number };

// registry.ts
export const pieceRegistry: {
  set(uid: number, el: HTMLElement): void;
  remove(uid: number): void;
  get(uid: number): HTMLElement | null;
};

// useBoardMetrics.ts
export function useBoardMetrics(boardRef: RefObject<HTMLDivElement | null>): Metrics | null;
// 内部：measure 取首个 .cell 的 offsetWidth/offsetLeft 推 gap/pad；resize 监听触发重测
```

- [ ] **Step 1: 实现三个基础设施模块**

`gameStore.ts`:

```ts
import { useSyncExternalStore } from 'react';
import type { Game } from '../engine/types.ts';

let version = 0;
let game: Game | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setGame(g: Game | null) {
  game = g; version++; notify();
  // 调试钩子（规格 §6.5）：getter 保证 e2e/控制台永远读到当前局
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__HJ_DEBUG__ = {
      get game() { return game; },
    };
  }
}
export function getGame() { return game; }
export function bumpVersion() { version++; notify(); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
const snapshot = () => version;
export function useGameTick() { return useSyncExternalStore(subscribe, snapshot); }
export function useGame() {
  const tick = useGameTick();
  return game ? { game, tick } : null;
}
```

`geometry.ts`（公式自 ui.js `posOf` 平移，pad 取格子 offsetLeft）:

```ts
export interface Metrics { size: number; gap: number; pad: number }
export function posOf(x: number, y: number, big: boolean, m: Metrics) {
  return {
    left: m.pad + (x - 1) * (m.size + m.gap),
    top: m.pad + (13 - y - (big ? 1 : 0)) * (m.size + m.gap),
  };
}
```

`registry.ts`: Map 封装如上接口，一行实现一个方法。

- [ ] **Step 2: 实现 BoardArea + CellsGrid + PiecesLayer + TopBar + FxLayer**

- `CellsGrid`：双层循环 row 1→13 / col 1→9，`y = 13 - row + 1`（蓝方在下），`dataset.x/y` 保留（点击委托用），base-cell 判定 `occ?.defId === -1`。高亮类在本任务先不做（Task 6 接 highlights）。
- `PiecesLayer`：

```tsx
function PieceView({ p, st, m }: { p: Piece; st: GameState; m: Metrics }) {
  const refCb = useCallback((el: HTMLDivElement | null) => {
    if (el) pieceRegistry.set(p.uid, el); else pieceRegistry.remove(p.uid);
  }, [p.uid]);
  const def = getDef(p.defId);
  const pos = posOf(p.x, p.y, !!p.big, m);
  return (
    <div ref={refCb}
         className={`${s.piece} own${p.owner}${p.big ? ` ${s.big5}` : ''}`}
         data-uid={p.uid}
         style={{ left: pos.left, top: pos.top }}>
      <div className={s.face}>{def.emoji}</div>
      {p.defId >= 0 && <span className={`${s.stat} ${s.atk}`}>{effAtk(st, p)}</span>}
      <span className={`${s.stat} ${s.hp}${p.hp <= p.maxHp * 0.35 ? ` ${s.hurt}` : ''}`}>
        {Math.max(0, Math.round(p.hp))}
      </span>
    </div>
  );
}
```

（不引入 clsx 等任何新依赖；`effAtk` 从 `../engine/rules.ts` 具名导入、GameState 经 props 下传——分层铁律第 2 条允许的只读具名导入；badges/apdots/状态类 Task 7 补全，此处先立骨架。注意 `.piece.dying/.piece.hit-jolt/.piece.pop-in` 三个 fx 命令式类**不属于本 module**，见 Global Constraints 选择器约定与 Task 8。）

- `TopBar`：refreshTop 平移（血条宽度百分比、回合数、行动方 active 类）。
- `FxLayer`：渲染 `<div id="fxlayer">` 与 `<div id="banner" className="hidden">`，`ref` 暴露给父级。
- `BoardArea`：组合三者；`useBoardMetrics` 测得 metrics 后同时 `FX.setMetrics`（本任务 fx 未接入则暂存 geometry 模块级变量，Task 8 initFx 后切换）。

- [ ] **Step 3: 重写 App.tsx（装载流程）**

```tsx
export default function App() {
  const [error, setError] = useState<string | null>(null);
  // 重开通道（M4 裁定）：setGame(null) 本身不触发重建，必须以 seq 为 effect 依赖
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = await createGame((Math.random() * 0xffffffff) >>> 0, {
          // 占位选择器：Task 6 Step 1 建成 interactionStore 后替换为真 ask
          choose: async () => null,
        });
        if (alive) setGame(g);
      } catch (e) { if (alive) setError(String(e)); }
    })();
    return () => { alive = false; };
  }, [seq]);
  const restart = useCallback(() => { setGame(null); setSeq((n) => n + 1); }, []);
  const loaded = useGame();
  if (error) return <div>加载失败：{error}</div>;
  if (!loaded) return <div>正在开局……</div>;
  return (
    <div id="app">
      <TopBar />
      <main id="layout">
        <BoardArea />
        <aside id="panel">{/* SidePanel 于 Task 6 起填充；restart 经 props 下发 */}</aside>
      </main>
    </div>
  );
}
```

（占位选择器在 Task 6 Step 1 建成 interactionStore 后替换为真 `ask`——届时仅改动这一处导入与实参。`restart` 回调自 Task 6 起经 props 下发 ActionBar、Task 9 下发 WinMask 的「再来一局」。）

- [ ] **Step 4: CSS 摘薄第一批**

按 Global Constraints 的选择器约定执行第一刀：

- **移入 `TopBar.module.css`**：`#topbar/.side/.basebar*/.side-name/#turnbox/#turn-num/#turn-owner` 区段（style.css:46-89）；
- **移入 `Piece.module.css` 仅结构类**：`.piece`/`.face`/`.stat`/`.badges`/`.apdots/.apdot*`/`.big5` 及 hurt/exhausted/shielded/marked/charged/reapered/charmed/buffed/selected 外观类（style.css:165-243）；
- **留在 global.css 不动**：`:root` token、`#app/#layout/#boardwrap/#board-outer/#board/.cell` 网格全家族含全部高亮与基地类（style.css:92-163）、fx 命令式类 `.piece.pop-in/.piece.dying/.piece.hit-jolt` 及 keyframes popIn/dieAnim/jolt/shieldSpin/wobble/blink（style.css:222-258 中相应部分）；
- **删除死代码**：`.neutral`（style.css:190 附近）、`.blocked-dot::after`（:159）、`.deploy-glow`（:127）——v1 全库零引用的孤儿类；
- keyframes 若被 module 类引用而 fx 也用，一律留 global（CSS Modules 对 keyframes 同样哈希化，跨文件共享必须 global）。

- [ ] **Step 5: 验证**

Run: `npm run typecheck && npm test`（引擎回归不得破）
Run: `npm run dev` → Expected: 开局横幅后可见 117 格棋盘、双方基地血条满格、回合信息正确（人工目测）
Run: `npm run build` → verify OK

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): React 骨架——version store/registry/metrics/棋盘静态渲染"
```

---

### Task 6: 交互·部署阶段 —— interactionStore、ask/choice、手牌与部署流

**Files:**
- Create: `src/ui/interactionStore.ts`、`src/ui/highlights.ts`、`src/ui/components/{SidePanel,PhaseHint,Hand,Stored,ActionBar,OptionFloat}.tsx`（配 .module.css）
- Modify: `App.tsx`（SidePanel 装载 + 选择器注入替换占位）、`CellsGrid.tsx`（高亮类）、`BoardArea.tsx`（点击委托）、`global.css`（第二批摘薄）

**Interfaces:**
- Produces:

```ts
// interactionStore.ts
export interface ActiveChoice { spec: ChoiceSpec; resolve(r: ChoiceResult): void }
export interface InteractionState {
  mode: 'idle' | 'deployCard' | 'pieceSel';
  cardIdx: number | null;
  selUid: number | null;
  inspectUid: number | null;
  choice: ActiveChoice | null;   // 组件读；resolve 经 ref，见铁律
  busy: boolean;
}
export function getInteraction(): InteractionState;
export function setInteraction(patch: Partial<InteractionState>): void;  // 浅合并 + notify
export function useInteraction(): InteractionState;                      // useSyncExternalStore
export function ask(spec: ChoiceSpec): Promise<ChoiceResult>;            // 引擎注入点
export function finishChoice(v: ChoiceResult): void;
export function resetSelection(): void;                                  // mode=idle 清空三件套
export function act(fn: (g: Game) => Promise<unknown>): Promise<void>;   // 统一动作入口
```

- [ ] **Step 1: 实现 interactionStore（含 act 骨架）**

```ts
let st: InteractionState = { mode: 'idle', cardIdx: null, selUid: null,
                             inspectUid: null, choice: null, busy: false };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
export function getInteraction() { return st; }
export function setInteraction(patch: Partial<InteractionState>) { st = { ...st, ...patch }; notify(); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function useInteraction() { return useSyncExternalStore(subscribe, () => st); }

export function ask(spec: ChoiceSpec): Promise<ChoiceResult> {
  if (spec.kind === 'none') return Promise.resolve(null);
  return new Promise((resolve) => {
    setInteraction({ choice: { spec, resolve } });   // choice 对象本身存 store（渲染高亮要用），
                                                     // resolve 由 finishChoice 持有后立即置空 choice
  });
}
export function finishChoice(v: ChoiceResult) {
  const c = st.choice; setInteraction({ choice: null }); c?.resolve(v);
}
export function resetSelection() {
  setInteraction({ mode: 'idle', cardIdx: null, selUid: null });
}

export async function act(fn: (g: Game) => Promise<unknown>) {
  const g = getGame();
  if (!g || st.busy) return;
  setInteraction({ busy: true });
  try {
    await fn(g);
    await playChain(g);        // Task 8 前为空实现：async () => {}
    bumpVersion();
  } catch (err) {
    console.error(err);
    toast(err instanceof Error ? err.message : String(err), true);
  } finally {
    setInteraction({ busy: false });
    resetSelection();
    bumpVersion();
  }
}
```

（`toast` 本任务先用 `console.warn` 占位，Task 8 接 ToastHost。`playChain` 从 `../ui/fx/fx.ts` 导入，本任务建空壳文件。）

App.tsx 的占位选择器（`async () => null`，见 Task 5 Step 3）替换为 `ask`——同步更新导入。

- [ ] **Step 2: 实现 highlights.ts（computeHighlights 纯函数平移）**

自 ui.js `computeHighlights`（ui.js:50-87）平移：输入 `{ game, ia }`（ia = InteractionState），输出 `{ dep: Set<string>, mv, atk, sk, heal, sel }`（key 为 `'x,y'`）。choice 优先 → deployCard → pieceSel 三级逻辑逐字保留。CellsGrid 消费它打高亮类。

- [ ] **Step 3: 实现点击解析（BoardArea 委托）**

`handleCellClick(x, y)` 与 `handlePieceClick(el)` 自 input.js `onCellClick/onPieceClick`（input.js:102-182）平移，两条铁律平移：**choice 分支先于 busy 检查**；已选中己方棋子时点敌方＝攻击、点残血友方＝治疗（onPieceClick 的攻击解析分支）。toast 提示（💤热身/⚡没行动点）本任务先 console 占位。

- [ ] **Step 4: 实现 SidePanel 五件**

- `PhaseHint`：renderPhaseHint 平移（choice.hint 优先 → deploy 文案 → action 文案）。
- `Hand`：renderHand 平移为 JSX——卡片 selected/awaiting 态、spell 卡 ⏳limit 徽标、释放/储存按钮（法术）、弃置按钮（无处部署的随从）、卡片本体点击切 deployCard。法术释放走 `runSpellCast`（input.js:253-272 平移：busy→getSpec→ask→castHandSpell→playChain→bump）。
- `Stored`：renderStored 平移（剩余期限徽标 + 释放按钮，同样走 runSpellCast）。
- `ActionBar`：结束回合（`act(g=>g.endTurn())`）、悔棋（`g.undo()` 成功后 bump+toast）、图鉴/规则按钮（本任务先空回调，Task 9 接 modal）、重开（`confirm()` 确认后调用 App 下发的 **`restart` prop**——见 Task 5 Step 3 的 seq 重建通道；不用 location.reload）。按钮保留 v1 DOM id：`btn-end/btn-undo/btn-codex/btn-rules/btn-restart`（e2e 与快捷键依赖）。
- `Hand` 卡片元素添加 `data-card` 属性（e2e 选择器钩子，见 Global Constraints 约定 3）。
- `OptionFloat`：kind==='option' 时浮层渲染 options 按钮 + cancelable 取消键，点击调 finishChoice。

- [ ] **Step 5: CSS 第二批摘薄**

`#panel/.panel-block/#phasehint/.card*/.mini-btn` 区段（style.css:355-418）分入 `SidePanel/PhaseHint/Hand/Stored.module.css`；`.card*` 移入 module 后组件同步加 `data-card` 属性（选择器约定）；**`.btn/.btn-primary/.btn-danger` 按钮基类留在 global.css**（ActionBar 与 WinMask 跨组件共用，n6）；`#optfloat/.of-*`（578-602）入 `OptionFloat.module.css`。

- [ ] **Step 6: 验证**

Run: `npm run typecheck && npm test`
Dev 手测脚本：开局 → 点一张随从卡（绿格亮起）→ 点合法格落子 → 法术卡释放/储存 → 结束回合推进到对方 → 悔棋回退。目测高亮与状态流转正确。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): 部署阶段交互——ask/choice 注入、手牌储存栏、act 动作管线"
```

---

### Task 7: 交互·行动阶段 —— 指令解析、详情面板、技能框

**Files:**
- Modify: `interactionStore.ts`（selUid 完整流转）、`BoardArea.tsx`（行动分支激活）、`CellsGrid.tsx`（mv/atk/heal/sel 高亮激活）
- Create: `src/ui/components/{InspectPanel,SkillBox}.tsx`（配 .module.css）
- Modify: `global.css` 第三批摘薄（`#inspect/#skillbox` 区段 style.css:420-448）

**Interfaces:**
- Produces: 完整的双阶段游玩能力（除动画外全部行为到位）

- [ ] **Step 1: 激活行动分支**

`handleCellClick` 的 mv-ok→doMove（含大肉比 charge<=0 时拦截走 SkillBox 蓄势按钮的判定）、occ∈atk/heal 列表→doAttack 分支；`handlePieceClick` 的选子进入 pieceSel、justDeployed/apLeft 提示。全部自 input.js 平移，`APIST.selUid` → `setInteraction({ selUid })`。

- [ ] **Step 2: InspectPanel**

renderInspect + statusText（ui.js:286-317）平移为 JSX：五维行、坐标、hp/maxHp、状态行（蓄力/强化/击杀/金身/引信/斩杀/策反/守护耗尽/时限/待苏醒）。数据源 `pieceByUid(g.state, ia.inspectUid)`。

- [ ] **Step 3: SkillBox**

renderSkillbox 平移：大肉比蓄势按钮（`act(g=>g.doMove(uid,p.x,p.y))`）、`g.rules.skillInfo(p)?.usable(p)` 时渲染技能按钮（`act(g=>g.useSkill(uid))`）。按钮 label 来自 SkillInfo.label。

- [ ] **Step 4: PiecesLayer 补全状态外观**

把 Task 5 留白的 badges（⚡charge/💀reaper/🎭charm）、apdots（effActions 个点、spent 态）、exhausted/shielded/marked/reapered/charmed/charged/buffed/selected 类全部按 ui.js syncStatsOf（ui.js:138-176）条件补齐——**声明式渲染，禁止 memo 依赖 piece 对象身份**（铁律：deps 用原始值）。

- [ ] **Step 5: 验证**

Run: `npm run typecheck && npm test`
Dev 手测：选子高亮移动/攻击/治疗格；移动扣 ap；攻击掉血飘数字前的即时刷新豁免为链尾（此时无动画，bump 即刻发生属预期）；大肉比两段式；技能按钮发动钩拉（二段选拉落点浮层）、献祭炮（二段选列）、路障、神行、BUFF怪。**重点回归**：冲锋怪部署询问浮层的取消路径。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): 行动阶段交互——指令解析、详情面板、技能框、棋子状态外观"
```

---

### Task 8: FX 核心 —— 命令式内核平移与受控提交整合

**Files:**
- Create: `src/ui/toastBus.ts`、完善 `src/ui/fx/fx.ts`
- Modify: `interactionStore.ts`（act 接真 playChain）、`App.tsx`（initFx 装配 + ToastHost 挂载）
- Create: `src/ui/components/ToastHost.tsx`（配 .module.css）

**Interfaces:**
- Produces:

```ts
// fx.ts
export interface FxCtx {
  hosts: { boardOuter: HTMLElement; fxLayer: HTMLElement; banner: HTMLElement };
  registry: typeof pieceRegistry;
  getGame: () => Game;
  onWin: (winner: number) => void;
  onSyncPoint: () => Promise<void>;   // deploy 受控提交（bump + 双 rAF）
}
export function initFx(ctx: FxCtx): void;
export function setMetrics(m: Metrics): void;
export async function playChain(g: Game): Promise<void>;   // act 调用的播放入口
export async function banner(text: string, cls: string): Promise<void>;
export function shake(): void;
```

- [ ] **Step 1: 实现 toastBus + ToastHost**

```ts
// toastBus.ts —— 模块级发射器，ToastHost 订阅渲染，2.6s 自动消失（v1 codex.js toast 语义）
export function toast(msg: string, warn = false): void;
```

- [ ] **Step 2: 平移 fx.ts 内核**

自 `src/js/fx.js` 逐 case 平移 `playOne` 全部分支（flyNum/lunge/projectile/projectileTo/hitRing/boomAt/spellIcon/banner/shake 原语原样），按下表执行**结构性改动**（§7.2 挂点清单的落地）：

| v1 引用 | v2 实现 |
|---|---|
| `UI.pieceEl(uid)` | `ctx.registry.get(uid)` |
| `UI.movePieceTo`（move/hook case） | registry.get 后直写 el.style.left/top（geometry.posOf 公式） |
| `UI.syncPieces()`（deploy case） | **替换为** `await ctx.onSyncPoint()`（受控提交物化新节点，双 rAF 确保注册表就绪） |
| `el.remove()` + `UI.syncPieces()`（death case） | **删除二者**：保留 boomAt + dying 类 + sleep(480)；节点由 React 链尾卸载（`.dying` 终态 opacity:0，无跳变） |
| `refreshTop()`（turn case） | 删除（链尾刷新，豁免表第 2 条） |
| `UI.syncStatFlash`（attack case） | 删除（豁免表第 1 条） |
| `UI.refreshAll()`（charm case） | 删除（豁免表第 3 条） |
| `showWinMask`（win case） | fx 在 win case 中**先自行播胜利横幅** `banner(\`${PNAME[e.winner]}胜利！\`, 'bwin')`（对齐 v1 main.js:22 行为），再调 `ctx.onWin(e.winner)` 由 React 挂 WinMask——横幅归 FX、遮罩归 React，无第二通道 |
| `API.state()` | `ctx.getGame().state` |
| `document.getElementById('board-outer'/'fxlayer'/'banner')` | `ctx.hosts.*` |
| `H/W/getDef/nearestDist/PNAME/EV` | 具名 import / `g.events` |

`playChain` 游标逻辑平移（含 `evCursor > events.length → 0` 的 undo 防御）。

- [ ] **Step 3: act 接入真 playChain**

interactionStore.act 中 `await playChain(g)` 替换空壳；undo 路径（ActionBar）在 `g.undo()` 后同样 `bumpVersion()`（events 已被清空，游标防御兜底）。

- [ ] **Step 4: App 装配 initFx**

BoardArea 挂载后将三个宿主元素经 ref 上报 App，App useEffect 中 `initFx({ hosts, registry, getGame, onWin, onSyncPoint })`；`onWin` 写入 App state `winner` → 渲染 WinMask（遮罩本体 Task 9，先 console 占位）。`onSyncPoint`：

```ts
const onSyncPoint = async () => {
  bumpVersion();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
};
```

- [ ] **Step 5: CSS 第四批摘薄与 FX 类豁免确认**

`.fly-num/.slash/.bolt/.ring/.boom/.spell-cast/#banner/@keyframes(floatUp…bannerSweep)/body.shake` **留在 global.css**（FX 特区样式，类名为 fx 硬编码字符串，哈希化即失效）；确认 Task 5 已将 `.piece.dying/.piece.hit-jolt/.piece.pop-in` 及 dieAnim/jolt/popIn keyframes 留在 global（M1 修复点，本步骤复核缺一即补回）；`#toast/.toast-item`（style.css:561-575 含 toastOut keyframes）入 ToastHost.module.css。

- [ ] **Step 5b: toast 占位回收 + 欢迎语（v1 遗留承接）**

- interactionStore.act 与点击解析中的 `console.warn` 占位全部替换为真 `toast(msg, warn)`；
- App 挂载完成（首局 setGame 后）触发一次欢迎提示：`toast('欢迎来到「浩劫」！首次游玩建议先读一读 📐 规则 哦～')`（对齐 v1 main.js boot 的行为）。

- [ ] **Step 6: 验证**

Run: `npm run typecheck && npm test`
Dev 手测全链路动画：移动滑行 340ms、近战冲刺+斩击线、远程弹道、伤害/治疗飘字、暴击震屏、死亡爆散+渐隐、墓地 deploy 及时物化（跑得快送死场景）、钩拉弹道、爆弹四格爆炸、金身/名刀/倒戈特效、回合横幅。**专项**：连续快速点击不得穿插动画（busy 锁）；动画结束前棋盘不闪变（version 未 bump）。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): FX 命令式内核平移——受控提交/死亡所有权移交/onWin 单通道"
```

---

### Task 9: 外围组件 —— 胜负、图鉴、日志、快捷键

**Files:**
- Create: `src/ui/components/{CodexModal,WinMask,LogPanel}.tsx`（配 .module.css）
- Modify: `App.tsx`（modal/winner 状态与键盘绑定）、`ActionBar.tsx`（接 modal 开关）、`SidePanel`（装 LogPanel）
- Modify: `global.css` 最后一批摘薄（`#modal*/.cx-*/.rules-doc/#winmask/#log*` 区段 style.css:462-558；`.l-impt/.l-p1/.l-p2` 日志色随 LogPanel）

**Interfaces:**
- Produces: 与 v1 完全对齐的外围体验；`global.css` 达成最终形态，**完整清单**——`:root` token 与 body 背景/字体基础样式、`#app/#layout/#boardwrap/#board-outer/#board/.cell` 网格全家族（含高亮与基地类）、fx 命令式类（`.piece.dying/.hit-jolt/.pop-in` 及 `.fly-num/.slash/.bolt/.ring/.boom/.spell-cast`）、全部共享 keyframes、`.btn/.btn-primary/.btn-danger` 按钮基类、`body.shake`、`@media` 响应式断点；除此之外一切类名均已 module 化

- [ ] **Step 1: CodexModal**

`openModal/closeModal/switchTab` 状态化为 App state `{ tab: 'codex'|'rules'|null }`；renderCodex（codex.js:19-59）与 renderRulesDoc（61-113）平移为 JSX——HTML 字符串改 JSX 语法（class→className、内联 `<b>/<ul>/<li>` 保留、`String(def.id).padStart(2,'0')` 照搬），衍生单位卡 [-1,-2,-3,33] 照搬。点遮罩关闭、Esc 关闭（并入快捷键 effect）。

- [ ] **Step 2: WinMask**

main.js showWinMask 平移：`{PNAME[winner]}获胜！` w1/w2 配色、副标题、「⟳ 再来一局」（**不 reload**：调用 Task 5 Step 3 的 **`restart` prop**——seq 重建通道，见 M4 裁定）、「🔍 复盘战场」（隐藏遮罩查看终局盘面）。由 Task 8 的 onWin 状态驱动显示。按钮复用 global.css 的 `.btn/.btn-primary` 基类。

- [ ] **Step 3: LogPanel**

renderLog 平移（tail 70 条、cls 映射、自动滚底 `scrollTop = scrollHeight` 于 useEffect [tick]）。

- [ ] **Step 4: 快捷键与右键**

main.js bindTopButtons 的 keydown/contextmenu effect 平移：Esc（关 modal → 取消 cancelable choice → resetSelection 三级）、U 悔棋、E 结束回合、右键取消 choice/resetSelection（preventDefault）。

- [ ] **Step 5: 验证**

Run: `npm run typecheck && npm test`
Dev 手测：图鉴 30 张卡（26+4 衍生）、规则书全文、胜负触发遮罩→再来一局开新局（URL 不变）、复盘战场、日志滚底、全部快捷键。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): 外围组件——图鉴/规则书/胜利遮罩/战报/快捷键，global.css 定稿"
```

---

### Task 10: 收尾 —— 删旧、e2e 入库、README、最终回归

**Files:**
- Delete: `src/js/`（13 文件）、`src/css/`、`src/template.html`、`build.js`、`test/smoke.js`（连同空的 `test/` 目录）
- Create: `tests/e2e/smoke.e2e.mjs`
- Modify: `README.md`（重写）

**Interfaces:**
- Consumes: 前九个任务的全部成果
- Produces: 干净的仓库终态；`npm run build && node tests/e2e/smoke.e2e.mjs` 为发布前全链路验收命令

- [ ] **Step 1: 编写 e2e 脚本（完整给出）——先于 Step 2 的删除执行，行为关卡建立后才动旧代码**

原理：读取 `dist/index.html`，注入驱动脚本 → 写临时副本 `_e2e.tmp.html` → Edge headless `--dump-dom` 提取结果断言 → 删除临时文件。驱动脚本三条铁律（对应评审 B1a/b/c）：

1. 读**新世界钩子形状** `window.__HJ_DEBUG__.game`（Task 5 已挂载，getter 恒指向当前局）；
2. 选择器只用三类可寻址目标：global 类（`.cell.dep-ok/.atk-ok/.mv-ok`）、DOM id（`#hand/#btn-end/#optfloat`）、data-* 属性（`[data-card]/[data-store]/[data-discard]/.piece[data-uid]`）；
3. 流程必须**跨回合**：首回合部署的棋子 `justDeployed=true` 不能行动，因此顺序为「清空手牌 → 点结束回合 → 等下一行动方有可动棋子 → 选子攻击/移动」。冲锋询问等 option 浮层出现时点首个 `.of-btn` 通过。

```js
/** 发布前端到端冒烟：真实浏览器中完成 清手牌→跨回合→选子→攻击/移动 链路。 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const edge = EDGE_CANDIDATES.find(existsSync);
if (!edge) { console.error('未找到 msedge.exe'); process.exit(1); }

const DRIVER = `
<script>
(function () {
  const out = { deployed: false, advanced: false, selected: false,
                attacked: false, moved: false, error: '' };
  let finished = false;
  const done = () => {
    if (finished) return; finished = true;
    document.body.insertAdjacentHTML('beforeend',
      '<div id="e2e-result">' + JSON.stringify(out) + '</div>');
  };
  const $  = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms) => {
    const t0 = Date.now();
    while (!(cond())) {
      if (Date.now() - t0 > ms) return false;
      await wait(80);
    }
    return true;
  };
  const game = () => window.__HJ_DEBUG__ && window.__HJ_DEBUG__.game;
  const st   = () => game() && game().state;

  (async () => {
    if (!(await until(() => st() && st().phase === 'action', 20000))) throw new Error('开局超时');

    // ① 部署阶段：清空当前手牌（法术点储存；随从落 dep-ok 格；浮层点首项）
    for (let i = 0; i < 40; i++) {
      const s = st();
      if (s.phase !== 'deploy') break;
      if ($('#optfloat')) { click($('.of-btn')); await wait(200); continue; }
      const before = s.hand[s.curPlayer].length;
      const storeBtn = $('[data-store]');
      if (storeBtn) { click(storeBtn); }                 // 法术：储存无目标选择，必定成功
      else {
        const card = $('#hand [data-card]');
        if (!card) break;
        click(card);                                      // 进入部署模式
        if (!(await until(() => $('.cell.dep-ok') || $('[data-discard]'), 3000))) break;
        const cell = $('.cell.dep-ok');
        if (cell) { click(cell); out.deployed = true; }
        else { click($('[data-discard]')); }              // 无处部署 → 弃置
      }
      if (!(await until(() => st().phase !== 'deploy' ||
          st().hand[st().curPlayer].length < before, 5000)))
        throw new Error('手牌处理卡死');
    }
    if (st().phase === 'deploy') throw new Error('部署阶段未走完');

    // ② 结束回合 → 等任一方进入行动阶段且有「确定有动作可做」的棋子
    click($('#btn-end'));
    const hasActor = () => {
      const s = st(); if (!s || s.phase !== 'action') return false;
      return s.pieces.some((p) => p.owner === s.curPlayer && !p.justDeployed &&
        p.apLeft > 0 && p.defId !== -1 && p.defId !== 5 &&
        (game().rules.attackTargets(p).length ||
         game().rules.moveTargets(p).some((c) => c.x !== p.x || c.y !== p.y)));
    };
    for (let turnGuard = 0; turnGuard < 6 && !hasActor(); turnGuard++) {
      await until(() => st().phase === 'action', 15000);
      if (hasActor()) break;
      click($('#btn-end'));                               // 该方无人可动 → 再过一回合
    }
    if (!hasActor()) throw new Error('连续多回合无可行动棋子');
    out.advanced = true;

    // ③ 选定一枚「能攻击或有位移」的棋子，点击之
    const s = st();
    let mine = null, plan = null;
    for (const p of s.pieces.filter((q) => q.owner === s.curPlayer && !q.justDeployed &&
                                       q.apLeft > 0 && q.defId !== -1 && q.defId !== 5)) {
      if (game().rules.attackTargets(p).length) { mine = p; plan = 'attack'; break; }
      if (!mine && game().rules.moveTargets(p).some((c) => c.x !== p.x || c.y !== p.y)) {
        mine = p; plan = 'move';
      }
    }
    const el = $('.piece[data-uid="' + mine.uid + '"]');
    if (!el) throw new Error('找不到棋子 DOM uid=' + mine.uid);
    click(el);
    out.selected = true;
    if (!(await until(() => $('.atk-ok') || $('.mv-ok'), 5000))) throw new Error('选中后无高亮');

    if (plan === 'attack') {
      const tuid = game().rules.attackTargets(mine)[0].uid;
      const tEl = $('.piece[data-uid="' + tuid + '"]');
      if (tEl && $('.atk-ok')) { click(tEl); out.attacked = true; }
      else { const mv = $('.mv-ok'); if (mv) { click(mv); out.moved = true; } }
    } else {
      click($('.mv-ok'));
      out.moved = true;
    }
    await wait(2500);                                     // 等动画链与链尾提交
    done();
  })().catch((e) => { out.error = String((e && e.message) || e); done(); });
})();
</script>`;
```

主流程：读 `dist/index.html` → 把 DRIVER 注入 `</body>` 前 → 写 `dist/_e2e.tmp.html` → `execFileSync(edge, ['--headless=new','--disable-gpu','--virtual-time-budget=60000','--dump-dom', pathToFileURL(tmp).href])` → 正则 `<div id="e2e-result">(.*?)</div>` 提取 JSON → 断言 `parsed.error === '' && parsed.deployed && parsed.advanced && parsed.selected && (parsed.attacked || parsed.moved)`，失败时打印完整 out 对象辅助定位 → finally 删临时文件 → 失败退出码 1。

> 实施提示：若 headless 下动画时序导致偶发超时，优先调大 `--virtual-time-budget` 与各处等待上限，不得为绕过而改用直接调用 API 替代真实点击——本脚本的验收价值就在真实 DOM 链路。

- [ ] **Step 2: 删除旧世界**

```bash
git rm -r src/js src/css src/template.html build.js test
```

Run: `grep -rn "from '.*src/js" src tests --include="*.ts*" || echo clean` → Expected: clean（无残留引用）

- [ ] **Step 3: README 重写**

结构：项目简介 → 快速开始（`npm install / npm run dev / npm test / npm run build`）→ 产物说明（`dist/index.html` 双击可玩、GitHub Pages 就绪）→ 目录结构（对照本计划 File Structure）→ 架构要点（engine 零 DOM / Session 工厂 / 受控提交 / FX 特区）→ 快捷键表 → 设计规格与实施计划文档链接。

- [ ] **Step 4: 终极回归四连**

Run: `npm run typecheck` → PASS
Run: `npm test` → 全绿
Run: `npm run build` → verify OK
Run: `node tests/e2e/smoke.e2e.mjs` → deployed/selected/attacked 全 true
浏览器双击 `dist/index.html` 完整打一局（人工，覆盖部署/行动/技能/法术/悔棋/胜负/再来一局）。

- [ ] **Step 5: 对照规格 §6.4 豁免表复核**

逐条确认只有表列五处时序差异存在，无额外行为漂移；发现漂移立即修复或上报。

- [ ] **Step 6: Commit & 推送**

```bash
git add -A
git commit -m "chore: 删除拼接时代旧实现，e2e 入库，README 重写——迁移完成"
git push origin main
```

---

## Self-Review 记录

**第一轮自审**（成稿时）：

1. **规格覆盖**：§3 版本表→Task 1；§4 目录/铁律→File Structure + Global Constraints；§5.1 工厂/管线顺序/钩子删除→Task 3；§5.2 ctx 通道→Task 3 Step 2 + 裁定 R1/R2；§5.3 五函数改签名→Task 2 Step 4 表；§5.4 ChoiceSpec→Task 2 Step 2 + 裁定 R2；§6.1 memo 铁律→Global Constraints + Task 7 Step 4；§6.2 受控提交→Task 8 Step 2 表；§6.3 状态机→Task 6；§6.4 豁免→Task 8 Step 2 表 + Task 10 Step 6 复核；§6.5 __HJ_DEBUG__→gameStore.setGame 挂载（裁定 R6，Task 5）；§7.2 挂点清单→Task 8 Step 2 表；§8 组件→Task 5–9；§9 构建/verify→Task 1 + Task 10；§10 测试→Task 2/4/10；§11 错误处理→act try/catch（Task 6）+ verify（Task 1）；§12 施工序→Task 序列（R5 消除过渡期风险）；§13 决策表→裁定记录。
2. **占位符扫描**：机械平移类步骤均给出「源文件:行号区间 + 签名变更总表 + 代表性完整代码」，无 TBD/TODO；所有新增基础设施均为完整代码。
3. **类型一致性**：`Session/HandlerCtx/ChoiceSpec/ChoiceResult/Game/GameDeps/SkillInfo/Metrics` 各处交叉核对一致。

**第二轮修订**（吸收独立计划评审，结论「需重大修订」→ 已全部处置）：

| 编号 | 问题 | 处置 |
|---|---|---|
| B1a | `__HJ_DEBUG__` 无人生产且 driver 读旧形状 | 裁定 R6 + gameStore.setGame 挂载（Task 5 Step 1）；driver 改 `.game.state` |
| B1b | CSS Modules 哈希化击穿 driver 选择器 | Global Constraints 新增「选择器与类名可见性约定」四条；CSS 各批次摘薄范围重划；driver 选择器全部改用 global 类/id/data-* |
| B1c | driver 回合逻辑违反规则（同回合部署即攻击不可能） | 重写为跨回合流程（清手牌→endTurn→hasActor 判定→选子），含冲锋浮层应答与「必能行动」的候选筛选 |
| M1 | `.dying/.hit-jolt` 被 module 化致动画失效 | 归入 global.css（Task 5 Step 4 + Task 8 Step 5 双处确认） |
| M2 | summonOnce 触达不了闭包内 deployPiece | 裁定 R7：deployPiece/performAttack 携 ctx 上移 engine.ts，Interfaces 补登 |
| M3 | Task 3 循环论断错误/清单漏项/types.ts 未登记 | 循环说明如实化；Interfaces 补两签名；types.ts 入 Files+目录树；计数更正 |
| M4 | setGame(null) 不触发重建 | 裁定 R8：App seq 重建通道 + restart props 下发（Task 5/6/9 三处） |
| M5 | clsx 未安装、PieceView 引用作用域外 game | 去 clsx 改模板串；GameState 经 props 下传 |
| m1–m6, n1–n7 | 测试期望值/缺导入/API 替换表/bwin 属主/toast 回收/门禁说明/孤儿类等 | 全部按评审建议就地修复（Task 2/4/6/8/9 对应步骤及 Constraints） |
