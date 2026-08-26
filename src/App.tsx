import { useCallback, useEffect, useRef, useState } from 'react';
import { createGame } from './engine/game.ts';
import { setGame, getGame, bumpVersion, useGame } from './ui/gameStore.ts';
import { ask, toast } from './ui/interactionStore.ts';
import { initFx } from './ui/fx/fx.ts';
import { pieceRegistry } from './ui/fx/registry.ts';
import { PNAME } from './engine/state.ts';
import TopBar from './ui/components/TopBar.tsx';
import BoardArea, { type FxHosts } from './ui/components/BoardArea.tsx';
import SidePanel from './ui/components/SidePanel.tsx';
import ToastHost from './ui/components/ToastHost.tsx';

export default function App() {
  const [error, setError] = useState<string | null>(null);
  // 重开通道（M4 裁定）：setGame(null) 本身不触发重建，必须以 seq 为 effect 依赖
  const [seq, setSeq] = useState(0);
  // Task 8 onWin 写入；Task 9 渲染 WinMask 本体（当前 console 占位）
  const [winner, setWinner] = useState<number | null>(null);
  const [hosts, setHosts] = useState<FxHosts | null>(null);

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
  const restart = useCallback(() => { setGame(null); setWinner(null); setSeq((n) => n + 1); }, []);

  // BoardArea 挂载后上报三个宿主元素（恒等稳定，只触发一次）
  const onHosts = useCallback((h: FxHosts) => {
    setHosts((prev) =>
      prev && prev.boardOuter === h.boardOuter && prev.fxLayer === h.fxLayer && prev.banner === h.banner
        ? prev : h);
  }, []);

  const onWin = useCallback((w: number) => {
    setWinner(w);
    // Task 9：渲染 WinMask 本体；当前仅 console 占位
    console.log(`[Task 8 占位] ${PNAME[w]}胜利——WinMask 由 Task 9 渲染`);
  }, []);

  // initFx 装配（宿主就绪后一次；onSyncPoint = bump + 双 rAF，deploy 受控提交）
  useEffect(() => {
    if (!hosts) return;
    initFx({
      hosts,
      registry: pieceRegistry,
      getGame: () => getGame()!, // act/playChain 均在 game 就绪后运行，非空安全
      onWin,
      onSyncPoint: async () => {
        bumpVersion();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      },
    });
  }, [hosts, onWin]);

  const loaded = useGame();

  // 欢迎语（对齐 v1 main.js boot：首局 setGame 后触发一次，重开不重复）
  const welcomed = useRef(false);
  useEffect(() => {
    if (loaded && !welcomed.current) {
      welcomed.current = true;
      toast('欢迎来到「浩劫」！首次游玩建议先读一读 📐 规则 哦～');
    }
  }, [loaded]);

  if (error) return <div>加载失败：{error}</div>;
  if (!loaded) return <div>正在开局……</div>;
  return (
    <div id="app">
      <TopBar />
      <main id="layout">
        <BoardArea onHosts={onHosts} />
        <SidePanel restart={restart} />
      </main>
      <ToastHost />
    </div>
  );
}
