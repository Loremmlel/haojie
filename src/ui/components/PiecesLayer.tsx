/* PiecesLayer.tsx · 棋子层：key={uid} 渲染存活棋子（跨渲染 DOM 稳定，CSS transition 不打断）。
 * 状态外观（badges/apdots/exhausted/shielded/marked/reapered/charmed/charged/buffed/selected）
 * 全部由当前 st/ia 声明式推导（ui.js syncStatsOf 平移），无命令式 DOM 操作。
 * memo/useCallback deps 只用原始值（uid），绝不依赖 piece 对象身份。
 * 布局：root（ref=pieceRegistry 条目）负责 left/top/点击/持久态 CSS（transform/filter）；
 * 内层 [data-piece-motion]（.motionBody）承接 fx 命令式 temporary transform
 * （lunge/hit/deploy/death，见 fx.ts），两者分离使 MOTION 可变样式与 React 持久态互不踩写。 */
import { useCallback } from 'react';
import { getDef } from '../../engine/data.ts';
import { effAtk, effActions } from '../../engine/rules.ts';
import { pieceRegistry } from '../fx/registry.ts';
import { isDying } from '../fx/fx.ts';
import { posOf, type Metrics } from '../geometry.ts';
import type { Game } from '../../engine/types.ts';
import type { GameState, Piece } from '../../engine/state.ts';
import type { InteractionState } from '../interactionStore.ts';
import s from './Piece.module.css';

function PieceView({ p, st, ia, m }: { p: Piece; st: GameState; ia: InteractionState; m: Metrics }) {
  const refCb = useCallback((el: HTMLDivElement | null) => {
    if (el) pieceRegistry.set(p.uid, el); else pieceRegistry.remove(p.uid);
  }, [p.uid]);
  const def = getDef(p.defId);
  const pos = posOf(p.x, p.y, !!p.big, m);

  // 徽标（syncStatsOf：charge>0 → ⚡n；reaper 生效当回合 → 💀；charm 生效中 → 🎭）
  const badges: string[] = [];
  if (p.charge > 0) badges.push(`⚡${p.charge}`);
  if (p.reaperTo && st.turnCounter === p.reaperFrom) badges.push('💀');
  if (p.charmTo && st.turnCounter >= p.charmFrom && st.turnCounter < p.charmTo) badges.push('🎭');

  // 行动点：己方行动阶段、非刚部署、effActions>0 时渲染 total 个点，已耗者 spent
  const total = effActions(st, p);
  const mine = p.owner === st.curPlayer && st.phase !== 'over';
  const showAp = mine && !p.justDeployed && total > 0 && st.phase === 'action';

  // 状态外观类（syncStatsOf classList.toggle 条件逐字平移）
  const exhausted =
    (p.owner === st.curPlayer && st.phase === 'action' &&
      (p.justDeployed || (p.apLeft <= 0 && total > 0))) || def.type === 'grave';
  const cls = [
    'piece',
    s.piece,
    s[`own${p.owner}`],
    p.big ? s.big5 : '',
    exhausted ? s.exhausted : '',
    p.shieldUntil > st.turnCounter ? s.shielded : '',
    p.mark10 ? s.marked : '',
    p.reaperTo && p.reaperFrom <= st.turnCounter ? s.reapered : '',
    p.charmTo && p.charmFrom <= st.turnCounter && p.charmTo > st.turnCounter ? s.charmed : '',
    p.charge >= 2 ? s.charged : '',
    p.atkBuffs.length > 0 ? s.buffed : '',
    ia.mode === 'pieceSel' && ia.selUid === p.uid ? s.selected : '',
  ].filter(Boolean).join(' ');

  return (
    <div ref={refCb}
         className={cls}
         data-uid={p.uid}
         style={{ left: pos.left, top: pos.top }}>
      <div className={s.motionBody} data-piece-motion>
        <div className={s.face}>{def.emoji}</div>
        {p.defId >= 0 && <span className={`${s.stat} ${s.atk}`}>{effAtk(st, p)}</span>}
        <span className={`${s.stat} ${s.hp}${p.hp <= p.maxHp * 0.35 ? ` ${s.hurt}` : ''}`}>
          {Math.max(0, Math.round(p.hp))}
        </span>
        {badges.length > 0 && <div className={s.badges}>{badges.join('')}</div>}
        {showAp && (
          <div className={s.apdots}>
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={`${s.apdot}${i >= p.apLeft ? ` ${s.apdotSpent}` : ''}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PiecesLayer({ game, st, ia, m }: {
  game: Game; st: GameState; ia: InteractionState; m: Metrics | null;
}) {
  if (!m) return null; // 量测就绪前不渲染（无坐标可定位）
  return (
    <>
      {/* 死亡节点存续期归 FX 链（isDying 事件游标法）：引擎在 doAttack 内同步置 dead，
          act 的 busy/dead 渲染（React 批量 flush）会先于 playChain 提交；若此时即按
          !p.dead 直接过滤，阵亡棋子会在死亡 FX 播完前被卸载（registry 也随之清空，
          fx 拿不到 motion node）。fx 的 isDying 以「死亡事件未消费」判定：死亡事件由
          fn 同步入列、playChain 消费后才过游标——链首到链尾命中保持挂载，链尾之后
          （含任意后续 busy 链）不再命中——旧 !p.dead || ia.busy 过滤会在每条后续链
          开头把 0HP 尸体重新挂载整个链期。 */}
      {st.pieces.filter((p) => !p.dead || isDying(game, p.uid)).map((p) => (
        <PieceView key={p.uid} p={p} st={st} ia={ia} m={m} />
      ))}
    </>
  );
}
