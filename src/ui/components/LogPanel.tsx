/* LogPanel.tsx · 战报日志（ui.js renderLog 平移）
 * tail 70 条；cls 映射（l-impt/l-p1/l-p2 → module 类，空串走纯 .entry）；
 * 自动滚底 scrollTop = scrollHeight 于 useEffect [tick]（对齐 v1 每次刷新滚底）。
 * #logwrap/#log 为全局 DOM id（e2e 锚点）；标题复用 SidePanel.module.css 的 blockTitle
 * （与其它面板块同款，InspectPanel 亦复用 side 模块类，见其 emptyHint）。 */
import { useEffect, useRef } from 'react';
import { useGame } from '../gameStore.ts';
import s from './LogPanel.module.css';
import side from './SidePanel.module.css';

const CLS_MAP: Record<string, string> = {
  'l-impt': s.impt,
  'l-p1': s.p1,
  'l-p2': s.p2,
};

export default function LogPanel() {
  const loaded = useGame();
  const tick = loaded?.tick;
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [tick]);
  if (!loaded) return null;
  const tail = loaded.game.state.log.slice(-70);
  return (
    <div id="logwrap">
      <h3 className={side.blockTitle}>🗒 战报</h3>
      <div id="log" ref={logRef}>
        {tail.map((l, i) => (
          <div key={i} className={`${s.entry}${l.cls ? ` ${CLS_MAP[l.cls] ?? ''}` : ''}`}>{l.msg}</div>
        ))}
      </div>
    </div>
  );
}
