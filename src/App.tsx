import { useCallback, useEffect, useState } from 'react';
import { createGame } from './engine/game.ts';
import { setGame, useGame } from './ui/gameStore.ts';
import TopBar from './ui/components/TopBar.tsx';
import BoardArea from './ui/components/BoardArea.tsx';

export default function App() {
  const [error, setError] = useState<string | null>(null);
  // 重开通道（M4 裁定）：setGame(null) 本身不触发重建，必须以 seq 为 effect 依赖
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = await createGame((Math.random() * 0xffffffff) >>> 0, {
          // 占位选择器：Task 6 Step 1 建成 interactionStore 后替换为真 ask
          choose: async () => null,
        });
        if (alive) setGame(g);
      } catch (e) { if (alive) setError(String(e)); }
    })();
    return () => { alive = false; };
  }, [seq]);
  const restart = useCallback(() => { setGame(null); setSeq((n) => n + 1); }, []);
  const loaded = useGame();
  if (error) return <div>加载失败：{error}</div>;
  if (!loaded) return <div>正在开局……</div>;
  return (
    <div id="app">
      <TopBar />
      <main id="layout">
        <BoardArea />
        <aside id="panel">{/* SidePanel 于 Task 6 起填充；restart 经 props 下发 */}</aside>
      </main>
    </div>
  );
}
