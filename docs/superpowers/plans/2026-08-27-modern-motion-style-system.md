# 「浩劫」现代动画与样式系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Motion 13.1.1 替换现有 timer-driven FX 与 React lifecycle CSS 动画，在不改变玩法和 GameEvent 时序的前提下减少生产源码，并保持单 HTML 交付。

**Architecture:** 保留 `playChain() → playOne()` 与现有 React/FX/CSS ownership。`fx.ts` 内只增加一个很小的 per-`initFx` run record 来集中 active controls、transient nodes 与 stale-run 隔离；piece root 继续负责 `left/top`/点击/persistent state，新增单层 `[data-piece-motion]` 只承载 temporary transform/opacity。React lifecycle/layout 直接使用 `motion/react`，不增加共享 animation framework。

**Tech Stack:** React 19.2.6、TypeScript 5.9.3 strict、Vite 8.0.13、Motion 13.1.1、CSS Modules、现有 Node tests + Edge headless E2E。

**Spec:** `docs/superpowers/specs/2026-08-27-modern-motion-style-system-design.md`

## Global Constraints

- `src/engine/**`、玩法数值、GameEvent schema 与 GameEvent 生成顺序不修改。
- `src/ui/fx/**` 保持零 React import；Motion 在这里仅通过 `animate()` 作为命令式执行器。
- `playChain()` 串行消费事件；不得并行 GameEvent。
- `busy` 继续阻止普通动作；choice 仍优先于 busy。restart 是例外控制操作，必须能取消当前 FX。
- deploy 仍先 `onSyncPoint()`，确认 root 与 `[data-piece-motion]` 已物化后再播 FX。
- death 仍由 `fx.ts` 播放并 await；`PiecesLayer` 不增加 death `AnimatePresence`，React 只在后续受控 commit 过滤 `p.dead`。
- piece root 继续是 `left/top + posOf()` 的位置 authority；不切换到 x/y transform 坐标系统。
- `pieceRegistry` 继续保存 root；temporary FX 通过 root 下的 `[data-piece-motion]` 句柄工作。
- 只新增 `motion@13.1.1` 一个运行时依赖；不引入 GSAP/Pixi/Tailwind/CSS-in-JS/新测试框架。
- 默认使用标准 `motion/react`；本计划不预先引入 `LazyMotion`。
- `vite-plugin-singlefile`、零外链、`file://` 可运行约束保持。
- 实施 PR 的 `src/**/*.ts|tsx|css` 总计必须 **deleted > added**；达不到时先删抽象/重复实现。
- 不为本次工作创建 `runtime.ts`、`session.ts`、`timings.ts` 或一文件一个 FX primitive；只有实际 diff 证明拆分能净减代码时才另行调整。

---

## File Map

**主要修改：**

- `package.json` / `package-lock.json`：固定 Motion 13.1.1。
- `src/main.tsx`：全局 `MotionConfig reducedMotion="user"`。
- `src/ui/fx/fx.ts`：per-run cancellation、Motion imperative FX、删除 timer/reflow plumbing。
- `src/App.tsx`：restart 调 `resetFx()`；FX effect cleanup；Modal/WinMask `AnimatePresence`。
- `src/ui/components/ActionBar.tsx`：restart 不再被普通 `busy` 锁禁用。
- `src/ui/components/PiecesLayer.tsx`：单层 `[data-piece-motion]` wrapper。
- `src/ui/components/Piece.module.css`：wrapper 结构；删除 root 的 left/top transition；persistent state 保留 CSS。
- `src/styles/global.css`：删除 Motion 接管的 FX/lifecycle keyframes，仅保留静态形状、棋盘状态动画和共享样式。
- `src/ui/components/CodexModal.tsx` / `.module.css`：Modal enter/exit。
- `src/ui/components/OptionFloat.tsx` / `.module.css`：choice 浮层 enter/exit。
- `src/ui/components/WinMask.tsx` / `.module.css`：遮罩 enter/exit；`winGlow` 留 CSS。
- `src/ui/components/ToastHost.tsx` / `.module.css`：toast lifetime 仍由 timer 控制，enter/exit 改 Motion。
- `src/ui/components/Hand.tsx`：手牌 layout/enter/exit；hover 继续作用于内层 card。
- `src/ui/components/Stored.tsx`：储存卡 layout/enter/exit；UI-only WeakMap 提供稳定 key。
- `tests/e2e/smoke.e2e.mjs`：去除 2500ms 猜测等待，新增 modal exit、motion handle、death ownership、restart cancellation、reduced-motion 覆盖。

**明确不改：** `src/engine/**`、`src/ui/fx/registry.ts`、`LogPanel`（除非实现时实测迁 Motion 能直接净减代码；本计划默认不改）。

---

