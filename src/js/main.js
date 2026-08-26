/* ═══════════════ main.js · 入口装配 ═══════════════ */

/** 胜利遮罩（fx.js 的 win 事件调用） */
function showWinMask(winner) {
  let mask = document.getElementById('winmask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'winmask';
    mask.innerHTML =
      `<div id="win-text"></div><div id="win-sub">基地化为废墟，浩劫落幕</div>` +
      `<button class="btn btn-primary" onclick="location.reload()">⟳ 再来一局</button>` +
      `<button class="btn" id="win-review">🔍 复盘战场</button>`;
    document.body.appendChild(mask);
    document.getElementById('win-review').onclick = () => {
      mask.classList.add('hidden');
      UI.refreshAll();
    };
  }
  const t = document.getElementById('win-text');
  t.textContent = `${PNAME[winner]}获胜！`;
  t.className = winner === 0 ? 'w1' : 'w2';
  FX.banner(`${PNAME[winner]}胜利！`, 'bwin');
}

/* ─────────── 启动 ─────────── */

async function boot() {
  bindTopButtons();
  bindEvents();   // 棋盘 / 手牌 / 储存栏 / 技能框的点击委托
  await API.init((Math.random() * 0xffffffff) >>> 0);
  UI.refreshAll();

  // 调试/自动化测试钩子（不影响正常游玩）
  if (typeof window !== 'undefined') {
    window.__HJ_DEBUG__ = { api: API, ui: UI, uist: UIST };
  }

  // 首次进入自动展示一次规则提示
  toast('欢迎来到「浩劫」！首次游玩建议先读一读 📐 规则 哦～');
}

function bindTopButtons() {
  document.getElementById('btn-end').onclick = () => act(() => API.endTurn());
  document.getElementById('btn-undo').onclick = async () => {
    if (busy) return;
    if (await API.undo()) { UI.refreshAll(); toast('↩ 已撤销上一步'); }
  };
  document.getElementById('btn-codex').onclick = () => openModal('codex');
  document.getElementById('btn-rules').onclick = () => openModal('rules');
  document.getElementById('btn-restart').onclick = () => {
    if (confirm('确定要重新开始吗？当前对局将丢失。')) location.reload();
  };

  // 模态框
  document.getElementById('modal-close').onclick = closeModal;
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });
  document.querySelectorAll('.mtab').forEach((b) => {
    b.onclick = () => switchTab(b.dataset.tab);
  });

  // 快捷键：Esc 取消选择/关闭弹窗；U 悔棋；E 结束回合
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!document.getElementById('modal').classList.contains('hidden')) closeModal();
      else if (UIST.choice && UIST.choice.spec.cancelable) finishChoice(null);
      else if (UIST.mode !== 'idle') {
        UIST.mode = 'idle'; UIST.cardIdx = null; UIST.selUid = null;
        UI.refreshAll();
      }
    } else if (e.key === 'u' || e.key === 'U') {
      document.getElementById('btn-undo').click();
    } else if (e.key === 'e' || e.key === 'E') {
      document.getElementById('btn-end').click();
    }
  });

  // 右键：取消目标选择
  document.addEventListener('contextmenu', (e) => {
    if (UIST.choice) {
      e.preventDefault();
      if (UIST.choice.spec.cancelable) finishChoice(null);
      return;
    }
    if (UIST.mode !== 'idle') {
      e.preventDefault();
      UIST.mode = 'idle'; UIST.cardIdx = null; UIST.selUid = null;
      UI.refreshAll();
    }
  });

  // 窗口尺寸变化后重排棋子
  window.addEventListener('resize', () => {
    UI.refreshAll();
  });
}

boot();
