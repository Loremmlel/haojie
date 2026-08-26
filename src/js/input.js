/* ═══════════════ input.js · 交互状态机 ═══════════════
 * 核心节奏：act(fn) 加锁 → 执行逻辑 → 播放动画 → 解锁刷新。
 * ENV.choose 在这里落地为「高亮 + 等待点击」的 Promise。
 * ════════════════════════════════════════════════════ */

let busy = false;

/** 动作统一入口：加锁执行 → 播事件动画 → 解锁全刷 */
async function act(fn) {
  if (busy) return;
  busy = true;
  UI.renderPanel();
  try {
    await fn();
    await FX.playNew();
  } catch (err) {
    console.error(err);
    toast('操作出错啦：' + err.message, true);
  } finally {
    busy = false;
    UIST.mode = 'idle';
    UIST.cardIdx = null;
    UIST.selUid = null;
    UI.refreshAll();
  }
}

/* ─────────── 目标选择（ENV.choose 落地） ─────────── */

function ask(spec) {
  if (spec.kind === 'none') return Promise.resolve(null);
  return new Promise((resolve) => {
    UIST.choice = { spec, resolve };
    UI.refreshAll();
    if (spec.kind === 'option') mountOptionFloat(spec);
  });
}

function finishChoice(val) {
  const c = UIST.choice;
  UIST.choice = null;
  unmountOptionFloat();
  if (c) c.resolve(val);
  else UI.refreshAll();
}

function mountOptionFloat(spec) {
  unmountOptionFloat();
  const wrap = document.createElement('div');
  wrap.id = 'optfloat';
  const title = document.createElement('div');
  title.className = 'of-title';
  title.textContent = spec.hint || '请选择';
  wrap.appendChild(title);
  for (const opt of spec.options) {
    const b = document.createElement('button');
    b.className = 'of-btn';
    b.textContent = opt.label;
    b.onclick = () => finishChoice(opt.value);
    wrap.appendChild(b);
  }
  if (spec.cancelable) {
    const c = document.createElement('button');
    c.className = 'of-cancel';
    c.textContent = '取消';
    c.onclick = () => finishChoice(null);
    wrap.appendChild(c);
  }
  document.body.appendChild(wrap);
}
function unmountOptionFloat() {
  const old = document.getElementById('optfloat');
  if (old) old.remove();
}

/* ─────────── 点击解析 ─────────── */

function tryResolveChoiceByCell(x, y) {
  const spec = UIST.choice && UIST.choice.spec;
  if (!spec) return false;
  if (spec.kind === 'cell' && spec.cells.some((c) => c.x === x && c.y === y)) {
    finishChoice({ x, y });
    return true;
  }
  if (spec.kind === 'piece') {
    const occ = pieceAt(API.state(), x, y);
    if (occ && spec.pieces.includes(occ)) { finishChoice(occ); return true; }
  }
  return true; // 选择模式下吞掉其它点击
}

function tryResolveChoiceByPiece(p) {
  const spec = UIST.choice && UIST.choice.spec;
  if (!spec) return false;
  if (spec.kind === 'piece' && spec.pieces.includes(p)) { finishChoice(p); return true; }
  return true;
}

/** 格子被点击。
 *  注意：目标选择（choice）期间 busy 也是 true——此时必须放行，
 *  否则 choose 的 Promise 永远等不到点击，会造成死锁。 */
function onCellClick(x, y) {
  if (UIST.choice) { tryResolveChoiceByCell(x, y); return; }
  if (busy) return;
  const st = API.state();

  // 部署阶段
  if (st.phase === 'deploy' && UIST.mode === 'deployCard' && UIST.cardIdx != null) {
    const idx = UIST.cardIdx;
    act(() => API.deployFollower(idx, x, y));
    return;
  }

  // 行动阶段：对已选棋子下达指令
  if (st.phase === 'action' && UIST.mode === 'pieceSel' && UIST.selUid != null) {
    const key = x + ',' + y;
    const p = pieceByUid(st, UIST.selUid);
    if (!p) return;
    const mv = API.rules.moveTargets(p).some((c) => c.x === x && c.y === y);
    if (mv && !(p.defId === 5 && p.charge <= 0)) {
      act(() => API.doMove(UIST.selUid, x, y));
      return;
    }
    const occ = pieceAt(st, x, y);
    if (occ && occ !== p) {
      const isAtk = API.rules.attackTargets(p).includes(occ);
      const isHeal = p.defId === 2 && occ.owner === p.owner &&
                     API.rules.healTargets(p).includes(occ);
      if (isAtk || isHeal) {
        act(() => API.doAttack(UIST.selUid, occ.uid));
        return;
      }
    }
  }
}

