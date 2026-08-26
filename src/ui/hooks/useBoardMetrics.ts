/* useBoardMetrics.ts · 量测棋盘首个 .cell 的 offsetWidth/offsetLeft 推 gap/pad；resize 触发重测
 * 量测结果双写：本地 state 供 React 渲染定位，FX.setMetrics 供 fx 内核几何（centerOf/movePieceTo）。 */
import { useEffect, useState, type RefObject } from 'react';
import { setMetrics } from '../fx/fx.ts';
import type { Metrics } from '../geometry.ts';

export function useBoardMetrics(boardRef: RefObject<HTMLDivElement | null>): Metrics | null {
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => {
    const measure = () => {
      const board = boardRef.current;
      const first = board ? board.querySelector<HTMLElement>('.cell') : null;
      if (!first) return;
      const size = first.offsetWidth;
      const next = first.nextElementSibling as HTMLElement | null;
      const gap = next ? next.offsetLeft - first.offsetLeft - size : 3;
      const pad = first.offsetLeft;
      const metrics: Metrics = { size, gap, pad };
      setM(metrics);
      setMetrics(metrics); // 真 setMetrics：写入 fx 模块内 M（Task 8 切换）
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [boardRef]);
  return m;
}