### Task 1: 建立 Motion 依赖与基线

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/main.tsx`

**Interfaces:**
- Produces: `motion@13.1.1`；应用根部 `MotionConfig reducedMotion="user"`。
- Consumes: 无。

- [ ] **Step 1: 在实现分支记录干净基线**

Run:

```bash
npm ci
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
node --input-type=module -e "import {statSync} from 'node:fs'; console.log(statSync('dist/index.html').size)"
```

Expected: typecheck/test/build/e2e 全部 exit 0；最后一条输出 baseline `dist/index.html` bytes。把该数字保留到最终 PR 正文，不新增 metrics 文件。

- [ ] **Step 2: 安装唯一新运行时依赖**

Run:

```bash
npm install --save-exact motion@13.1.1
```

Expected `package.json` dependencies:

```json
{
  "motion": "13.1.1",
  "react": "19.2.6",
  "react-dom": "19.2.6"
}
```

- [ ] **Step 3: 在根部接入 reduced-motion 配置**

Modify `src/main.tsx` to:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App.tsx';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);
```

- [ ] **Step 4: 验证依赖和单文件构建**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: 全部 PASS；`npm run build` 的 `verify-singlefile.mjs` 继续通过。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/main.tsx
git commit -m "build: add Motion runtime"
```

---

### Task 2: 用最小 per-run lifecycle 迁移 transient FX

**Files:**
- Modify: `src/ui/fx/fx.ts`
- Modify: `src/App.tsx`
- Modify: `src/ui/components/ActionBar.tsx`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/smoke.e2e.mjs`

**Interfaces:**
- Produces: `resetFx(): void`；`initFx(c: FxCtx): void` 创建独立 run；`playChain(g)` 捕获当前 run 与传入 `g`。
- Produces inside `fx.ts`: `FxRun`, `track(run, controls)`, `background(run, controls)`, `addEl(run, ...)`, `dropEl(run, el)`；这些保持 module-private。
- Removes from `FxCtx`: `getGame`。
- Consumes: Task 1 的 `animate` from `motion`。

- [ ] **Step 1: 先把 restart-during-FX 写成会失败的 E2E**

在 `tests/e2e/smoke.e2e.mjs` 的 browser driver `out` 增加：

```js
restarted: false,
staleFxClean: false,
```

在现有一次真实攻击/移动完成并回到可操作状态后追加：

```js
const oldGame = game();
window.confirm = () => true;
click($('#btn-end'));
if (!(await until(() => {
  const b = $('#banner');
  return b && !b.classList.contains('hidden');
}, 3000))) throw new Error('未进入回合横幅 FX');

const restart = $('#btn-restart');
if (!restart || restart.disabled) throw new Error('restart 被 busy 锁死');
click(restart);
if (!(await until(() => game() && game() !== oldGame, 6000)))
  throw new Error('FX 中 restart 未创建新局');
out.restarted = true;

const newBanner = $('#banner');
newBanner.className = 'e2e-sentinel';
await wait(1200);
if (newBanner.className !== 'e2e-sentinel')
  throw new Error('旧 FX completion 写入了新局 banner');
newBanner.className = 'hidden';
if ($('#fxlayer').querySelector('.fly-num,.ring,.boom,.slash,.spell-cast,.bolt'))
  throw new Error('restart 后仍有旧 transient FX');
out.staleFxClean = true;
```

同时把最终 `ok` 条件加入 `parsed.restarted && parsed.staleFxClean`。

- [ ] **Step 2: 运行测试确认红灯**

Run:

```bash
npm run build
node tests/e2e/smoke.e2e.mjs
```

Expected: FAIL，至少命中 `restart 被 busy 锁死`（当前 `#btn-restart` 在 busy 时 disabled）。

- [ ] **Step 3: 让 restart 成为 busy 期间允许的控制操作**

在 `ActionBar.tsx` 中保留 confirm，但删除 restart 按钮的 `disabled={ia.busy}`：

```tsx
<button id="btn-restart" className="btn btn-danger" onClick={handleRestart}>⟳ 重开</button>
```

不要放宽 end/undo/棋盘普通动作的 busy 锁。

- [ ] **Step 4: 在 `fx.ts` 建立单文件 per-run lifecycle，并删除动态 `getGame`**

在 `fx.ts` 引入：

```ts
import { animate } from 'motion';

type FxControls = ReturnType<typeof animate>;
type FxRun = {
  ctx: FxCtx;
  alive: boolean;
  controls: Set<FxControls>;
  nodes: Set<HTMLElement>;
};

let currentRun: FxRun | null = null;
```

把 `FxCtx` 收窄为：

```ts
export interface FxCtx {
  hosts: { boardOuter: HTMLElement; fxLayer: HTMLElement; banner: HTMLElement };
  registry: typeof pieceRegistry;
  onWin: (winner: number) => void;
  onSyncPoint: () => Promise<void>;
}
```

