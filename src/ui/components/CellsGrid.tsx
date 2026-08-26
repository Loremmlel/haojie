/* CellsGrid.tsx · 117 格静态渲染：row 1→13 / col 1→9，y=13-row+1（蓝方在下）。
 * 高亮类 Task 6 接入 highlights 后补打；本任务仅 base-cell 判定。
 * 网格全家族类（.cell/base-cell/p1/p2）属 Global Constraints 保留 global 的范围，本组件无 module 私有类。 */
import type { RefObject } from 'react';
import { W, H } from '../../engine/data.ts';
import { pieceAt, type GameState } from '../../engine/state.ts';

export default function CellsGrid({ st, boardRef }: {
  st: GameState;
  boardRef: RefObject<HTMLDivElement | null>;
}) {
  const cells = [];
  for (let row = 1; row <= H; row++) {
    for (let col = 1; col <= W; col++) {
      const x = col, y = H - row + 1; // y=1 固定渲染在最下行（蓝方阵地）
      const occ = pieceAt(st, x, y);
      const cls = ['cell'];
      if (occ && occ.defId === -1) cls.push('base-cell', occ.owner === 0 ? 'p1' : 'p2');
      cells.push(
        <div key={`${x},${y}`} className={cls.join(' ')} data-x={x} data-y={y} />,
      );
    }
  }
  return (
    <div id="board" ref={boardRef}>{cells}</div>
  );
}
