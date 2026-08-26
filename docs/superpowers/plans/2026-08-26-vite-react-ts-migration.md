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
- **禁止任何函数值进入 GameState**（JSON 快照会静默丢函数）；组件禁止以 piece/state 对象身份作 memo/useMemo/deps 比较依据；choice 存 ref
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
  assert.equal(nearestDist(a, b), 5);            // |3-1|+|3-1|（big 左上格 (4,4) 最近为 (4,4)→距离5；右下 (5,5)→8；取最小 5）
});
```

- [ ] **Step 2: 实现 src/engine/state.ts（类型建模核心，完整给出）**

函数体自 `src/js/state.js` 平移，变化点：删除模块级 `S`/`EV`/`ENV`/`undoStack`（改由 Session 参数承载）；`newGame` 变纯函数（不再赋值 S，不再清 EV/undoStack——这些归 createGame）；`ev` 改为接收 Session；`effAtk` **迁出至 rules.ts**（裁定 R3）。

```ts
/* state.ts · 游戏状态类型 / 会话体 / 快照悔棋 */
import { getDef, type Cell } from './data.ts';

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
- Create: `src/engine/engine.ts`、`src/engine/abilities.ts`、`src/engine/spells.ts`、`src/engine/game.ts`

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
- `summonOnce` 签名 `(ctx, s, owner)`（其内部 choose 调用走 ctx）
- `performAttack` 引用（神行千里补刀用）改为从 `./game.ts` import —— 注意 game.ts 也 import abilities（SKILLS），形成 abilities↔game 循环导入。**解法**：把 `performAttack` 定义在 game.ts，abilities 顶部 `import { performAttack } from './game.ts'`；game.ts 顶部 `import { SKILLS } from './abilities.ts'`。ESM 循环引用在「顶层 const 表 + 运行期才调用的函数」场景安全（两者都在函数调用期才解引用），但为彻底避免初始化顺序坑，改为：**performAttack 移入 engine.ts**（它是攻击结算核心，语义上也属于 engine 层；game.ts 的 doAttack 调它）。采用后者，无循环。
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
| `drawCards/deployPiece/checkPhaseAdvance/startTurnInternal/endTurn/deployFollower/discardUnplaceable/storeHandSpell/castHandSpell/castStored/doMove/performAttack/doAttack/useSkill` | 全部成为闭包函数；`S`→`sess.state`、`snap()`→`snap(sess)`、`ev(...)`→`ev(sess,...)`；`deployPiece` 与 `useSkill` 增加 `ctx` 参与（冲锋询问/技能选择直达 `ctx.choose`）；`performAttack(sess, p, target)` 移至本文件或 engine.ts（见 Step 2 裁定），`useSkill`/`doAttack` 调用处带 ctx |
| `__HAOJIE_EXPORT__` 钩子 | **删除** |

`rejectChooser`（防静默错局的默认值）:

```ts
const rejectChooser: Chooser = (spec) =>
  Promise.reject(new Error(`未注入目标选择器却发起了 ${spec.kind} 选择——请通过 createGame(seed, { choose }) 注入`));
```

`return { ... }` 组装 Game 门面：`state: sess.state`（getter 语义用 `get state() { return sess.state; }`——undo 后对象会被整体替换，必须 getter！）、`events: sess.events`（同一引用，getter 同理 `get events() { return sess.events; }`）、方法逐个箭头绑定闭包、`rules` 七个便捷包装（`p => moveTargets(sess.state, p)` 等，`skillInfo: p => SKILLS[p.defId] ?? null`、`bigCharge: p => p.charge`）。

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

转换规则：旧 `await reset(); const S = API.state();` → `const g = await freshGame();`；`spawn(owner,…)` → `spawn(g, owner,…)`；`API.doX(...)` → `await g.doX(...)`；`API.rules.X(p)` → `g.rules.X(p)`；`ok(cond, name)` → `assert.ok(cond, name)`；`API.state().curPlayer = 1` → `g.state.curPlayer = 1`。**每个场景一个 `test('穿透阻挡', async () => {...})`，断言文案沿用旧名**。九场内容对照源 `test/smoke.js:71-224` 逐行搬运（穿透 4 断言、厚脸皮 2、名刀 3、投石机 4、策反 3、大肉比 4、直行侠 2、杀手 3、死吧金身 3）。

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