实现 module-private tracking：

```ts
function requireRun(): FxRun {
  if (!currentRun) throw new Error('initFx 未装配——App 装配前不得调用特效');
  return currentRun;
}

function track(run: FxRun, controls: FxControls): FxControls {
  run.controls.add(controls);
  void controls.then(
    () => run.controls.delete(controls),
    () => run.controls.delete(controls),
  );
  return controls;
}

function background(run: FxRun, controls: FxControls): void {
  void track(run, controls).catch((err) => {
    if (run.alive) console.error('fx background error', err);
  });
}
```

实现 cleanup：

```ts
export function resetFx(): void {
  const run = currentRun;
  if (!run) return;
  run.alive = false;
  for (const controls of run.controls) controls.stop();
  run.controls.clear();
  for (const node of run.nodes) node.remove();
  run.nodes.clear();
  run.ctx.hosts.banner.className = 'hidden';
  document.body.classList.remove('shake');
  if (currentRun === run) currentRun = null;
}

export function initFx(c: FxCtx): void {
  resetFx();
  currentRun = { ctx: c, alive: true, controls: new Set(), nodes: new Set() };
  evCursor = 0;
}
```

`playChain(g)` 在入口捕获 run，并把 `g`、run 传给 `playOne`；正常 restart cancellation 不记 error：

```ts
export async function playChain(g: Game): Promise<void> {
  const run = requireRun();
  const events = g.events;
  if (evCursor > events.length) evCursor = 0;
  while (run.alive && evCursor < events.length) {
    const e = events[evCursor++];
    try {
      await playOne(run, g, e);
    } catch (err) {
      if (!run.alive) return;
      console.error('fx error', e, err);
    }
  }
}
```

从此以后不要在 `await` 后重新读取全局 `currentRun`；helper 使用传入的 `run.ctx`。

- [ ] **Step 5: 让 App 在 restart/effect cleanup 显式 reset FX**

Imports:

```ts
import { initFx, resetFx } from './ui/fx/fx.ts';
```

Restart 顺序：

```ts
const restart = useCallback(() => {
  resetFx();
  resetAll();
  setGame(null); setWinner(null); setSeq((n) => n + 1);
}, []);
```

FX effect 删除 `getGame` 注入，并返回 cleanup：

```ts
useEffect(() => {
  if (!hosts) return;
  initFx({
    hosts,
    registry: pieceRegistry,
    onWin,
    onSyncPoint: async () => {
      bumpVersion();
      await new Promise((r) => setTimeout(() => setTimeout(r, 0), 0));
    },
  });
  return resetFx;
}, [hosts, onWin]);
```

保留这里的双 `setTimeout(0)`：它是 React materialize sync point，不是 animation timer。

- [ ] **Step 6: 迁移 transient primitives，删除它们的 timer/keyframe ownership**

把 `addEl` 改成接收 run 并登记 node：

```ts
function addEl(run: FxRun, cls: string, styles: Record<string, string>, text?: string) {
  const el = document.createElement('div');
  el.className = cls;
  if (text != null) el.textContent = text;
  for (const k in styles) el.style.setProperty(k, styles[k]);
  run.ctx.hosts.fxLayer.appendChild(el);
  run.nodes.add(el);
  return el;
}

function dropEl(run: FxRun, el: HTMLElement): void {
  run.nodes.delete(el);
  el.remove();
}
```

迁移规则：

| Primitive | Motion 行为 | 是否阻塞 `playOne` |
|---|---|---|
| `flyNum` | opacity + y + scale，约 0.7s，结束 `dropEl` | 否 |
| `projectileTo` | left/top，沿用 140–420ms 距离时长 | 是 |
| `hitRing` ring | size/opacity，约 0.55s | 否 |
| `boomAt` | x/y/rotate/scale/opacity，约 0.7s | 否 |
| `spellIcon` | scale/rotate/y/opacity，约 0.75s | 是 |
| `banner` | opacity + scaleX，约 1.05s；win 调用仍 fire-and-forget | turn 阻塞；win 否 |
| `shake` | 直接 animate `boardOuter` x/y keyframes，约 0.38s | 否 |

非阻塞 transient 使用这一模式，不再 `setTimeout(remove)`：

```ts
const el = addEl(run, 'ring', styles);
void track(run, animate(el, keyframes, options))
  .catch((err) => { if (run.alive) console.error('fx background error', err); })
  .finally(() => dropEl(run, el));
```

CSS 中只保留这些元素的 static shape。为避免 static centering 与 Motion transform 抢 `transform`，把 `.fly-num/.bolt/.ring/.boom/.spell-cast` 的居中改为现代独立属性：

```css
translate: -50% -50%;
```

`#banner` 同理使用：

```css
translate: -50% 0;
```

