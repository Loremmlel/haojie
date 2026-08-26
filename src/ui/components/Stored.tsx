/* Stored.tsx · 法术储存栏（ui.js renderStored 平移为 JSX）
 * 卡类复用 Hand.module.css（.card/.spellCard/.c-* 同构）；释放按钮保留
 * data-cast-stored（评审 N3 e2e 钩子），同样走 runSpellCast。 */
import { useGame } from '../gameStore.ts';
import { runSpellCast } from '../interactionStore.ts';
import { getDef } from '../../engine/data.ts';
import { SPELL_TARGETS } from '../../engine/spells.ts';
import hand from './Hand.module.css';
import side from './SidePanel.module.css';

export default function Stored() {
  const loaded = useGame();
  if (!loaded) return null;
  const g = loaded.game;
  const st = g.state;
  const arr = st.stored[st.curPlayer] || [];

  if (!arr.length) {
    return <div id="stored" className={hand.cardrow}><div className={side.emptyHint}>空空如也</div></div>;
  }

  const handleCastStored = (idx: number) => {
    const gNow = g;
    void runSpellCast(
      () => {
        const s = gNow.state;
        const card = s.stored[s.curPlayer][idx];
        return SPELL_TARGETS[card.defId](s, s.curPlayer);
      },
      (got) => gNow.castStored(idx, got),
    );
  };

  return (
    <div id="stored" className={hand.cardrow}>
      {arr.map((card, idx) => {
        const def = getDef(card.defId);
        return (
          <div key={card.defId + '-' + idx} className={`${hand.card} ${hand.spellCard}`} data-card={idx}>
            <span className={hand.cLimit}>⏳剩 {card.remain} 回合</span>
            <div className={hand.cHead}>
              <span className={hand.cEmoji}>{def.emoji}</span>
              <span className={hand.cName}>{def.name}</span>
            </div>
            <div className={hand.cDesc}>{def.short}</div>
            {st.phase === 'action' && (
              <div className={hand.cardBtns}>
                <button className={`${hand.miniBtn} ${hand.miniPurple}`} data-cast-stored={idx}
                        onClick={() => handleCastStored(idx)}>✨ 释放</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
