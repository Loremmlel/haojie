/* interactionStore.ts · 交互状态机（input.js UIST/busy/ask/act/runSpellCast 平移）
 * choice 对象本身存 store（渲染高亮要读 spec）；resolve 由 finishChoice 从 st 取出后
 * 立即置空再调用——resolve 不经过任何渲染路径。
 * busy 锁与 act 统一动作入口：执行逻辑 → playChain 播事件动画 → bump 刷新。 */
import { useSyncExternalStore } from 'react';
import type { Game } from '../engine/types.ts';
import type { ChoiceSpec, ChoiceResult } from '../engine/state.ts';
import { getGame, bumpVersion } from './gameStore.ts';
import { playChain } from '../ui/fx/fx.ts';
import { toast } from './toastBus.ts';
export { toast };   // Task 8：占位回收——真实现移至 toastBus，此处 re-export 保持既有调用方（ActionBar/BoardArea）不变

export interface ActiveChoice { spec: ChoiceSpec; resolve(r: ChoiceResult): void }
export interface InteractionState {
  mode: 'idle' | 'deployCard' | 'pieceSel';
  cardIdx: number | null;
  selUid: number | null;
  inspectUid: number | null;
  choice: ActiveChoice | null;   // 组件读；resolve 经 ref，见铁律
  busy: boolean;
}

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
/** 整局重开时全量复位交互态（App restart 调用，对齐 v1 reload 语义）。
 *  resetSelection 只清 mode/cardIdx/selUid；重开还需清 inspectUid/choice/busy，
 *  否则新局会带着旧选中态渲染（错位手牌高亮 / dep-ok 残留 / 同 uid 棋子被选中）。 */
export function resetAll() {
  setInteraction({ mode: 'idle', cardIdx: null, selUid: null, inspectUid: null, choice: null, busy: false });
}

export async function act(fn: (g: Game) => Promise<unknown>) {
  const g = getGame();
  if (!g || st.busy) return;
  // 不变量（PiecesLayer.isDying 依赖，勿扰此序）：busy 同步 notify → React 渲染
  // busy/dead 必须先于 playChain 消费事件。死亡事件由 fn 同步入列、dead 同步置位；
  // await fn(g) 让出微任务时 React 批量 flush 完成，随后 playChain 才消费——若在此
  // 插入 await 或改动批量策略，渲染会晚于事件消费，尸体在死亡 FX 前被卸载。
  setInteraction({ busy: true });
  try {
    await fn(g);
    await playChain(g);
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

/** 法术通用流程（input.js runSpellCast 平移）：先选目标，再执行。
 *  Hand/Stored 的释放按钮共用；run 为 castHandSpell/castStored。 */
export async function runSpellCast(getSpec: () => ChoiceSpec, run: (got: ChoiceResult) => Promise<boolean>): Promise<void> {
  if (st.busy) return;
  setInteraction({ busy: true });
  try {
    const spec = getSpec();
    const got = await ask(spec);
    if (got == null) { setInteraction({ busy: false }); return; }
    const g = getGame();
    if (!g) return;
    await run(got);
    await playChain(g);
    bumpVersion();
  } catch (err) {
    console.error(err);
    toast('施法失败：' + (err instanceof Error ? err.message : String(err)), true);
  } finally {
    setInteraction({ busy: false });
    resetSelection();
    bumpVersion();
  }
}
