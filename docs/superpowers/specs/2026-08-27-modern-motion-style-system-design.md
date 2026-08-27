# 「浩劫」现代动画与样式系统设计

- **日期**：2026-08-27
- **状态**：设计已与用户逐节确认；本文为最终收敛版，覆盖前期讨论中更复杂的 runtime/session/token 方案
- **基线**：`main` @ `ef1d7d3a860af7fe937c274d07a0282a963a3171`
- **范围**：表现层动画基础设施与小范围样式整理；不修改玩法、GameEvent schema 或 engine
- **实现原则**：引入成熟动画库是为了删除自维护动画代码，而不是再造一层动画框架

---

## 1. 背景与目标

当前 React/TypeScript 迁移已经完成，分层边界明确：

- `src/engine/**`：纯逻辑，零 DOM / React；
- React：拥有结构和终态渲染；
- `src/ui/fx/fx.ts`：按 GameEvent 顺序驱动命令式战斗演出；
- CSS Modules：负责组件样式和大量 keyframe / transition。

现在的主要债务集中在动画执行层：`fx.ts` 使用 `sleep()`、`setTimeout()`、`style.transition`、强制 reflow 和临时 class 来推断动画结束；部分 React lifecycle 动画又以 CSS keyframe 实现并存在 global/module 重复定义。

**目标**：引入 Motion，用库提供的 animation lifecycle 替换手写 timing/cleanup，同时保持现有游戏时序和 ownership 不变，并让生产源码整体更短。

### 成功标准

1. 玩法、数值、GameEvent 生成与顺序不变；
2. React / FX / CSS 的 ownership 更清晰，但不增加新的框架层；
3. Motion 接管的动画不再依赖固定 `sleep()` / cleanup `setTimeout()` / 强制 reflow；
4. `dist/index.html` 继续是零外链、可 `file://` 运行的单文件；
5. **实施 PR 中 `src/**/*.ts|tsx|css` 的删除行数必须大于新增行数**。如果达不到，合并前必须先重新审视并删除不必要的抽象。

> 第 5 条只统计生产源码与 CSS；lockfile、测试、文档和依赖清单不参与该净行数指标。

---

## 2. 非目标

本次不做：

- engine 重构或规则修复；
- GameEvent schema 重设计；
- 状态管理库；
- 新棋盘/卡牌视觉设计；
- 新技能演出、复杂粒子、3D 卡牌、声音系统；
- Canvas / WebGL / PixiJS / GSAP；
- Tailwind / CSS-in-JS / 主题系统；
- 大规模 CSS rename / 全量 design-token 化；
- 移动端专项重构。

发现与本任务无关的 engine bug 时，记录为 follow-up，不混入本 PR。

---

## 3. 依赖与 bundle 策略

新增唯一运行时依赖：

```json
"motion": "13.1.1"
```

该版本于 2026-08-27 核实为 npm `latest`，MIT License。

使用方式：

```ts
// React-owned lifecycle/layout
import { motion, AnimatePresence, MotionConfig } from "motion/react";

// imperative gameplay FX
import { animate } from "motion";
```

### 3.1 默认不使用 LazyMotion

本项目由 `vite-plugin-singlefile` 打成一个自包含 HTML，动态 feature chunk 没有实际网络收益。`LazyMotion + m` 虽可降低 Motion React bundle，但会增加 provider、feature bundle 和 import 约束。

因此第一实现直接使用标准 `motion/react` API，以源码简洁为优先。只有真实构建显示 Motion 造成不合理的产物膨胀时，才在同一实现 PR 中评估 `m + LazyMotion`。

PR 必须记录：

- 修改前 `dist/index.html` bytes；
- 修改后 bytes；
- absolute / percentage delta。

不预设拍脑袋的 KB 上限。

---

## 4. 动画 ownership

保持并收紧现有边界：

| Owner | 负责 |
|---|---|
| React | 节点创建/销毁、终态内容和坐标 |
| Motion React | React-owned 节点的 enter / exit / layout |
| `fx.ts` + `animate()` | GameEvent 驱动的临时战斗演出 |
| CSS Modules | 静态外观、hover/focus、持续状态、轻量循环 |

铁律：

- `src/ui/fx/**` 不 import React；
- FX 不直接删除 React-owned piece 节点；
- 同一个 CSS property 在同一时段只有一个动画 owner；
- Motion 是动画执行器，不是状态层或新的事件层。

