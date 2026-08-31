/* ActionBar.tsx · 动作栏 #btns（v1 template.html 静态按钮 + ui.js renderBtns 禁用逻辑平移）
 * 按钮保留 v1 DOM id：btn-end/btn-undo/btn-codex/btn-rules/btn-restart（e2e 与快捷键依赖）。
 * .btn 基类留 global.css（ActionBar 与 WinMask 跨组件共用，评审 n6）。
 * 图鉴/规则按钮经 onOpenModal 打开对应 tab（Task 9 接线）；重开经 App 下发的 restart prop（M4 seq 重建通道）。 */
import { useGame, bumpVersion } from '../gameStore.ts';
import { useInteraction, act, toast } from '../interactionStore.ts';

export default function ActionBar({ restart, onOpenModal }: {
  restart: () => void;
  onOpenModal: (tab: 'codex' | 'rules') => void;
}) {
  const loaded = useGame();
  const ia = useInteraction();
  if (!loaded) return null;
  const g = loaded.game;
  const st = g.state;
  const canUndo = g.canUndo();

  const handleUndo = () => {
    if (ia.busy) return;
    if (g.undo()) { bumpVersion(); toast('↩ 已撤销上一步'); }
  };
  const handleRestart = () => {
    if (confirm('确定要重新开始吗？当前对局将丢失。')) restart();
  };

  return (
    <div id="btns">
      <button id="btn-end" className="btn btn-primary"
              disabled={ia.busy || st.phase !== 'action' || st.winner != null}
              onClick={() => void act((gg) => gg.endTurn())}>⏭ 结束回合</button>
      <button id="btn-undo" className="btn"
              disabled={ia.busy || !canUndo || st.winner != null}
              onClick={handleUndo}>↩ 悔棋</button>
      <button id="btn-codex" className="btn" onClick={() => onOpenModal('codex')}>📖 图鉴</button>
      <button id="btn-rules" className="btn" onClick={() => onOpenModal('rules')}>📐 规则</button>
      <button id="btn-restart" className="btn btn-danger" disabled={ia.choice != null}
              onClick={handleRestart}>⟳ 重开</button>
    </div>
  );
}
