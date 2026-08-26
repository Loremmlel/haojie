/* TopBar.tsx · 顶栏：双方基地血条 + 回合数 + 行动方高亮（ui.js refreshTop 平移） */
import { useEffect, useState } from 'react';
import { BASE_HP } from '../../engine/data.ts';
import { PNAME } from '../../engine/state.ts';
import { useGame } from '../gameStore.ts';
import s from './TopBar.module.css';

interface BarVals { f0: number; f1: number; hp0: number; hp1: number }

export default function TopBar() {
  const loaded = useGame();
  const tick = loaded?.tick;
  // 基地阵亡冻结（v1 refreshTop 语义：基地缺失即 early-return，血条停在最后一次有效值）
  const [last, setLast] = useState<BarVals | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const b0 = loaded.game.state.pieces.find((q) => !q.dead && q.defId === -1 && q.owner === 0);
    const b1 = loaded.game.state.pieces.find((q) => !q.dead && q.defId === -1 && q.owner === 1);
    if (b0 && b1) {
      setLast({
        f0: (Math.max(0, b0.hp) / BASE_HP) * 100,
        f1: (Math.max(0, b1.hp) / BASE_HP) * 100,
        hp0: Math.max(0, Math.round(b0.hp)),
        hp1: Math.max(0, Math.round(b1.hp)),
      });
    }
  }, [tick]); // tick 随 version 每 bump 递增：链尾刷新节奏与 v1 refreshTop 一致
  if (!loaded) return null;
  const st = loaded.game.state;
  const b0 = st.pieces.find((q) => !q.dead && q.defId === -1 && q.owner === 0);
  const b1 = st.pieces.find((q) => !q.dead && q.defId === -1 && q.owner === 1);
  const f0 = b0 && b1 ? (Math.max(0, b0.hp) / BASE_HP) * 100 : (last?.f0 ?? 0);
  const f1 = b0 && b1 ? (Math.max(0, b1.hp) / BASE_HP) * 100 : (last?.f1 ?? 0);
  const hp0 = b0 && b1 ? Math.max(0, Math.round(b0.hp)) : (last?.hp0 ?? 0);
  const hp1 = b0 && b1 ? Math.max(0, Math.round(b1.hp)) : (last?.hp1 ?? 0);
  const p1Active = st.curPlayer === 0 && st.winner == null;
  const p2Active = st.curPlayer === 1 && st.winner == null;
  return (
    <header id="topbar" className={s.topbar}>
      <div id="side-p1" className={`${s.side} ${s.sideP1}${p1Active ? ` ${s.active}` : ''}`}>
        <span className={s.sideName}>❄ 蓝方（玩家一）</span>
        <div className={s.basebar}>
          <div id="hp-p1" className={s.basebarFill} style={{ width: `${f0}%` }} />
          <span id="hp-p1-text" className={s.basebarText}>{`🏰 基地 ${hp0}/${BASE_HP}`}</span>
        </div>
      </div>
      <div id="turnbox" className={s.turnbox}>
        <div id="turn-num" className={s.turnNum}>{`回合 ${st.turnCounter}`}</div>
        <div id="turn-owner" className={s.turnOwner}>
          {st.winner != null ? `🏆 ${PNAME[st.winner]}获胜` : `${PNAME[st.curPlayer]}行动中`}
        </div>
      </div>
      <div id="side-p2" className={`${s.side} ${s.sideP2}${p2Active ? ` ${s.active}` : ''}`}>
        <div className={s.basebar}>
          <div id="hp-p2" className={s.basebarFill} style={{ width: `${f1}%` }} />
          <span id="hp-p2-text" className={s.basebarText}>{`${hp1}/${BASE_HP} 基地 🏰`}</span>
        </div>
        <span className={s.sideName}>红方（玩家二） 🔥</span>
      </div>
    </header>
  );
}