然后删除对应 `floatUp/ringGrow/boomFly/spellPop/bannerSweep/shakeIt` keyframes 与 `animation:` 声明。`slashGo`、piece `popIn/dieAnim/jolt` 留到 Task 3。

- [ ] **Step 7: 验证 Task 2**

Run:

```bash
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
```

Expected: 全部 PASS；restart 可在 banner FX 中执行；无 unhandled rejection；新局 sentinel banner 不被旧 run 改写。

- [ ] **Step 8: Commit**

```bash
git add src/ui/fx/fx.ts src/App.tsx src/ui/components/ActionBar.tsx src/styles/global.css tests/e2e/smoke.e2e.mjs
git commit -m "refactor: move transient FX to Motion"
```

---

### Task 3: 分离 piece root/motion handle 并迁移 piece FX

**Files:**
- Modify: `src/ui/components/PiecesLayer.tsx`
- Modify: `src/ui/components/Piece.module.css`
- Modify: `src/ui/fx/fx.ts`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/smoke.e2e.mjs`

**Interfaces:**
- `pieceRegistry.get(uid)` 继续返回 root。
- New module-private helper in `fx.ts`: `pieceMotion(run, uid): HTMLElement | null`。
- `movePieceTo(run, g, uid, x, y): Promise<void>` 动画 root 的 `left/top`。
- temporary `lunge/hit/deploy/death` 只写 `[data-piece-motion]`。

- [ ] **Step 1: 先给 E2E 加 motion-handle 与 death ownership 断言**

在 Task 2 restart 后的新局里，driver 直接利用现有只读 debug `game` 建立确定性 death 场景，不修改 engine 源码：

```js
const g2 = game();
const s2 = g2.state;
s2.phase = 'action';
const attacker = s2.pieces.find((p) => p.owner === s2.curPlayer && p.defId === -1);
const victim = s2.pieces.find((p) => p.owner !== s2.curPlayer && p.defId === -1);
attacker.justDeployed = false;
attacker.apLeft = 1;
attacker.range = 99;
attacker.atk = 999;
victim.hp = 1;

const attackerRoot = $('.piece[data-uid="' + attacker.uid + '"]');
const victimRoot = $('.piece[data-uid="' + victim.uid + '"]');
if (!attackerRoot?.querySelector('[data-piece-motion]') ||
    !victimRoot?.querySelector('[data-piece-motion]'))
  throw new Error('piece motion handle 缺失');

click(attackerRoot);
if (!(await until(() => $('.atk-ok'), 2000))) throw new Error('确定性 death 场景无法攻击');
click(victimRoot);
if (!(await until(() => {
  const node = victimRoot.querySelector('[data-piece-motion]');
  return node && (node.style.opacity || node.style.transform);
}, 4000))) throw new Error('death FX 未落在 motion node');
if (!victimRoot.isConnected) throw new Error('death FX 完成前 React 已卸载 root');
if (!(await until(() => !document.querySelector('.piece[data-uid="' + victim.uid + '"]'), 5000)))
  throw new Error('death FX 完成后 React 未卸载 root');
```

给 `out` 增加 `motionHandle` / `deathOwned` 并加入最终 `ok`。

- [ ] **Step 2: 运行确认测试红灯**

Run:

```bash
npm run build
node tests/e2e/smoke.e2e.mjs
```

Expected: FAIL with `piece motion handle 缺失`。

- [ ] **Step 3: PiecesLayer 只增加一层 wrapper；registry 仍绑 root**

删除 base 的永久 `'pop-in'` class 特判，并把全部视觉 children 包入 inner node：

```tsx
<div ref={refCb}
     className={cls}
     data-uid={p.uid}
     style={{ left: pos.left, top: pos.top }}>
  <div className={s.motionBody} data-piece-motion>
    <div className={s.face}>{def.emoji}</div>
    {p.defId >= 0 && <span className={`${s.stat} ${s.atk}`}>{effAtk(st, p)}</span>}
    <span className={`${s.stat} ${s.hp}${p.hp <= p.maxHp * 0.35 ? ` ${s.hurt}` : ''}`}>
      {Math.max(0, Math.round(p.hp))}
    </span>
    {badges.length > 0 && <div className={s.badges}>{badges.join('')}</div>}
    {showAp && <div className={s.apdots}>{/* existing ap dots unchanged */}</div>}
  </div>
