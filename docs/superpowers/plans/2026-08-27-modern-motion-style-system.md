# 「浩劫」现代动画与样式系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Motion 13.1.1 替换 timer-driven FX 与 React lifecycle CSS 动画，在冻结玩法/GameEvent 时序的前提下减少生产源码，并继续输出零外链单 HTML。

**Architecture:** 保留 `playChain() → playOne()`。`fx.ts` 只增加一个 module-private per-`initFx` run record，集中 active Motion controls、transient nodes 和 stale-run 隔离；piece root 继续负责 `left/top`、点击和 persistent state，单层 `[data-piece-motion]` 负责 temporary transform/opacity。React lifecycle/layout 直接使用 `motion/react`，不建立新的 animation framework。

**Tech Stack:** React 19.2.6、TypeScript 5.9.3 strict、Vite 8.0.13、Motion 13.1.1、CSS Modules、现有 Node tests + Edge headless E2E。

**Spec:** `docs/superpowers/specs/2026-08-27-modern-motion-style-system-design.md`

## Global Constraints

- 不修改 `src/engine/**`、玩法数值、GameEvent schema 或事件生成顺序。
- `src/ui/fx/**` 保持零 React import；Motion 在这里仅通过 `animate()` 执行动画。
- GameEvent 串行；`busy` 继续阻止普通动作；choice 仍优先于 busy。
- restart 是 FX 的取消入口：FX busy 时可重开；pending choice 时仍禁用 restart，避免遗留未 resolve 的 `ask()`。
- deploy 仍先 `onSyncPoint()`；death 仍由 `fx.ts` await，`PiecesLayer` 不增加 death `AnimatePresence`。
- `pieceRegistry` 继续保存 root；root 继续是 `left/top + posOf()`、点击和几何测量 authority。
- temporary FX 只写 root 下的 `[data-piece-motion]`，不写承载 persistent transform 的 root。
- 只新增 `motion@13.1.1`；不引入 GSAP/Pixi/Tailwind/CSS-in-JS/新测试框架。
- 默认标准 `motion/react`；本计划不预先上 `LazyMotion`。
- `vite-plugin-singlefile`、零外链、`file://` 运行约束不变。
- implementation PR 的 `src/**/*.ts|tsx|css` 汇总必须 **deleted > added**。
- 不预建 `runtime.ts`、`session.ts`、`timings.ts` 或一文件一个 primitive；抽象只有在真实减少重复/总代码时才保留。

## File Map

**Modify:** `package.json`, `package-lock.json`, `src/main.tsx`, `src/App.tsx`, `src/ui/fx/fx.ts`, `src/ui/components/ActionBar.tsx`, `src/ui/components/PiecesLayer.tsx`, `src/ui/components/Piece.module.css`, `src/styles/global.css`, `CodexModal*`, `OptionFloat*`, `WinMask*`, `ToastHost*`, `Hand.tsx`, `Stored.tsx`, `Hand.module.css`, `tests/e2e/smoke.e2e.mjs`。

**Do not modify:** `src/engine/**`, `src/ui/fx/registry.ts`。`LogPanel` 默认不迁 Motion。

---

### Task 1: Motion 依赖、根配置与基线

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/main.tsx`

**Interfaces:**
- Produces: `motion@13.1.1`；根部 `MotionConfig reducedMotion="user"`。

- [ ] **Step 1: 记录实现分支基线**

```bash
npm ci
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
node --input-type=module -e "import {statSync} from 'node:fs'; console.log(statSync('dist/index.html').size)"
```

Expected: 全部 exit 0；保存最后的 baseline bytes 到最终 PR 正文，不创建 metrics 文件。

- [ ] **Step 2: 安装唯一新依赖**

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

- [ ] **Step 3: 根部接入 reduced-motion 配置**

`src/main.tsx`：

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App.tsx';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user"><App /></MotionConfig>
  </StrictMode>,
);
```

- [ ] **Step 4: 验证并提交**

```bash
npm run typecheck
npm test
npm run build
git add package.json package-lock.json src/main.tsx
git commit -m "build: add Motion runtime"
```

---

### Task 2: Per-run cancellation + transient FX → Motion

