/* PiecesLayer.tsx · 棋子层：key={uid} 渲染存活棋子（跨渲染 DOM 稳定，CSS transition 不打断）。
 * 本任务立骨架（face/atk/hp）；badges/apdots/状态外观类 Task 7 按 syncStatsOf 补全。
 * fx 命令式类 .piece.dying/.hit-jolt/.pop-in 不属于本 module（Global Constraints 第 2 条 + Task 8）。 */
import { useCallback } from 'react';
import { getDef } from '../../engine/data.ts';
import { effAtk } from '../../engine/rules.ts';
import { pieceRegistry } from '../fx/registry.ts';
import { posOf, type Metrics } from '../geometry.ts';
import type { GameState, Piece } from '../../engine/state.ts';
import s from './Piece.module.css';

function PieceView({ p, st, m }: { p: Piece; st: GameState; m: Metrics }) {
  const refCb = useCallback((el: HTMLDivElement | null) => {
    if (el) pieceRegistry.set(p.uid, el); else pieceRegistry.remove(p.uid);
  }, [p.uid]);
  const def = getDef(p.defId);
  const pos = posOf(p.x, p.y, !!p.big, m);
  return (
    <div ref={refCb}
         className={`piece ${s.piece} ${s[`own${p.owner}`]}${p.big ? ` ${s.big5}` : ''}`}
         data-uid={p.uid}
         style={{ left: pos.left, top: pos.top }}>
      <div className={s.face}>{def.emoji}</div>
      {p.defId >= 0 && <span className={`${s.stat} ${s.atk}`}>{effAtk(st, p)}</span>}
      <span className={`${s.stat} ${s.hp}${p.hp <= p.maxHp * 0.35 ? ` ${s.hurt}` : ''}`}>
        {Math.max(0, Math.round(p.hp))}
      </span>
    </div>
  );
}

export default function PiecesLayer({ st, m }: { st: GameState; m: Metrics | null }) {
  if (!m) return null; // 量测就绪前不渲染（无坐标可定位）
  return (
    <>
      {st.pieces.filter((p) => !p.dead).map((p) => (
        <PieceView key={p.uid} p={p} st={st} m={m} />
      ))}
    </>
  );
}
