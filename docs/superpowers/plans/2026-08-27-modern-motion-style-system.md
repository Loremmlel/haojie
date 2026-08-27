# 「浩劫」现代动画与样式系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Motion 13.1.1 替换 timer-driven FX 与 React lifecycle CSS 动画，在冻结玩法/GameEvent 时序的前提下减少生产源码，并继续输出零外链单 HTML。

**Architecture:** 保留 `playChain() → playOne()`。`fx.ts` 只增加一个 module-private per-`initFx` run record，集中 active Motion controls、transient nodes 与 stale-run 隔离；piece root 继续负责 `left/top`、点击和 persistent state，单层 `[data-piece-motion]` 负责 temporary transform/opacity。React lifecycle/layout 直接使用 `motion/react`，不建立新的 animation framework。

**Tech Stack:** React 19.2.6、TypeScript 5.9.3 strict、Vite 8.0.13、Motion 13.1.1、CSS Modules、现有 Node tests + Edge headless E2E。

**Spec:** `docs/superpowers/specs/2026-08-27-modern-motion-style-system-design.md`

## Global Constraints

- 不修改 `src/engine/**`、玩法数值、GameEvent schema 或事件生成顺序。
- `src/ui/fx/**` 保持零 React import；GameEvent 仍串行播放。
- `busy` 继续阻止普通动作；choice 仍优先于 busy。
- restart 可在普通 FX busy 中取消旧 run，但 pending choice 时仍禁用，避免遗留未 resolve 的 `ask()`。
- restart 必须先使旧 run 失效并清空 App 的旧 `hosts` state；只有新 `BoardArea` 上报的新 host refs 才允许创建新 run，旧 run/旧 host 不得复用。
- deploy 仍先 `onSyncPoint()`；death 仍由 `fx.ts` await，`PiecesLayer` 不增加 death `AnimatePresence`。
- `pieceRegistry` 继续保存 root；root 继续是 `left/top + posOf()`、点击和几何测量 authority。
- temporary FX 只写 root 下的 `[data-piece-motion]`，不写承载 persistent transform 的 root。
- 只新增 `motion@13.1.1`；不引入 GSAP/Pixi/Tailwind/CSS-in-JS/新测试框架。
- 默认标准 `motion/react`；不预先使用 `LazyMotion`。
- `vite-plugin-singlefile`、零外链、`file://` 运行约束不变。
- implementation PR 的 `src/**/*.ts|tsx|css` 汇总必须 **deleted > added**。
- 不预建 `runtime.ts`、`session.ts`、`timings.ts` 或一文件一个 primitive；抽象只有在真实减少重复/总代码时才保留。

## File Map

**Modify:** `package.json`, `package-lock.json`, `src/main.tsx`, `src/App.tsx`, `src/ui/fx/fx.ts`, `src/ui/components/ActionBar.tsx`, `PiecesLayer.tsx`, `Piece.module.css`, `global.css`, `CodexModal*`, `OptionFloat*`, `WinMask*`, `ToastHost*`, `Hand.tsx`, `Stored.tsx`, `Hand.module.css`, `tests/e2e/smoke.e2e.mjs`。

**Do not modify:** `src/engine/**`, `src/ui/fx/registry.ts`。`LogPanel` 默认不迁 Motion。

---

### Task 1: Motion 依赖、根配置与基线

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/main.tsx`

**Interfaces:** Produces `motion@13.1.1` and root `MotionConfig reducedMotion="user"`.

- [ ] **Step 1: 记录干净基线**

```bash
npm ci
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
node --input-type=module -e "import {statSync} from 'node:fs'; console.log(statSync('dist/index.html').size)"
```

Expected: 全部 exit 0；保存 baseline HTML bytes 到最终 PR 正文。

- [ ] **Step 2: 安装唯一新依赖**

```bash
npm install --save-exact motion@13.1.1
```

Expected dependencies include exactly:

```json
"motion": "13.1.1"
```

- [ ] **Step 3: 根部接入 reduced-motion**

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
- Produces public `resetFx(): void`.
- `initFx(c)` creates a private `FxRun`; `playChain(g)` captures that run and the supplied game.
- Removes `FxCtx.getGame`.

- [ ] **Step 1: 先写 restart-during-FX 红灯**

In the browser driver add:

```js
restarted: false,
staleFxClean: false,
```

Replace the final fixed `await wait(2500)` after a real action with:

```js
if (!(await until(() => {
  const b = $('#btn-end');
  return b && !b.disabled;
}, 8000))) throw new Error('动作链未在 8s 内结束');
```

Then trigger a turn banner and restart while it is playing:

```js
const oldGame = game();
const oldBanner = $('#banner');
window.confirm = () => true;
click($('#btn-end'));
if (!(await until(() => {
  const b = $('#banner');
  return b && !b.classList.contains('hidden');
}, 3000))) throw new Error('未进入回合横幅 FX');

