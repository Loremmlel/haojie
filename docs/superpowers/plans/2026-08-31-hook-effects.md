# 棋子效果钩子系统重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「浩劫」引擎里散落 5 个文件的 `if (defId === N)` 硬编码效果分支，全部收编进单一 `effects.ts`（`PieceEffect` 基类 + `EFFECTS` 注册表 + `getEffect` 兜底），引擎各触发点改为调用钩子，行为逐字节不变。

**Architecture:** 新增纯几何层 `geometry.ts` 打破 import 环；新增 `effects.ts` 承载全部棋子效果（查询钩子 + 触发器钩子 + 主动技能）；`rules.ts` 变转发层；`engine.ts`/`game.ts` 的管线在固定触发点调用钩子；`abilities.ts` 删除；`data.ts` 数据化（`big`/`form`/`SPECIALS`）。

**Tech Stack:** TypeScript（strict + erasableSyntaxOnly）、node:test（`node --experimental-strip-types --test`）、Vite 单文件构建。

**Spec:** `docs/superpowers/specs/2026-08-31-hook-effects-design.md`

## Global Constraints

- **行为逐字节不变**：现有 `tests/engine.test.ts`（398 行）+ `tests/fx.test.ts` + 随机整局 + 悔棋逐字节还原断言，每个任务结束必须全绿。
- **红线 1 · 随机数顺序**：`rng` 为种子推进（mulberry32，`state.seed` 原地更新）。钩子必须挂在与旧 if 链**完全相同的位置**，钩子内不增删 `rnd()` 调用。
- **红线 2 · JSON 快照悔棋**：`Piece` 字段一个不动；`EFFECTS`/`DEFAULT` 为无状态单例（只存行为，不存数据）。
- **红线 3 · import 环纪律**：effects.ts ↔ engine.ts 双向环沿用旧 abilities.ts ↔ engine.ts 模式——所有交叉引用在**调用时**，`EFFECTS` 顶层**只做纯构造**（`new XxxEffect()`），绝不顶层触碰 engine/rules 函数。
- **每步验证**：`npm test`（node --experimental-strip-types --test tests/*.test.ts）+ `npm run typecheck`（tsc --noEmit）。e2e（`npm run build && node tests/e2e/smoke.e2e.mjs`）只在 Task 8 最终回归跑一次。
- **提交**：每个任务一个 commit，lowercase conventional message，全部落在 `feat/hook-effects` 分支。
- **erasableSyntaxOnly**：不得使用 `abstract`/enum/命名空间/参数属性——基类用具体类（本计划已如此设计）。

---

### Task 1: 纯类型收拢（HandlerCtx / SkillInfo → types.ts）

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/engine/abilities.ts`
- Modify: `src/engine/engine.ts:13`
- Modify: `src/engine/game.ts:11`
- Modify: `src/engine/spells.ts:12`

**Interfaces:**
- Consumes: 现有 `Chooser`/`ChoiceSpec`/`Piece`/`GameState` 类型（state.ts）
- Produces: `types.ts` 导出 `HandlerCtx` 与 `SkillInfo`（后续 effects.ts 从 types.ts 导入 HandlerCtx）

- [ ] **Step 1: 把两个接口移入 types.ts**

在 `src/engine/types.ts` 中，`import type { ChoiceSpec } from './state.ts';` 加入 ChoiceSpec（state.ts 导出的 `ChoiceSpec`），删除 `import type { SkillInfo } from './abilities.ts';`，追加定义：

```ts
export interface HandlerCtx { choose: Chooser }

export interface SkillInfo {
  label: string;
  usable(p: Piece): boolean;
  targetSpec(st: GameState, p: Piece): ChoiceSpec;
  exec(ctx: HandlerCtx, s: Session, p: Piece, got: ChoiceResult): Promise<void>;
}
```

注意 `Session` 也要从 state.ts 导入（`import type { Session } from './state.ts'`）。

- [ ] **Step 2: abilities.ts 改为从 types.ts 导入**

`src/engine/abilities.ts` 删除本地 `export interface HandlerCtx {...}` 与 `export interface SkillInfo {...}`（约 17-24 行），新增：

```ts
import type { HandlerCtx, SkillInfo } from './types.ts';
```

（`SKILLS: Record<number, SkillInfo>` 与 `DEATHRATTLES: Record<number, (ctx: HandlerCtx, ...) => ...>` 的类型注解继续用，只是类型来源变了。）

- [ ] **Step 3: 更新其余三个 import 来源**

- `src/engine/engine.ts:13`：`import { DEATHRATTLES, type HandlerCtx } from './abilities.ts';` → `import { DEATHRATTLES } from './abilities.ts';` + 新增 `import type { HandlerCtx } from './types.ts';`
- `src/engine/game.ts:11`：`import { SKILLS, type HandlerCtx } from './abilities.ts';` → `import { SKILLS } from './abilities.ts';` + `import type { HandlerCtx } from './types.ts';`
- `src/engine/spells.ts:12`：`import type { HandlerCtx } from './abilities.ts';` → `import type { HandlerCtx } from './types.ts';`

- [ ] **Step 4: 验证**

Run: `npm test && npm run typecheck`
Expected: 全绿（纯类型搬移，零行为变化）。

- [ ] **Step 5: 提交**

```bash
git add src/engine/types.ts src/engine/abilities.ts src/engine/engine.ts src/engine/game.ts src/engine/spells.ts
git commit -m "refactor: move HandlerCtx/SkillInfo pure types into types.ts"
```

---

### Task 2: data.ts 数据化（big / form / SPECIALS）+ state.ts 清硬编码

**Files:**
- Modify: `src/engine/data.ts`
- Modify: `src/engine/state.ts:92`

**Interfaces:**
- Consumes: 现有 `Def` 结构
- Produces: `Def` 新增可选字段 `big?: boolean` 与 `form?: { to: number; keepProb: number }`；`getDef` 语义不变（-1/-2/-3/33 走 `SPECIALS` 映射）；`DEFS[5].big === true`、`DEFS[3].form === { to: 33, keepProb: 1/3 }`（后续 resolveDrawDefId 消费）

- [ ] **Step 1: Def 接口加字段 + getDef 改映射表**

`src/engine/data.ts` 的 `Def` 接口（7-10 行）改为：

```ts
export interface Def { id: number; name: string; emoji: string;
  type: 'follower' | 'spell' | 'base' | 'grave';
  atk: number; hp: number; rng: number; acts: number; mv: number;
  short: string; desc: string; limit?: number; big?: boolean;
  /** 抽到时按概率换成另一形态（名刀 → 刀魂），keepProb 为保持原形态的概率 */
  form?: { to: number; keepProb: number } }
```

`DEFS[3]`（名刀，30-34 行）加 `form: { to: 33, keepProb: 1 / 3 }`；`DEFS[5]`（大肉比，42-46 行）加 `big: true`。

`getDef`（181-187 行）整体替换为映射表查找（同时消灭内部四处 `defId ===` 字面量，供 Task 8 的零字面量守卫测试无豁免通过）：

```ts
const SPECIALS: Record<number, Def> = { [-1]: DEF_BASE, [-2]: DEF_GRAVE, [-3]: DEF_BARRIER, [33]: DEF_BLADE };

export function getDef(defId: number): Def {
  return SPECIALS[defId] ?? DEFS.find((d) => d.id === defId)!;
}
```

- [ ] **Step 2: state.ts 删 `|| defId === 5`**

`src/engine/state.ts:92`：`big: !!def.big || defId === 5,` → `big: !!def.big,`

（DEFS[5] 现在自带 `big: true`，行为逐字节等价。）

- [ ] **Step 3: 验证**

Run: `npm test && npm run typecheck`
Expected: 全绿。

- [ ] **Step 4: 提交**

```bash
git add src/engine/data.ts src/engine/state.ts
git commit -m "refactor: move big/form/SPECIALS into data definitions"
```

---

### Task 3: geometry.ts 抽取（打破 rules ↔ effects 环）

**Files:**
- Create: `src/engine/geometry.ts`
- Modify: `src/engine/rules.ts`（删除已迁出函数，改为 import + re-export）

**Interfaces:**
- Consumes: `Cell`（data.ts）、`GameState`/`Piece` 类型（state.ts）
- Produces: 从 geometry.ts 导出 `DIRS, inBoard, mdist, pieceCells, nearestDist, isFrontal, inLonerZone, bfsEmptyCells`；`bfsEmptyCells(state, p, maxStep, isBlocked?)` 新增可选谓词参数（缺省时行为与旧版完全一致）；rules.ts 以相同名字 re-export，外部 import 零改动

- [ ] **Step 1: 新建 geometry.ts**

```ts
/* geometry.ts · 纯几何助手（零 effects 依赖，打破 rules↔effects 环） */
import { W, H, type Cell } from './data.ts';
import type { GameState, Piece, Owner } from './state.ts';