</div>
```

不要修改 `registry.ts`。

- [ ] **Step 4: Piece CSS 分离 position/persistent 与 temporary transform**

在 `Piece.module.css`：

```css
.piece {
  /* existing position/size/persistent styles */
  transition: transform .18s, opacity .3s, filter .3s;
  will-change: left, top;
}
.motionBody {
  position: absolute;
  inset: 0;
  border-radius: inherit;
}
```

删除 root 的 `left .32s` / `top .32s` transition；selected/exhausted/shield/charm 等 persistent class 继续作用 root 或其 descendants，不迁成 JS。

- [ ] **Step 5: `fx.ts` 用短 helper 获取 temporary handle**

```ts
function pieceMotion(run: FxRun, uid: number): HTMLElement | null {
  return run.ctx.registry.get(uid)?.querySelector<HTMLElement>('[data-piece-motion]') ?? null;
}
```

Geometry 继续从 root `getBoundingClientRect()` 读取；只有 temporary transform/opacity/filter 写 inner。

- [ ] **Step 6: 迁移 move/hook/lunge/hit/deploy/death**

`movePieceTo` 改为阻塞 Motion left/top，Game 明确作为参数传入：

```ts
async function movePieceTo(run: FxRun, g: Game, uid: number, x: number, y: number) {
  const p = g.state.pieces.find((q) => q.uid === uid);
  const root = run.ctx.registry.get(uid);
  if (!p || !root) return;
  const pos = posOf(x, y, !!p.big, M);
  await track(run, animate(root, { left: pos.left, top: pos.top }, {
    duration: prefersReducedMotion() ? .08 : .32,
    ease: [.34, 1.3, .5, 1],
  }));
}
```

`lunge`：root 只用于 attacker/target rect 与临时 `zIndex`；inner motion node 执行向目标的 x/y/scale 和回位。用 `try/finally` 清 root `zIndex`。

`hitRing`：jolt 改成 inner 的非阻塞 Motion keyframes；ring 仍是 Task 2 的 transient Motion。

`deploy`：

```ts
await run.ctx.onSyncPoint();
if (!run.alive) return;
const body = pieceMotion(run, e.uid);
if (body) background(run, animate(body, {
  scale: [.15, 1], y: [-14, 0], opacity: [0, 1],
}, { duration: .42, ease: [.34, 1.56, .64, 1] }));
```

`death`：boom 仍非阻塞；inner death Motion 必须 await；不让 React exit 接管：

```ts
const body = pieceMotion(run, e.uid);
if (body) {
  await track(run, animate(body, {
    scale: [1, .2], rotate: [0, 80], opacity: [1, 0],
    filter: ['brightness(2)', 'brightness(3) blur(2px)'],
  }, { duration: prefersReducedMotion() ? .08 : .48, ease: 'easeIn' }));
}
```

`hook` 在 projectile 后直接 `await movePieceTo(...)`；普通 move 直接 await，不再 `sleep(340)`。

`slash` 迁成 transient Motion 后删除 `slashGo` CSS keyframe和 cleanup timer。

- [ ] **Step 7: 删除失去 owner 的 piece FX CSS**

从 `global.css` 删除：

```text
.piece.pop-in / @keyframes popIn
.piece.dying / @keyframes dieAnim
.piece.hit-jolt / @keyframes jolt
@keyframes slashGo
```

`.slash` 只保留 static shape；Motion 负责 scale/opacity/rotation。

- [ ] **Step 8: 验证 Task 3**

Run:

```bash
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
```

Expected: E2E 能找到每个 piece 的 inner motion handle；death 动画期间 root 存在，完成后 root 被 React 过滤卸载；无 `PiecesLayer AnimatePresence`。

- [ ] **Step 9: Commit**

```bash
git add src/ui/components/PiecesLayer.tsx src/ui/components/Piece.module.css src/ui/fx/fx.ts src/styles/global.css tests/e2e/smoke.e2e.mjs
git commit -m "refactor: move piece FX to Motion"
```

---

### Task 4: 迁移明确受益的 React lifecycle/layout 动画

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/ui/components/CodexModal.tsx`
- Modify: `src/ui/components/CodexModal.module.css`
- Modify: `src/ui/components/OptionFloat.tsx`
- Modify: `src/ui/components/OptionFloat.module.css`
- Modify: `src/ui/components/WinMask.tsx`
- Modify: `src/ui/components/WinMask.module.css`
- Modify: `src/ui/components/ToastHost.tsx`
- Modify: `src/ui/components/ToastHost.module.css`
- Modify: `src/ui/components/Hand.tsx`
- Modify: `src/ui/components/Stored.tsx`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/smoke.e2e.mjs`

**Interfaces:**
- `App` owns `AnimatePresence` for components whose entire component mounts/unmounts (`CodexModal`, `WinMask`).
- `OptionFloat`/`ToastHost` own their local `AnimatePresence` because their components remain mounted while children appear/disappear.
- Hand/Stored use an outer Motion layout wrapper so existing `.card:hover { transform: ... }` stays on a different DOM node.
- PiecesLayer remains outside React exit animation.

- [ ] **Step 1: 先写 Modal exit 红灯**

在 smoke driver 开局后加入：

```js
click($('#btn-codex'));
if (!(await until(() => $('#modal'), 1500))) throw new Error('图鉴未打开');
click($('#modal-close'));
if (!$('#modal')) throw new Error('Modal 没有 exit 生命周期，立即卸载');
if (!(await until(() => !$('#modal'), 1500))) throw new Error('Modal exit 后未卸载');
out.modalExit = true;
```

把 `modalExit` 加入 `out` 和最终 `ok`。

- [ ] **Step 2: 运行确认红灯**

Run:

```bash
npm run build
node tests/e2e/smoke.e2e.mjs
```

Expected: FAIL with `Modal 没有 exit 生命周期，立即卸载`。

- [ ] **Step 3: App 用 AnimatePresence 包住 modal/win 条件节点**

Import:

```ts
import { AnimatePresence } from 'motion/react';
```

Render:

```tsx
<AnimatePresence>
  {modalTab && <CodexModal key="modal" tab={modalTab} onClose={closeModal} onSwitchTab={openModal} />}
