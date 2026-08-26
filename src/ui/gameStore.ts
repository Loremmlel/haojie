/* gameStore.ts · 版本化外部 store——引擎 Game 实例的持有者与 React 订阅桥 */
import { useSyncExternalStore } from 'react';
import type { Game } from '../engine/types.ts';

let version = 0;
let game: Game | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setGame(g: Game | null) {
  game = g; version++; notify();
  // 调试钩子（规格 §6.5）：getter 保证 e2e/控制台永远读到当前局
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__HJ_DEBUG__ = {
      get game() { return game; },
    };
  }
}
export function getGame() { return game; }
export function bumpVersion() { version++; notify(); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
const snapshot = () => version;
export function useGameTick() { return useSyncExternalStore(subscribe, snapshot); }
export function useGame() {
  const tick = useGameTick();
  return game ? { game, tick } : null;
}