const restart = $('#btn-restart');
if (!restart || restart.disabled) throw new Error('restart 被 FX busy 锁死');
click(restart);
if (!(await until(() => {
  const banner = $('#banner');
  return game() && game() !== oldGame && banner && banner !== oldBanner && $('#fxlayer');
}, 6000))) throw new Error('FX 中 restart 未完成新局 DOM 物化');
out.restarted = true;

// 给 BoardArea.onHosts → App setHosts → FX effect/initFx 一个短 settle；
// 之后 sentinel 只检测真正的 stale completion，不把新 run 正常装配误判为旧 run 写入。
await wait(100);
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

Add both fields to final `ok`.

- [ ] **Step 2: 运行确认红灯**

```bash
npm run build
node tests/e2e/smoke.e2e.mjs
```

Expected: FAIL at least with `restart 被 FX busy 锁死`.

- [ ] **Step 3: restart 只绕过普通 busy，不绕过 pending choice**

`ActionBar.tsx`:

```tsx
<button id="btn-restart" className="btn btn-danger"
        disabled={ia.choice != null}
        onClick={handleRestart}>⟳ 重开</button>
```

End/undo/BoardArea busy rules remain unchanged.

- [ ] **Step 4: 建立最小 per-run record**

In `fx.ts`:

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

Remove `getGame` from `FxCtx`.

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

Do not call `.catch()` or `.finally()` directly on Motion controls; they are Promise-like via `then()`.

Implement reset/init:

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

Change `playOne` to `playOne(run, g, e)`. `playChain(g)` captures the current run once; after cancellation it returns silently. Helpers use the captured `run.ctx`, never a new global context after `await`.

- [ ] **Step 5: App 显式使旧 hosts 失效，并由新 hosts 重建 run**

Import `resetFx`. Restart order:

```ts
resetFx();
setHosts(null); // 旧 BoardArea host refs 立即失效；禁止后续 effect 用 detached DOM 重建 run
resetAll();
setGame(null); setWinner(null); setSeq((n) => n + 1);
```

FX effect removes `getGame` from `initFx(...)`, keeps `hosts` as the reinitialization trigger, and returns `resetFx` as cleanup:

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

`setHosts(null)` makes restart 的恢复路径显式：旧 run 被取消、旧 host refs 被清空；新局 `BoardArea` remount 后通过现有 `onHosts` 上报新的 DOM refs，`hosts` 从 `null` 变为新值，effect 必然再次调用 `initFx` 创建**新的** run。不要仅把 `seq` 加入 effect 依赖，因为 `seq` 变化时旧 host refs 可能仍指向已卸载 DOM；新 run 只能绑定新 `BoardArea` 上报的 hosts。

Preserve the nested `setTimeout(0)` in `onSyncPoint`; it is React materialization scheduling, not animation completion.

- [ ] **Step 6: Move transient primitives to Motion**

Make `addEl(run, ...)` register nodes; `dropEl` removes from the set and DOM. For non-blocking transient cleanup:

```ts
function transient(run: FxRun, el: HTMLElement, controls: FxControls): void {
  void Promise.resolve(track(run, controls))
    .catch((err) => { if (run.alive) console.error('fx background error', err); })
    .finally(() => dropEl(run, el));
}
```

Migration:

| Primitive | Motion behavior | Blocking |
|---|---|---|
| `flyNum` | opacity/y/scale ~0.7s | no |
| `projectileTo` | left/top, keep 140–420ms distance duration | yes |
| ring | size/opacity ~0.55s | no |
| `boomAt` | x/y/rotate/scale/opacity ~0.7s | no |
| `spellIcon` | scale/rotate/y/opacity ~0.75s | yes |
| `banner` | opacity/scaleX ~1.05s | turn yes, win no |
| `shake` | boardOuter x/y keyframes ~0.38s | no |