/** 棋子被点击 */
function onPieceClick(p) {
  if (UIST.choice) { tryResolveChoiceByPiece(p); return; }
  if (busy) return;
  const st = API.state();
  UIST.inspectUid = p.uid;

  if (st.winner != null) { UI.renderPanel(); return; }

  // ── 已选中己方棋子时：点敌方红框棋子＝发起攻击；点残血友方绿框棋子＝治疗。
  //    （必须在此解析：敌方棋子 DOM 盖在格子上，点它不会经过 onCellClick）
  if (st.phase === 'action' && UIST.mode === 'pieceSel' && UIST.selUid != null &&
      UIST.selUid !== p.uid) {
    const sel = pieceByUid(st, UIST.selUid);
    if (sel && sel.owner === st.curPlayer && !sel.justDeployed && sel.apLeft > 0) {
      const isAtk = p.owner !== st.curPlayer && API.rules.attackTargets(sel).includes(p);
      const isHeal = sel.defId === 2 && p.owner === sel.owner &&
                     API.rules.healTargets(sel).includes(p);
      if (isAtk || isHeal) {
        const uid = sel.uid;
        act(() => API.doAttack(uid, p.uid));
        return;
      }
    }
  }

  if (p.owner === st.curPlayer && st.phase === 'action') {
    if (p.justDeployed) {
      toast('💤 刚部署的棋子本回合还在热身，下回合才能行动（冲锋怪可以选择冲锋立即行动哦）');
    } else if (p.apLeft <= 0) {
      toast('⚡ 这枚棋子本回合的行动点已经用完了');
    }
  }

  // 点自己的可行动棋子 → 进入指挥模式
  if (p.owner === st.curPlayer &&
      ((st.phase === 'action' && !p.justDeployed && p.apLeft > 0) ||
       st.phase === 'deploy')) {
    UIST.mode = 'pieceSel';
    UIST.selUid = p.uid;
  } else if (UIST.mode === 'pieceSel' && UIST.selUid !== p.uid) {
    UIST.mode = 'idle';
    UIST.selUid = null;
  }
  UI.refreshAll();
}

/* ─────────── DOM 事件绑定 ─────────── */

function bindEvents() {
  // 棋盘：棋子挂在 #board-outer 上（避免被格子层重建清除），
  // 因此监听器必须绑在外层容器才能同时接住棋子与格子的点击
  document.getElementById('board-outer').addEventListener('click', (e) => {
    const pel = e.target.closest('.piece');
    if (pel) {
      const p = pieceByUid(API.state(), Number(pel.dataset.uid));
      if (p) { onPieceClick(p); return; }
    }
    const cel = e.target.closest('.cell');
    if (cel) onCellClick(Number(cel.dataset.x), Number(cel.dataset.y));
  });

  // 手牌 / 储存栏（事件委托）
  document.getElementById('hand').addEventListener('click', (e) => {
    const btn = e.target;
    const st = API.state();
    if (btn.dataset.cast != null) {
      const idx = Number(btn.dataset.cast);
      runSpellCast(() => getHandSpec(idx), (got) => API.castHandSpell(idx, got));
      return;
    }
    if (btn.dataset.store != null) {
      act(() => API.storeHandSpell(Number(btn.dataset.store)));
      return;
    }
    if (btn.dataset.discard != null) {
      act(() => API.discardUnplaceable(Number(btn.dataset.discard)));
      return;
    }
    // 卡片本体：随从卡切换部署模式
    const cardEl = btn.closest('.card');
    if (!cardEl || !cardEl.dataset.idx) return;
    const idx = Number(cardEl.dataset.idx);
    const card = st.hand[st.curPlayer][idx];
    if (!card || getDef(card.defId).type === 'spell') return;
    if (UIST.mode === 'deployCard' && UIST.cardIdx === idx) {
      UIST.mode = 'idle'; UIST.cardIdx = null;
    } else {
      UIST.mode = 'deployCard'; UIST.cardIdx = idx;
    }
    UI.refreshAll();
  });

  document.getElementById('stored').addEventListener('click', (e) => {
    if (e.target.dataset.castStored != null) {
      const idx = Number(e.target.dataset.castStored);
      runSpellCast(() => {
        const card = API.state().stored[API.state().curPlayer][idx];
        return SPELL_TARGETS[card.defId](API.state(), API.state().curPlayer);
      }, (got) => API.castStored(idx, got));
    }
  });

  // 技能框
  document.getElementById('skillbox').addEventListener('click', (e) => {
    if (e.target.dataset.act === 'brace') {
      const p = pieceByUid(API.state(), UIST.selUid);
      if (p) act(() => API.doMove(p.uid, p.x, p.y)); // 大肉比蓄势
    } else if (e.target.dataset.act === 'skill') {
      const uid = UIST.selUid;
      act(() => API.useSkill(uid));
    }
  });
}

/** 法术通用流程：先选目标，再执行 */
async function runSpellCast(getSpec, run) {
  if (busy) return;
  busy = true;
  try {
    const spec = getSpec();
    const got = await ask(spec);
    if (got == null) { busy = false; UI.refreshAll(); return; }
    await run(got);
    await FX.playNew();
  } catch (err) {
    console.error(err);
    toast('施法失败：' + err.message, true);
  } finally {
    busy = false;
    UIST.choice = null;
    unmountOptionFloat();
    UIST.mode = 'idle'; UIST.cardIdx = null; UIST.selUid = null;
    UI.refreshAll();
  }
}

function getHandSpec(idx) {
  const st = API.state();
  const card = st.hand[st.curPlayer][idx];
  return SPELL_TARGETS[card.defId](st, st.curPlayer);
}

// 注入逻辑层的选择器
ENV.choose = ask;