**Files:**
- Modify: `src/ui/fx/fx.ts`
- Modify: `src/App.tsx`
- Modify: `src/ui/components/ActionBar.tsx`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/smoke.e2e.mjs`

**Interfaces:**
- Produces: `resetFx(): void`。
- `initFx(c)` 创建独立 `FxRun`；`playChain(g)` 捕获当前 run 和传入的 `g`。
- Removes: `FxCtx.getGame`。
- Module-private: `track`, `background`, `transient`, `addEl`, `dropEl`。

- [ ] **Step 1: 先写 restart-during-FX 红灯**

把 smoke driver 的 `out` 增加：

```js
restarted: false,
staleFxClean: false,
```

把现有真实攻击/移动后的固定 `await wait(2500)` 改为：

```js
if (!(await until(() => {
  const b = $('#btn-end');
  return b && !b.disabled;
}, 8000))) throw new Error('动作链未在 8s 内结束');
```

随后追加：

```js
const oldGame = game();
window.confirm = () => true;
click($('#btn-end'));
if (!(await until(() => {
  const b = $('#banner');
  return b && !b.classList.contains('hidden');
}, 3000))) throw new Error('未进入回合横幅 FX');

const restart = $('#btn-restart');
if (!restart || restart.disabled) throw new Error('restart 被 FX busy 锁死');
click(restart);
if (!(await until(() => game() && game() !== oldGame, 6000)))
  throw new Error('FX 中 restart 未创建新局');
out.restarted = true;

const newBanner = $('#banner');
newBanner.className = 'e2e-sentinel';
await wait(1200);
if (newBanner.className !== 'e2e-sentinel')
  throw new Error('旧 FX completion 写入新局 banner');
newBanner.className = 'hidden';
if ($('#fxlayer').querySelector('.fly-num,.ring,.boom,.slash,.spell-cast,.bolt'))
  throw new Error('restart 后仍有旧 transient FX');
out.staleFxClean = true;
```

最终 `ok` 加入 `restarted && staleFxClean`。

- [ ] **Step 2: 运行确认红灯**

```bash
npm run build
node tests/e2e/smoke.e2e.mjs
```

Expected: FAIL，当前实现至少会报 `restart 被 FX busy 锁死`。

- [ ] **Step 3: restart 只绕过普通 busy，不绕过 pending choice**

`ActionBar.tsx` restart button 改为：

```tsx
<button id="btn-restart" className="btn btn-danger"
        disabled={ia.choice != null}
        onClick={handleRestart}>⟳ 重开</button>
```

其它按钮和 BoardArea 的 busy 规则不动。

- [ ] **Step 4: 在 `fx.ts` 建立最小 per-run record**

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

`FxCtx` 删除 `getGame`：

```ts
export interface FxCtx {
  hosts: { boardOuter: HTMLElement; fxLayer: HTMLElement; banner: HTMLElement };
  registry: typeof pieceRegistry;
  onWin: (winner: number) => void;
  onSyncPoint: () => Promise<void>;
}
```

Controls 是 Promise-like（有 `then()`，不要假设直接有 `.catch/.finally`）：

```ts
function track(run: FxRun, controls: FxControls): FxControls {
  run.controls.add(controls);
  void controls.then(
    () => run.controls.delete(controls),
    () => run.controls.delete(controls),
  );
  return controls;
}

function background(run: FxRun, controls: FxControls): void {
  void Promise.resolve(track(run, controls)).catch((err) => {
    if (run.alive) console.error('fx background error', err);
  });
}
```

实现：

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
  if (currentRun === run) currentRun = null;
}

export function initFx(c: FxCtx): void {
  resetFx();
  currentRun = { ctx: c, alive: true, controls: new Set(), nodes: new Set() };
  evCursor = 0;
}
```

`playChain(g)` 捕获 run；`playOne` 签名改成 `playOne(run, g, e)`。如果 `run.alive` 已 false，正常返回，不记录 cancellation error。后续 helper 一律使用传入的 `run.ctx`，不能在 `await` 后重新获取新 run。

- [ ] **Step 5: App 显式 reset 旧 run**

```ts
import { initFx, resetFx } from './ui/fx/fx.ts';
```

Restart：

```ts
const restart = useCallback(() => {
  resetFx();
  resetAll();
  setGame(null); setWinner(null); setSeq((n) => n + 1);
}, []);
```