Static centering uses CSS individual `translate` (`-50% -50%`; banner `-50% 0`) so Motion owns `transform`. Delete `floatUp/ringGrow/boomFly/spellPop/bannerSweep/shakeIt` keyframes and corresponding `animation:`. Leave slash/piece FX for Task 3.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
git add src/ui/fx/fx.ts src/App.tsx src/ui/components/ActionBar.tsx src/styles/global.css tests/e2e/smoke.e2e.mjs
git commit -m "refactor: move transient FX to Motion"
```

Expected: restart works during non-choice FX, old run cannot mutate new hosts, fresh `BoardArea` hosts always create a new run, and no unhandled rejection is emitted.

---

### Task 3: Piece root/motion handle + piece FX → Motion

**Files:**
- Modify: `src/ui/components/PiecesLayer.tsx`
- Modify: `src/ui/components/Piece.module.css`
- Modify: `src/ui/fx/fx.ts`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/smoke.e2e.mjs`

**Interfaces:** `pieceRegistry.get(uid)` still returns root. Private `pieceMotion(run, uid)` returns `[data-piece-motion]`. Move animates root left/top; lunge/hit/deploy/death animate inner node.

- [ ] **Step 1: Write motion-handle/death ownership red test**

After Task 2 restart, create a deterministic base-vs-base attack only in the E2E fixture:

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
  return node && (node.getAnimations().length > 0 || node.style.opacity || node.style.transform);
}, 4000))) throw new Error('death FX 未落在 motion node');
if (!victimRoot.isConnected) throw new Error('death FX 完成前 React 已卸载 root');
if (!(await until(() => !document.querySelector('.piece[data-uid="' + victim.uid + '"]'), 5000)))
  throw new Error('death FX 完成后 React 未卸载 root');
```

Add `motionHandle/deathOwned` to final result.

- [ ] **Step 2: Run red test**

```bash
npm run build
node tests/e2e/smoke.e2e.mjs
```

Expected: FAIL with `piece motion handle 缺失`.

- [ ] **Step 3: Add exactly one piece wrapper**

Keep root ref callback/registry unchanged. Remove the base `'pop-in'` class special case. Put all visual children inside:

```tsx
<div className={s.motionBody} data-piece-motion>
  {/* face/stat/badges/apdots unchanged */}
</div>
```

`Piece.module.css`:

```css
.piece {
  /* existing position/size */
  transition: transform .18s, opacity .3s, filter .3s;
  will-change: left, top;
}
.motionBody { position: absolute; inset: 0; border-radius: inherit; }
```

Remove root `left/top` transition. Persistent selected/exhausted/shield/charm remain CSS.

- [ ] **Step 4: Add private inner-handle helper**

```ts
function pieceMotion(run: FxRun, uid: number): HTMLElement | null {
  return run.ctx.registry.get(uid)?.querySelector<HTMLElement>('[data-piece-motion]') ?? null;
}
```

Geometry still reads root `getBoundingClientRect()`.

- [ ] **Step 5: Migrate move/hook/lunge/hit/deploy/death**

Move root with Motion and remove `sleep(340)`:

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

- Lunge: root supplies rect/z-index; inner performs x/y/scale out-and-back; `finally` restores root z-index.
- Hit: inner performs jolt; ring remains transient.
- Deploy: `await run.ctx.onSyncPoint()`, check `run.alive`, then non-blocking inner scale/y/opacity.
- Death: boom is non-blocking; inner death Motion is awaited; React exit remains absent.
- Slash becomes transient Motion; hook `await movePieceTo(...)`.

Death shape:

```ts
await track(run, animate(body, {
  scale: [1, .2], rotate: [0, 80], opacity: [1, 0],
  filter: ['brightness(2)', 'brightness(3) blur(2px)'],
}, { duration: .48, ease: 'easeIn' }));
```

- [ ] **Step 6: Delete legacy piece FX CSS, verify, commit**

Delete `.piece.pop-in/.dying/.hit-jolt` and `popIn/dieAnim/jolt/slashGo` keyframes. `.slash` keeps static shape only.

```bash
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
git add src/ui/components/PiecesLayer.tsx src/ui/components/Piece.module.css src/ui/fx/fx.ts src/styles/global.css tests/e2e/smoke.e2e.mjs
git commit -m "refactor: move piece FX to Motion"
```

Expected: death FX is visible on inner motion node before React removes root; no PiecesLayer AnimatePresence.

---

### Task 4: React lifecycle/layout → Motion

**Files:**
- Modify: `src/App.tsx`
- Modify: `CodexModal.tsx/.module.css`
- Modify: `OptionFloat.tsx/.module.css`
- Modify: `WinMask.tsx/.module.css`
- Modify: `ToastHost.tsx/.module.css`
- Modify: `Hand.tsx`, `Stored.tsx`, `src/styles/global.css`
- Modify: `tests/e2e/smoke.e2e.mjs`

**Interfaces:** App owns whole-component `AnimatePresence` for Codex/WinMask. OptionFloat/Toast own local presence. Hand/Stored use outer Motion wrappers so inner `.card:hover` remains CSS-owned.

- [ ] **Step 1: Write Modal exit red test**

At boot:

```js
click($('#btn-codex'));
if (!(await until(() => $('#modal'), 1500))) throw new Error('图鉴未打开');
click($('#modal-close'));
await wait(30);
if (!$('#modal')) throw new Error('Modal 没有 exit 生命周期，立即卸载');
if (!(await until(() => !$('#modal'), 1500))) throw new Error('Modal exit 后未卸载');
out.modalExit = true;
```

Add `modalExit` to final `ok`.

- [ ] **Step 2: Run red test**

```bash
npm run build
node tests/e2e/smoke.e2e.mjs
```

Expected: current implementation fails because Modal unmounts before 30ms.

- [ ] **Step 3: App/Codex/WinMask lifecycle**

App imports `AnimatePresence` and wraps modal/win conditions separately. Do not wrap PiecesLayer.

Codex root/card become `motion.div` preserving ids:

```tsx
<motion.div id="modal"
  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
  transition={{ duration: .2 }}>
  <motion.div id="modal-card"
    initial={{ opacity: 0, y: 26, scale: .97 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: 16, scale: .98 }}
    transition={{ duration: .28, ease: [.2, .9, .3, 1.1] }}>
    {/* existing content */}
  </motion.div>
