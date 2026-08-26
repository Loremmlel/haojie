import { useCallback, useEffect, useRef, useState } from 'react';
import { createGame } from './engine/game.ts';
import { setGame, getGame, bumpVersion, useGame } from './ui/gameStore.ts';
import { ask, toast, act, finishChoice, resetSelection, getInteraction } from './ui/interactionStore.ts';
import { initFx } from './ui/fx/fx.ts';
import { pieceRegistry } from './ui/fx/registry.ts';
import TopBar from './ui/components/TopBar.tsx';
import BoardArea, { type FxHosts } from './ui/components/BoardArea.tsx';
import SidePanel from './ui/components/SidePanel.tsx';
import ToastHost from './ui/components/ToastHost.tsx';
import CodexModal from './ui/components/CodexModal.tsx';
import WinMask from './ui/components/WinMask.tsx';

export default function App() {
  const [error, setError] = useState<string | null>(null);
  // 重开通道（M4 裁定）：setGame(null) 本身不触发重建，必须以 seq 为 effect 依赖
  const [seq, setSeq] = useState(0);
  // Task 8 onWin 写入；Task 9 渲染 WinMask 本体（winner != null 挂载，卸载即隐藏）
  const [winner, setWinner] = useState<number | null>(null);
  const [hosts, setHosts] = useState<FxHosts | null>(null);
  // 图鉴/规则模态框状态化（codex.js openModal/closeModal/switchTab 平移）：null 即关闭
  const [modalTab, setModalTab] = useState<'codex' | 'rules' | null>(null);
  const openModal = useCallback((tab: 'codex' | 'rules') => setModalTab(tab), []);
  const closeModal = useCallback(() => setModalTab(null), []);
  const review = useCallback(() => setWinner(null), []);

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
        // 规格 §6.2「双 rAF 或等效调度手法」：headless（--virtual-time-budget）下嵌套
        // requestAnimationFrame 可能永不触发（实测不稳定），改用双 setTimeout(0)——macrotask
        // 必在 React 微任务提交（registry 物化新节点）之后执行，语义等价且环境无关。
        await new Promise((r) => setTimeout(() => setTimeout(r, 0), 0));
      },
    });
  }, [hosts, onWin]);

  // 快捷键（main.js bindTopButtons keydown 平移）：Esc 三级（关 modal → 取消 cancelable choice →
  // resetSelection）、U 悔棋、E 结束回合。绑定期间读交互/游戏状态一律走 getter 取最新值；
  // modalTab 为 React state，以依赖项使 effect 在开关时重绑（关闭/打开切换极低频）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (modalTab) {
          closeModal();
        } else {
          const ia = getInteraction();
          if (ia.choice && ia.choice.spec.kind !== 'none' && ia.choice.spec.cancelable) {
            finishChoice(null);
          } else if (ia.mode !== 'idle') {
            resetSelection();
          }
        }
      } else if (e.key === 'u' || e.key === 'U') {
        const ia = getInteraction();
        if (ia.busy) return;
        const g = getGame();
        if (!g || g.state.winner != null) return; // 对齐 btn-undo disabled（busy/无栈/胜负已定）
        if (g.undo()) { bumpVersion(); toast('↩ 已撤销上一步'); }
      } else if (e.key === 'e' || e.key === 'E') {
        const ia = getInteraction();
        if (ia.busy) return;
        const g = getGame();
        if (!g) return;
        const st = g.state;
        if (st.phase !== 'action' || st.winner != null) return; // 对齐 btn-end disabled
        void act((gg) => gg.endTurn());
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [modalTab, closeModal]);

  // 右键（main.js bindTopButtons contextmenu 平移）：取消 choice（cancelable）/ 复位选择，preventDefault
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const ia = getInteraction();
      if (ia.choice) {
        e.preventDefault();
        if (ia.choice.spec.kind !== 'none' && ia.choice.spec.cancelable) finishChoice(null);
        return;
      }
      if (ia.mode !== 'idle') {
        e.preventDefault();
        resetSelection();
      }
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

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
        <SidePanel restart={restart} onOpenModal={openModal} />
      </main>
      <ToastHost />
      {modalTab && <CodexModal tab={modalTab} onClose={closeModal} onSwitchTab={openModal} />}
      {winner != null && <WinMask winner={winner} restart={restart} onReview={review} />}
    </div>
  );
}