</AnimatePresence>
<AnimatePresence>
  {winner != null && <WinMask key="win" winner={winner} restart={restart} onReview={review} />}
</AnimatePresence>
```

不要包 `PiecesLayer`。

- [ ] **Step 4: CodexModal 与 WinMask 把 lifecycle 从 CSS 移到 Motion**

CodexModal root/card 改为 `motion.div`，保留所有 ids：

```tsx
<motion.div id="modal"
  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
  transition={{ duration: .2 }}
  onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <motion.div id="modal-card"
    initial={{ opacity: 0, y: 26, scale: .97 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: 16, scale: .98 }}
    transition={{ duration: .28, ease: [.2, .9, .3, 1.1] }}>
    {/* existing content */}
  </motion.div>
</motion.div>
```

WinMask root 改为 `motion.div`，只迁 overlay enter/exit；`#win-text` 的 `winGlow` 继续 CSS。

删除 Codex/WinMask 对应 lifecycle `animation:` 与 duplicated `fadeIn/modalUp` keyframes。`global.css` 删除已经无人使用的 global `fadeIn/modalUp`；若 `winGlow` 只剩 WinMask.module 的本地引用，也删除 global duplicate，保留 module 本地定义。

- [ ] **Step 5: OptionFloat 在组件内部使用 AnimatePresence**

组件不再 early-return whole component；让 `AnimatePresence` 看到 option child 的退出：

```tsx
return (
  <AnimatePresence>
    {spec?.kind === 'option' && (
      <motion.div id="optfloat" key="option-float"
        initial={{ opacity: 0, y: 20, scale: .97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: .98 }}
        transition={{ duration: .22, ease: [.2, .9, .3, 1.15] }}>
        {/* existing buttons */}
      </motion.div>
    )}
  </AnimatePresence>
);
```

`OptionFloat.module.css` 根定位从 `transform: translate(-50%, -50%)` 改为独立：

```css
translate: -50% -50%;
```

删除 `modalUp` animation/keyframe，避免与 Motion transform 同 owner。

- [ ] **Step 6: Toast 保留 2600ms 数据 lifetime，只迁 DOM enter/exit**

`ToastHost.tsx` import `AnimatePresence, motion`。保留现有 `setTimeout(..., 2600)`；map 改为：

```tsx
<AnimatePresence initial={false}>
  {items.map((t) => (
    <motion.div key={t.id}
      className={`${s.item}${t.warn ? ` ${s.warn}` : ''}`}
      initial={{ opacity: 0, y: 14, scale: .9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: .25 }}>
      {t.msg}
    </motion.div>
  ))}
</AnimatePresence>
```

从 CSS 删除 `toastIn/toastOut` 与 `.item` 的 animation 声明。

- [ ] **Step 7: Hand 用 Motion outer wrapper 做 layout，内层 card 继续 CSS hover**

Import:

```ts
import { AnimatePresence, motion } from 'motion/react';
```

保留现有 `.card` div 内容和 `data-card/data-idx` 在内层；只在外面包：

```tsx
<AnimatePresence initial={false}>
  {cards.map((card, idx) => (
    <motion.div key={card.uid} layout="position"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className={cls} data-card={idx} data-idx={idx} onClick={() => handleCardClick(idx)}>
        {/* existing card body */}
      </div>
    </motion.div>
  ))}
</AnimatePresence>
```

不要把 `.card:hover` 改 `whileHover`；layout transform 与 hover transform 位于不同节点。

- [ ] **Step 8: Stored 用 UI-only WeakMap 给 Motion wrapper 稳定 identity**

不要修改 `StoredCard`/engine schema。在 `Stored.tsx` module scope：

```ts
const storedKeys = new WeakMap<object, number>();
let nextStoredKey = 1;
function storedKey(card: object): number {
  let key = storedKeys.get(card);
  if (key == null) {
    key = nextStoredKey++;
    storedKeys.set(card, key);
  }
  return key;
}
```

