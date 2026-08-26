/* geometry.ts · 格子几何唯一权威（公式自 ui.js posOf 平移；FX 与 React 共用，不得在别处复制第二套） */
export interface Metrics { size: number; gap: number; pad: number }

/** 当前量测暂存：Task 5 FX 未接入前由 useBoardMetrics 写入；
 *  Task 8 initFx 后切换为 FX.setMetrics（见实施计划 Task 5 Step 2）。 */
let current: Metrics | null = null;
export function setMetrics(m: Metrics | null): void { current = m; }

export function posOf(x: number, y: number, big: boolean, m: Metrics) {
  return {
    left: m.pad + (x - 1) * (m.size + m.gap),
    top: m.pad + (13 - y - (big ? 1 : 0)) * (m.size + m.gap),
  };
}
