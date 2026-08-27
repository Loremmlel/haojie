# 「浩劫」现代动画与样式系统设计

- **日期**：2026-08-27
- **基线**：`main` @ `ef1d7d3a860af7fe937c274d07a0282a963a3171`
- **范围**：表现层动画基础设施 + 小范围样式整理
- **总原则**：引入成熟动画库是为了删除自维护动画代码，不是再造动画框架

## 1. 目标

当前 React/TypeScript 迁移已经完成，现有边界继续保留：

- `src/engine/**`：纯逻辑，零 DOM / React；
- React：拥有节点结构与终态渲染；
- `src/ui/fx/fx.ts`：按 GameEvent 顺序驱动战斗演出；
- CSS Modules：负责组件样式、hover、持续状态和部分动画。

当前动画债务主要是 `fx.ts` 中的 `sleep()`、cleanup `setTimeout()`、`style.transition`、强制 reflow 与 temporary class/keyframe，以及部分 React lifecycle keyframe 的重复定义。

本次目标：

1. 引入 Motion，用 animation completion / lifecycle 替换手写 timing 与 cleanup；
2. 保持玩法、GameEvent、busy/choice、deploy/death 等时序语义不变；
3. 收紧 React / FX / CSS 的动画 ownership；
4. 保持单 HTML、零外链、`file://` 可运行；
5. **实施 PR 中所有 `src/` 下 `.ts` / `.tsx` / `.css` 的删除行数必须大于新增行数。**

第 5 条不统计 lockfile、测试、文档和依赖清单。若达不到，合并前先删抽象/重复实现，而不是为新增层级辩护。

## 2. 非目标

不做：engine/规则修改、GameEvent redesign、状态管理库、新技能演出、视觉大改、声音、Canvas/WebGL/PixiJS、GSAP、Tailwind/CSS-in-JS、主题系统、大规模 CSS rename、移动端专项。

与本任务无关的 engine bug 单独 follow-up。

## 3. 依赖与 bundle

新增唯一运行时依赖：

```json
"motion": "13.1.1"
```

2026-08-27 已核实为 npm `latest`，MIT License。

```ts
// React lifecycle/layout
import { motion, AnimatePresence, MotionConfig } from "motion/react";

// GameEvent FX
import { animate } from "motion";
```

默认直接使用标准 `motion/react`，**不预先上 `LazyMotion + m`**。项目最终只有一个内联 HTML，少量 bundle 节省不值得换更多 provider/import 约束；只有真实构建显示体积异常时再优化。

实施 PR 记录修改前后 `dist/index.html` bytes 与增量百分比，不预设 KB 上限。

## 4. Ownership

| Owner | 职责 |
|---|---|
| React | 节点创建/销毁、终态内容与坐标 |
| Motion React | React-owned 节点的 enter / exit / layout |
| `fx.ts` + `animate()` | GameEvent 驱动的临时战斗演出 |
| CSS Modules | 静态外观、hover/focus、persistent state、轻量循环 |

硬约束：

- `src/ui/fx/**` 不 import React；
- FX 不直接删除 React-owned piece；
- 同一 CSS property 同一时段只有一个动画 owner；
- Motion 只是执行器，不成为状态层或新事件层。

## 5. FX 改造

### 5.1 默认保留单个 `fx.ts`

继续保留 `playChain()` / `playOne()` 与 primitive。不要预先创建 `runtime.ts`、`session.ts`、`timings.ts`、一文件一个 primitive。

**抽象不是越少越好，而是必须有净收益：** helper / module 若能消除真实重复、降低总代码行数，或把必须一致的 cleanup/cancellation 收拢成更短的一处，就应抽；仅为“未来扩展”服务则不抽。

### 5.2 删除 timer-driven animation

Motion 接管处应尽量把：

```ts
el.style.transition = "...";
el.style.left = "...";
await sleep(340);
```

变成：

```ts
await animate(el, { left, top }, options);
```

并删除对应的：

- 仅用于猜动画结束的 `sleep()`；
- cleanup `setTimeout()`；
- 为重启动画使用的 `offsetWidth` 强制 reflow；
- temporary animation class/keyframe；
- inline `style.transition`。

语义 timer 可保留，例如 toast lifetime、React sync-point 的事件循环等待。

### 5.3 GameEvent 顺序不变

继续串行：

```text
GameEvent[] → playChain() → await playOne(event) → next event
```

禁止批量并行 GameEvent。

关键动作（move、lunge/projectile、death 等）直接 await；纯装饰尾巴（ring、burst、shake tail 等）可非阻塞播放，让后续事件自然重叠。直接在 primitive 中表达，不建立 `blocking/finished` 协议。

### 5.4 保留现有同步语义

- `busy` 覆盖普通玩家动作及阻塞 FX；
- choice 仍优先于 busy，避免 `await choose()` 死锁；
- deploy：先 `onSyncPoint()` 让 React materialize piece + registry，再播 FX；
- death：先播 FX，最终由 React 终态渲染卸载；
- move：继续使用现有 `left/top + posOf()`，不改成新的 x/y 坐标体系。

