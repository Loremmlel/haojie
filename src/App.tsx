import { useCallback, useEffect, useState } from 'react';
import { createGame } from './engine/game.ts';
import { setGame, useGame } from './ui/gameStore.ts';
import { ask } from './ui/interactionStore.ts';
import TopBar from './ui/components/TopBar.tsx';
import BoardArea from './ui/components/BoardArea.tsx';
import SidePanel from './ui/components/SidePanel.tsx';

export default function App() {
  const [error, setError] = useState<string | null>(null);
  // 重开通道（M4 裁定）：setGame(null) 本身不触发重建，必须以 seq 为 effect 依赖
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = await createGame((Math.random() * 0xffffffff) >>> 0, {
          choose: ask, // 引擎目标选择注入：ask 在 interactionStore 落地为「高亮 + 等待点击」
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
        <SidePanel restart={restart} />
      </main>
    </div>
  );
}
