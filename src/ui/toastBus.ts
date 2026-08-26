/* toastBus.ts · 模块级 toast 发射器（v1 codex.js toast 语义平移）
 * ToastHost 订阅渲染；2.6s 自动消失由 ToastHost 侧 setTimeout 负责（v1 setTimeout 2600ms）。
 * interactionStore 的 toast 占位（console.warn）经此处回收为真实现并 re-export。 */
type ToastListener = (msg: string, warn: boolean) => void;
const listeners = new Set<ToastListener>();

export function subscribeToast(l: ToastListener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function toast(msg: string, warn = false): void {
  for (const l of listeners) l(msg, warn);
}