### 5.5 Piece 允许一个 motion wrapper

为避免 selected/persistent transform 与 lunge/hit/death 抢 `transform`：

```html
<div class="piece">       <!-- registry / left / top / click / persistent state -->
  <div data-piece-motion>  <!-- temporary FX transform -->
    ...
  </div>
</div>
```

只增加这一层，不继续扩 wrapper，也不改 piece 数据模型。

### 5.6 Restart / unmount cleanup

旧命令式动画和 FX-owned transient DOM 在 restart/unmount 后不得继续影响新局。

采用能满足这一点的**最小实现**。如果一个很小的 active-controls/transient-nodes 集合 + `resetFx()` 能减少分散 cleanup，就使用；如果更简单的做法足够，就不额外抽象。

不预先设计 `FxSession`、generation framework 或通用 animation manager。正常 cancellation 不应产生 unhandled rejection/error spam。

## 6. React Motion 范围

优先迁那些**能删除现有 lifecycle CSS/keyframe**的组件：

- `CodexModal`：overlay/card enter/exit；
- `OptionFloat`：enter/exit；
- `WinMask`：enter/exit，持续 `winGlow` 留 CSS；
- `ToastHost`：React timer 管 lifetime，`AnimatePresence` 管 enter/exit；
- `Hand` / `Stored`：增删/重排使用 layout animation。

`LogPanel` 只有迁移后实现更短才改。

继续使用 CSS：card/button hover、HP bar transition、board target pulse、shield/wobble/charged/selected 等 persistent state，以及其它 CSS 明显更短的轻量循环。

禁止为了统一 Motion 把普通 `:hover` 机械改成 `whileHover`。

## 7. CSS 与 tokens

先删除失去 owner 的 CSS，再谈 token：

- 删除 Motion 已接管的 piece temporary FX keyframe/class；
- 删除 Modal/OptionFloat/Toast 等已迁 lifecycle keyframe；
- 删除因此失去必要性的 global/module 重复 keyframe；
- CSS Modules 架构保持不变。

Design token 只整理本次触及且跨组件明显复用的值。旧 `--p1` / `--p2` / `--gold` 无需为了命名好看全仓 rename；单组件尺寸/padding 留本地。

普通 UI timing 可用 CSS variable；gameplay FX timing 留 TS。

## 8. Reduced Motion

React 侧使用 `MotionConfig reducedMotion="user"` 或等价官方能力；命令式 FX 读取 `prefers-reduced-motion`，降低时长/位移/摇晃强度。

Reduced motion 只改变演出参数，不创建第二套 GameEvent/业务流程；persistent state 仍必须可辨识，可从运动降级为静态 glow。

## 9. 测试与验收

继续现有 Node engine tests + Edge E2E，不新增 Vitest/Jest/jsdom/Playwright。

重点保护：

- choice-through-busy；
- deploy sync 后 registry 可找到新 piece；
- death 后 React 正确卸载；
- 动画中 restart 后无旧 transient FX / runtime error；
- reduced motion 不死锁且终态一致。

现有动作后的长固定 wait（如 2500ms）尽量改为等待真实 DOM/busy 条件；现有可观察状态足够时不扩 debug API，只有无法稳定表达条件时才增加最小只读观测点。

实施 PR Gate：

```text
npm run typecheck
npm test
npm run build
现有 + 必要新增 Edge E2E
```

同时确认：

- `verify-singlefile` 通过；
- `dist/index.html` 仍为唯一正式产物，无 CDN/runtime chunk；
- console 无新增 unhandled rejection/runtime error；
- Motion 接管处无遗留“timer 猜 completion”；
- `src/` 下 `.ts/.tsx/.css` diff：**deleted > added**；
- PR 正文记录 bundle delta 与少量有意 presentation 差异。

## 10. 实施顺序

1. 加 `motion`，记录 baseline artifact size；
2. 先迁 FX-owned transient primitives，边迁边删 timer/reflow/keyframe；
3. 加 piece motion wrapper，再迁 move/lunge/hit/deploy/death；
4. 迁收益明确的 React lifecycle/layout；
5. 删除失去 owner 的 CSS，只做必要 token 整理；
6. 收紧 E2E 等待，跑完整验证，记录 LOC / bundle delta。

不保留新旧动画 feature flag；Git commit/branch 即 rollback 单位。

## 11. 自审准则

实现前后都检查：

1. Motion 原生 API 能完成的事情，是否又包了一层？
2. 新 helper/module 是否真实减少重复/总代码，或集中必要 cleanup？
3. 某动画留 CSS 是否更短、更清晰？
4. 是否改变 GameEvent、busy、choice、deploy、death 时序？
5. 是否新增仅服务“未来扩展”的 manager/interface/file？
6. 生产源码是否达到 **deleted > added**？若没有，优先继续减实现。

最终目标：**用成熟库替掉自维护 animation plumbing，让表现层更稳、更现代，同时代码更少。**
