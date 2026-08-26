/* geometry.ts · 格子几何唯一权威（公式自 ui.js posOf 平移；FX 与 React 共用，不得在别处复制第二套）
 * 量测暂存已随 Task 8 切换为 fx.setMetrics（useBoardMetrics 直写 FX 模块内 M），本文件不再持有 metrics 状态。 */
export interface Metrics { size: number; gap: number; pad: number }

export function posOf(x: number, y: number, big: boolean, m: Metrics) {
  return {
    left: m.pad + (x - 1) * (m.size + m.gap),
    top: m.pad + (13 - y - (big ? 1 : 0)) * (m.size + m.gap),
  };
}
