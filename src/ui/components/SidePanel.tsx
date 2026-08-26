/* SidePanel.tsx · 右侧面板装配（v1 template.html #panel 结构平移）
 * 块结构（.panel-block/.block-title）静态定义于此；PhaseHint/Hand/Stored/InspectPanel/
 * SkillBox 各渲染内容，#panel 布局样式在 SidePanel.module.css（:global(#panel)）。
 * OptionFloat 为 position:fixed 浮层，随 choice 状态由自身渲染。 */
import PhaseHint from './PhaseHint.tsx';
import Hand from './Hand.tsx';
import Stored from './Stored.tsx';
import InspectPanel from './InspectPanel.tsx';
import SkillBox from './SkillBox.tsx';
import ActionBar from './ActionBar.tsx';
import OptionFloat from './OptionFloat.tsx';
import s from './SidePanel.module.css';

export default function SidePanel({ restart }: { restart: () => void }) {
  return (
    <aside id="panel">
      <PhaseHint />
      <section className={s.panelBlock}>
        <h3 className={s.blockTitle}>📜 本回合召唤 <span className={s.blockSub}>随从必须部署 / 法术可释放或储存</span></h3>
        <Hand />
      </section>
      <section className={s.panelBlock}>
        <h3 className={s.blockTitle}>🧪 法术储存栏 <span className={s.blockSub}>点击释放，期限耗尽即销毁</span></h3>
        <Stored />
      </section>
      <section className={s.panelBlock}>
        <h3 className={s.blockTitle}>🔍 棋子详情 <span className={s.blockSub}>点击场上棋子查看</span></h3>
        <InspectPanel />
      </section>
      <SkillBox />
      <ActionBar restart={restart} />
      <OptionFloat />
    </aside>
  );
}
