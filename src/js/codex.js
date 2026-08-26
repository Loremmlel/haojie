/* ═══════════════ codex.js · 图鉴 & 规则 ═══════════════ */

function openModal(tab) {
  document.getElementById('modal').classList.remove('hidden');
  switchTab(tab || 'codex');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

function switchTab(tab) {
  document.querySelectorAll('.mtab').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'codex') renderCodex();
  else renderRulesDoc();
}

function renderCodex() {
  const body = document.getElementById('modal-body');
  const cards = DEFS.map((def) => {
    const isSpell = def.type === 'spell';
    return `
      <div class="cx-card ${isSpell ? 'spell' : ''}">
        <div class="cx-head">
          <span class="cx-idx">${String(def.id).padStart(2, '0')}</span>
          <span class="cx-emoji">${def.emoji}</span>
          <span class="cx-name">${def.name}</span>
          <span class="cx-type ${isSpell ? 'spell-t' : 'follower'}">${isSpell ? '法术' : '随从'}</span>
        </div>
        ${isSpell
          ? `<div class="cx-stats"><span>⏳ 储存限制 <b>${def.limit}</b> 回合</span></div>`
          : `<div class="cx-stats">
               <span>⚔️ 攻击 <b>${def.atk}</b></span><span>❤️ 血量 <b>${def.hp}</b></span>
               <span>🎯 射程 <b>${def.rng}</b></span><span>⚡ 行动 <b>${def.acts}</b></span>
               <span>👟 移速 <b>${def.mv}</b></span>
             </div>`}
        <div class="cx-desc">${def.desc}</div>
      </div>`;
  }).join('');
  const extra = [-1, -2, -3, 33].map((id) => {
    const def = getDef(id);
    return `
      <div class="cx-card spell">
        <div class="cx-head">
          <span class="cx-emoji">${def.emoji}</span>
          <span class="cx-name">${def.name}</span>
          <span class="cx-type follower">衍生</span>
        </div>
        <div class="cx-desc">${def.desc}</div>
      </div>`;
  }).join('');
  body.innerHTML =
    `<div class="rules-doc" style="margin-bottom:12px">
       💡 五维数字依次为 <b>攻击 / 血量 / 攻击范围 / 一回合行动次数 / 一回合移动格数</b>。
       距离按曼哈顿距离（横竖步数之和）计算。点击棋盘上的棋子可在对局中随时查看详情。
     </div>
     <div class="codex-grid">${cards}${extra}</div>`;
}

function renderRulesDoc() {
  document.getElementById('modal-body').innerHTML = `
  <div class="rules-doc">
    <h3>🏰 胜负目标</h3>
    双方基地位于 (5,1) 与 (5,13)，各有 <b>300 血量</b>。率先摧毁对方基地者获胜。

    <h3>🗺️ 战场与部署</h3>
    <ul>
      <li>战场为 <b>9 列 × 13 行</b> 共 117 格，坐标 (x,y) 表示第 x 列第 y 行；蓝方阵地在下（y=1 侧），红方在上（y=13 侧）。</li>
      <li>蓝方初始可部署于 <b>第 1～8 行</b>，红方为 <b>第 6～13 行</b>，第 6～8 行是双方争夺的中间地带。</li>
      <li><b>推进许可</b>：回合开始时，若某条本不可部署的行中己方棋子数 ≥ 对方该行棋子数 + 2，本回合即可在该行部署。</li>
      <li>所有“格数”（射程、移程）均按<b>曼哈顿距离</b>（横竖步数之和）计算。</li>
    </ul>

    <h3>🎴 召唤与手牌</h3>
    <ul>
      <li>每个回合开始时从 26 种棋子库中<b>随机抽取 2 张</b>。</li>
      <li><b>随从类</b>必须在本回合内部署；若战场无处安放则被迫弃置。</li>
      <li><b>法术类</b>可当回合立即释放，也可存入储存栏，在储存期限内任意己方回合释放；期限耗尽自动销毁。</li>
      <li>刚部署的随从当回合不能行动（拥有【冲锋】的除外），从下个回合开始正常行动。</li>
    </ul>

    <h3>⚔️ 指令与行动</h3>
    <ul>
      <li>每次轮到己方回合，每枚可用棋子获得等于其「一回合行动次数」的行动点。</li>
      <li>每消耗 1 点行动点，可从<b>移动 / 攻击 / 技能</b>中选择一项执行（未标注技能的棋子只有前两项）。</li>
      <li><b>攻击</b>：选择攻击范围内（≤ 射程）的敌方单位造成等同于攻击力的伤害。</li>
      <li><b>穿透规则</b>：若通往某个敌方单位的、长度不超过射程的所有路径都被其他敌方棋子封死，则无法越过它们攻击更远的目标——敌方棋子会挡住弹道，友方不会。</li>
      <li><b>移动</b>：移动不超过自身移速的格数，不能穿过任何棋子。</li>
    </ul>

    <h3>↩ 悔棋</h3>
    点击「悔棋」可以撤销最近一次操作（包括部署、攻击、施法甚至结束回合），可连续撤销至开局。两人线下对弈时请自觉遵守约定哦～

    <h3>📖 查看信息</h3>
    <ul>
      <li>点击场上任意棋子可在右侧面板查看完整数值与状态说明。</li>
      <li>顶部按钮可打开<b>图鉴</b>查阅全部 26 种棋子。</li>
    </ul>

    <h3>⚖️ 规则裁定说明（实现口径）</h3>
    <ul>
      <li>原文距离公式 |Δx+Δy| 在同反对角线上恒为 0，会产生免费瞬移，经确认改用曼哈顿距离。</li>
      <li>名刀「刀魂」形态的 n 统计以其为中心 3×3 内双方所有随从（含自身），实时波动。</li>
      <li>定炮蓄力 ≥2 即可开炮，开炮清空蓄力；蓄力恰满 5 格的那一炮射程 +1。</li>
      <li>投石机标记在「被标记者回满血」或「再次被标记方另一枚非投石机棋子命中」时引爆 5 点伤害，标记持续到拥有者的下回合开始。</li>
      <li>BUFF怪 的 +10 攻击覆盖到你的下个行动回合。</li>
      <li>死吧！的即死对基地无效，金身可以抵挡；策反收编的是造成伤害的敌方随从（基地不会倒戈），其当回合剩余行动作废。</li>
      <li>厚脸皮的正面＝从前线方向（远离己方基地一侧）袭来的攻击；背后偷袭全额。</li>
      <li>重铸召唤抽到法术时会自动存入储存栏，不浪费。</li>
    </ul>
  </div>`;
}

/* ─────────── toast 提示 ─────────── */

function toast(msg, warn) {
  const box = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = 'toast-item' + (warn ? ' warn' : '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
