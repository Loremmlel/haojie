/* ═══════════════ fx.js · 特效引擎 ═══════════════
 * 消费事件队列 EV，把逻辑层的每次动作翻译成动画。
 * 所有动画返回 Promise，由 input 层 await 后再解锁输入。
 * ═══════════════════════════════════════════════ */

const FX = (() => {
  let evCursor = 0;         // EV 已播放游标
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFrame = () => new Promise((r) => requestAnimationFrame(r));

  /** 格子几何：由 ui.js 在布局后调用 setMetrics 更新 */
  let M = { size: 48, gap: 3, pad: 10, originX: 0, originY: 0 };
  function setMetrics(m) { M = m; }

  /** 格子中心相对 #board-outer 的像素坐标 */
  function centerOf(x, y) {
    return {
      cx: M.pad + (x - 0.5) * (M.size + M.gap),
      cy: M.pad + (H - y + 0.5) * (M.size + M.gap), // y=1 渲染在最下行
    };
  }
  function boardOuter() { return document.getElementById('board-outer'); }

  function addEl(cls, styles, text) {
    const layer = document.getElementById('fxlayer');
    const el = document.createElement('div');
    el.className = cls;
    if (text != null) el.textContent = text;
    for (const k in styles) el.style[k] = styles[k];
    layer.appendChild(el);
    return el;
  }

  /* ─────────── 特效原语 ─────────── */

  async function flyNum(uid, text, cls) {
    const pEl = UI.pieceEl(uid);
    const box = boardOuter().getBoundingClientRect();
    const r = pEl ? pEl.getBoundingClientRect() : box;
    const el = addEl('fly-num ' + cls, {
      left: (r.left - box.left + r.width / 2) + 'px',
      top: (r.top - box.top + r.height * 0.35) + 'px',
    }, text);
    await sleep(950);
    el.remove();
  }

  /** 近战冲刺：攻击者扑向目标再弹回 */
  async function lunge(pEl, tEl) {
    const b = boardOuter().getBoundingClientRect();
    const pr = pEl.getBoundingClientRect(), tr = tEl.getBoundingClientRect();
    const dx = (tr.left + tr.width / 2) - (pr.left + pr.width / 2);
    const dy = (tr.top + tr.height / 2) - (pr.top + pr.height / 2);
    pEl.style.transition = 'transform .12s cubic-bezier(.5,0,.8,1)';
    pEl.style.transform = `translate(${dx * 0.55}px, ${dy * 0.55}px) scale(1.08)`;
    pEl.style.zIndex = 15;
    await sleep(120);
    // 斩击线
    const ang = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    const slash = addEl('slash', {
      left: (pr.left - b.left + pr.width / 2 + dx * 0.25 - 26) + 'px',
      top: (pr.top - b.top + pr.height / 2 + dy * 0.25 - 2) + 'px',
      width: '52px', '--rot': ang + 'deg',
    });
    setTimeout(() => slash.remove(), 300);
    pEl.style.transition = 'left .32s cubic-bezier(.34,1.3,.5,1), top .32s cubic-bezier(.34,1.3,.5,1), transform .22s';
    pEl.style.transform = '';
    setTimeout(() => { pEl.style.zIndex = ''; }, 350);
    await sleep(160);
  }

  /** 远程弹道（棋子 → 棋子） */
  async function projectile(fromUid, toUid, color, healMode) {
    const pEl = UI.pieceEl(fromUid), tEl = UI.pieceEl(toUid);
    if (!pEl || !tEl) return;
    const b = boardOuter().getBoundingClientRect();
    const pr = pEl.getBoundingClientRect(), tr = tEl.getBoundingClientRect();
    const x1 = pr.left - b.left + pr.width / 2, y1 = pr.top - b.top + pr.height / 2;
    const x2 = tr.left - b.left + tr.width / 2, y2 = tr.top - b.top + tr.height / 2;
    await projectileTo(x1, y1, x2, y2, color);
    if (!healMode) hitRing(toUid, color || '#f87171');
  }

  /** 远程弹道原语（像素坐标 → 像素坐标） */
  async function projectileTo(x1, y1, x2, y2, color) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const dur = Math.min(420, Math.max(140, dist * 1.4));
    const bolt = addEl('bolt', { left: x1 + 'px', top: y1 + 'px', color: color || '#fbbf24' });
    bolt.style.transition = `left ${dur}ms linear, top ${dur}ms linear`;
    void bolt.offsetWidth;
    bolt.style.left = x2 + 'px'; bolt.style.top = y2 + 'px';
    await sleep(dur + 30);
    bolt.remove();
  }

  function hitRing(uid, color) {
    const tEl = UI.pieceEl(uid);
    if (!tEl) return;
    const r = tEl.getBoundingClientRect();
    tEl.classList.remove('hit-jolt'); void tEl.offsetWidth; tEl.classList.add('hit-jolt');
    const ring = addEl('ring', {
      left: (r.left - boardOuter().getBoundingClientRect().left + r.width / 2) + 'px',
      top: (r.top - boardOuter().getBoundingClientRect().top + r.height / 2) + 'px',
      color,
      '--ring-w': r.width * 1.7 + 'px',
    });
    setTimeout(() => ring.remove(), 600);
  }

  /** 爆炸粒子（爆弹/死亡等） */
  function boomAt(px, py, color, n) {
    for (let i = 0; i < (n || 8); i++) {
      const ang = Math.random() * Math.PI * 2;
      const d = 24 + Math.random() * 42;
      const b = addEl('boom', {
        left: px + 'px', top: py + 'px', color,
        background: color,
        '--dx': Math.cos(ang) * d + 'px', '--dy': Math.sin(ang) * d + 'px',
        width: 5 + Math.random() * 7 + 'px', height: 5 + Math.random() * 7 + 'px',
      });
      setTimeout(() => b.remove(), 750);
    }
  }

  async function spellIcon(text, x, y) {
    const { cx, cy } = centerOf(x, y);
    const el = addEl('spell-cast', { left: cx + 'px', top: cy + 'px' }, text);
    await sleep(750);
    el.remove();
  }

  async function banner(text, cls) {
    const el = document.getElementById('banner');
    el.textContent = text;
    el.className = cls || '';
    await sleep(1050);
    el.className = 'hidden';
  }

  function shake() {
    document.body.classList.remove('shake');
    void document.body.offsetWidth;
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 420);
  }

  /* ─────────── 事件 → 动画调度 ─────────── */

  async function playNew() {
    if (evCursor > EV.length) evCursor = 0; // 悔棋清空事件队列后重置游标
    while (evCursor < EV.length) {
      const e = EV[evCursor++];
      try { await playOne(e); } catch (err) { console.error('fx error', e, err); }
    }
  }

  async function playOne(e) {
    switch (e.type) {
      case 'turn': {
        refreshTop(); // 回合横幅期间同步血条
        await banner(`第 ${e.turn} 回合 · ${PNAME[e.player]}行动`, e.player === 0 ? 'b1' : 'b2');
        break;
      }
      case 'deploy': {
        UI.syncPieces(); // 新棋子 pop-in
        break;
      }
      case 'move': {
        UI.movePieceTo(e.uid, e.tx, e.ty);
        await sleep(340);
        break;
      }
      case 'hook': {
        // 钩链飞向目标原位置 → 勾住拉回
        const h = centerOf(e.fx, e.fy), t = centerOf(e.x0, e.y0);
        await projectileTo(h.cx, h.cy, t.cx, t.cy, '#fda4af');
        UI.movePieceTo(e.uid, e.tx, e.ty);
        await sleep(340);
        break;
      }
      case 'attack': {
        const atkP = API.state().pieces.find((q) => q.uid === e.uid);
        const tEl = UI.pieceEl(e.tuid);
        if (!atkP || !tEl) break;
        if (e.healMode) { await projectile(e.uid, e.tuid, '#34d399', true); break; }
        const isRanged = nearestDist(
          atkP,
          API.state().pieces.find((q) => q.uid === e.tuid)
        ) > 1;
        UI.syncStatFlash(atkP.uid);
        if (isRanged) await projectile(e.uid, e.tuid, '#fbbf24');
        else await lunge(UI.pieceEl(e.uid), tEl);
        break;
      }
      case 'damage': {
        const st = API.state();
        const victim = st.pieces.find((q) => q.uid === e.uid);
        if (victim && !e.silentNum) {
          await flyNum(e.uid, '-' + e.amount + (e.frontal ? '（正面）' : ''), e.crit ? 'crit' : 'dmg');
          if (e.amount >= 60 || e.crit) shake();
        }
        break;
      }
      case 'heal': {
        await flyNum(e.uid, '+' + e.amount, 'heal');
        break;
      }
      case 'buff': {
        await flyNum(e.uid, '▲ 强化', 'buff');
        break;
      }
      case 'guard': {
        const tEl = UI.pieceEl(e.uid);
        if (tEl) {
          const r = tEl.getBoundingClientRect();
          boomAt(r.left - boardOuter().getBoundingClientRect().left + r.width / 2,
                 r.top - boardOuter().getBoundingClientRect().top + r.height / 2,
                 '#7dd3fc', 10);
        }
        await flyNum(e.uid, '🗡️ 名刀！', 'buff');
        break;
      }
      case 'block': {
        await flyNum(e.uid, '🛡️ 免疫', 'buff');
        break;
      }
      case 'mark': {
        await flyNum(e.uid, '🎯 引信', 'buff');
        break;
      }
      case 'counter': {
        await flyNum(e.uid, '🔄 反弹！', 'buff');
        shake();
        break;
      }
      case 'charm': {
        await flyNum(e.uid, '🎭 倒戈！', 'buff');
        shake();
        UI.refreshAll();
        break;
      }
      case 'death': {
        const el = UI.pieceEl(e.uid);
        if (el) {
          const r = el.getBoundingClientRect();
          const b = boardOuter().getBoundingClientRect();
          boomAt(r.left - b.left + r.width / 2, r.top - b.top + r.height / 2, getDef(e.defId).type === 'base' ? '#fbbf24' : '#94a3b8', 12);
          el.classList.add('dying');
          await sleep(480);
          el.remove();
        }
        if (getDef(e.defId).type === 'base') shake();
        UI.syncPieces();
        break;
      }
      case 'spell': {
        const def = getDef(e.defId);
        if (e.defId === 8) {
          await spellIcon('💣', e.x + 0.5, e.y + 0.5);
          // 田字四格（锚点为左上格）中心各炸一次
          for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) {
            const { cx, cy } = centerOf(e.x + dx, e.y + dy);
            boomAt(cx, cy, '#fb923c', 7);
          }
          shake();
          await sleep(250);
        } else if (e.uid != null) {
          const icons = { 17: '🛡️', 18: '💀', 22: '🎭' };
          await spellIcon(icons[e.defId] || def.emoji,
            API.state().pieces.find((q) => q.uid === e.uid)?.x || W / 2,
            API.state().pieces.find((q) => q.uid === e.uid)?.y || H / 2);
        }
        break;
      }
      case 'expire': break;
      case 'win': {
        showWinMask(e.winner);
        break;
      }
      case 'phase': break;
      default: break;
    }
  }

  return { setMetrics, centerOf, playNew, flyNum, boomAt, banner, shake, projectile };
})();
