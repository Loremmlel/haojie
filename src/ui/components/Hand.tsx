/* Hand.tsx · 手牌（ui.js renderHand 平移为 JSX）
 * e2e 钩子（评审 N3）：卡片 data-card/data-idx；释放/储存/弃置按钮
 * data-cast/data-store/data-discard。法术释放走 runSpellCast。 */
import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { useGame } from '../gameStore.ts';
import { useInteraction, setInteraction, act, runSpellCast } from '../interactionStore.ts';
import { getDef, type Def } from '../../engine/data.ts';
import { SPELL_TARGETS } from '../../engine/spells.ts';
import hand from './Hand.module.css';
import side from './SidePanel.module.css';

function statLine(def: Def) {
  if (def.type === 'spell') {
    return (
      <>
        <span>🧪 法术</span>
        <span>⏳ 储存 {def.limit} 回合</span>
      </>
    );
  }
  return (
    <>
      <span>⚔️ <b>{def.atk}</b></span>
      <span>❤️ <b>{def.hp}</b></span>
      <span>🎯 <b>{def.rng}</b></span>
      <span>⚡ <b>{def.acts}</b></span>
      <span>👟 <b>{def.mv}</b></span>
    </>
  );
}

export default function Hand() {
  const loaded = useGame();
  const ia = useInteraction();
  if (!loaded) return null;
  const g = loaded.game;
  const st = g.state;
  if (st.phase === 'over') {
    return <div id="hand" className={hand.cardrow}><div className={side.emptyHint}>战斗已结束</div></div>;
  }
  const cards = st.hand[st.curPlayer] || [];
  if (st.phase === 'action' && cards.length === 0) {
    return <div id="hand" className={hand.cardrow}><div className={side.emptyHint}>本回合召唤已全部处理完毕</div></div>;
  }

  const handleCardClick = (idx: number) => {
    const card = st.hand[st.curPlayer][idx];
    if (!card || getDef(card.defId).type === 'spell') return;
    if (ia.mode === 'deployCard' && ia.cardIdx === idx) {
      setInteraction({ mode: 'idle', cardIdx: null });
    } else {
      setInteraction({ mode: 'deployCard', cardIdx: idx });
    }
  };

  const handleCast = (idx: number) => {
    const gNow = g;
    void runSpellCast(
      () => {
        const s = gNow.state;
        const card = s.hand[s.curPlayer][idx];
        return SPELL_TARGETS[card.defId](s, s.curPlayer);
      },
      (got) => gNow.castHandSpell(idx, got),
    );
  };
  const handleStore = (idx: number) => {
    void act((gg) => gg.storeHandSpell(idx));
  };
  const handleDiscard = (idx: number) => {
    void act(async (gg) => { gg.discardUnplaceable(idx); });
  };

  const renderButtons = (card: { defId: number }, idx: number): ReactNode => {
    const def = getDef(card.defId);
    if (def.type === 'follower') {
      const n = g.rules.deployCells(card.defId, st.curPlayer).length;
      if (n === 0) {
        return (
          <div className={hand.cardBtns}>
            <button className={`${hand.miniBtn} ${hand.miniGold}`} data-discard={idx}
                    onClick={(e) => { e.stopPropagation(); handleDiscard(idx); }}>⚠️ 无处部署 · 弃置</button>
          </div>
        );
      }
      return null;
    }
    return (
      <div className={hand.cardBtns}>
        <button className={`${hand.miniBtn} ${hand.miniPurple}`} data-cast={idx}
                onClick={(e) => { e.stopPropagation(); handleCast(idx); }}>✨ 释放</button>
        <button className={`${hand.miniBtn} ${hand.miniGold}`} data-store={idx}
                onClick={(e) => { e.stopPropagation(); handleStore(idx); }}>🧪 储存</button>
      </div>
    );
  };

  return (
    <div id="hand" className={hand.cardrow}>
      {cards.map((card, idx) => {
        const def = getDef(card.defId);
        const isSelected = ia.mode === 'deployCard' && ia.cardIdx === idx;
        const cls = [
          hand.card,
          def.type === 'spell' ? hand.spellCard : '',
          isSelected ? hand.selected : (st.phase === 'deploy' ? hand.awaiting : ''),
        ].filter(Boolean).join(' ');
        return (
          <motion.div key={card.uid} layout="position">
            <div className={cls} data-card={idx} data-idx={idx} onClick={() => handleCardClick(idx)}>
              {def.type === 'spell' && <span className={hand.cLimit}>⏳{def.limit}回合</span>}
              <div className={hand.cHead}>
                <span className={hand.cEmoji}>{def.emoji}</span>
                <span className={hand.cName}>{def.name}</span>
              </div>
              <div className={hand.cStats}>{statLine(def)}</div>
              <div className={hand.cDesc}>{def.short}</div>
              {renderButtons(card, idx)}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