FX effect 删除 `getGame` 注入，并 `return resetFx`。保留 `onSyncPoint` 的双 `setTimeout(0)`，它是 React materialize 调度，不是 animation timer。

- [ ] **Step 6: 迁移 transient primitives**

`addEl(run, ...)` 把 node 登记到 `run.nodes`；`dropEl` 同时从 set 删除并 `remove()`。

为非阻塞 transient 使用：

```ts
function transient(run: FxRun, el: HTMLElement, controls: FxControls): void {
  void Promise.resolve(track(run, controls))
    .catch((err) => { if (run.alive) console.error('fx background error', err); })
    .finally(() => dropEl(run, el));
}
```

迁移表：

| Primitive | Motion | playOne |
|---|---|---|
| `flyNum` | opacity/y/scale ~0.7s | non-blocking |
| `projectileTo` | left/top，保持 140–420ms 距离时长 | await |
| ring | size/opacity ~0.55s | non-blocking |
| `boomAt` | x/y/rotate/scale/opacity ~0.7s | non-blocking |
| `spellIcon` | scale/rotate/y/opacity ~0.75s | await |
| `banner` | opacity/scaleX ~1.05s | turn await；win background |
| `shake` | `boardOuter` x/y keyframes ~0.38s | background |

`.fly-num/.bolt/.ring/.boom/.spell-cast` 的静态居中改用 CSS `translate: -50% -50%`；`#banner` 改 `translate: -50% 0`，避免与 Motion transform 抢 owner。

从 `global.css` 删除这些 primitive 对应的 `floatUp/ringGrow/boomFly/spellPop/bannerSweep/shakeIt` keyframes/animation。`slashGo` 和 piece FX 留到 Task 3。

- [ ] **Step 7: 验证并提交**

```bash
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
git add src/ui/fx/fx.ts src/App.tsx src/ui/components/ActionBar.tsx src/styles/global.css tests/e2e/smoke.e2e.mjs
git commit -m "refactor: move transient FX to Motion"
```

Expected: restart 可在非-choice FX busy 中执行；旧 run 不污染新局；无 unhandled rejection。

---

### Task 3: Piece root/motion handle 分离 + piece FX → Motion

**Files:**
- Modify: `src/ui/components/PiecesLayer.tsx`
- Modify: `src/ui/components/Piece.module.css`
- Modify: `src/ui/fx/fx.ts`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/smoke.e2e.mjs`

**Interfaces:**
- `pieceRegistry.get(uid)` 继续返回 root。
- New module-private: `pieceMotion(run, uid): HTMLElement | null`。
- `movePieceTo(run, g, uid, x, y): Promise<void>` 动画 root left/top。
- lunge/hit/deploy/death 只动画 inner motion node。

- [ ] **Step 1: 先写 motion handle + death ownership 红灯**

在 Task 2 restart 后的新局中，用 debug game 构造确定性 base-vs-base 攻击（仅测试夹具，engine 源码不改）：

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

给 `out` 增加 `motionHandle/deathOwned` 并加入最终 `ok`。

- [ ] **Step 2: 运行确认红灯**

```bash
npm run build
node tests/e2e/smoke.e2e.mjs
```

Expected: FAIL with `piece motion handle 缺失`。

- [ ] **Step 3: PiecesLayer 只增加一个 wrapper，registry 不改语义**

删除 base 的 `'pop-in'` class 特判；root ref callback 保持原样。把 face/stat/badges/apdots 全部放进：

```tsx
<div className={s.motionBody} data-piece-motion>
  {/* existing visual children */}
