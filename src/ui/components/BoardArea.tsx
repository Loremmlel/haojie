/* BoardArea.tsx · 棋盘区：CellsGrid + PiecesLayer + FxLayer 组合；
 * 点击解析（input.js onCellClick/onPieceClick 平移）：监听器挂在 #board-outer——
 * 棋子 DOM 盖在格子上，必须在外层容器才能同时接住棋子与格子的点击。
 * 两条铁律：choice 分支先于 busy 检查（死锁防御 §6.3）；
 * 已选中己方棋子时点敌方＝攻击、点残血友方＝治疗（onPieceClick 攻击解析分支）。
 * #boardwrap/#board-outer 属 Global Constraints 第 1 条保留 global 的范围，本组件无 module 私有类。 */
import { useRef, type MouseEvent } from 'react';
import { useGame, getGame } from '../gameStore.ts';
import { useBoardMetrics } from '../hooks/useBoardMetrics.ts';
import { pieceAt, pieceByUid, type Piece } from '../../engine/state.ts';
import { getInteraction, setInteraction, finishChoice, act, toast } from '../interactionStore.ts';
import CellsGrid from './CellsGrid.tsx';
import PiecesLayer from './PiecesLayer.tsx';
import FxLayer, { type FxLayerHandle } from './FxLayer.tsx';

/** 选择模式下解析格子点击（input.js tryResolveChoiceByCell 平移） */
function tryResolveChoiceByCell(x: number, y: number): boolean {
  const spec = getInteraction().choice?.spec;
  if (!spec) return false;
  if (spec.kind === 'cell' && spec.cells.some((c) => c.x === x && c.y === y)) {
    finishChoice({ x, y });
    return true;
  }
  if (spec.kind === 'piece') {
    const occ = pieceAt(getGame()!.state, x, y);
    if (occ && spec.pieces.includes(occ)) { finishChoice(occ); return true; }
  }
  return true; // 选择模式下吞掉其它点击
}

/** 选择模式下解析棋子点击（input.js tryResolveChoiceByPiece 平移） */
function tryResolveChoiceByPiece(p: Piece): boolean {
  const spec = getInteraction().choice?.spec;
  if (!spec) return false;
  if (spec.kind === 'piece' && spec.pieces.includes(p)) { finishChoice(p); return true; }
  return true;
}

/** 格子被点击（input.js onCellClick 平移） */
function handleCellClick(x: number, y: number) {
  const ia = getInteraction();
  if (ia.choice) { tryResolveChoiceByCell(x, y); return; }
  if (ia.busy) return;
  const g = getGame();
  if (!g) return;
  const st = g.state;

  // 部署阶段
  if (st.phase === 'deploy' && ia.mode === 'deployCard' && ia.cardIdx != null) {
    const idx = ia.cardIdx;
    void act((gg) => gg.deployFollower(idx, x, y));
    return;
  }

  // 行动阶段：对已选棋子下达指令
  if (st.phase === 'action' && ia.mode === 'pieceSel' && ia.selUid != null) {
    const p = pieceByUid(st, ia.selUid);
    if (!p) return;
    const mv = g.rules.moveTargets(p).some((c) => c.x === x && c.y === y);
    if (mv && !(p.defId === 5 && p.charge <= 0)) {
      const uid = ia.selUid;
      void act((gg) => gg.doMove(uid, x, y));
      return;
    }
    const occ = pieceAt(st, x, y);
    if (occ && occ !== p) {
      const isAtk = g.rules.attackTargets(p).includes(occ);
      const isHeal = p.defId === 2 && occ.owner === p.owner &&
                     g.rules.healTargets(p).includes(occ);
      if (isAtk || isHeal) {
        const uid = ia.selUid;
        void act((gg) => gg.doAttack(uid, occ.uid));
        return;
      }
    }
  }
}

/** 棋子被点击（input.js onPieceClick 平移） */
function handlePieceClick(p: Piece) {
  const ia = getInteraction();
  if (ia.choice) { tryResolveChoiceByPiece(p); return; }
  if (ia.busy) return;
  const g = getGame();
  if (!g) return;
  const st = g.state;
  setInteraction({ inspectUid: p.uid });

  if (st.winner != null) return;

  // ── 已选中己方棋子时：点敌方红框棋子＝发起攻击；点残血友方绿框棋子＝治疗。
  //    （必须在此解析：敌方棋子 DOM 盖在格子上，点它不会经过 onCellClick）
  if (st.phase === 'action' && ia.mode === 'pieceSel' && ia.selUid != null &&
      ia.selUid !== p.uid) {
    const sel = pieceByUid(st, ia.selUid);
    if (sel && sel.owner === st.curPlayer && !sel.justDeployed && sel.apLeft > 0) {
      const isAtk = p.owner !== st.curPlayer && g.rules.attackTargets(sel).includes(p);
      const isHeal = sel.defId === 2 && p.owner === sel.owner &&
                     g.rules.healTargets(sel).includes(p);
      if (isAtk || isHeal) {
        const uid = sel.uid;
        void act((gg) => gg.doAttack(uid, p.uid));
        return;
      }
    }
  }

  if (p.owner === st.curPlayer && st.phase === 'action') {
    if (p.justDeployed) {
      toast('💤 刚部署的棋子本回合还在热身，下回合才能行动（冲锋怪可以选择冲锋立即行动哦）');
    } else if (p.apLeft <= 0) {
      toast('⚡ 这枚棋子本回合的行动点已经用完了');
    }
  }

  // 点自己的可行动棋子 → 进入指挥模式
  if (p.owner === st.curPlayer &&
      ((st.phase === 'action' && !p.justDeployed && p.apLeft > 0) ||
       st.phase === 'deploy')) {
    setInteraction({ mode: 'pieceSel', selUid: p.uid });
  } else if (ia.mode === 'pieceSel' && ia.selUid !== p.uid) {
    setInteraction({ mode: 'idle', selUid: null });
  }
}

export default function BoardArea() {
  const loaded = useGame();
  const boardRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<FxLayerHandle>(null);
  const m = useBoardMetrics(boardRef);
  if (!loaded) return null;
  const game = loaded.game;

  const handleBoardClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const pel = target.closest<HTMLElement>('.piece');
    if (pel) {
      const p = pieceByUid(game.state, Number(pel.dataset.uid));
      if (p) { handlePieceClick(p); return; }
    }
    const cel = target.closest<HTMLElement>('.cell');
    if (cel) handleCellClick(Number(cel.dataset.x), Number(cel.dataset.y));
  };

  return (
    <section id="boardwrap">
      <div id="board-outer" onClick={handleBoardClick}>
        <CellsGrid game={game} boardRef={boardRef} />
        <PiecesLayer st={game.state} m={m} />
        <FxLayer ref={fxRef} />
      </div>
    </section>
  );
}
