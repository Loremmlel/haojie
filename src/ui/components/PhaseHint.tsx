/* PhaseHint.tsx · 阶段提示条（ui.js renderPhaseHint 平移）
 * 优先级：winner 文案 → choice.hint → deploy 文案 → action 文案。 */
import { useGame } from '../gameStore.ts';
import { useInteraction } from '../interactionStore.ts';
import s from './PhaseHint.module.css';

export default function PhaseHint() {
  const loaded = useGame();
  const ia = useInteraction();
  if (!loaded) return null;
  const st = loaded.game.state;
  let text: string;
  if (st.winner != null) {
    text = '🏆 战斗结束！点击「重开」再来一局。';
  } else if (ia.choice && ia.choice.spec && 'hint' in ia.choice.spec && ia.choice.spec.hint) {
    text = '👆 ' + ia.choice.spec.hint;
  } else if (st.phase === 'deploy') {
    text = '📜 部署阶段：处理手中的召唤卡（随从必须放置 / 法术可释放或储存）';
  } else {
    text = '⚔️ 行动阶段：点击己方棋子下达指令（移动 / 攻击 / 技能），或结束回合';
  }
  return <div id="phasehint" className={s.phaseHint}>{text}</div>;
}
