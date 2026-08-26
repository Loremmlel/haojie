/* highlights.ts · 高亮计算（ui.js computeHighlights 纯函数平移）
 * 输入 { game, ia }，输出六组 'x,y' key 的 Set（CellsGrid 消费打高亮类）。
 * 三级逻辑逐字保留：choice 优先 → deployCard → pieceSel。 */
import type { Game } from '../engine/types.ts';
import { pieceByUid, type Piece } from '../engine/state.ts';
import { pieceCells } from '../engine/rules.ts';
import type { InteractionState } from './interactionStore.ts';

export interface Highlights {
  dep: Set<string>; mv: Set<string>; atk: Set<string>; sk: Set<string>; heal: Set<string>; sel: Set<string>;
}

export function computeHighlights({ game, ia }: { game: Game; ia: InteractionState }): Highlights {
  const hl: Highlights = {
    dep: new Set<string>(), mv: new Set<string>(), atk: new Set<string>(),
    sk: new Set<string>(), heal: new Set<string>(), sel: new Set<string>(),
  };
  const st = game.state;

  const cellsOfPiece = (p: Piece): string[] => pieceCells(p).map((c) => c.x + ',' + c.y);

  // 法术/技能目标选择优先
  if (ia.choice && ia.choice.spec) {
    const spec = ia.choice.spec;
    if (spec.kind === 'cell') for (const c of spec.cells) hl.sk.add(c.x + ',' + c.y);
    if (spec.kind === 'piece') for (const t of spec.pieces) for (const k of cellsOfPiece(t)) hl.sk.add(k);
    return hl;
  }

  if (ia.mode === 'deployCard' && ia.cardIdx != null) {
    const card = st.hand[st.curPlayer][ia.cardIdx];
    if (card) for (const c of game.rules.deployCells(card.defId, st.curPlayer)) hl.dep.add(c.x + ',' + c.y);
    return hl;
  }

  if (ia.mode === 'pieceSel' && ia.selUid != null) {
    const p = pieceByUid(st, ia.selUid);
    if (!p) return hl;
    for (const k of cellsOfPiece(p)) hl.sel.add(k);
    const canActNow = st.phase === 'action' && p.owner === st.curPlayer &&
                      !p.justDeployed && p.apLeft > 0;
    if (canActNow) {
      if (p.defId === 5) {
        if (p.charge > 0) for (const c of game.rules.moveTargets(p)) hl.mv.add(c.x + ',' + c.y);
      } else {
        for (const c of game.rules.moveTargets(p)) hl.mv.add(c.x + ',' + c.y);
        for (const t of game.rules.attackTargets(p)) for (const k of cellsOfPiece(t)) hl.atk.add(k);
        if (p.defId === 2) for (const t of game.rules.healTargets(p)) for (const k of cellsOfPiece(t)) hl.heal.add(k);
      }
    }
  }
  return hl;
}