</div>
```

`Piece.module.css`：

```css
.piece {
  /* existing position/size */
  transition: transform .18s, opacity .3s, filter .3s;
  will-change: left, top;
}
.motionBody { position: absolute; inset: 0; border-radius: inherit; }
```

删除 root 的 `left/top` CSS transition；persistent selected/exhausted/shield/charm 等继续 CSS。

- [ ] **Step 4: `fx.ts` 获取 inner handle**

```ts
function pieceMotion(run: FxRun, uid: number): HTMLElement | null {
  return run.ctx.registry.get(uid)?.querySelector<HTMLElement>('[data-piece-motion]') ?? null;
}
```

Geometry 继续读 root rect。

- [ ] **Step 5: 迁移 piece FX**

Move/hook：root left/top 使用 Motion，去掉 `sleep(340)`：

```ts
async function movePieceTo(run: FxRun, g: Game, uid: number, x: number, y: number) {
  const p = g.state.pieces.find((q) => q.uid === uid);
  const root = run.ctx.registry.get(uid);
  if (!p || !root) return;
  const pos = posOf(x, y, !!p.big, M);
  await track(run, animate(root, { left: pos.left, top: pos.top }, {
    duration: .32,
    ease: [.34, 1.3, .5, 1],
  }));
}
```

Lunge：root 只用于 rect/z-index；inner 做 x/y/scale 并回位；`try/finally` 恢复 root z-index。Slash 改 transient Motion。

Hit：inner 做 jolt keyframes；ring 继续 Task 2 transient。

Deploy：`await run.ctx.onSyncPoint()` 后先检查 `run.alive`，再对 inner 做非阻塞 scale/y/opacity。

Death：boom 非阻塞，inner death Motion **await**；不要引入 React exit：

```ts
await track(run, animate(body, {
  scale: [1, .2], rotate: [0, 80], opacity: [1, 0],
  filter: ['brightness(2)', 'brightness(3) blur(2px)'],
}, { duration: .48, ease: 'easeIn' }));
```

- [ ] **Step 6: 删除旧 piece FX CSS 并验证**

从 `global.css` 删除 `.piece.pop-in/.dying/.hit-jolt` 及 `popIn/dieAnim/jolt/slashGo` keyframes；`.slash` 只保留 static shape。

```bash
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
```

Expected: motion handle 存在；death FX 完成前 root 存在，完成后由 React 过滤卸载；无 PiecesLayer AnimatePresence。

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/PiecesLayer.tsx src/ui/components/Piece.module.css src/ui/fx/fx.ts src/styles/global.css tests/e2e/smoke.e2e.mjs
git commit -m "refactor: move piece FX to Motion"
```

---

### Task 4: React lifecycle/layout → Motion

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/ui/components/CodexModal.tsx`, `CodexModal.module.css`
- Modify: `src/ui/components/OptionFloat.tsx`, `OptionFloat.module.css`
- Modify: `src/ui/components/WinMask.tsx`, `WinMask.module.css`
- Modify: `src/ui/components/ToastHost.tsx`, `ToastHost.module.css`
- Modify: `src/ui/components/Hand.tsx`
- Modify: `src/ui/components/Stored.tsx`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/smoke.e2e.mjs`

**Interfaces:**
- App owns `AnimatePresence` for whole-component conditional mount (`CodexModal`, `WinMask`)。
- OptionFloat/ToastHost own local `AnimatePresence`。
- Hand/Stored layout Motion 放在 outer wrapper；inner `.card` 继续 CSS hover。

- [ ] **Step 1: 先写 Modal exit 红灯**

开局后：

```js
click($('#btn-codex'));
if (!(await until(() => $('#modal'), 1500))) throw new Error('图鉴未打开');
click($('#modal-close'));
if (!$('#modal')) throw new Error('Modal 没有 exit 生命周期，立即卸载');
if (!(await until(() => !$('#modal'), 1500))) throw new Error('Modal exit 后未卸载');
out.modalExit = true;
```

把 `modalExit` 加入最终 `ok`。

- [ ] **Step 2: 运行确认红灯**

```bash
npm run build
node tests/e2e/smoke.e2e.mjs
```

Expected: FAIL with `Modal 没有 exit 生命周期，立即卸载`。

- [ ] **Step 3: App/Codex/WinMask lifecycle**

App import `AnimatePresence`，分别包住 modal/win 条件节点；不要包 PiecesLayer。

CodexModal root/card 改 `motion.div`，保留 ids：

```tsx
<motion.div id="modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .2 }}>
  <motion.div id="modal-card"
    initial={{ opacity: 0, y: 26, scale: .97 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: 16, scale: .98 }}
    transition={{ duration: .28, ease: [.2, .9, .3, 1.1] }}>
    {/* existing content */}
  </motion.div>
</motion.div>
```

WinMask root 改 `motion.div` 做 overlay enter/exit；`#win-text` 的 `winGlow` 继续 CSS。

删除 Codex/WinMask 对应 lifecycle animation 和 duplicated `fadeIn/modalUp`。

