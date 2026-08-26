/* InspectPanel.tsx · 棋子详情面板（ui.js renderInspect + statusText 平移为 JSX）。
 * 数据源 pieceByUid(g.state, ia.inspectUid)；状态行文案与 v1 statusText 逐字。
 * 面板块外壳（panel-block）在 SidePanel 静态定义，本组件只渲染 #inspect 内容。 */
import { useGame } from '../gameStore.ts';
import { useInteraction } from '../interactionStore.ts';
import { getDef, type Def } from '../../engine/data.ts';
import { pieceByUid, PNAME, type Piece } from '../../engine/state.ts';
import s from './InspectPanel.module.css';
import side from './SidePanel.module.css';

/** 五维行（ui.js statLine 平移；棋子恒非法术，走数值分支） */
function statLine(def: Def) {
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

/** 状态行（ui.js statusText 平移，文案逐字） */
function statusParts(p: Piece, turnCounter: number): string[] {
  const parts: string[] = [];
  if (p.charge > 0) parts.push(`⚡蓄力 ${p.charge}`);
  if (p.skillUses > 0) parts.push(`🔋已强化 ${p.skillUses}/3`);
  if (p.killCount > 0) parts.push(`🔪击杀 ${p.killCount}`);
  if (p.shieldUntil > turnCounter) parts.push('🛡️金身');
  if (p.mark10) parts.push('🎯引信标记');
  if (p.reaperTo && p.reaperFrom <= turnCounter) parts.push('💀斩杀之刃');
  if (p.charmTo && p.charmFrom <= turnCounter) parts.push('🎭策反陷阱');
  if (p.guardUsed) parts.push('🗡️守护已耗尽');
  if (p.diesAt) parts.push(`⏳${Math.max(0, p.diesAt - turnCounter)} 回合后消散`);
  if (p.justDeployed) parts.push('💤部署当回合，尚待苏醒');
  return parts;
}

export default function InspectPanel() {
  const loaded = useGame();
  const ia = useInteraction();
  if (!loaded) return null;
  const g = loaded.game;
  const st = g.state;
  const p = ia.inspectUid != null ? pieceByUid(st, ia.inspectUid) : null;
  if (!p) {
    return (
      <div id="inspect">
        <div className={side.emptyHint}>暂无选中棋子</div>
      </div>
    );
  }
  const def = getDef(p.defId);
  const parts = statusParts(p, st.turnCounter);
  return (
    <div id="inspect">
      <div className={s.iHead}>
        <span className={s.iEmoji}>{def.emoji}</span>
        <span className={s.iName}>{def.name}</span>
        {def.type !== 'grave' && (
          <span className={`${s.iOwner} ${s[`o${p.owner}`]}`}>{PNAME[p.owner]}</span>
        )}
      </div>
      <div className={s.iStats}>
        {statLine(def)}
        <span>📍 <b>{p.x},{p.y}</b></span>
        <span>❤️ <b>{Math.max(0, Math.round(p.hp))}/{p.maxHp}</b></span>
      </div>
      {parts.length > 0 && <div className={s.iDesc}>{parts.join(' · ')}</div>}
      <div className={s.iDesc}>{def.desc}</div>
    </div>
  );
}
