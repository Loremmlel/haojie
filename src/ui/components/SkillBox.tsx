/* SkillBox.tsx · 技能框（ui.js renderSkillbox 平移为 JSX）。
 * 大肉比蓄势按钮 act(g=>g.doMove(uid,p.x,p.y))；技能按钮 act(g=>g.useSkill(uid))。
 * 按钮 label 来自 SkillInfo.label；React onClick 直连，不再走 v1 的 data-act 事件委托。 */
import { useGame } from '../gameStore.ts';
import { useInteraction, act } from '../interactionStore.ts';
import { pieceByUid } from '../../engine/state.ts';
import s from './SkillBox.module.css';

export default function SkillBox() {
  const loaded = useGame();
  const ia = useInteraction();
  if (!loaded) return null;
  const g = loaded.game;
  const st = g.state;
  if (st.phase !== 'action' || ia.mode !== 'pieceSel' || ia.selUid == null) {
    return <div id="skillbox" />;
  }
  const p = pieceByUid(st, ia.selUid);
  if (!p || p.owner !== st.curPlayer || p.justDeployed || p.apLeft <= 0) {
    return <div id="skillbox" />;
  }

  // 大肉比蓄势按钮（v1 早退优先于技能按钮）
  if (p.defId === 5 && p.charge <= 0) {
    return (
      <div id="skillbox">
        <button className={s.btnMove}
                onClick={() => void act((gg) => gg.doMove(p.uid, p.x, p.y))}>
          🐘 蓄势（下次移动才会真正挪动）
        </button>
      </div>
    );
  }
  // 技能按钮
  const sk = g.rules.skillInfo(p);
  if (sk && sk.usable(p)) {
    return (
      <div id="skillbox">
        <button className={s.btnSkill}
                onClick={() => void act((gg) => gg.useSkill(p.uid))}>
          {sk.label}
        </button>
      </div>
    );
  }
  return <div id="skillbox" />;
}