export const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function inBoard(x: number, y: number): boolean { return x >= 1 && x <= W && y >= 1 && y <= H; }
export function mdist(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** 棋子占据的全部格子 */
export function pieceCells(p: Piece): Cell[] {
  if (!p.big) return [{ x: p.x, y: p.y }];
  const c: Cell[] = [];
  for (const dx of [0, 1]) for (const dy of [0, 1]) c.push({ x: p.x + dx, y: p.y + dy });
  return c;
}

/** 两棋子间的最近格距（按各自占据格两两求最小） */
export function nearestDist(a: Piece, b: Piece): number {
  let best = Infinity;
  for (const ca of pieceCells(a)) for (const cb of pieceCells(b)) {
    const d = mdist(ca.x, ca.y, cb.x, cb.y);
    if (d < best) best = d;
  }
  return best;
}

/** 24 号厚脸皮：来自正面的伤害至多 10。正面 = 攻击者位于受害者朝前线一侧。 */
export function isFrontal(attacker: Piece, victim: Piece): boolean {
  return victim.owner === 0 ? attacker.y > victim.y : attacker.y < victim.y;
}

/** 是否为 23 号独行侠的禁入邻圈（对 owner 阵营而言）。Task 4 将由 effects.blocksAlly 取代并删除。 */
export function inLonerZone(st: GameState, x: number, y: number, owner: Owner): boolean {
  for (const q of st.pieces) {
    if (q.dead || q.defId !== 23 || q.owner !== owner) continue;
    if (mdist(x, y, q.x, q.y) <= 1) return true;
  }
  return false;
}

/** 通用可达空格 BFS（≤maxStep 步，途经不可穿子），含起点。
 *  isBlocked 为逐格禁止谓词（原 inLonerZone 检查）；缺省保持旧行为。 */
export function bfsEmptyCells(state: GameState, p: Piece, maxStep: number,
                              isBlocked?: (x: number, y: number) => boolean): Cell[] {
  const out: Cell[] = [{ x: p.x, y: p.y }];
  if (maxStep <= 0) return out;
  const occupied = new Set<string>();
  for (const q of state.pieces) {
    if (q.dead || q.uid === p.uid) continue;
    for (const c of pieceCells(q)) occupied.add(c.x + ',' + c.y);
  }
  const seen = new Set<string>([p.x + ',' + p.y]);
  let frontier: Cell[] = [{ x: p.x, y: p.y }];
  for (let step = 0; step < maxStep; step++) {
    const next: Cell[] = [];
    for (const cur of frontier) {
      for (const [dx, dy] of DIRS) {
        const nx = cur.x + dx, ny = cur.y + dy;
        const key = nx + ',' + ny;
        if (!inBoard(nx, ny) || seen.has(key) || occupied.has(key)) continue;
        seen.add(key);
        if (isBlocked ? isBlocked(nx, ny) : inLonerZone(state, nx, ny, p.owner)) continue;
        next.push({ x: nx, y: ny });
        out.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }
  return out;
}
```

（`pieceAt` 从 state.ts 导入但 geometry.ts 未直接用——**删掉这个 import**，geometry 只 import `W, H, Cell` 与类型。）

- [ ] **Step 2: rules.ts 迁出并 re-export**

`src/engine/rules.ts`：删除 `DIRS`（9 行）、`inBoard`（11 行）、`mdist`（12-14 行）、`pieceCells`（17-22 行）、`nearestDist`（25-32 行）、`inLonerZone`（62-68 行）、`bfsEmptyCells`（71-97 行）、`isFrontal`（292-295 行）的定义。文件头 import 改为：

```ts
import { getDef, W, H, type Cell } from './data.ts';
import { pieceAt, type GameState, type Owner, type Piece } from './state.ts';
import { inBoard, pieceCells, nearestDist, bfsEmptyCells, DIRS, inLonerZone } from './geometry.ts';

/** 保持外部（UI / 测试）既有 import 面零改动 */
export { mdist, inBoard, pieceCells, nearestDist, bfsEmptyCells, DIRS, isFrontal, inLonerZone } from './geometry.ts';
```

（`W`/`H` 必须保留：`baseDeployRows`/`computeExtraRows` 用 H，`deployCells` 用 W/H。）

- [ ] **Step 3: 验证**

Run: `npm test && npm run typecheck`
Expected: 全绿（纯搬移 + 默认谓词保持 inLonerZone 行为）。

- [ ] **Step 4: 提交**

```bash
git add src/engine/geometry.ts src/engine/rules.ts
git commit -m "refactor: extract pure geometry helpers into geometry.ts"
```

---

### Task 4: effects.ts 基座 + 查询层 + rules.ts 翻转

**Files:**
- Create: `src/engine/effects.ts`（基座 + 7 个查询类）
- Modify: `src/engine/rules.ts`（查询函数改 re-export；canDeployAt/computeExtraRows 数据化；删 inLonerZone）
- Modify: `src/engine/geometry.ts`（删 inLonerZone）
- Modify: `src/engine/abilities.ts:190`（21 神行的 bfsEmptyCells 传谓词）

**Interfaces:**
- Consumes: geometry 助手、state 类型、engine 的 `dealDamage/killPiece/heal/flushDeaths/performAttack`（调用时）、`HandlerCtx`（types.ts）
- Produces: effects.ts 导出 `PieceEffect`、`EFFECTS`、`getEffect(defId)`、`effRange/effAtk/effActions/effMv/moveTargets/attackTargets`（转发）、`blocksAlly(st,x,y,owner)`、`resolveDrawDefId(state,defId)`。rules.ts re-export 同名单，外部零改动。

- [ ] **Step 1: 新建 effects.ts（基座 + 查询类）**

完整内容（本任务只含基座与 7 个查询类；Task 5 追加其余 15 个类并扩展注册表）：

```ts
/* effects.ts · 棋子效果之家：PieceEffect 基类 + EFFECTS 注册表 + 全局助手
 * 钩子只收编「以 defId 分发的硬编码分支」；状态驱动的通用管线步骤留在 engine。
 * 与 engine.ts 存在调用时循环引用（旧 abilities.ts↔engine.ts 同构）：
 * EFFECTS 顶层只做纯构造，交叉调用一律发生在运行时。 */

import { getDef, W, H, type Cell } from './data.ts';
import { rnd } from './rng.ts';
import { PNAME, ev, pushLog, makePiece, pieceAt,
         type Session, type GameState, type Piece, type Owner, type ChoiceSpec, type ChoiceResult } from './state.ts';
import { mdist, inBoard, pieceCells, nearestDist, bfsEmptyCells, DIRS, isFrontal } from './geometry.ts';
import type { HandlerCtx } from './types.ts';
import { dealDamage, killPiece, heal, flushDeaths, performAttack } from './engine.ts';

/* ── 通用助手 ── */
function foesOf(state: GameState, owner: number): Piece[] {
  return state.pieces.filter((q) => !q.dead && q.owner !== owner);
}
/** 敌方随从（不含基地） */
function foeFollowers(state: GameState, owner: number): Piece[] {
  return foesOf(state, owner).filter((q) => getDef(q.defId).type === 'follower' || getDef(q.defId).type === 'grave');
}
/** 己方随从（不含基地） */
function myFollowers(state: GameState, owner: number): Piece[] {
  return state.pieces.filter((q) => !q.dead && q.owner === owner &&
    (getDef(q.defId).type === 'follower' || getDef(q.defId).type === 'grave'));
}
/** 12 号贴脸：与任意敌方距离 1 格 */
function adjacentFoe(st: GameState, p: Piece): boolean {
  return st.pieces.some((q) => !q.dead && q.owner !== p.owner && nearestDist(p, q) === 1);
}
/** 33 号刀魂的 n：以其为中心 3×3 内随从数量（双方、含自身、实时计算） */
function bladeN(st: GameState, p: Piece): number {
  let n = 0;
  for (const q of st.pieces) {
    if (q.dead) continue;
    const t = getDef(q.defId).type;
    if (t !== 'follower' && t !== 'grave') continue;
    for (const c of pieceCells(q)) {
      if (Math.abs(c.x - p.x) <= 1 && Math.abs(c.y - p.y) <= 1) { n++; break; }
    }
  }
  return Math.max(1, n);
}

/* ═════════════ 基类：默认实现 = 无特殊棋子的旧行为 ═════════════ */
export class PieceEffect {
  // ── 静态属性（定义性事实）──
  buffable = true;          // 10 投石机 = false（6 BUFF怪 增益过滤）
  isCatapult = false;       // 10 投石机 = true（标记引爆防御性守卫）

  // ── 查询钩子（纯函数）──
  effRange(_st: GameState, p: Piece): number { return p.range; }
  effAtk(st: GameState, p: Piece): number {
    let a = p.atk;
    for (const b of p.atkBuffs) if (st.turnCounter < b.until) a += b.amt;
    return a;
  }
  effActions(_st: GameState, p: Piece): number { return getDef(p.defId).acts; }
  effMv(_st: GameState, p: Piece): number { return p.mv; }
  /** 攻击目标计算用的射程（4 号蓄满 +1 的接缝，不外泄到 effRange 消费方） */
  attackRange(st: GameState, p: Piece): number { return this.effRange(st, p); }
  moveTargets(st: GameState, p: Piece): Cell[] {
    if (p.big) {
      const out: Cell[] = [];
      const occupied = new Set<string>();
      for (const q of st.pieces) {
        if (q.dead || q.uid === p.uid) continue;
        for (const c of pieceCells(q)) occupied.add(c.x + ',' + c.y);
      }
      for (const [dx, dy] of DIRS) {
        let ok = true;
        for (const c of pieceCells(p)) {
          const nx = c.x + dx, ny = c.y + dy;
          if (!inBoard(nx, ny) || occupied.has(nx + ',' + ny) || blocksAlly(st, nx, ny, p.owner)) { ok = false; break; }
        }
        if (ok) out.push({ x: p.x + dx, y: p.y + dy });
      }
      return out;
    }
    return bfsEmptyCells(st, p, this.effMv(st, p), (x, y) => blocksAlly(st, x, y, p.owner));
  }
  attackTargets(st: GameState, p: Piece): Piece[] {
    const out: Piece[] = [];
    const rngEff = this.attackRange(st, p);
    const myCells = new Set<string>(pieceCells(p).map((c) => c.x + ',' + c.y));
    const candidates = st.pieces.filter((q) =>
      !q.dead && q.owner !== p.owner && nearestDist(p, q) <= rngEff);
    for (const t of candidates) {
      const tKeys = new Set<string>(pieceCells(t).map((c) => c.x + ',' + c.y));
      const dist = new Map<string, number>();
      let frontier: string[] = [];
      for (const k of myCells) { dist.set(k, 0); frontier.push(k); }
      let reach = -1;
      bfs:
      while (frontier.length) {
        const next: string[] = [];
        for (const key of frontier) {
          const d0 = dist.get(key)!;
          if (d0 >= rngEff) continue;
          const [cx, cy] = key.split(',').map(Number);
          for (const [dx, dy] of DIRS) {
            const nx = cx + dx, ny = cy + dy;
            if (!inBoard(nx, ny)) continue;
            const nk = nx + ',' + ny;
            if (dist.has(nk)) continue;
            if (tKeys.has(nk)) { if (d0 + 1 <= rngEff) { reach = d0 + 1; break bfs; } continue; }
            const occ = pieceAt(st, nx, ny);
            if (occ && occ.owner !== p.owner) continue;
            dist.set(nk, d0 + 1);
            next.push(nk);
          }
        }
        frontier = next;
      }
      if (reach >= 0) out.push(t);
    }
    return out;
  }
  modifyIncomingDamage(_st: GameState, _target: Piece, amount: number,
                       _src: Piece | null, _opts: { hit?: boolean }): { amount: number; frontal: boolean } {
    return { amount, frontal: false };
  }
  modifyAttackDamage(_st: GameState, _p: Piece, _target: Piece, dmg: number): { dmg: number; crit: boolean } {
    return { dmg, crit: false };
  }

  // ── 触发器钩子（副作用，默认空）──
  async onDeploy(_ctx: HandlerCtx, _s: Session, _p: Piece): Promise<void> {}
  async onTurnStart(_ctx: HandlerCtx, _s: Session, _p: Piece): Promise<void> {}
  async onMoveCommand(_ctx: HandlerCtx, _s: Session, _p: Piece, _x: number, _y: number): Promise<boolean> { return false; }
  async onAttackSelected(_ctx: HandlerCtx, _s: Session, _p: Piece, _t: Piece): Promise<boolean> { return false; }
  async onAttack(_ctx: HandlerCtx, _s: Session, _p: Piece, _target: Piece): Promise<boolean> { return false; }
  async onAttackDone(_ctx: HandlerCtx, _s: Session, _p: Piece, _target: Piece): Promise<void> {}
  async onDamaged(_ctx: HandlerCtx, _s: Session, _target: Piece, _amount: number,
                  _src: Piece | null, _opts: { noCounter?: boolean }): Promise<void> {}
  async onKill(_ctx: HandlerCtx, _s: Session, _killer: Piece, _victim: Piece): Promise<void> {}
  async onDeath(_ctx: HandlerCtx, _s: Session, _victim: Piece, _killer: Piece | null): Promise<void> {}

  // ── 全局查询钩子 ──
  blocksAllyCell(_st: GameState, _p: Piece, _x: number, _y: number, _owner: Owner): boolean { return false; }
  guardsAlly(_st: GameState, _blade: Piece, _ally: Piece): boolean { return false; }

  // ── 主动技能（无则缺省）──
  skillLabel?: string;
  skillUsable?(_p: Piece): boolean { return true; }
  skillTargetSpec?(_st: GameState, _p: Piece): ChoiceSpec { return { kind: 'none' }; }
  async skillExec?(_ctx: HandlerCtx, _s: Session, _p: Piece, _got: ChoiceResult): Promise<void> {}
}

/* ═════════════ 查询层棋子效果 ═════════════ */

/** 33 刀魂：随 3×3 内随从数实时波动攻/射程（名刀的另一形态，见 3 号 form） */
class BladeEffect extends PieceEffect {
  effRange(st: GameState, p: Piece): number { return bladeN(st, p); }
  effAtk(st: GameState, p: Piece): number {
    const now = st.turnCounter;
    let a = bladeN(st, p) * 40;
    for (const b of p.atkBuffs) if (now < b.until) a += b.amt;
    return a;
  }
}

/** 12 跑得快：贴脸减速减攻速（一个实现，旧 effActions/effMv 双份重复的收敛点）；遗言留墓地 */
class SpeedyEffect extends PieceEffect {
  effActions(st: GameState, p: Piece): number {
    let n = getDef(p.defId).acts;
    if (adjacentFoe(st, p)) n -= 1;
    return Math.max(0, n);
  }
  effMv(st: GameState, p: Piece): number {
    let m = p.mv;
    if (adjacentFoe(st, p)) m -= 1;
    return Math.max(0, m);
  }
  async onDeath(_ctx: HandlerCtx, s: Session, victim: Piece): Promise<void> {
    const grave = makePiece(s.state, victim.owner, -2, victim.x, victim.y);
    grave.justDeployed = false;
    s.state.pieces.push(grave);
    ev(s, { type: 'deploy', uid: grave.uid });
    pushLog(s.state, `👟 跑得快倒下了，原地留下一座墓地（0/70）。`);
  }
}

/** 13 直行侠：每次移动必须直线冲整整三格 */
class StraightEffect extends PieceEffect {
  moveTargets(st: GameState, p: Piece): Cell[] {
    const out: Cell[] = [];
    const occupied = new Set<string>();
    for (const q of st.pieces) {
      if (q.dead || q.uid === p.uid) continue;
      for (const c of pieceCells(q)) occupied.add(c.x + ',' + c.y);
    }
    for (const [dx, dy] of DIRS) {
      let ok = true;
      for (let i = 1; i <= 3; i++) {
        const nx = p.x + dx * i, ny = p.y + dy * i;
        if (!inBoard(nx, ny) || occupied.has(nx + ',' + ny) || blocksAlly(st, nx, ny, p.owner)) { ok = false; break; }
      }
      if (ok) out.push({ x: p.x + dx * 3, y: p.y + dy * 3 });
    }
    return out;
  }
}

/** 9 射手：一回合两次攻击不可指定同一目标 */
class ArcherEffect extends PieceEffect {
  attackTargets(st: GameState, p: Piece): Piece[] {
    return super.attackTargets(st, p).filter((t) => !p.hitThisTurn.includes(t.uid));
  }
  async onAttackDone(_ctx: HandlerCtx, _s: Session, p: Piece, target: Piece): Promise<void> {
    p.hitThisTurn.push(target.uid);
  }
}

/** 4 定炮：蓄力两回合才能开炮，蓄满 5 格射程 +1；行动仅蓄力/开炮 */
class CannonEffect extends PieceEffect {
  attackRange(st: GameState, p: Piece): number {
    return this.effRange(st, p) + (p.charge >= 5 ? 1 : 0);
  }
  attackTargets(st: GameState, p: Piece): Piece[] {
    if (p.charge < 2) return [];
    return super.attackTargets(st, p);
  }
  async onAttackDone(_ctx: HandlerCtx, _s: Session, p: Piece): Promise<void> { p.charge = 0; }
  skillLabel = '⚡ 蓄力';
  skillUsable(p: Piece): boolean { return p.charge < 5; }
  skillTargetSpec(): ChoiceSpec { return { kind: 'none' }; }
  async skillExec(_ctx: HandlerCtx, s: Session, p: Piece): Promise<void> {
    p.charge++;
    ev(s, { type: 'buff', uid: p.uid });
    pushLog(s.state, `🎯 定炮蓄力中……（${p.charge}/5）`);
  }
}

/** 23 独行侠：两回合一动爆发六次；周围一圈禁入友军 */
class LonerEffect extends PieceEffect {
  effActions(_st: GameState, p: Piece): number { return p.beatCount % 2 === 0 ? 6 : 0; }
  async onTurnStart(_ctx: HandlerCtx, _s: Session, p: Piece): Promise<void> { p.beatCount++; }
  blocksAllyCell(_st: GameState, p: Piece, x: number, y: number, owner: Owner): boolean {
    return p.owner === owner && mdist(x, y, p.x, p.y) <= 1;
  }
}

/** 21 神行千里：蓄气两回合后扣 10 血瞬移六格并出手一次 */
class TeleporterEffect extends PieceEffect {
  skillLabel = '🌀 神行千里';
  skillUsable(p: Piece): boolean { return p.charge >= 2 && p.hp > 10; }
  skillTargetSpec(): ChoiceSpec { return { kind: 'none' }; }
  async skillExec(ctx: HandlerCtx, s: Session, p: Piece): Promise<void> {
    p.hp -= 10;
    p.charge = 0;
    ev(s, { type: 'damage', uid: p.uid, amount: 10 });
    pushLog(s.state, `🌀 神行千里发动！扣除 10 血（${p.hp}/${p.maxHp}），请选择落点（≤6 格）。`, 'l-impt');
    const cells = bfsEmptyCells(s.state, p, 6, (x, y) => blocksAlly(s.state, x, y, p.owner));
    const dest = (await ctx.choose({ kind: 'cell', cells, hint: '神行：选择落点（可原地不动）' })) as Cell;
    if (dest.x !== p.x || dest.y !== p.y) {
      ev(s, { type: 'move', uid: p.uid, tx: dest.x, ty: dest.y });
      p.x = dest.x; p.y = dest.y;
    }
    const targets = attackTargets(s.state, p);
    if (!targets.length) { pushLog(s.state, '🌀 周围没有可攻击的目标，神行结束。'); return; }
    const t = await ctx.choose({ kind: 'piece', pieces: targets, hint: '进行一次攻击（取消则放弃）', cancelable: true });
    if (!t) { pushLog(s.state, '🌀 放弃了攻击。'); return; }
    await performAttack(ctx, s, p, t as Piece);
  }
}

/* ═════════════ 注册表 / 兜底 / 转发 / 全局助手 ═════════════ */
export const EFFECTS: Record<number, PieceEffect> = {
  4: new CannonEffect(), 9: new ArcherEffect(), 12: new SpeedyEffect(),
  13: new StraightEffect(), 21: new TeleporterEffect(), 23: new LonerEffect(),
  33: new BladeEffect(),
};

const DEFAULT = new PieceEffect();
/** 未注册的特殊单位（-1 基地 / -2 墓地 / -3 路障）兜底返回默认实例，杜绝 undefined 崩溃 */
export function getEffect(defId: number): PieceEffect { return EFFECTS[defId] ?? DEFAULT; }

export function effRange(st: GameState, p: Piece): number { return getEffect(p.defId).effRange(st, p); }
export function effAtk(st: GameState, p: Piece): number { return getEffect(p.defId).effAtk(st, p); }
export function effActions(st: GameState, p: Piece): number { return getEffect(p.defId).effActions(st, p); }
export function effMv(st: GameState, p: Piece): number { return getEffect(p.defId).effMv(st, p); }
export function moveTargets(st: GameState, p: Piece): Cell[] { return getEffect(p.defId).moveTargets(st, p); }
export function attackTargets(st: GameState, p: Piece): Piece[] { return getEffect(p.defId).attackTargets(st, p); }

/** 全局：某棋子效果是否阻止 owner 方进入 (x,y)（23 独行侠禁入圈） */
export function blocksAlly(st: GameState, x: number, y: number, owner: Owner): boolean {
  for (const q of st.pieces) {
    if (q.dead) continue;
    if (getEffect(q.defId).blocksAllyCell(st, q, x, y, owner)) return true;
  }
  return false;
}

/** 抽牌形态判定（名刀 → 刀魂）。game.ts 与 spells.ts 共用，消灭重复。 */
export function resolveDrawDefId(state: GameState, defId: number): number {
  const form = getDef(defId).form;
  if (form && rnd(state) >= form.keepProb) return form.to;
  return defId;
}
```

- [ ] **Step 2: geometry.ts 删 inLonerZone + bfsEmptyCells 强制谓词**

`src/engine/geometry.ts`：删除 `inLonerZone` 定义；`bfsEmptyCells` 的缺省回退删除，签名改为 `bfsEmptyCells(state, p, maxStep, isBlocked: (x: number, y: number) => boolean)`，循环内 `if (isBlocked(nx, ny)) continue;`。

- [ ] **Step 3: rules.ts 翻转（查询转发 + 数据化）**

`src/engine/rules.ts`：
- 删除 `effRange`（49-51 行）、`effAtk`（54-59 行）、`effActions`（163-175 行）、`effMv`（178-187 行）、`moveTargets`（192-228 行）、`attackTargets`（237-282 行）的旧实现。
- import 行替换为：

```ts
import { getDef, W, H, type Cell } from './data.ts';
import { pieceAt, type GameState, type Owner, type Piece } from './state.ts';
import { inBoard, nearestDist } from './geometry.ts';
import { blocksAlly, effRange } from './effects.ts';

/** 保持外部（UI / 测试）既有 import 面零改动 */
export { mdist, inBoard, pieceCells, nearestDist, DIRS } from './geometry.ts';
export { effRange, effAtk, effActions, effMv, moveTargets, attackTargets } from './effects.ts';
```

- `canDeployAt`（136-149 行）：`const cells = defId === 5 ? [...] : [{x,y}]` → `const cells = getDef(defId).big ? [...] : [{ x, y }];`；`if (inLonerZone(state, c.x, c.y, owner)) return false;` → `if (blocksAlly(state, c.x, c.y, owner)) return false;`
- `computeExtraRows`（113-128 行）：`if (p.dead || p.defId === -1) continue;` → `if (p.dead || getDef(p.defId).type === 'base') continue;`
- `healTargets` 保留原样（其 `effRange` 现来自 effects 转发）。

- [ ] **Step 4: abilities.ts 的 21 神行传谓词**

`src/engine/abilities.ts` 的 `SKILLS[21].exec`（约 190 行）：`const cells = bfsEmptyCells(s.state, p, 6);` → `const cells = bfsEmptyCells(s.state, p, 6, (x, y) => blocksAlly(s.state, x, y, p.owner));`，并在文件头加 `import { blocksAlly } from './effects.ts';`。

- [ ] **Step 5: 验证**

Run: `npm test && npm run typecheck`
Expected: 全绿。此步后所有查询类行为（射程/攻/行动/移速/目标）都已经 effects 转发生效；未注册棋子走 DEFAULT 与旧行为一致。

- [ ] **Step 6: 提交**

```bash
git add src/engine/effects.ts src/engine/geometry.ts src/engine/rules.ts src/engine/abilities.ts
git commit -m "refactor: route query layer through effects registry"
```

---

### Task 5: effects.ts 触发器/技能类 + engine.ts 管线翻转

**Files:**
- Modify: `src/engine/effects.ts`（追加 15 个类并扩展 EFFECTS）
- Modify: `src/engine/engine.ts`（管线改钩子；`=== -1` 数据化）

**Interfaces:**
- Consumes: Task 4 的基类/助手/注册表
- Produces: `getEffect(defId).onDeath/onDeploy/onAttack/onAttackDone/onDamaged/onKill/onAttackSelected/onMoveCommand/onTurnStart/onKill/skill*` 全部就绪；engine.ts 的 `flushDeaths/dealDamage/performAttack/deployPiece/killPiece/checkWin/hasBladeGuard` 只经 `getEffect` 分发

- [ ] **Step 1: effects.ts 追加触发器/技能类**

在查询类之后、注册表之前追加以下类（保持「类在 EFFECTS 之前」的顺序）：

```ts
/** 1 冲锋怪：伤害随机波动；部署可 -10 血换冲锋 */
class ChargerEffect extends PieceEffect {
  modifyAttackDamage(st: GameState, _p: Piece, _target: Piece, dmg: number): { dmg: number; crit: boolean } {
    const r = rnd(st);
    if (r < 1 / 12) return { dmg: dmg + 60, crit: true };
    if (r < 1 / 4) return { dmg: dmg + 20, crit: false };
    return { dmg, crit: false };
  }
  async onDeploy(ctx: HandlerCtx, s: Session, p: Piece): Promise<void> {
    const choice = await ctx.choose({
      kind: 'option',
      options: [
        { label: '⚡ 获得冲锋（−10 血）', value: 'charge' },
        { label: '🛡️ 保持满血', value: 'normal' },
      ],
      hint: '冲锋怪：是否牺牲 10 血量换取部署当回合即可行动？',
    });
    if (choice === 'charge') {
      p.hp -= 10;
      p.justDeployed = false;
      p.apLeft = this.effActions(s.state, p);
      pushLog(s.state, '⚔️ 冲锋怪嘶吼着冲入了战场！（本回合即可行动）', 'l-impt');
      ev(s, { type: 'buff', uid: p.uid });
    }
  }
}

/** 2 奶妈：可治疗友方（doAttack 层接管）；死亡时无视距离反击 */
class HealerEffect extends PieceEffect {
  async onAttackSelected(_ctx: HandlerCtx, s: Session, p: Piece, t: Piece): Promise<boolean> {
    if (t.hp >= t.maxHp) return false;
    if (nearestDist(p, t) > p.range) return false;
    snap(s); p.apLeft--;
    pushLog(s.state, `💉 奶妈为【${getDef(t.defId).name}】回复了 20 血量。`);
    ev(s, { type: 'attack', uid: p.uid, tuid: t.uid, healMode: true });
    await heal(s, t, 20);
    return true;
  }
  async onDeath(ctx: HandlerCtx, s: Session, victim: Piece): Promise<void> {
    const foes = foesOf(s.state, victim.owner);
    if (!foes.length) return;
    const t = await ctx.choose({
      kind: 'piece', pieces: foes, cancelable: true,
      hint: `奶妈的遗言：选择一名敌方单位进行无视距离的反击（20 伤害，可取消）`,
    });
    if (!t) { pushLog(s.state, '💉 奶妈安详地离去了……'); return; }
    pushLog(s.state, `💉 奶妈的遗言发动！无视距离对【${getDef((t as Piece).defId).name}】造成 20 伤害！`, 'l-impt');
    await dealDamage(s, t as Piece, victim.atk, null, {});
  }
}

/** 3 名刀（守护灵形态）：射程 6 内友方各自免死一次 */
class KatanaGuardEffect extends PieceEffect {
  guardsAlly(_st: GameState, blade: Piece, ally: Piece): boolean {
    return nearestDist(blade, ally) <= 6;
  }
}

/** 5 大肉比：先蓄势一回合再整体平移一格 */
class BigChargeEffect extends PieceEffect {
  async onMoveCommand(_ctx: HandlerCtx, s: Session, p: Piece, x: number, y: number): Promise<boolean> {
    if (p.charge <= 0) {
      snap(s);
      p.charge = 1;
      p.apLeft--;
      ev(s, { type: 'buff', uid: p.uid });
      pushLog(s.state, '🐘 大肉比深深蓄势……下次选择移动才会真正挪动！');
      return true;
    }
    const legal = this.moveTargets(s.state, p).some((c) => c.x === x && c.y === y);
    if (!legal) return false;
    snap(s);
    p.charge = 0;
    ev(s, { type: 'move', uid: p.uid, tx: x, ty: y });
    p.x = x; p.y = y;
    p.apLeft--;
    pushLog(s.state, `🐘 大肉比轰隆隆地挪到了 (${x},${y})！`);
    return true;
  }
}

/** 6 BUFF怪：技能令射程内友方下回合 +10 攻击（对投石机无效） */
class BuffGuyEffect extends PieceEffect {
  skillLabel = '📣 增益 +10攻';
  skillUsable(): boolean { return true; }
  skillTargetSpec(st: GameState, p: Piece): ChoiceSpec {
    return {
      kind: 'piece',
      pieces: myFollowers(st, p.owner).filter((q) => q.buffable !== false && nearestDist(p, q) <= this.effRange(st, p)),
      hint: '选择射程内的一名友方棋子获得下回合 +10 攻击（对投石机无效）',
    };
  }
  async skillExec(_ctx: HandlerCtx, s: Session, p: Piece, got: ChoiceResult): Promise<void> {
    const target = got as Piece;
    target.atkBuffs.push({ amt: 10, until: s.state.turnCounter + 3 });
    ev(s, { type: 'buff', uid: target.uid });
    pushLog(s.state, `📣 【${getDef(target.defId).name}】获得下回合 +10 攻击力！`, 'l-impt');
  }
}

/** 7 钩子：技能把射程内一名敌方棋子钩到身边 */
class HookEffect extends PieceEffect {
  skillLabel = '🪝 钩拉';
  skillUsable(): boolean { return true; }
  skillTargetSpec(st: GameState, p: Piece): ChoiceSpec {
    return {
      kind: 'piece',
      pieces: foeFollowers(st, p.owner).filter((q) => !q.big && nearestDist(p, q) <= this.effRange(st, p)),
      hint: '选择攻击范围内的一名敌方棋子，将其钩到身边',
    };
  }
  async skillExec(ctx: HandlerCtx, s: Session, p: Piece, got: ChoiceResult): Promise<void> {
    const target = got as Piece;
    const spots: Cell[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const x = p.x + dx, y = p.y + dy;
      if (!inBoard(x, y) || pieceAt(s.state, x, y)) continue;
      spots.push({ x, y });
    }
    let dest: Cell;
    if (spots.length === 0) { pushLog(s.state, '🪝 钩子周围没有空格，钩拉失败。'); return; }
    else if (spots.length === 1) dest = spots[0];
    else dest = (await ctx.choose({ kind: 'cell', cells: spots, hint: '选择把敌人钩到哪个位置' })) as Cell;
    ev(s, { type: 'hook', uid: target.uid, fx: p.x, fy: p.y, x0: target.x, y0: target.y, tx: dest.x, ty: dest.y });
    target.x = dest.x; target.y = dest.y;
    pushLog(s.state, `🪝 【${getDef(target.defId).name}】被钩到了 (${dest.x},${dest.y})！`, 'l-impt');
  }
}

/** 10 投石机：攻击改为挂引信标记（performAttack 层接管）；不受增益 */
class CatapultEffect extends PieceEffect {
  buffable = false;
  isCatapult = true;
  async onAttack(_ctx: HandlerCtx, s: Session, p: Piece, target: Piece): Promise<boolean> {
    pushLog(s.state, `🪨 投石机砸中了【${getDef(target.defId).name}】，附上引信标记！`);
    if (!target.dead) {
      target.mark10 = { owner: p.owner, srcUid: p.uid, expires: s.state.turnCounter + 2 };
      ev(s, { type: 'mark', uid: target.uid });
    }
    return true;
  }
}

/** 11 白嫖怪：死亡时下回合额外召唤一次 */
class FreeloaderEffect extends PieceEffect {
  async onDeath(_ctx: HandlerCtx, s: Session, victim: Piece): Promise<void> {
    s.state.extraDraw[victim.owner]++;
    pushLog(s.state, `🆓 白嫖怪死亡：${PNAME[victim.owner]}下回合将额外召唤一枚棋子！`, 'l-impt');
  }
}

/** 14 献祭炮：技能献祭友方，向某一列第一个敌人倾泻其攻击力 */
class SacrificeEffect extends PieceEffect {
  skillLabel = '🔥 献祭齐射';
  skillUsable(): boolean { return true; }
  skillTargetSpec(st: GameState, p: Piece): ChoiceSpec {
    return {
      kind: 'piece',
      pieces: myFollowers(st, p.owner).filter((q) => q.uid !== p.uid && nearestDist(p, q) <= this.effRange(st, p)),
      hint: '选择要献祭的友方棋子（将扣除你 10 点血量上限）',
    };
  }
  async skillExec(ctx: HandlerCtx, s: Session, p: Piece, got: ChoiceResult): Promise<void> {
    const victim = got as Piece;
    p.maxHp -= 10;
    p.hp = Math.min(p.hp, p.maxHp);
    ev(s, { type: 'damage', uid: p.uid, amount: 0, silentNum: true });
    pushLog(s.state, `🔥 献祭炮扣除了自己 10 点血量上限（上限 ${p.maxHp}）。`);
    const vAtk = this.effAtk(s.state, victim);
    await killPiece(s, victim, null);
    await flushDeaths(ctx, s);
    const cols: number[] = [];
    const rng = this.effRange(s.state, p);
    for (let c = Math.max(1, p.x - rng); c <= Math.min(W, p.x + rng); c++) cols.push(c);
    const colCells: (Cell & { col: number })[] = [];
    for (const c of cols) for (let y = 1; y <= H; y++) colCells.push({ x: c, y, col: c });
    const picked = (await ctx.choose({
      kind: 'cell', cells: colCells,
      hint: `选择轰击哪一列（对距你最近的敌方造成 ${vAtk} 伤害）`,
    })) as Cell & { col: number };
    let best: Piece | null = null, bestD = Infinity;
    for (const q of foesOf(s.state, p.owner)) {
      const covers = q.big ? (picked.col >= q.x && picked.col <= q.x + 1) : q.x === picked.col;
      if (!covers) continue;
      const d = nearestDist(p, q);
      if (d < bestD) { bestD = d; best = q; }
    }
    if (!best) { pushLog(s.state, `🔥 第 ${picked.col} 列上没有敌方单位，炮击落空……`); return; }
    pushLog(s.state, `🔥 献祭齐射命中第 ${picked.col} 列的【${getDef(best.defId).name}】，造成 ${vAtk} 伤害！`, 'l-impt');
    await dealDamage(s, best, vAtk, p, { hit: true });
  }
}

/** 15 蓄力怪：技能 +10 攻或 +1 射程，整场限 3 次 */
class ChargerSkillEffect extends PieceEffect {
  skillLabel = '🔋 强化(限3次)';
  skillUsable(p: Piece): boolean { return p.skillUses < 3; }
  skillTargetSpec(): ChoiceSpec {
    return {
      kind: 'option',
      options: [{ label: '+10 攻击力', value: 'atk' }, { label: '+1 攻击范围', value: 'rng' }],
      hint: '选择强化方式（整场限 3 次）',
    };
  }
  async skillExec(_ctx: HandlerCtx, s: Session, p: Piece, got: ChoiceResult): Promise<void> {
    p.skillUses++;
    if (got === 'atk') { p.atk += 10; pushLog(s.state, `🔋 蓄力怪强化：攻击力提升至 ${p.atk}！（剩余 ${3 - p.skillUses} 次）`); }
    else { p.range += 1; pushLog(s.state, `🔋 蓄力怪强化：射程提升至 ${p.range}！（剩余 ${3 - p.skillUses} 次）`); }
    ev(s, { type: 'buff', uid: p.uid });
  }
}

/** 16 伤害转化器：受友方伤害时反弹等量给射程内敌人（忠实迁移，友伤分支目前不可达） */
class ConverterEffect extends PieceEffect {
  async onDamaged(_ctx: HandlerCtx, s: Session, target: Piece, amount: number,
                  src: Piece | null, opts: { noCounter?: boolean }): Promise<void> {
    if (!src || src.owner !== target.owner || opts.noCounter) return;
    ev(s, { type: 'counter', uid: target.uid });
    pushLog(s.state, `🔄 伤害转化器将 ${amount} 点友方伤害转化为反击！`);
    const foes = s.state.pieces.filter((q) => !q.dead && q.owner !== target.owner &&
                                           nearestDist(target, q) <= this.effRange(s.state, target));
    for (const f of foes) await dealDamage(s, f, amount, target, { noCounter: true });
  }
}

/** 19 路障小法师：技能召唤撑不过下回合的路障 */
class BarrierMageEffect extends PieceEffect {
  skillLabel = '🚧 召唤路障';
  skillUsable(): boolean { return true; }
  skillTargetSpec(st: GameState, p: Piece): ChoiceSpec {
    const cells: Cell[] = [];
    for (let y = 1; y <= H; y++) for (let x = 1; x <= W; x++) {
      if (!pieceAt(st, x, y) && mdist(p.x, p.y, x, y) <= this.effRange(st, p)) cells.push({ x, y });
    }
    return { kind: 'cell', cells, hint: '选择放置路障的空格（存活到你的下回合开始）' };
  }
  async skillExec(_ctx: HandlerCtx, s: Session, p: Piece, got: ChoiceResult): Promise<void> {
    const cell = got as Cell;
    const bar = makePiece(s.state, p.owner, -3, cell.x, cell.y);
    bar.diesAt = s.state.turnCounter + 2;
    bar.justDeployed = false;
    s.state.pieces.push(bar);
    ev(s, { type: 'deploy', uid: bar.uid });
    pushLog(s.state, `🚧 路障小法师在 (${cell.x},${cell.y}) 召唤了路障（它撑不过你的下回合开始）。`);
  }
}

/** 20 超级跑得快：被敌方击杀时反咬 20 伤害 */
class SuperSpeedyEffect extends PieceEffect {
  async onDeath(_ctx: HandlerCtx, s: Session, victim: Piece, killer: Piece | null): Promise<void> {
    if (!killer || killer.dead || killer.owner === victim.owner) return;
    pushLog(s.state, `💥 超级跑得快的遗言：对击杀者【${getDef(killer.defId).name}】造成 20 伤害！`, 'l-impt');
    await dealDamage(s, killer, 20, null, {});
  }
}

/** 24 厚脸皮：来自正面的伤害至多 10 */
class ThickFaceEffect extends PieceEffect {
  modifyIncomingDamage(_st: GameState, _target: Piece, amount: number,
                       src: Piece | null, opts: { hit?: boolean }): { amount: number; frontal: boolean } {
    if (src && opts.hit && isFrontal(src, _target)) return { amount: Math.min(amount, 10), frontal: true };
    return { amount, frontal: false };
  }
}

/** 26 杀手：连续击杀循环升级 +血 → +攻 → +射程 */
class AssassinEffect extends PieceEffect {
  async onKill(_ctx: HandlerCtx, s: Session, killer: Piece): Promise<void> {
    killer.killCount++;
    const stage = ((killer.killCount - 1) % 4) + 1;
    if (stage === 1 || stage === 4) {
      killer.maxHp += 10;
      killer.hp = Math.min(killer.maxHp, killer.hp + 10);
      pushLog(s.state, `🔪 杀手完成第 ${killer.killCount} 杀：+10 血量上限并回复 10 血！（${killer.hp}/${killer.maxHp}）`, 'l-impt');
    } else if (stage === 2) {
      killer.atk += 5;
      pushLog(s.state, `🔪 杀手完成第 ${killer.killCount} 杀：+5 攻击力！（atk ${killer.atk}）`, 'l-impt');
    } else {
      killer.range += 1;
      pushLog(s.state, `🔪 杀手完成第 ${killer.killCount} 杀：+1 攻击范围！（射程 ${killer.range}）`, 'l-impt');
    }
    ev(s, { type: 'buff', uid: killer.uid });
  }
}
```

并在 `EFFECTS` 注册表补全：

```ts
export const EFFECTS: Record<number, PieceEffect> = {
  1: new ChargerEffect(), 2: new HealerEffect(), 3: new KatanaGuardEffect(),
  4: new CannonEffect(), 5: new BigChargeEffect(), 6: new BuffGuyEffect(),
  7: new HookEffect(), 9: new ArcherEffect(), 10: new CatapultEffect(),
  11: new FreeloaderEffect(), 12: new SpeedyEffect(), 13: new StraightEffect(),
  14: new SacrificeEffect(), 15: new ChargerSkillEffect(), 16: new ConverterEffect(),
  19: new BarrierMageEffect(), 20: new SuperSpeedyEffect(), 21: new TeleporterEffect(),
  23: new LonerEffect(), 24: new ThickFaceEffect(), 26: new AssassinEffect(),
  33: new BladeEffect(),
};
```

`effects.ts` 文件头 import 需补 `snap`（HealerEffect/BigChargeEffect 用）与 `pieceByUid`（若引用；本版用不到则不加）——把 state.ts 的 import 补成：`import { PNAME, ev, pushLog, snap, makePiece, pieceAt, type Session, type GameState, type Piece, type Owner, type ChoiceSpec, type ChoiceResult } from './state.ts';`

- [ ] **Step 2: 重写 engine.ts 管线**

`src/engine/engine.ts` 全文替换为：

```ts
/* ═══════════════ engine.ts · 伤害 / 治疗 / 死亡管线 ═══════════════
 * 所有伤害统一经过 dealDamage，依次结算（顺序与 v1 逐字节一致）：
 *   金身免疫 → 策反倒戈 → 厚脸皮正面减免（钩子）→ 扣血 →
 *   投石机标记引爆（通用状态步骤）→ 名刀守护（全局钩子询问）→
 *   死亡遗言入队 → 转化器反弹（钩子）
 * 效果分发一律经 getEffect(defId)，defId 字面量已归零（见 data.ts 守卫）。
 * ═══════════════════════════════════════════════════════════════ */

import { getDef } from './data.ts';
import { PNAME, ev, pushLog, makePiece, pieceByUid,
         type Session, type GameState, type Piece, type Owner } from './state.ts';
import { getEffect, effAtk } from './effects.ts';
import type { HandlerCtx } from './types.ts';

/**
 * 对目标造成伤害。
 * @param src  来源棋子（可为 null，如法术直接伤害）
 * @param opts {hit:是否为攻击命中, isMark:标记引爆, noCounter:禁止反弹,
 *              noGuard:无视名刀守护, crit:暴击标记}
 */
export async function dealDamage(s: Session, target: Piece, amount: number,
  src: Piece | null,
  opts?: { hit?: boolean; isMark?: boolean; noCounter?: boolean; noGuard?: boolean; crit?: boolean }): Promise<void> {
  opts = opts || {};
  if (!target || target.dead || !(amount > 0)) return;

  // ── 金身：不受任何伤害（通用状态步骤）
  if (target.shieldUntil > s.state.turnCounter) {
    ev(s, { type: 'block', uid: target.uid });
    pushLog(s.state, `🛡️ ${getDef(target.defId).name} 处于金身状态，免疫了 ${amount} 点伤害！`, 'l-impt');
    return;
  }

  // ── 策反：首次受击时收编攻击者（通用状态步骤；基地不可被策反）
  if (src && target.charmFrom && s.state.turnCounter >= target.charmFrom && s.state.turnCounter < target.charmTo
      && src.owner !== target.owner && getDef(src.defId).type !== 'base') {
    target.charmFrom = 0; target.charmTo = 0;
    const oldOwner = src.owner;
    src.owner = target.owner;
    src.apLeft = 0;
    ev(s, { type: 'charm', uid: src.uid });
    pushLog(s.state, `🎭 策反成功！${PNAME[oldOwner]}的【${getDef(src.defId).name}】临阵倒戈，加入${PNAME[target.owner]}！`, 'l-impt');
    return;
  }

  // ── 厚脸皮：来自正面的攻击伤害至多 10（钩子）
  const mod = getEffect(target.defId).modifyIncomingDamage(s.state, target, amount, src, opts);
  const dmg = mod.amount;
  const frontal = mod.frontal;

  target.hp -= dmg;
  ev(s, { type: 'damage', uid: target.uid, amount: dmg, frontal, crit: opts.crit || false });

  // ── 投石机标记：被“标记方另一枚非投石机棋子”再次命中时引爆（通用状态步骤）
  if (opts.hit && src && target.mark10 && !opts.isMark &&
      src.owner === target.mark10.owner && !getEffect(src.defId).isCatapult && !target.dead) {
    const mk = target.mark10;
    target.mark10 = null;
    pushLog(s.state, `🪨 投石机标记被引爆！`);
    await dealDamage(s, target, 5, pieceByUid(s.state, mk.srcUid), { isMark: true });
  }
  if (target.dead) return;

  // ── 致命伤害：名刀守护（全局钩子询问）
  if (target.hp <= 0) {
    if (!opts.noGuard && !target.guardUsed && hasBladeGuard(s.state, target)) {
      target.guardUsed = true;
      target.hp = 1;
      ev(s, { type: 'guard', uid: target.uid });
      pushLog(s.state, `🗡️ 名刀之佑！【${getDef(target.defId).name}】避免了一次致命伤害，以 1 血存活。`, 'l-impt');
      return;
    }
    await killPiece(s, target, src);
    return;
  }

  // ── 伤害转化器（钩子；友伤分支按规格剔除“可被友方攻击”机制、忠实迁移现有逻辑）
  await getEffect(target.defId).onDamaged(s, target, dmg, src, opts);
}

/** 目标是否有己方名刀（本体形态）守护 —— 遍历询问全局钩子 */
export function hasBladeGuard(st: GameState, target: Piece): boolean {
  for (const q of st.pieces) {
    if (q.dead || q.owner !== target.owner) continue;
    if (getEffect(q.defId).guardsAlly(st, q, target)) return true;
  }
  return false;
}

/** 治疗（回满血会引爆投石机标记）—— 通用，无 defId 分支 */
export async function heal(s: Session, target: Piece, amount: number): Promise<void> {
  if (!target || target.dead || !(amount > 0)) return;
  const real = Math.min(amount, target.maxHp - target.hp);
  if (real <= 0) return;
  target.hp += real;
  ev(s, { type: 'heal', uid: target.uid, amount: real });
  if (target.hp >= target.maxHp && target.mark10) {
    const mk = target.mark10;
    target.mark10 = null;
    pushLog(s.state, `🪨 【${getDef(target.defId).name}】回满血，投石机标记引爆！`);
    await dealDamage(s, target, 5, pieceByUid(s.state, mk.srcUid), { isMark: true });
  }
}

/** 击杀：标记死亡 + 记录遗言 + 杀手升级（钩子） */
export async function killPiece(s: Session, victim: Piece, killer: Piece | null): Promise<void> {
  if (victim.dead) return;
  victim.dead = true;
  victim.hp = 0;
  ev(s, { type: 'death', uid: victim.uid, defId: victim.defId });

  if (killer && !killer.dead && victim.owner !== killer.owner) {
    await getEffect(killer.defId).onKill(s, killer, victim);
  }

  if (getDef(victim.defId).type !== 'base' && getDef(victim.defId).type !== 'grave') {
    s.pendingDeaths.push({ victim, killer });
  } else if (getDef(victim.defId).type === 'base') {
    const w = checkWin(s.state);
    if (w != null) ev(s, { type: 'win', winner: w });
  }
}

/** 逐个结算死亡遗言（可能异步等待玩家选择）—— 经 getEffect 分发 */
export async function flushDeaths(ctx: HandlerCtx, s: Session): Promise<void> {
  while (s.pendingDeaths.length) {
    const { victim, killer } = s.pendingDeaths.shift()!;
    await getEffect(victim.defId).onDeath(ctx, s, victim, killer);
  }
}

/** 胜负判定：纯 (st) 查询，返回「本次调用新判定或变更出的 winner」 */
export function checkWin(st: GameState): number | null {
  const prev = st.winner;
  const b0 = st.pieces.find((p) => getDef(p.defId).type === 'base' && p.owner === 0);
  const b1 = st.pieces.find((p) => getDef(p.defId).type === 'base' && p.owner === 1);
  if (!b0 || !b1) return null;
  const d0 = b0.hp <= 0, d1 = b1.hp <= 0;
  if (d0 && d1) { st.winner = 1 - st.curPlayer; }
  else if (d0) { st.winner = 1; }
  else if (d1) { st.winner = 0; }
  if (st.winner !== prev) {
    const w = st.winner!;
    st.phase = 'over';
    pushLog(st, `🏆 ${PNAME[w]}摧毁了对方基地，获得胜利！`, 'l-impt');
    return w;
  }
  return null;
}

/** 攻击结算核心。钩子挂点：onAttack（接管）→ modifyAttackDamage（掷骰）→ dealDamage → onAttackDone */
export async function performAttack(ctx: HandlerCtx, s: Session, p: Piece, target: Piece): Promise<void> {
  ev(s, { type: 'attack', uid: p.uid, tuid: target.uid });

  // ── 死吧！：下回合命中的第一个敌方立即死亡（通用状态步骤）
  if (p.reaperFrom && s.state.turnCounter === p.reaperFrom &&
      getDef(target.defId).type !== 'base') {
    p.reaperFrom = 0; p.reaperTo = 0;
    if (target.shieldUntil > s.state.turnCounter) {
      pushLog(s.state, `💀 斩杀之光撞上了金身！【${getDef(target.defId).name}】侥幸存活！`, 'l-impt');
    } else {
      pushLog(s.state, `💀 死吧！！【${getDef(target.defId).name}】当场毙命！`, 'l-impt');
      await killPiece(s, target, p);
      await flushDeaths(ctx, s);
      const w = checkWin(s.state);
      if (w != null) ev(s, { type: 'win', winner: w });
      return;
    }
  }

  const eff = getEffect(p.defId);

  // ── 攻击接管（投石机挂标），未接管则走伤害掷骰 → 扣血
  const handled = await eff.onAttack(ctx, s, p, target);
  if (!handled) {
    const dmg = effAtk(s.state, p);
    const mod = eff.modifyAttackDamage(s.state, p, target, dmg);
    await dealDamage(s, target, mod.dmg, p, { hit: true, crit: mod.crit });
  }

  // ── 攻击后（射手记录 / 定炮清充能）
  await eff.onAttackDone(ctx, s, p, target);

  await flushDeaths(ctx, s);
  const w = checkWin(s.state);
  if (w != null) ev(s, { type: 'win', winner: w });
}

/** 底层落子 + 冲锋询问（钩子）。spells.ts 与 game.ts 都调用它。 */
export async function deployPiece(ctx: HandlerCtx, s: Session, owner: number,
  defId: number, x: number, y: number): Promise<Piece> {
  const p = makePiece(s.state, owner as Owner, defId, x, y);
  s.state.pieces.push(p);
  ev(s, { type: 'deploy', uid: p.uid });
  pushLog(s.state, `${PNAME[owner]}部署【${getDef(defId).name}】于 (${x},${y})`);
  await getEffect(defId).onDeploy(ctx, s, p);
  return p;
}
```

- [ ] **Step 3: 验证**

Run: `npm test && npm run typecheck`
Expected: 全绿。此步后 engine 全部效果分支已走钩子（遗言/杀手/厚脸皮/转化器/名刀/投石机/冲锋）；abilities.ts 仍被 game.ts 引用（useSkill/SKILLS 未翻），DEATHRATTLES/SKILLS 成为死代码但保留到 Task 7。

- [ ] **Step 4: 提交**

```bash
git add src/engine/effects.ts src/engine/engine.ts
git commit -m "refactor: route damage/death pipeline through effect hooks"
```

---

### Task 6: game.ts 翻转（回合流 / 行动 / 技能）

**Files:**
- Modify: `src/engine/game.ts`

**Interfaces:**
- Consumes: Task 4/5 的 `getEffect`、`resolveDrawDefId`、effects 转发（rules re-export）
- Produces: game.ts 不再 import abilities.ts（SKILLS 使用归零）；`onMoveCommand`/`onAttackSelected`/`onTurnStart`/skill 组 / `resolveDrawDefId` 全量生效

- [ ] **Step 1: 改 import**

`src/engine/game.ts`：
- 删除 `import { SKILLS, type HandlerCtx } from './abilities.ts';`（第 11 行）
- 新增 `import { getEffect, resolveDrawDefId } from './effects.ts';` 与 `import type { HandlerCtx } from './types.ts';`
- `import { effActions, effRange, moveTargets, attackTargets, healTargets, deployCells, canDeployAt, nearestDist, computeExtraRows } from './rules.ts';` 中若 `nearestDist` 不再使用则移除（见 Step 3）

- [ ] **Step 2: drawCards 用 resolveDrawDefId**

`drawCards`（23-31 行）内两行：

```ts
let defId = rndInt(state, 1, 26);
if (defId === 3 && rnd(state) >= 1 / 3) defId = 33;
```
改为：
```ts
const defId = resolveDrawDefId(state, rndInt(state, 1, 26));
```
（rnd 调用顺序逐字节保持：rndInt 先、形态判定条件性 rnd 后。）

- [ ] **Step 3: startTurnInternal 用 onTurnStart**

`startTurnInternal` 的己方重置循环（63-69 行）中 `if (p.defId === 23) p.beatCount++;` 改为：

```ts
await getEffect(p.defId).onTurnStart(ctx, sess, p);
```

（放在 `p.justDeployed = false;` 之后、`p.apLeft = effActions(...)` 之前，与旧顺序一致。）

- [ ] **Step 4: doMove 用 onMoveCommand**

删除 5 号大肉比的整段特判（173-191 行），在默认移动校验前插入：

```ts
if (await getEffect(p.defId).onMoveCommand(ctx, sess, p, x, y)) return true;
```

默认路径（193-199 行）保持不变。

- [ ] **Step 5: doAttack 用 onAttackSelected**

删除 2 号奶妈特判（209-218 行），改为友方目标路由：

```ts
if (t.owner === p.owner) {
  return await getEffect(p.defId).onAttackSelected(ctx, sess, p, t);
}
```

（放在 `p.justDeployed || p.apLeft <= 0` 校验之后、`attackTargets` 校验之前；hook 返回 true 时已在内部完成 snap+apLeft--+治疗，与旧 heal 分支的自包含结构一致。此时 game.ts 的 `nearestDist` 若无其他使用则从 import 移除。）

- [ ] **Step 6: useSkill 用技能方法组**

`useSkill`（227-246 行）改写为：

```ts
const useSkill = async (uid: number): Promise<boolean> => {
  const p = pieceByUid(sess.state, uid);
  if (!p) return false;
  const eff = getEffect(p.defId);
  if (!eff.skillLabel || p.owner !== sess.state.curPlayer || sess.state.phase !== 'action') return false;
  if (p.justDeployed || p.apLeft <= 0 || !(eff.skillUsable?.(p) ?? true)) return false;
  const spec = eff.skillTargetSpec!(sess.state, p);
  let got: ChoiceResult = null;
  if (spec.kind !== 'none') {
    got = await ctx.choose(spec);
    if (got == null) return false;
  }
  snap(sess);
  p.apLeft--;
  await eff.skillExec!(ctx, sess, p, got);
  await flushDeaths(ctx, sess);
  const w = checkWin(sess.state);
  if (w != null) ev(sess, { type: 'win', winner: w });
  return true;
};
```

（`Game.rules.skillInfo`（277 行）同步改为 `skillInfo: (p: Piece) => { const e = getEffect(p.defId); return e.skillLabel ? { label: e.skillLabel, usable: e.skillUsable!, targetSpec: e.skillTargetSpec!, exec: e.skillExec! } : null; }`——保持 `Game.rules.skillInfo` 返回 `SkillInfo | null` 的既有类型契约。）

- [ ] **Step 7: 验证**

Run: `npm test && npm run typecheck`
Expected: 全绿。此步后 abilities.ts 已无任何引用方（纯死文件，Task 7 删除）。

- [ ] **Step 8: 提交**

```bash
git add src/engine/game.ts
git commit -m "refactor: route turn/action flow through effect hooks"
```

---

### Task 7: spells.ts 收尾 + 删除 abilities.ts

**Files:**
- Modify: `src/engine/spells.ts`
- Delete: `src/engine/abilities.ts`

**Interfaces:**
- Consumes: `resolveDrawDefId`（effects.ts）
- Produces: abilities.ts 消失；spells.ts 不再引用 rnd

- [ ] **Step 1: spells.ts 改形态判定 + 清理 import**

`src/engine/spells.ts`：
- 文件头加 `import { resolveDrawDefId } from './effects.ts';`
- `summonOnce`（127-129 行）两行：
```ts
let defId = rndInt(s.state, 1, 26);
if (defId === 3 && rnd(s.state) >= 1 / 3) defId = 33;
```
改为：
```ts
const defId = resolveDrawDefId(s.state, rndInt(s.state, 1, 26));
```
- `import { rnd, rndInt } from './rng.ts';` → `import { rndInt } from './rng.ts';`（rnd 已无使用；`summonOnce` 后文对 `defId` 的 `const` 用法核对——原为 `let` 仅因 33 改写，改后为 const，后续引用不变）

- [ ] **Step 2: 删除 abilities.ts**

```bash
git rm src/engine/abilities.ts
```

- [ ] **Step 3: 验证**

Run: `npm test && npm run typecheck`
Expected: 全绿；确认无任何文件再 import abilities。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor: delete abilities.ts after folding into effects.ts"
```

---

### Task 8: 守卫测试 + 最终回归

**Files:**
- Modify: `tests/engine.test.ts`（追加两个守卫测试）
- 全部引擎文件（最终核验）

**Interfaces:**
- Consumes: `EFFECTS`、`getEffect`（effects.ts）
- Produces: 两个微型守卫测试折叠进现有文件；零字面量断言全引擎生效

- [ ] **Step 1: 追加守卫测试**

`tests/engine.test.ts` 文件头 import 追加：

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { EFFECTS, getEffect } from '../src/engine/effects.ts';
```

文件末尾追加：

```ts
test('效果注册表覆盖全部棋子（含特殊单位兜底）', () => {
  for (const def of DEFS) {
    if (def.type === 'follower') {
      assert.ok(EFFECTS[def.id], `缺少效果注册：${def.name}(${def.id})`);
    }
  }
  assert.ok(EFFECTS[33], '缺少效果注册：刀魂(33)');
  // 特殊单位经 getEffect 兜底不崩
  assert.ok(getEffect(-1) && getEffect(-2) && getEffect(-3), '特殊单位应有默认兜底');
});

test('引擎源码无 defId 字面量硬编码分支', () => {
  const dir = new URL('../src/engine/', import.meta.url);
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts')) continue;
    const src = readFileSync(new URL(name, dir), 'utf8');
    assert.ok(!/defId\s*(===|!==)\s*-?\d/.test(src), `${name} 含 defId 字面量分支`);
  }
});
```

- [ ] **Step 2: 全量回归**

Run: `npm test && npm run typecheck`
Expected: 全绿（守卫测试确认注册表完备、`defId ===/!==` 在全引擎归零——data.ts 已因 SPECIALS 映射无字面量，无需豁免）。

- [ ] **Step 3: 删除/新增行数核验**

Run:
```bash
git diff --stat 2755d39..HEAD -- src/engine
```
Expected: `abilities.ts` 删除（-248 行）；除 `effects.ts`/`geometry.ts` 外其余引擎文件（data/state/rules/engine/game/spells/types/rng）合计行数 < 1386（基线 1634 − abilities 248），即净删 > 0。若未达标，删除 effects 内冗余注释或重复助手后再提交。

- [ ] **Step 4: 发布级 e2e**

Run: `npm run build && node tests/e2e/smoke.e2e.mjs`
Expected: 构建成功（单 HTML 零外链），e2e 全绿（真实 Edge 浏览器冒烟：清手牌→跨回合→选子→攻击/移动）。

- [ ] **Step 5: 提交**

```bash
git add tests/engine.test.ts
git commit -m "test: guard effects registry completeness and zero defId literals"
```

---

## 自审记录

- **Spec 覆盖**：§4 基类/钩子清单 → Task 4/5；§5 跨棋子八例 → Task 4（2/3/5/6/7 类）+ Task 5（10/16/22/24 处理，22 策反走数据驱动守卫在 engine.ts）；§6 逐文件改造 → Task 1-7；§7 红线 → Global Constraints；§8 测试策略 → 各任务验证 + Task 8 守卫测试；§9 成功标准 → Task 8 核验。22 号策反的 `!== -1` 数据化落在 Task 5 的 engine.ts 重写中；`isCatapult` 守卫在 Task 5。
- **类型一致性**：`modifyIncomingDamage` 返回 `{amount, frontal}`（Task 4 基类 + Task 5 的 24 类一致）；`onAttackSelected`/`onMoveCommand`/`onAttack`/`onAttackDone` 签名在基类与各覆写一致；`blocksAlly(st,x,y,owner)` 在 Task 4 与 21/13/基类 moveTargets、canDeployAt 调用一致；`resolveDrawDefId(state,defId)` Task 4 定义、Task 6/7 消费。
- **已核实的等价值**：4 号与 21 号的 effActions 覆写可省略（data.acts 已为 1，旧分支是冗余）；10 号 `src.defId !== 10` 守卫在 performAttack 接管后结构性不可达，保留为 `isCatapult` 防御性一行；`getDef` 的 SPECIALS 映射同时消灭 data.ts 内四处字面量，使 Task 8 零豁免扫描成立。
