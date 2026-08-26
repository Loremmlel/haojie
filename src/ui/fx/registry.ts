/* registry.ts · uid → 棋子 DOM 注册表（PiecesLayer ref 回调注册；Task 8 FX 经 get 取节点） */
const map = new Map<number, HTMLElement>();

export const pieceRegistry = {
  set(uid: number, el: HTMLElement): void { map.set(uid, el); },
  remove(uid: number): void { map.delete(uid); },
  get(uid: number): HTMLElement | null { return map.get(uid) ?? null; },
};