- [ ] **Step 4: OptionFloat local AnimatePresence**

组件不再在 option 不存在时直接卸载自身；返回：

```tsx
<AnimatePresence>
  {spec?.kind === 'option' && (
    <motion.div id="optfloat" key="option-float"
      initial={{ opacity: 0, y: 20, scale: .97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: .98 }}
      transition={{ duration: .22, ease: [.2, .9, .3, 1.15] }}>
      {/* existing choice UI */}
    </motion.div>
  )}
</AnimatePresence>
```

CSS root positioning 改 `translate: -50% -50%`；删除 `modalUp` animation/keyframe。

- [ ] **Step 5: Toast lifetime 不动，只迁 DOM lifecycle**

保留现有 2600ms `setTimeout`。items map 使用 `AnimatePresence initial={false}` + `motion.div`：enter `{ opacity:0,y:14,scale:.9 } → { opacity:1,y:0,scale:1 }`，exit `{ opacity:0,y:-8 }`。删除 `toastIn/toastOut` CSS。

- [ ] **Step 6: Hand layout wrapper，hover 留 CSS**

每张现有 card 外包：

```tsx
<motion.div key={card.uid} layout="position"
  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
  <div className={cls} data-card={idx} data-idx={idx} onClick={() => handleCardClick(idx)}>
    {/* existing card */}
  </div>
</motion.div>
```

父级 map 用 `AnimatePresence initial={false}`。E2E data attributes 继续在 inner card；不要把 hover 改 `whileHover`。

- [ ] **Step 7: Stored 用 UI-only WeakMap 稳定 key**

不改 `StoredCard`：

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

正常 engine mutation 保留 object identity；undo 替换对象时允许重新 enter。Stored card 同 Hand 使用 outer `motion.div key={storedKey(card)} layout="position"`，inner card 保留现有 data selector/hover。

- [ ] **Step 8: 删除 React lifecycle CSS 并验证/提交**

从 global/module CSS 删除已经失去 owner 的 `fadeIn/modalUp/toastIn/toastOut`。若 `winGlow` 只剩 WinMask.module 使用，则删除 global duplicate、保留 module local keyframe。

```bash
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
git add src/App.tsx src/ui/components/CodexModal.tsx src/ui/components/CodexModal.module.css src/ui/components/OptionFloat.tsx src/ui/components/OptionFloat.module.css src/ui/components/WinMask.tsx src/ui/components/WinMask.module.css src/ui/components/ToastHost.tsx src/ui/components/ToastHost.module.css src/ui/components/Hand.tsx src/ui/components/Stored.tsx src/styles/global.css tests/e2e/smoke.e2e.mjs
git commit -m "refactor: move UI lifecycle animation to Motion"
```

---

### Task 5: Reduced Motion + persistent CSS cleanup