export function setGame(g: Game | null) { game = g; version++; notify(); }
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
function PieceView({ p, m }: { p: Piece; m: Metrics }) {
  const refCb = useCallback((el: HTMLDivElement | null) => {
    if (el) pieceRegistry.set(p.uid, el); else pieceRegistry.remove(p.uid);
  }, [p.uid]);
  const def = getDef(p.defId);
  const pos = posOf(p.x, p.y, !!p.big, m);
  return (
    <div ref={refCb}
         className={`${s.piece} own${p.owner}${p.big ? ' big5' : ''}`}
         data-uid={p.uid}
         style={{ left: pos.left, top: pos.top }}>
      <div className={s.face}>{def.emoji}</div>
      {p.defId >= 0 && <span className={`${s.stat} ${s.atk}`}>{effAtk(game.state, p)}</span>}
      <span className={clsx(s.stat, s.hp, p.hp <= p.maxHp * 0.35 && s.hurt)}>
        {Math.max(0, Math.round(p.hp))}
      </span>
    </div>
  );
}
```

（`effAtk` 从 `../engine/rules.ts` 具名导入——分层铁律第 2 条允许的只读具名导入；badges/apdots/状态类 Task 7 补全，此处先立骨架。）

- `TopBar`：refreshTop 平移（血条宽度百分比、回合数、行动方 active 类）。
- `FxLayer`：渲染 `<div id="fxlayer">` 与 `<div id="banner" className="hidden">`，`ref` 暴露给父级。
- `BoardArea`：组合三者；`useBoardMetrics` 测得 metrics 后同时 `FX.setMetrics`（本任务 fx 未接入则暂存 geometry 模块级变量，Task 8 initFx 后切换）。

- [ ] **Step 3: 重写 App.tsx（装载流程）**

```tsx
export default function App() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const autoChoose: Chooser = async (spec) => {   // 浏览器版选择器 Task 6 才接真实现
          if (spec.kind === 'none') return null;
          return null;                                   // 占位：Task 6 替换为 ask
        };
        const g = await createGame((Math.random() * 0xffffffff) >>> 0, { choose: autoChoose });
        if (alive) setGame(g);
      } catch (e) { if (alive) setError(String(e)); }
    })();
    return () => { alive = false; };
  }, []);
  const loaded = useGame();
  if (error) return <div>加载失败：{error}</div>;
  if (!loaded) return <div>正在开局……</div>;
  return (
    <div id="app">
      <TopBar />
      <main id="layout">
        <BoardArea />
        <aside id="panel">{/* SidePanel 于 Task 6 起填充 */}</aside>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: CSS 摘薄第一批**

从 `global.css` 移除 `#topbar/.side/.basebar/.cell/.piece` 区段（style.css:46-258），分别落入 `TopBar.module.css`、`CellsGrid.module.css`、`Piece.module.css`（类名去前缀直接映射，`:global(#app)` 级布局留 global）。keyframes（popIn/jolt/shieldSpin/wobble/blink 等）**留在 global**（FX 与跨组件动画共用）。

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

App.tsx 的选择器占位替换为 `choose: ask`。

- [ ] **Step 2: 实现 highlights.ts（computeHighlights 纯函数平移）**

自 ui.js `computeHighlights`（ui.js:50-87）平移：输入 `{ game, ia }`（ia = InteractionState），输出 `{ dep: Set<string>, mv, atk, sk, heal, sel }`（key 为 `'x,y'`）。choice 优先 → deployCard → pieceSel 三级逻辑逐字保留。CellsGrid 消费它打高亮类。

- [ ] **Step 3: 实现点击解析（BoardArea 委托）**

`handleCellClick(x, y)` 与 `handlePieceClick(el)` 自 input.js `onCellClick/onPieceClick`（input.js:102-182）平移，两条铁律平移：**choice 分支先于 busy 检查**；已选中己方棋子时点敌方＝攻击、点残血友方＝治疗（onPieceClick 的攻击解析分支）。toast 提示（💤热身/⚡没行动点）本任务先 console 占位。

- [ ] **Step 4: 实现 SidePanel 五件**

- `PhaseHint`：renderPhaseHint 平移（choice.hint 优先 → deploy 文案 → action 文案）。
- `Hand`：renderHand 平移为 JSX——卡片 selected/awaiting 态、spell 卡 ⏳limit 徽标、释放/储存按钮（法术）、弃置按钮（无处部署的随从）、卡片本体点击切 deployCard。法术释放走 `runSpellCast`（input.js:253-272 平移：busy→getSpec→ask→castHandSpell→playChain→bump）。
- `Stored`：renderStored 平移（剩余期限徽标 + 释放按钮，同样走 runSpellCast）。
- `ActionBar`：结束回合（`act(g=>g.endTurn())`）、悔棋（`g.undo()` 成功后 bump+toast）、图鉴/规则按钮（本任务先空回调，Task 9 接 modal）、重开（`confirm()` + `setGame(null)` 触发 App 重建新局——不用 location.reload）。
- `OptionFloat`：kind==='option' 时浮层渲染 options 按钮 + cancelable 取消键，点击调 finishChoice。

- [ ] **Step 5: CSS 第二批摘薄**

`#panel/.panel-block/#phasehint/.card*/.mini-btn/#btns/.btn*` 区段（style.css:355-460）分入 `SidePanel/PhaseHint/Hand/Stored/ActionBar.module.css`；`#optfloat/.of-*`（578-601）入 `OptionFloat.module.css`。

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
| `showWinMask`（win case） | `ctx.onWin(e.winner)` |
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

- [ ] **Step 5: CSS 第四批摘薄**

`.fly-num/.slash/.bolt/.ring/.boom/.spell-cast/#banner/@keyframes(floatUp…bannerSweep)/body.shake` **留在 global.css**（FX 特区样式，类名为 fx 硬编码字符串）；`#toast/.toast-item`（561-574）入 ToastHost.module.css。

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
- Produces: 与 v1 完全对齐的外围体验；`global.css` 达成最终形态（仅剩 :root token、#app/#layout/#boardwrap/#board-outer/#board 网格、FX keyframes 与 body.shake、@media 响应式）

- [ ] **Step 1: CodexModal**

`openModal/closeModal/switchTab` 状态化为 App state `{ tab: 'codex'|'rules'|null }`；renderCodex（codex.js:19-59）与 renderRulesDoc（61-113）平移为 JSX——HTML 字符串改 JSX 语法（class→className、内联 `<b>/<ul>/<li>` 保留、`String(def.id).padStart(2,'0')` 照搬），衍生单位卡 [-1,-2,-3,33] 照搬。点遮罩关闭、Esc 关闭（并入快捷键 effect）。

- [ ] **Step 2: WinMask**

main.js showWinMask 平移：`{PNAME[winner]}获胜！` w1/w2 配色、副标题、「⟳ 再来一局」（**不 reload**：`setGame(null)` 让 App useEffect 重建新局）、「🔍 复盘战场」（隐藏遮罩查看终局盘面）。由 Task 8 的 onWin 状态驱动显示。

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

- [ ] **Step 1: 编写 e2e 脚本（完整给出）**

原理：读取 `dist/index.html`，注入驱动脚本（等 `__HJ_DEBUG__.game` 就绪 → 真实派发 click 完成「部署→选子→攻击」→ 把结果 JSON 写入 `#e2e-result` div）→ 写临时副本 `_e2e.tmp.html` → Edge headless `--dump-dom` 提取断言 → 删除临时文件。

```js
/** 发布前端到端冒烟：真实浏览器中完成 部署→选子→攻击 链路。 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const edge = EDGE_CANDIDATES.find(existsSync);
if (!edge) { console.error('未找到 msedge.exe'); process.exit(1); }

const DRIVER = `
<script>
(function drive() {
  const out = { deployed: false, selected: false, attacked: false, error: '' };
  const done = () => {
    document.body.insertAdjacentHTML('beforeend',
      '<div id="e2e-result">' + JSON.stringify(out) + '</div>');
  };
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const until = (cond, ms) => new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => cond() ? res() :
      (Date.now() - t0 > ms ? rej(new Error('timeout')) : null), 60);
  });
  (async () => {
    await until(() => window.__HJ_DEBUG__?.api?.state?.(), 15000);
    const { api } = window.__HJ_DEBUG__;
    await until(() => api.state().phase === 'action', 20000);
    // ① 部署：点第一张随从卡，再点第一个绿格
    const hand = document.querySelectorAll('#hand .card');
    for (const card of hand) {
      card.click();
      const cell = document.querySelector('.cell.dep-ok');
      if (cell) { click(cell); out.deployed = true; break; }
    }
    await until(() => api.state().phase === 'action' &&
      api.state().pieces.some((p) => p.owner === api.state().curPlayer &&
        !p.justDeployed && p.defId !== -1), 30000);
    // ② 选子：点第一枚可行动己方棋子
    const mine = api.state().pieces.find((p) => p.owner === api.state().curPlayer &&
      !p.justDeployed && p.apLeft > 0 && p.defId !== -1);
    click(document.querySelector('.piece[data-uid="' + mine.uid + '"]'));
    out.selected = true;
    await until(() => document.querySelector('.atk-ok, .mv-ok'), 5000);
    // ③ 攻击优先，否则移动
    const foe = [...document.querySelectorAll('.piece')].find((el) => {
      const q = api.state().pieces.find((z) => z.uid == el.dataset.uid);
      return q && q.owner !== api.state().curPlayer &&
        el.querySelector('.face') && !el.classList.contains('dying');
    });
    if (foe && document.querySelector('.atk-ok')) { click(foe); out.attacked = true; }
    else click(document.querySelector('.mv-ok'));
    await new Promise((r) => setTimeout(r, 2500)); // 等动画与链尾提交
    done();
  })().catch((e) => { out.error = String(e); done(); });
})();
</script>`;
```