</motion.div>
```

WinMask root becomes `motion.div`; `winGlow` stays CSS.

- [ ] **Step 4: OptionFloat local presence**

Return `AnimatePresence` even when no option; conditional child is `motion.div id="optfloat"` with opacity/y/scale enter/exit. Change root CSS positioning from transform to `translate: -50% -50%`. Delete modalUp animation/keyframe.

- [ ] **Step 5: Toast keeps lifetime timer, Motion owns DOM lifecycle**

Keep `setTimeout(..., 2600)`. Wrap mapped items in `AnimatePresence initial={false}`; item `motion.div` enter `{opacity:0,y:14,scale:.9}` → normal, exit `{opacity:0,y:-8}`. Delete toastIn/toastOut CSS.

- [ ] **Step 6: Hand/Stored layout wrappers**

Hand: each stable `card.uid` gets outer `motion.div layout="position"`; inner card retains `data-card/data-idx` and CSS hover.

Stored has no uid in engine schema. Keep engine untouched and create UI-only keys:

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

Use outer `motion.div key={storedKey(card)} layout="position"`; undo replacing objects may legitimately replay enter.

- [ ] **Step 7: Delete lifecycle CSS, verify, commit**

Delete replaced `fadeIn/modalUp/toastIn/toastOut` and their duplicate global/module keyframes. Keep `winGlow` where still used.

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
- Modify: `Piece.module.css`, `Hand.module.css`, `WinMask.module.css`, `src/styles/global.css`
- Modify: `tests/e2e/smoke.e2e.mjs`

**Interfaces:** private `prefersReducedMotion(): boolean`; E2E `--reduced-motion` maps to Edge `--force-prefers-reduced-motion`.

- [ ] **Step 1: Add reduced-motion E2E mode**

Node side:

```js
const reducedMotion = process.argv.includes('--reduced-motion');
```

Edge args:

```js
...(reducedMotion ? ['--force-prefers-reduced-motion'] : []),
```

Driver records:

```js
reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
```

When CLI flag is present, final assertion requires `parsed.reducedMotion === true`.

- [ ] **Step 2: Imperative FX changes parameters, not control flow**

```ts
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
```

Keep the same `playOne` branches/await points. Reduce blocking motion durations to roughly 0.05–0.08s; shake returns immediately; decorative movement/rotation shrinks. Do not add a second `playReducedEvent` path.

- [ ] **Step 3: Persistent CSS motion becomes static under reduce**

```css
/* Piece.module.css */
@media (prefers-reduced-motion: reduce) {
  .shielded .face, .marked::after, .charmed::before { animation: none; }
}