**Files:**
- Modify: `src/ui/fx/fx.ts`
- Modify: `src/ui/components/Piece.module.css`
- Modify: `src/ui/components/Hand.module.css`
- Modify: `src/ui/components/WinMask.module.css`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/smoke.e2e.mjs`

**Interfaces:**
- Module-private `prefersReducedMotion(): boolean`。
- E2E CLI: `--reduced-motion` → Edge `--force-prefers-reduced-motion`。

- [ ] **Step 1: E2E 增加 reduced-motion 模式**

Node side：

```js
const reducedMotion = process.argv.includes('--reduced-motion');
```

Edge args：

```js
...(reducedMotion ? ['--force-prefers-reduced-motion'] : []),
```

Driver `out` 记录：

```js
reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
```

使用 `--reduced-motion` 时最终断言必须为 true。

- [ ] **Step 2: imperative FX 只改参数，不分叉流程**

```ts
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
```

Move/projectile/death/lunge 保持相同 await 点，reduced duration 收敛到约 0.05–0.08s；shake 在 reduced mode 直接 return；decorative FX 缩短位移/旋转。不要建立 `playReducedEvent` 第二套流程。

- [ ] **Step 3: persistent CSS motion 降级为静态状态**

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

`global.css` 对 `.dep-ok/.atk-ok/.sk-ok/.heal-ok` pulse 做 `animation: none`，保留颜色/边框。

- [ ] **Step 4: 删除确认无引用的 global duplicate keyframes**

```bash
git grep -n "shieldSpin\|wobble\|winGlow\|fadeIn\|modalUp" -- src
```

删除只剩 module-local owner 的 global duplicates；不得留下悬空 animation name。

- [ ] **Step 5: 双模式验证并提交**

```bash
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
node tests/e2e/smoke.e2e.mjs --reduced-motion
git add src/ui/fx/fx.ts src/ui/components/Piece.module.css src/ui/components/Hand.module.css src/ui/components/WinMask.module.css src/styles/global.css tests/e2e/smoke.e2e.mjs
git commit -m "feat: respect reduced motion preference"
```

Expected: 两种 preference 都无死锁/stale FX，death ownership 一致。

---

### Task 6: 最终 verification、净删行 Gate 与 PR 证据

**Files:**
- Modify only previously touched files if this task finds dead code/stale comments.
- Do not create new production abstraction files.

**Interfaces:**
- Produces: review-ready implementation branch。

- [ ] **Step 1: 搜索 timer/reflow/旧 FX class 残留**

```bash
git grep -n "offsetWidth\|style.transition\|hit-jolt\|dying\|pop-in" -- src/ui/fx src/styles src/ui/components || true
git grep -n "sleep(" -- src/ui/fx/fx.ts || true
git grep -n "setTimeout" -- src/ui/fx/fx.ts src/App.tsx src/ui/components/ToastHost.tsx
```

Expected: Motion-owned animation 不再使用 `offsetWidth/style.transition/sleep/temporary FX class`；允许的 timer 只有 App deploy sync-point 和 Toast lifetime。

- [ ] **Step 2: 搜索 ownership 违规**

```bash
git grep -n "from 'react\|from \"react" -- src/ui/fx || true
git grep -n "AnimatePresence" -- src/ui/components/PiecesLayer.tsx || true
git grep -n "data-piece-motion" -- src/ui/components/PiecesLayer.tsx src/ui/fx/fx.ts
```

Expected: FX 无 React import；PiecesLayer 无 AnimatePresence；wrapper 和 FX helper 都引用 `data-piece-motion`。

- [ ] **Step 3: 完整验证**

```bash
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
node tests/e2e/smoke.e2e.mjs --reduced-motion
```

Expected: 全部 exit 0。

- [ ] **Step 4: 记录 bundle delta**

```bash
node --input-type=module -e "import {statSync} from 'node:fs'; console.log(statSync('dist/index.html').size)"
```

最终 PR 写 `baseline bytes → final bytes → absolute delta → percentage delta`。

- [ ] **Step 5: 强制 production deleted > added**

令 `BASE_SHA` 为实现分支创建时的 main SHA，然后：

```bash
git diff --numstat "$BASE_SHA"...HEAD -- ':(glob)src/**/*.ts' ':(glob)src/**/*.tsx' ':(glob)src/**/*.css' \
  | awk '{add+=$1; del+=$2} END {printf "production added=%d deleted=%d\n", add, del; exit !(del>add)}'
```

Expected: exit 0，且 deleted > added。若失败，依次删除未产生真实复用的 helper、Motion 已替代的 CSS/keyframes/stale comments；不要新增 manager/file 来整理。

- [ ] **Step 6: 人工 smoke**

真实浏览器检查：部署、移动、近战、远程 projectile、伤害/death、法术、choice、FX 中 restart、Modal、WinMask、Hand/Stored layout、系统 reduced motion。

Expected intentional differences：decorative tail 可重叠；Modal/Toast/Win/Hand/Stored 使用 Motion lifecycle/layout；restart 可在非-choice FX 中取消旧 run；reduced motion 缩短/静态化演出。其余玩法和暗色视觉保持。

- [ ] **Step 7: cleanup commit（只有存在实际修改时）**

```bash
git add src tests/e2e/smoke.e2e.mjs
git commit -m "test: harden Motion migration verification"
```

无修改则不制造空 commit。

- [ ] **Step 8: implementation PR 正文附证据**

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
- decorative FX tails may overlap instead of blocking their full visual duration
- Modal/Toast/Win/Hand/Stored lifecycle/layout is Motion-driven
- restart is available during non-choice FX and cancels the old run
- reduced-motion keeps event order but shortens/staticizes presentation
- initial base pieces no longer use the legacy CSS `pop-in` special case
```
