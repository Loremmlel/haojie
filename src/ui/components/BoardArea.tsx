/* BoardArea.tsx · 棋盘区：CellsGrid + PiecesLayer + FxLayer 组合；
 * useBoardMetrics 量测后经 geometry.setMetrics 暂存（Task 8 initFx 后切换为 FX.setMetrics）。
 * #boardwrap/#board-outer 属 Global Constraints 第 1 条保留 global 的范围，本组件无 module 私有类。 */
import { useRef } from 'react';
import { useGame } from '../gameStore.ts';
import { useBoardMetrics } from '../hooks/useBoardMetrics.ts';
import CellsGrid from './CellsGrid.tsx';
import PiecesLayer from './PiecesLayer.tsx';
import FxLayer, { type FxLayerHandle } from './FxLayer.tsx';
import s from './BoardArea.module.css';

export default function BoardArea() {
  const loaded = useGame();
  const boardRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<FxLayerHandle>(null);
  const m = useBoardMetrics(boardRef);
  if (!loaded) return null;
  const st = loaded.game.state;
  return (
    <section id="boardwrap" className={s.boardwrap}>
      <div id="board-outer" className={s.boardOuter}>
        <CellsGrid st={st} boardRef={boardRef} />
        <PiecesLayer st={st} m={m} />
        <FxLayer ref={fxRef} />
      </div>
    </section>
  );
}
