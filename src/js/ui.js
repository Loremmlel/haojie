/* ═══════════════ ui.js · 渲染层 ═══════════════
 * 格子层：每次刷新全量重建（无状态、承载高亮）
 * 棋子层：按 uid 做 DOM diff，位移交给 CSS transition 动画
 * ══════════════════════════════════════════════ */

/** 纯 UI 交互状态（不属于游戏状态、不入快照） */
const UIST = {
  mode: 'idle',      // idle | deployCard | pieceSel
  cardIdx: null,     // deployCard：当前手牌索引
  selUid: null,      // pieceSel：选中的己方棋子
  inspectUid: null,  // 详情面板展示的棋子
  choice: null,      // ENV.choose 进行中的 {spec, resolve}
};

const UI = (() => {
  const pieceMap = new Map();   // uid → HTMLElement
  let metrics = null;

  const boardEl = () => document.getElementById('board');

  /* ─────────── 几何 ─────────── */

  function measure() {
    const first = boardEl().querySelector('.cell');
    if (!first) return null;
    const size = first.offsetWidth;
    const next = first.nextElementSibling;
    const gap = next ? next.offsetLeft - first.offsetLeft - size : 3;
    const pad = first.offsetLeft;
    metrics = { size, gap, pad };
    FX.setMetrics(metrics);
    return metrics;
  }

  /** 棋子左上角像素位置 */
  function posOf(x, y, big) {
    const m = metrics || measure() || { size: 48, gap: 3, pad: 10 };
    return {
      left: m.pad + (x - 1) * (m.size + m.gap),
      top: m.pad + (H - y - (big ? 1 : 0)) * (m.size + m.gap),
    };
  }

  /* ─────────── 高亮计算 ─────────── */

  function cellsOfPiece(p) {
    return pieceCells(p).map((c) => c.x + ',' + c.y);
  }

  function computeHighlights() {
    const hl = { dep: [], mv: [], atk: [], sk: [], heal: [], sel: [] };
    const st = API.state();

    // 法术/技能目标选择优先
    if (UIST.choice && UIST.choice.spec) {
      const spec = UIST.choice.spec;
      if (spec.kind === 'cell') hl.sk = spec.cells.map((c) => c.x + ',' + c.y);
      if (spec.kind === 'piece') {
        for (const t of spec.pieces) hl.sk.push(...cellsOfPiece(t));
      }
      return hl;
    }

    if (UIST.mode === 'deployCard' && UIST.cardIdx != null) {
      const card = st.hand[st.curPlayer][UIST.cardIdx];
      if (card) hl.dep = API.rules.deployCells(card.defId, st.curPlayer).map((c) => c.x + ',' + c.y);
      return hl;
    }

    if (UIST.mode === 'pieceSel' && UIST.selUid != null) {
      const p = pieceByUid(st, UIST.selUid);
      if (!p) return hl;
      hl.sel = cellsOfPiece(p);
      const canActNow = st.phase === 'action' && p.owner === st.curPlayer &&
                        !p.justDeployed && p.apLeft > 0;
      if (canActNow) {
        if (p.defId === 5) {
          if (p.charge > 0) hl.mv = API.rules.moveTargets(p).map((c) => c.x + ',' + c.y);
        } else {
          hl.mv = API.rules.moveTargets(p).map((c) => c.x + ',' + c.y);
          for (const t of API.rules.attackTargets(p)) hl.atk.push(...cellsOfPiece(t));
          if (p.defId === 2) for (const t of API.rules.healTargets(p)) hl.heal.push(...cellsOfPiece(t));
        }
      }
    }
    return hl;
  }

  /* ─────────── 格子层 ─────────── */

  function renderCells() {
    const hl = computeHighlights();
    const set = (arr) => new Set(arr);
    const S_dep = set(hl.dep), S_mv = set(hl.mv), S_atk = set(hl.atk),
          S_sk = set(hl.sk), S_heal = set(hl.heal), S_sel = set(hl.sel);

    const frag = document.createDocumentFragment();
    for (let row = 1; row <= H; row++) {
      for (let col = 1; col <= W; col++) {
        const x = col, y = H - row + 1;   // y=1 固定渲染在最下行（蓝方阵地）
        const c = document.createElement('div');
        c.className = 'cell';
        c.dataset.x = x; c.dataset.y = y;
        const key = x + ',' + y;
        const occ = pieceAt(API.state(), x, y);
        if (occ && occ.defId === -1) c.classList.add('base-cell', occ.owner === 0 ? 'p1' : 'p2');
        if (S_dep.has(key)) c.classList.add('dep-ok');
        else {
          if (S_mv.has(key)) c.classList.add('mv-ok');
          if (S_atk.has(key)) c.classList.add('atk-ok');
          if (S_heal.has(key)) c.classList.add('heal-ok');
          if (S_sk.has(key)) c.classList.add('sk-ok');
        }
        if (S_sel.has(key)) c.classList.add('sel-hl');
        frag.appendChild(c);
      }
    }
    const el = boardEl();
    el.innerHTML = '';
    el.appendChild(frag);
  }

  /* ─────────── 棋子层 ─────────── */

  function buildPieceEl(p) {
    const def = getDef(p.defId);
    const el = document.createElement('div');
    el.className = 'piece pop-in';
    el.dataset.uid = p.uid;
    el.innerHTML =
      `<div class="face">${def.emoji}</div>` +
      `<span class="stat atk"></span><span class="stat hp"></span>` +
      `<div class="badges"></div><div class="apdots"></div>`;
    setTimeout(() => el.classList.remove('pop-in'), 500);
    return el;
  }

  function syncStatsOf(p, el) {
    const def = getDef(p.defId);
    const atkEl = el.querySelector('.stat.atk'), hpEl = el.querySelector('.stat.hp');
    if (p.defId < 0) { atkEl.style.display = 'none'; }
    else { atkEl.style.display = ''; atkEl.textContent = effAtk(p); }
    hpEl.textContent = Math.max(0, Math.round(p.hp));
    hpEl.parentElement.classList.toggle('hurt', p.hp <= p.maxHp * 0.35);

    // 徽标
    const badges = [];
    if (p.charge > 0) badges.push('⚡' + p.charge);
    if (p.reaperTo && API.state().turnCounter === p.reaperFrom) badges.push('💀');
    if (p.charmTo && API.state().turnCounter >= p.charmFrom && API.state().turnCounter < p.charmTo) badges.push('🎭');
    el.querySelector('.badges').textContent = badges.join('');

    // 行动点
    const apBox = el.querySelector('.apdots');
    const st = API.state();
    const mine = p.owner === st.curPlayer && st.phase !== 'over';
    const total = effActions(p);
    if (mine && !p.justDeployed && total > 0 && st.phase === 'action') {
      let html = '';
      for (let i = 0; i < total; i++) html += `<span class="apdot ${i < p.apLeft ? '' : 'spent'}"></span>`;
      apBox.innerHTML = html;
    } else apBox.innerHTML = '';

    // 状态外观
    el.classList.toggle('exhausted',
      (p.owner === st.curPlayer && st.phase === 'action' && (p.justDeployed || (p.apLeft <= 0 && total > 0))) ||
      def.type === 'grave');
    el.classList.toggle('shielded', !!p.shieldUntil && p.shieldUntil > st.turnCounter);
    el.classList.toggle('marked', !!p.mark10);
    el.classList.toggle('reapered', !!p.reaperTo && p.reaperFrom <= st.turnCounter);
    el.classList.toggle('charmed', !!p.charmTo && p.charmFrom <= st.turnCounter && p.charmTo > st.turnCounter);
    el.classList.toggle('charged', p.charge >= 2);
    el.classList.toggle('buffed', p.atkBuffs.length > 0);
    el.classList.toggle('selected', UIST.mode === 'pieceSel' && UIST.selUid === p.uid);
    void def;
  }

  /** 棋子层 diff：新建 / 更新 / 移除。
   *  棋子挂在 #board-outer 上（而非 #board 内），这样格子层
   *  的 innerHTML 重建不会连带清掉棋子 DOM。 */
  function syncPieces() {
    const st = API.state();
    const host = document.getElementById('board-outer');
    const alive = new Set();
    for (const p of st.pieces) {
      if (p.dead) continue;
      alive.add(p.uid);
      let el = pieceMap.get(p.uid);
      if (!el) {
        el = buildPieceEl(p);
        pieceMap.set(p.uid, el);
        host.appendChild(el);
      }
      const pos = posOf(p.x, p.y, p.big);
      el.style.left = pos.left + 'px';
      el.style.top = pos.top + 'px';
      el.classList.toggle('own0', p.owner === 0);
      el.classList.toggle('own1', p.owner === 1);
      el.classList.toggle('big5', !!p.big);
      syncStatsOf(p, el);
    }
    for (const [uid, el] of pieceMap) {
      if (!alive.has(uid)) { el.remove(); pieceMap.delete(uid); }
    }
  }

  function movePieceTo(uid, x, y) {
    const p = pieceByUid(API.state(), uid);
    const el = pieceMap.get(uid);
    if (!p || !el) return;
    const pos = posOf(x, y, p.big);
    el.style.left = pos.left + 'px';
    el.style.top = pos.top + 'px';
  }

  function pieceEl(uid) { return pieceMap.get(uid) || null; }

  /* ─────────── 右侧面板 ─────────── */

  function statLine(def) {
    if (def.type === 'spell') return `<span>🧪 法术</span><span>⏳ 储存 ${def.limit} 回合</span>`;
    return `<span>⚔️ <b>${def.atk}</b></span><span>❤️ <b>${def.hp}</b></span>` +
           `<span>🎯 <b>${def.rng}</b></span><span>⚡ <b>${def.acts}</b></span><span>👟 <b>${def.mv}</b></span>`;
  }

  function renderHand() {
    const st = API.state();
    const box = document.getElementById('hand');
    box.innerHTML = '';
    if (st.phase === 'over') { box.innerHTML = '<div class="empty-hint">战斗已结束</div>'; return; }
    const cards = st.hand[st.curPlayer] || [];
    if (st.phase === 'action' && cards.length === 0) {
      box.innerHTML = '<div class="empty-hint">本回合召唤已全部处理完毕</div>';
      return;
    }
    cards.forEach((card, idx) => {
      const def = getDef(card.defId);
      const el = document.createElement('div');
      const isSelected = UIST.mode === 'deployCard' && UIST.cardIdx === idx;
      el.className = 'card' + (def.type === 'spell' ? ' spell-card' : '') +
                     (isSelected ? ' selected' :
                      (st.phase === 'deploy' ? ' awaiting' : ''));
      el.dataset.idx = idx;

      let extra = '';
      if (def.type === 'follower') {
        const n = API.rules.deployCells(card.defId, st.curPlayer).length;
        if (n === 0) extra = '<div class="card-btns"><button class="mini-btn" data-discard="' + idx + '">⚠️ 无处部署 · 弃置</button></div>';
      } else {
        extra =
          `<div class="card-btns">` +
          `<button class="mini-btn purple" data-cast="${idx}">✨ 释放</button>` +
          `<button class="mini-btn gold" data-store="${idx}">🧪 储存</button></div>`;
      }

      el.innerHTML =
        (def.type === 'spell' ? `<span class="c-limit">⏳${def.limit}回合</span>` : '') +
        `<div class="c-head"><span class="c-emoji">${def.emoji}</span><span class="c-name">${def.name}</span></div>` +
        `<div class="c-stats">${statLine(def)}</div>` +
        `<div class="c-desc">${def.short}</div>` + extra;
      box.appendChild(el);
    });
  }

  function renderStored() {
    const st = API.state();
    const box = document.getElementById('stored');
    box.innerHTML = '';
    const arr = st.stored[st.curPlayer] || [];
    if (!arr.length) { box.innerHTML = '<div class="empty-hint">空空如也</div>'; return; }
    arr.forEach((card, idx) => {
      const def = getDef(card.defId);
      const el = document.createElement('div');
      el.className = 'card spell-card';
      el.innerHTML =
        `<span class="c-limit">⏳剩 ${card.remain} 回合</span>` +
        `<div class="c-head"><span class="c-emoji">${def.emoji}</span><span class="c-name">${def.name}</span></div>` +
        `<div class="c-desc">${def.short}</div>` +
        (st.phase === 'action'
          ? `<div class="card-btns"><button class="mini-btn purple" data-cast-stored="${idx}">✨ 释放</button></div>`
          : '');
      box.appendChild(el);
    });
  }

  function statusText(p) {
    const st = API.state();
    const parts = [];
    if (p.charge > 0) parts.push(`⚡蓄力 ${p.charge}`);
    if (p.skillUses > 0) parts.push(`🔋已强化 ${p.skillUses}/3`);
    if (p.killCount > 0) parts.push(`🔪击杀 ${p.killCount}`);
    if (p.shieldUntil > st.turnCounter) parts.push('🛡️金身');
    if (p.mark10) parts.push('🎯引信标记');
    if (p.reaperTo && p.reaperFrom <= st.turnCounter) parts.push('💀斩杀之刃');
    if (p.charmTo && p.charmFrom <= st.turnCounter) parts.push('🎭策反陷阱');
    if (p.guardUsed) parts.push('🗡️守护已耗尽');
    if (p.diesAt) parts.push(`⏳${Math.max(0, p.diesAt - st.turnCounter)} 回合后消散`);
    if (p.justDeployed) parts.push('💤部署当回合，尚待苏醒');
    return parts.length ? `<div class="i-desc">${parts.join(' · ')}</div>` : '';
  }

  function renderInspect() {
    const box = document.getElementById('inspect');
    const p = UIST.inspectUid != null ? pieceByUid(API.state(), UIST.inspectUid) : null;
    if (!p) { box.innerHTML = '<div class="empty-hint">暂无选中棋子</div>'; return; }
    const def = getDef(p.defId);
    box.innerHTML =
      `<div class="i-head"><span class="i-emoji">${def.emoji}</span>` +
      `<span class="i-name">${def.name}</span>` +
      (def.type === 'grave' ? '' :
        `<span class="i-owner o${p.owner}">${PNAME[p.owner]}</span>`) +
      `</div>` +
      `<div class="i-stats">${statLine(def)}<span>📍 <b>${p.x},${p.y}</b></span>` +
      `<span>❤️ <b>${Math.max(0, Math.round(p.hp))}/${p.maxHp}</b></span></div>` +
      statusText(p) +
      `<div class="i-desc">${def.desc}</div>`;
  }

  function renderSkillbox() {
    const box = document.getElementById('skillbox');
    box.innerHTML = '';
    const st = API.state();
    if (st.phase !== 'action' || UIST.mode !== 'pieceSel' || UIST.selUid == null) return;
    const p = pieceByUid(st, UIST.selUid);
    if (!p || p.owner !== st.curPlayer || p.justDeployed || p.apLeft <= 0) return;

    // 大肉比蓄势按钮
    if (p.defId === 5 && p.charge <= 0) {
      box.innerHTML = '<button class="btn-move" data-act="brace">🐘 蓄势（下次移动才会真正挪动）</button>';
      return;
    }
    // 技能按钮
    const sk = API.rules.skillInfo(p);
    if (sk && sk.usable(p)) {
      box.innerHTML = `<button class="btn-skill" data-act="skill">${sk.label}</button>`;
    }
  }

  function refreshTop() {
    const st = API.state();
    const b0 = st.pieces.find((q) => !q.dead && q.defId === -1 && q.owner === 0);
    const b1 = st.pieces.find((q) => !q.dead && q.defId === -1 && q.owner === 1);
    if (!b0 || !b1) return; // 基地缺失（异常/特殊场景）时不动血条
    const f0 = Math.max(0, b0.hp) / BASE_HP * 100;
    const f1 = Math.max(0, b1.hp) / BASE_HP * 100;
    document.getElementById('hp-p1').style.width = f0 + '%';
    document.getElementById('hp-p2').style.width = f1 + '%';
    document.getElementById('hp-p1-text').textContent = `🏰 基地 ${Math.max(0, Math.round(b0.hp))}/${BASE_HP}`;
    document.getElementById('hp-p2-text').textContent = `${Math.max(0, Math.round(b1.hp))}/${BASE_HP} 基地 🏰`;
    document.getElementById('turn-num').textContent = `回合 ${st.turnCounter}`;
    document.getElementById('turn-owner').textContent =
      st.winner != null ? `🏆 ${PNAME[st.winner]}获胜` : `${PNAME[st.curPlayer]}行动中`;
    document.getElementById('side-p1').classList.toggle('active', st.curPlayer === 0 && st.winner == null);
    document.getElementById('side-p2').classList.toggle('active', st.curPlayer === 1 && st.winner == null);
  }

  function renderPhaseHint() {
    const st = API.state();
    const el = document.getElementById('phasehint');
    if (st.winner != null) { el.textContent = '🏆 战斗结束！点击「重开」再来一局。'; return; }
    if (UIST.choice && UIST.choice.spec && UIST.choice.spec.hint) {
      el.textContent = '👆 ' + UIST.choice.spec.hint;
      return;
    }
    if (st.phase === 'deploy') {
      el.textContent = '📜 部署阶段：处理手中的召唤卡（随从必须放置 / 法术可释放或储存）';
    } else {
      el.textContent = '⚔️ 行动阶段：点击己方棋子下达指令（移动 / 攻击 / 技能），或结束回合';
    }
  }

  function renderLog() {
    const st = API.state();
    const box = document.getElementById('log');
    const tail = st.log.slice(-70);
    box.innerHTML = tail.map((l) => `<div class="${l.cls}">${l.msg}</div>`).join('');
    box.scrollTop = box.scrollHeight;
  }

  function renderBtns() {
    const st = API.state();
    document.getElementById('btn-end').disabled = busy || st.phase !== 'action' || st.winner != null;
    document.getElementById('btn-undo').disabled = busy || !canUndo() || st.winner != null;
    document.getElementById('btn-restart').disabled = busy;
  }

  function renderPanel() {
    refreshTop();
    renderPhaseHint();
    renderHand();
    renderStored();
    renderInspect();
    renderSkillbox();
    renderBtns();
    renderLog();
  }

  function refreshAll() {
    renderCells();   // 先重建格子
    measure();       // 再测量真实格距（棋子定位依赖它）
    syncPieces();
    renderPanel();
  }

  return { measure, posOf, renderCells, syncPieces, movePieceTo, pieceEl,
           syncStatFlash: (uid) => {
             const p = pieceByUid(API.state(), uid);
             const el = pieceMap.get(uid);
             if (p && el) syncStatsOf(p, el);
           },
           refreshAll, renderPanel };
})();

/** 供 fx.js 调用的顶层便捷函数 */
function refreshTop() { UI.renderPanel(); }