主流程：读 `dist/index.html` → 把 DRIVER 注入 `</body>` 前 → 写 `dist/_e2e.tmp.html` → `execFileSync(edge, ['--headless=new','--disable-gpu','--virtual-time-budget=40000','--dump-dom', fileUrl])`（fileUrl 为 pathToFileURL）→ 正则 `<div id="e2e-result">(.*?)</div>` 提取 JSON → 断言 `deployed && selected && (attacked || moved)`（moved 由 mv-ok 点击隐含，输出对象补 `moved` 字段同 attacked 逻辑）→ finally 删临时文件 → 非 0 退出码于失败。

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

1. **规格覆盖**：§3 版本表→Task 1；§4 目录/铁律→File Structure + Global Constraints；§5.1 工厂/管线顺序/钩子删除→Task 3；§5.2 ctx 通道→Task 3 Step 2 + 裁定 R1/R2；§5.3 五函数改签名→Task 2 Step 4 表；§5.4 ChoiceSpec→Task 2 Step 2 + 裁定 R2；§6.1 memo 铁律→Global Constraints + Task 7 Step 4；§6.2 受控提交→Task 8 Step 2 表；§6.3 状态机→Task 6；§6.4 豁免→Task 8 Step 2 表 + Task 10 Step 5 复核；§6.5 __HJ_DEBUG__→e2e 依赖（Task 10）；§7.2 挂点清单→Task 8 Step 2 表（14 项全覆盖）；§8 组件→Task 5–9；§9 构建/verify→Task 1 + Task 10；§10 测试→Task 2/4/10；§11 错误处理→act try/catch（Task 6）+ verify（Task 1）；§12 施工序→Task 序列（R5 消除过渡期风险）；§13 决策表→裁定记录。
2. **占位符扫描**：机械平移类步骤均给出「源文件:行号区间 + 签名变更总表 + 代表性完整代码」，无 TBD/TODO；所有新增基础设施（store/registry/act/ask/initFx/e2e/verify/config）均为完整代码。
3. **类型一致性**：`Session/HandlerCtx/ChoiceSpec/ChoiceResult/Game/GameDeps/SkillInfo/Metrics` 在各 Task 的 Interfaces 与实现步骤间已交叉核对一致；`effAtk(st,p)`、`bladeN(st,p)` 等五函数签名在 Task 2 Step 4 表与 Task 5 PieceView 引用一致；`playChain(g)` 在 Task 6（空壳）与 Task 8（真身）签名一致。