---

## 5. `fx.ts`：以删除代码为第一目标

### 5.1 默认继续单文件

`src/ui/fx/fx.ts` 继续保留 `playChain()` / `playOne()` 和具体 primitive。**不预先新增** `runtime.ts`、`session.ts`、`timings.ts` 或一文件一个 primitive。

允许抽 helper / 文件的判断标准：

- 能消除真实重复并减少总代码；或
- 能把必须重复的 cleanup / cancellation 收拢成更短、更难写错的一处。

“以后可能扩展”本身不是新增抽象的理由。

### 5.2 用 Motion completion 替换动画代理 timer

目标是把这类代码：

```ts
el.style.transition = "...";
el.style.left = "...";
await sleep(340);
```

替换为直接表达真实 completion 的代码：

```ts
await animate(el, { left, top }, options);
```

Motion 接管后应删除对应的：

- `sleep()`（仅用于猜动画结束的场景）；
- cleanup `setTimeout()`；
- 为重启 CSS animation 使用的 `offsetWidth` 强制 reflow；
- temporary animation class / keyframe；
- inline `style.transition`。

**语义 timer 可以保留**，例如 toast 的内容存活时间、React sync point 的事件循环等待；它们不是动画 completion 的替代品。

### 5.3 串行 GameEvent 不变

保持：

```text
GameEvent[]
→ playChain()
→ await playOne(event)
→ next event
```

禁止 `Promise.all(events.map(...))` 一类并行化。

关键动作（move、lunge/projectile、death 等）直接 `await` 动画；纯装饰尾巴（ring、burst、shake tail 等）可 fire-and-forget，使后续事件自然重叠，但不得产生状态副作用。

不为此建立 `blocking/finished` 自定义协议；直接在具体 primitive 中表达即可。

### 5.4 保留现有同步语义

以下均为硬约束：

- `busy` 覆盖整个普通玩家动作及其阻塞 FX；
- choice 输入仍优先于 busy，避免 `await choose()` 死锁；
- deploy：先 `onSyncPoint()` 让 React materialize piece + registry，再播放 deploy FX；
- death：FX 播放完成后继续事件链，piece 最终仍由 React 终态渲染卸载；
- move：正常棋盘位置继续以现有 `left/top + posOf()` 为 authority，不改成新的 x/y 坐标体系。

### 5.5 Piece 只增加一个必要 wrapper

当前 selected/persistent transform 与 lunge/hit/death temporary transform 存在 ownership 冲突。允许增加一个内部 wrapper：

```html
<div class="piece">              <!-- registry / left / top / click / persistent state -->
  <div data-piece-motion>         <!-- temporary FX transform -->
    ...
  </div>
</div>
```

不继续增加第三层 animation wrapper，也不重构 piece 数据模型。

### 5.6 Restart / unmount cleanup 保持最小

重开或 App unmount 时，旧的命令式动画和 FX-owned transient DOM 不应继续影响新局。

优先使用最短实现：例如在 `fx.ts` 内维护一个很小的 active-controls / transient-nodes 集合和 `resetFx()`；若实际代码能用更少状态完成 cleanup，则采用更少的实现。

不预先设计 `FxSession`、generation framework 或通用 animation manager。只有真实 stale-animation bug 证明简单 cleanup 不足时才升级。

预期 cancellation 应 silent；不得因用户正常 restart 产生 unhandled rejection / error spam。

---

## 6. React Motion 的使用范围

只迁收益明确、并能删除 CSS lifecycle/keyframe 代码的 React UI。

### 首选迁移

- `CodexModal`：overlay/card enter/exit；
- `OptionFloat`：enter/exit；
- `WinMask`：overlay/content enter/exit；持续 `winGlow` 留 CSS；
- `ToastHost`：数据 lifetime 仍由 React timer 管，enter/exit 由 `AnimatePresence` 管；
- `Hand` / `Stored`：增删和重排使用 layout animation。

### 可选

`LogPanel` 只有在迁移能让实现更短时才使用 Motion，否则保留现有 CSS animation。

### 明确保留 CSS

- card / button hover；
- HP bar width transition；
- board target pulse；
- shield / wobble / charged / selected 等 persistent state；
- 其它纯 CSS 能更短表达的轻量循环。