/* Hand.module.css */
@media (prefers-reduced-motion: reduce) {
  .selected, .awaiting { animation: none; }
}

/* WinMask.module.css */
@media (prefers-reduced-motion: reduce) {
  :global(#win-text) { animation: none; }
}
```

In `global.css`, disable `.dep-ok/.atk-ok/.sk-ok/.heal-ok` pulse animations while retaining color/border state.

- [ ] **Step 4: Remove confirmed global duplicate keyframes**

```bash
git grep -n "shieldSpin\|wobble\|winGlow\|fadeIn\|modalUp" -- src
```

Delete only global definitions that now have a module-local owner or zero references.

- [ ] **Step 5: Verify both modes and commit**

```bash
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
node tests/e2e/smoke.e2e.mjs --reduced-motion
git add src/ui/fx/fx.ts src/ui/components/Piece.module.css src/ui/components/Hand.module.css src/ui/components/WinMask.module.css src/styles/global.css tests/e2e/smoke.e2e.mjs
git commit -m "feat: respect reduced motion preference"
```

Expected: both modes preserve event order/death ownership and leave no stale run.

---

### Task 6: Verification, net-LOC Gate and PR evidence

**Files:** Modify only already-touched files if dead code/stale comments are found. Do not create production abstraction files.

- [ ] **Step 1: Search forbidden animation plumbing**

```bash
git grep -n "offsetWidth\|style.transition\|hit-jolt\|dying\|pop-in" -- src/ui/fx src/styles src/ui/components || true
git grep -n "sleep(" -- src/ui/fx/fx.ts || true
git grep -n "setTimeout" -- src/ui/fx/fx.ts src/App.tsx src/ui/components/ToastHost.tsx
```

Expected: no Motion-owned `offsetWidth/style.transition/sleep/temporary piece FX class`. Remaining timers are only App deploy sync scheduling and Toast lifetime.

- [ ] **Step 2: Search ownership violations**

```bash
git grep -n "from 'react\|from \"react" -- src/ui/fx || true
git grep -n "AnimatePresence" -- src/ui/components/PiecesLayer.tsx || true
git grep -n "data-piece-motion" -- src/ui/components/PiecesLayer.tsx src/ui/fx/fx.ts
```

Expected: FX has no React import; PiecesLayer has no AnimatePresence; wrapper and FX helper both reference the inner handle.

- [ ] **Step 3: Full verification**

```bash
npm run typecheck
npm test
npm run build
node tests/e2e/smoke.e2e.mjs
node tests/e2e/smoke.e2e.mjs --reduced-motion
```

Expected: all exit 0.

- [ ] **Step 4: Record artifact delta**

```bash
node --input-type=module -e "import {statSync} from 'node:fs'; console.log(statSync('dist/index.html').size)"
```

Record `baseline → final → absolute delta → percentage delta` in implementation PR.

- [ ] **Step 5: Enforce production deleted > added**

Let `BASE_SHA` be main HEAD when the implementation branch was created:

```bash
git diff --numstat "$BASE_SHA"...HEAD -- ':(glob)src/**/*.ts' ':(glob)src/**/*.tsx' ':(glob)src/**/*.css' \
  | awk '{add+=$1; del+=$2} END {printf "production added=%d deleted=%d\n", add, del; exit !(del>add)}'
```

Expected: exit 0. If it fails, first delete non-beneficial helpers, replaced CSS/keyframes and stale comments; do not add a manager/file to organize the excess.

- [ ] **Step 6: Manual browser smoke**

Verify deployment, move, melee, projectile, damage/death, spell, choice, restart during non-choice FX, Modal, WinMask, Hand/Stored layout, system reduced-motion.

Allowed presentation differences: decorative tails may overlap; React lifecycle/layout uses Motion; restart can cancel ordinary FX; reduced mode shortens/staticizes motion; initial bases no longer use legacy CSS `pop-in`.

- [ ] **Step 7: Cleanup commit only if this task changed files**

```bash
git add src tests/e2e/smoke.e2e.mjs
git commit -m "test: harden Motion migration verification"
```

No changes → no empty commit.

- [ ] **Step 8: Implementation PR body includes evidence**

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
- reduced-motion preserves event order but shortens/staticizes presentation
- initial base pieces no longer use the legacy CSS `pop-in` special case
```
