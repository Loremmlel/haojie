/* WinMask.tsx · 胜利遮罩（main.js showWinMask 平移）
 * winner 由 Task 8 onWin 状态驱动，winner != null 时挂载本组件，卸载即隐藏。
 * 「再来一局」调用 App 下发的 restart prop（M4 seq 重建通道，非 location.reload——
 *   restart 已含 setWinner(null)+setGame(null)+setSeq，评审 N5，勿重复实现）；
 * 「复盘战场」隐藏遮罩查看终局盘面（onReview 置 winner=null）。
 * 按钮复用 global.css .btn/.btn-primary 基类（评审 n6：ActionBar 与 WinMask 跨组件共用）。
 * #winmask/#win-text/#win-sub 为全局 DOM id。 */
import { PNAME } from '../../engine/state.ts';
import s from './WinMask.module.css';

export default function WinMask({ winner, restart, onReview }: {
  winner: number;
  restart: () => void;
  onReview: () => void;
}) {
  return (
    <div id="winmask">
      <div id="win-text" className={winner === 0 ? s.w1 : s.w2}>{PNAME[winner]}获胜！</div>
      <div id="win-sub">基地化为废墟，浩劫落幕</div>
      <button className="btn btn-primary" onClick={restart}>⟳ 再来一局</button>
      <button className="btn" onClick={onReview}>🔍 复盘战场</button>
    </div>
  );
}
