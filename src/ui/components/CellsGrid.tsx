/* CellsGrid.tsx · 117 格渲染 + 高亮类（ui.js renderCells 平移，高亮自 computeHighlights）。
 * row 1→13 / col 1→9，y=13-row+1（蓝方在下）。
 * 网格全家族类（.cell/base-cell/p1/p2）与高亮类（dep-ok/mv-ok/atk-ok/sk-ok/heal-ok/sel-hl）
 * 均属 Global Constraints 保留 global 的范围（e2e 依赖），本组件无 module 私有类。 */
import type { RefObject } from 'react';
import { W, H } from '../../engine/data.ts';
import type { Game } from '../../engine/types.ts';
import { pieceAt } from '../../engine/state.ts';
import { useInteraction } from '../interactionStore.ts';
import { computeHighlights } from '../highlights.ts';

export default function CellsGrid({ game, boardRef }: {
  game: Game;
  boardRef: RefObject<HTMLDivElement | null>;
}) {
  const ia = useInteraction();
  const hl = computeHighlights({ game, ia });
  const st = game.state;
  const cells = [];
  for (let row = 1; row <= H; row++) {
    for (let col = 1; col <= W; col++) {
      const x = col, y = H - row + 1; // y=1 固定渲染在最下行（蓝方阵地）
      const key = `${x},${y}`;
      const occ = pieceAt(st, x, y);
      const cls = ['cell'];
      if (occ && occ.defId === -1) cls.push('base-cell', occ.owner === 0 ? 'p1' : 'p2');
      if (hl.dep.has(key)) cls.push('dep-ok');
      else {
        if (hl.mv.has(key)) cls.push('mv-ok');
        if (hl.atk.has(key)) cls.push('atk-ok');
        if (hl.heal.has(key)) cls.push('heal-ok');
        if (hl.sk.has(key)) cls.push('sk-ok');
      }
      if (hl.sel.has(key)) cls.push('sel-hl');
      cells.push(
        <div key={key} className={cls.join(' ')} data-x={x} data-y={y} />,
      );
    }
  }
  return (
    <div id="board" ref={boardRef}>{cells}</div>
  );
}