禁止为了“统一 Motion”机械地把所有 `:hover` 改成 `whileHover`。

---

## 7. CSS 清理与 tokens

原则：**先删除 Motion 已接管的债务，再考虑 token。**

Motion 接管后删除相应的：

- piece `pop-in` / `dying` / `hit-jolt` 等 temporary FX keyframes；
- Modal / OptionFloat / Toast 等 lifecycle keyframes；
- 因 CSS Modules keyframe hashing 而产生、现已不再需要的 global/module 重复定义；
- 对应 transition / reflow workaround。

现有 CSS Modules 架构不变。

Design token 只整理本次实际触及且跨组件重复明显的值；单组件尺寸、padding 等继续留本地。旧 `--p1` / `--p2` / `--gold` 等变量无需为了命名美观做全仓 rename。

普通 UI duration 可以 CSS variable 化；gameplay FX timing 留在 TS 中，避免把演出顺序和主题样式混在一起。

---

## 8. Reduced Motion

React 侧使用 Motion 的 `MotionConfig reducedMotion="user"` 或等价官方能力。

命令式 FX 读取 `prefers-reduced-motion`，降低时长/位移/摇晃强度；事件顺序、await 点和游戏逻辑保持同一条流程，不另建 reduced-motion 业务分支。

持续状态不能因 reduced motion 失去信息：可从旋转/晃动降级为静态 glow，而不是完全隐藏状态。

---

## 9. 测试与验收

### 9.1 保持现有测试体系

不新增 Vitest / Jest / jsdom / Playwright。继续使用现有 Node engine tests 与真实 Edge E2E。

engine 逻辑本次不应发生功能修改；出现 engine regression 时优先判断为表现层重构越界，而不是修改规则测试。

### 9.2 E2E 只补关键风险

重点验证：

- choice 在 busy 时仍可完成；
- deploy sync 后 registry 可找到新 piece；
- death 后由 React 正确卸载；
- 动画进行中 restart 后没有旧 transient FX / runtime error；
- reduced motion 不死锁且最终状态一致。

现有长固定等待（例如动作后的 2500ms）应尽量改为等待真实 DOM / busy 条件；若现有可观察状态足够，不扩建 debug API。只有无法稳定表达条件时才增加最小只读观测点。

### 9.3 PR Gate

实施 PR 合并前至少执行：

```text
npm run typecheck
npm test
npm run build
现有 + 必要新增 Edge E2E
```

并确认：

- `verify-singlefile` 通过；
- `dist/index.html` 为唯一正式产物，无 CDN / runtime chunk request；
- console 无新增 unhandled rejection / runtime error；
- Motion 接管处没有遗留“timer 猜 completion”的代码；
- `src/**/*.ts|tsx|css` diff **deleted > added**；
- PR 正文记录 bundle delta 和少量有意 presentation 差异。

---

## 10. 实施顺序

实施时按低风险到高风险推进，每一步保持可构建：

1. 加 `motion`，记录 baseline artifact size；
2. 先迁 FX-owned transient primitives，删除 timer/reflow/keyframe 代码；
3. 加 piece motion wrapper，再迁 move/lunge/hit/deploy/death；
4. 迁收益明确的 React lifecycle/layout 动画；
5. 删除失去 owner 的 CSS/keyframes，并只做必要 token 整理；
6. 收紧 E2E 等待条件、跑完整验证、记录 LOC 和 bundle delta。

不保留新旧动画 feature flag；Git commit / branch 本身就是 rollback 单位。

---

## 11. 自审规则

Spec 和后续 implementation review 都必须主动检查：

1. **库 API 已经解决的问题，是否又包了一层自己的 API？**
2. **新增 helper / abstraction 是否实际消除了重复、减少了总代码，或集中了一段必须一致的 cleanup？**
3. **某个动画留在 CSS 是否反而更短、更清晰？**
4. **是否改变了 GameEvent、busy、choice、deploy、death 的既有时序？**
5. **是否出现仅为“未来扩展”服务的新 manager/interface/file？**
6. **生产源码是否达到 deleted > added？未达到时先减设计，而不是解释抽象。**

最终目标不是“Motion 使用率最大化”，而是：

> **用成熟库替掉自维护动画 plumbing，使《浩劫》的表现层更现代、更稳，同时代码更少。**