普通 engine mutation 会保留 StoredCard object identity；undo 替换对象时允许重新 enter。map 使用：

```tsx
<AnimatePresence initial={false}>
  {arr.map((card, idx) => (
    <motion.div key={storedKey(card)} layout="position"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className={`${hand.card} ${hand.spellCard}`} data-card={idx}>
        {/* existing body */}
      </div>
    </motion.div>
  ))}
</AnimatePresence>
```

- [ ] **Step 9: 验证 Task 4**

Run:

```bash
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
```

Expected: Modal close 后短暂保留用于 exit，随后卸载；E2E 其它稳定 selectors 不变。

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx src/ui/components/CodexModal.tsx src/ui/components/CodexModal.module.css src/ui/components/OptionFloat.tsx src/ui/components/OptionFloat.module.css src/ui/components/WinMask.tsx src/ui/components/WinMask.module.css src/ui/components/ToastHost.tsx src/ui/components/ToastHost.module.css src/ui/components/Hand.tsx src/ui/components/Stored.tsx src/styles/global.css tests/e2e/smoke.e2e.mjs
git commit -m "refactor: move UI lifecycle animation to Motion"
```

---

### Task 5: 完成 reduced-motion 与 CSS 清理

**Files:**
- Modify: `src/ui/fx/fx.ts`
- Modify: `src/ui/components/Piece.module.css`
- Modify: `src/ui/components/Hand.module.css`
- Modify: `src/ui/components/WinMask.module.css`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/smoke.e2e.mjs`

**Interfaces:**
- New module-private `prefersReducedMotion(): boolean` in `fx.ts`。
- E2E supports CLI `--reduced-motion`, translated to Edge `--force-prefers-reduced-motion`。

- [ ] **Step 1: 先让 E2E 能在 reduced-motion 浏览器条件运行**

Node side：

```js
const reducedMotion = process.argv.includes('--reduced-motion');
```

Edge args 中加入：

```js
...(reducedMotion ? ['--force-prefers-reduced-motion'] : []),
```

Driver `out` 增加：

```js
reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
```

Node final assertion在 `--reduced-motion` 时要求 `parsed.reducedMotion === true`。

- [ ] **Step 2: 运行 reduced case，确认当前命令可正确模拟媒体偏好**

Run:

```bash
npm run build
node tests/e2e/smoke.e2e.mjs --reduced-motion
```

Expected before imperative reduced tuning: E2E 可以运行且 `parsed.reducedMotion` 为 true；如果动画仍完整运行，本步骤不以时长作为失败条件。

- [ ] **Step 3: imperative FX 只调整参数，不分叉业务流程**

在 `fx.ts`：

```ts
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
```

规则：

- move/projectile/death/lunge 等仍走同一 `playOne` 分支和同一 await 点；reduced duration 收敛到约 0.05–0.08s。
- `shake` 在 reduced mode 直接 return，因为状态信息不依赖 shake。
- flyNum/ring/boom 等 decoration 可缩短并减少位移/旋转，但仍按同一 helper 创建/cleanup。
- 不新增 `if (reduced) playReducedEvent(...) else playNormalEvent(...)` 第二套事件流程。

- [ ] **Step 4: persistent CSS motion 在 reduced mode 降级为静态状态**

`Piece.module.css`：

```css
@media (prefers-reduced-motion: reduce) {
  .shielded .face, .marked::after, .charmed::before { animation: none; }
}
```

`Hand.module.css`：

```css
@media (prefers-reduced-motion: reduce) {
  .selected, .awaiting { animation: none; }
}
```

`WinMask.module.css`：

```css
@media (prefers-reduced-motion: reduce) {
  :global(#win-text) { animation: none; }
}
```

`global.css` 对 deploy/attack/skill/heal cell pulses 增加同类 media override，保留边框/背景颜色作为状态提示。

- [ ] **Step 5: 删除已经确认无引用的 global duplicate keyframes**

在代码搜索确认后删除仅 module 本地仍定义/引用的 global duplicates（当前候选包括 `shieldSpin`、`wobble`、`winGlow`）。

Run before delete:

```bash
git grep -n "shieldSpin\|wobble\|winGlow\|fadeIn\|modalUp" -- src
```

Expected: 每个被删除的 global keyframe 都仍有 module-local owner 或已经完全无引用；不得产生悬空 animation name。

- [ ] **Step 6: 两种 motion preference 都跑完整 E2E**

Run:

```bash
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
node tests/e2e/smoke.e2e.mjs --reduced-motion
```

Expected: 全部 PASS；两种模式都无死锁、无 stale FX、death ownership 一致。

- [ ] **Step 7: Commit**

```bash
git add src/ui/fx/fx.ts src/ui/components/Piece.module.css src/ui/components/Hand.module.css src/ui/components/WinMask.module.css src/styles/global.css tests/e2e/smoke.e2e.mjs
git commit -m "feat: respect reduced motion preference"
```

---

### Task 6: 最终删冗余、LOC/bundle Gate 与 PR 证据

**Files:**
- Modify only files already touched above if verification finds stale comments/dead code.
- No new production abstraction files.

**Interfaces:**
- Produces: verified implementation branch ready for review。
- Consumes: all prior tasks。

- [ ] **Step 1: 搜索禁止残留的 animation plumbing**

Run:

```bash
git grep -n "offsetWidth\|style.transition\|hit-jolt\|dying\|pop-in" -- src/ui/fx src/styles src/ui/components
git grep -n "sleep(" -- src/ui/fx/fx.ts
git grep -n "setTimeout" -- src/ui/fx/fx.ts src/App.tsx src/ui/components/ToastHost.tsx
```

Expected:

- Motion 已接管位置不再出现 `offsetWidth` / `style.transition` / temporary piece FX classes。
- `fx.ts` 不再以 `sleep()` 猜动画 completion；若 `sleep` 已零引用则删除 helper。
- `setTimeout` 允许剩余的只有语义 timer：`App` deploy sync-point 双 macrotask、`ToastHost` lifetime；FX cleanup 不靠 timer。

- [ ] **Step 2: 搜索 ownership 违规**

Run:

```bash
git grep -n "from 'react\|from \"react" -- src/ui/fx || true
git grep -n "AnimatePresence" -- src/ui/components/PiecesLayer.tsx || true
git grep -n "data-piece-motion" -- src/ui/components/PiecesLayer.tsx src/ui/fx/fx.ts
```

Expected:

- `src/ui/fx/**` 无 React import。
- PiecesLayer 无 AnimatePresence。
- wrapper 和 FX helper 都明确引用 `data-piece-motion`。

- [ ] **Step 3: 跑完整验证**

Run:

```bash
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
node tests/e2e/smoke.e2e.mjs --reduced-motion
```

Expected: 全部 exit 0。

- [ ] **Step 4: 记录最终 artifact bytes**

Run:

```bash
node --input-type=module -e "import {statSync} from 'node:fs'; console.log(statSync('dist/index.html').size)"
```

把结果与 Task 1 baseline 写进 implementation PR 正文：`before bytes → after bytes → absolute delta → percentage delta`。

- [ ] **Step 5: 强制生产源码 deleted > added**

先记录实现分支的 `BASE_SHA`（实现 worktree 创建时的 main HEAD），然后：

```bash
git diff --numstat "$BASE_SHA"...HEAD -- ':(glob)src/**/*.ts' ':(glob)src/**/*.tsx' ':(glob)src/**/*.css' \
  | awk '{add+=$1; del+=$2} END {printf "production added=%d deleted=%d\n", add, del; exit !(del>add)}'
```

Expected: exit 0 且 `deleted > added`。

如果失败，按以下顺序减代码后重跑，而不是放宽 Gate：

1. 删除未产生真实复用的 helper/interface；
2. 删除 Motion 已替代但仍残留的 CSS/keyframes/comments；
3. 保留 CSS 明显比 Motion 更短的 hover/persistent loops；
4. 不以拆新文件或新 manager 来“整理”代码。

- [ ] **Step 6: 人工 smoke（真实浏览器）**

检查：部署、普通移动、近战、远程 projectile、伤害/死亡、至少一个法术、choice、FX 中 restart、图鉴开关、WinMask、系统 reduced motion。

Expected: 视觉仍保持现有暗色风格；允许的有意差异仅包括 FX 尾巴更自然重叠、React exit/layout animation、reduced-motion 降级、restart 可在 FX 中执行。

- [ ] **Step 7: 最终 commit（仅当 Step 1–6 有 cleanup 修改）**

```bash
git add src tests/e2e/smoke.e2e.mjs
git commit -m "test: harden Motion migration verification"
```

若 Step 1–6 没产生文件修改，则不要制造空 commit。

- [ ] **Step 8: implementation PR 正文必须包含以下证据**

```markdown
## Verification
- `npm run typecheck`: PASS
- `npm test`: PASS
- `npm run build`: PASS / single-file verified
- `node tests/e2e/smoke.e2e.mjs`: PASS
- `node tests/e2e/smoke.e2e.mjs --reduced-motion`: PASS
- production LOC: added X / deleted Y (`Y > X`)
- dist/index.html: BEFORE bytes → AFTER bytes (Δ bytes, Δ%)

## Intentional presentation differences
- decorative FX tails may overlap instead of blocking the whole GameEvent duration
- modal/toast/win/hand/stored lifecycle/layout is Motion-driven
- restart is available during FX and cancels the old run
- reduced-motion uses shorter/static presentation while preserving event order
```
