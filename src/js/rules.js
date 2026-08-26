/* ═══════════════ rules.js · 几何与合法性判定 ═══════════════
 * 所有“格数”均为曼哈顿距离 |Δx| + |Δy|。
 * 攻击穿透规则：若到目标所有 ≤射程 的路径都被其他敌方棋子
 * 封死，则无法攻击（BFS 判可达）。
 * ═══════════════════════════════════════════════════════════ */

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function inBoard(x, y) { return x >= 1 && x <= W && y >= 1 && y <= H; }
function mdist(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }

/** 棋子占据的全部格子 */
function pieceCells(p) {
  if (!p.big) return [{ x: p.x, y: p.y }];
  const c = [];
  for (const dx of [0, 1]) for (const dy of [0, 1]) c.push({ x: p.x + dx, y: p.y + dy });
  return c;
}

/** 两棋子间的最近格距（按各自占据格两两求最小） */
function nearestDist(a, b) {
  let best = Infinity;
  for (const ca of pieceCells(a)) for (const cb of pieceCells(b)) {
    const d = mdist(ca.x, ca.y, cb.x, cb.y);
    if (d < best) best = d;
  }
  return best;
}

/** 刀魂（33 号）的 n：以其为中心 3×3 内随从数量（双方、含自身、实时计算） */
function bladeN(p) {
  let n = 0;
  for (const q of S.pieces) {
    if (q.dead) continue;
    const t = getDef(q.defId).type;
    if (t !== 'follower' && t !== 'grave') continue;
    for (const c of pieceCells(q)) {
      if (Math.abs(c.x - p.x) <= 1 && Math.abs(c.y - p.y) <= 1) { n++; break; }
    }
  }
  return Math.max(1, n);
}

/** 有效射程（刀魂动态，其余为静态值；定炮蓄满 +1 在攻击目标计算中另行叠加） */
function effRange(p) {
  return p.defId === 33 ? bladeN(p) : p.range;
}

/** 是否为 23 号独行侠的禁入邻圈（对 owner 阵营而言） */
function inLonerZone(x, y, owner) {
  for (const q of S.pieces) {
    if (q.dead || q.defId !== 23 || q.owner !== owner) continue;
    if (mdist(x, y, q.x, q.y) <= 1) return true;
  }
  return false;
}

/** 通用可达空格 BFS（≤maxStep 步，途经不可穿子，独行侠禁入圈对友方生效），含起点 */
function bfsEmptyCells(state, p, maxStep) {
  const out = [{ x: p.x, y: p.y }];
  if (maxStep <= 0) return out;
  const occupied = new Set();
  for (const q of state.pieces) {
    if (q.dead || q.uid === p.uid) continue;
    for (const c of pieceCells(q)) occupied.add(c.x + ',' + c.y);
  }
  const seen = new Set([p.x + ',' + p.y]);
  let frontier = [{ x: p.x, y: p.y }];
  for (let step = 0; step < maxStep; step++) {
    const next = [];
    for (const cur of frontier) {
      for (const [dx, dy] of DIRS) {
        const nx = cur.x + dx, ny = cur.y + dy;
        const key = nx + ',' + ny;
        if (!inBoard(nx, ny) || seen.has(key) || occupied.has(key)) continue;
        seen.add(key);
        if (inLonerZone(nx, ny, p.owner)) continue;
        next.push({ x: nx, y: ny });
        out.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }
  return out;
}

/* ─────────── 部署 ─────────── */

function baseDeployRows(owner) {
  const rows = [];
  for (let y = 1; y <= H; y++) {
    if (owner === 0 ? y <= 8 : y >= 6) rows.push(y);
  }
  return rows;
}

/**
 * 回合开始时结算“推进许可”：在本方不可部署的行中，
 * 己方该行棋子数 ≥ 对方该行棋子数 + 2，则该行本回合可部署。
 */
function computeExtraRows(state, owner) {
  const base = new Set(baseDeployRows(owner));
  const rows = [];
  for (let y = 1; y <= H; y++) {
    if (base.has(y)) continue;
    let own = 0, opp = 0;
    for (const p of state.pieces) {
      if (p.dead || p.defId === -1) continue;
      if (p.y === y || (p.big && y >= p.y && y <= p.y + 1)) {
        if (p.owner === owner) own++; else opp++;
      }
    }
    if (own >= opp + 2) rows.push(y);
  }
  state.extraRows[owner] = rows;
}

function deployRows(state, owner) {
  const all = baseDeployRows(owner).concat(state.extraRows[owner] || []);
  return new Set(all);
}

/** (x,y) 为锚点能否部署该棋子 */
function canDeployAt(state, defId, owner, x, y) {
  const def = getDef(defId);
  const cells = defId === 5
    ? [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }]
    : [{ x, y }];
  const rows = deployRows(state, owner);
  for (const c of cells) {
    if (!inBoard(c.x, c.y)) return false;
    if (!rows.has(c.y)) return false;               // 大肉比跨行的两行都需合法
    if (pieceAt(state, c.x, c.y)) return false;
    if (inLonerZone(c.x, c.y, owner)) return false; // 独行侠禁入圈
  }
  return true;
}

/** 全部合法部署锚点 */
function deployCells(state, defId, owner) {
  const out = [];
  for (let y = 1; y <= H; y++) for (let x = 1; x <= W; x++) {
    if (canDeployAt(state, defId, owner, x, y)) out.push({ x, y });
  }
  return out;
}

/* ─────────── 行动次数 ─────────── */

/** 该棋子本回合的有效行动次数上限 */
function effActions(p) {
  let n = getDef(p.defId).acts;
  if (p.defId === 4) n = 1;                       // 定炮：每回合一次行动（蓄力/开炮）
  if (p.defId === 21) n = 1;                      // 神行千里：蓄气/神行
  if (p.defId === 23) n = p.beatCount % 2 === 0 ? 6 : 0; // 独行侠节拍
  if (p.defId === 12) {                           // 跑得快贴脸惩罚
    for (const q of S.pieces) {
      if (q.dead || q.owner === p.owner) continue;
      if (nearestDist(p, q) === 1) { n -= 1; break; }
    }
  }
  return Math.max(0, n);
}

/** 有效移速 */
function effMv(p) {
  let m = p.mv;
  if (p.defId === 12) {
    for (const q of S.pieces) {
      if (q.dead || q.owner === p.owner) continue;
      if (nearestDist(p, q) === 1) { m -= 1; break; }
    }
  }
  return Math.max(0, m);
}

/* ─────────── 移动 ─────────── */

/** 移动落点集合。特殊：13 号直线三格；5 号整体平移一格（蓄力逻辑在上层）。 */
function moveTargets(state, p) {
  const out = [];
  const occupied = new Set();
  for (const q of state.pieces) {
    if (q.dead || q.uid === p.uid) continue;
    for (const c of pieceCells(q)) occupied.add(c.x + ',' + c.y);
  }

  if (p.defId === 13) {
    // 必须直线恰好三格，途经全空
    for (const [dx, dy] of DIRS) {
      let ok = true;
      for (let i = 1; i <= 3; i++) {
        const nx = p.x + dx * i, ny = p.y + dy * i;
        if (!inBoard(nx, ny) || occupied.has(nx + ',' + ny) || inLonerZone(nx, ny, p.owner)) { ok = false; break; }
      }
      if (ok) out.push({ x: p.x + dx * 3, y: p.y + dy * 3 });
    }
    return out;
  }

  if (p.big) {
    // 2×2 整体平移一格
    for (const [dx, dy] of DIRS) {
      let ok = true;
      for (const c of pieceCells(p)) {
        const nx = c.x + dx, ny = c.y + dy;
        if (!inBoard(nx, ny) || occupied.has(nx + ',' + ny) || inLonerZone(nx, ny, p.owner)) { ok = false; break; }
      }
      if (ok) out.push({ x: p.x + dx, y: p.y + dy });
    }
    return out;
  }

  // 常规 BFS：≤ effMv 步，途经格必须为空（复用通用 BFS）
  return bfsEmptyCells(state, p, effMv(p));
}

/* ─────────── 攻击 ─────────── */

/**
 * 可攻击的敌方单位列表。
 * 穿透规则：对每个候选目标做一次多源 BFS（起点=自身占据格），
 * 把“其他敌方棋子”视为墙体；存在 ≤射程 的路径才可攻击。
 */
function attackTargets(state, p) {
  const out = [];
  if (p.defId === 4 && p.charge < 2) return out;   // 定炮未蓄够力
  const rngEff = p.defId === 4 ? effRange(p) + (p.charge >= 5 ? 1 : 0) : effRange(p); // 蓄满5格射程+1
  const myCells = new Set(pieceCells(p).map((c) => c.x + ',' + c.y));

  const candidates = state.pieces.filter((q) =>
    !q.dead && q.owner !== p.owner &&
    nearestDist(p, q) <= rngEff);

  for (const t of candidates) {
    if (p.defId === 9 && p.hitThisTurn.includes(t.uid)) continue; // 射手不重复打同一目标
    const tKeys = new Set(pieceCells(t).map((c) => c.x + ',' + c.y));
    // 多源 BFS
    const dist = new Map();
    let frontier = [];
    for (const k of myCells) { dist.set(k, 0); frontier.push(k); }
    let reach = -1;
    bfs:
    while (frontier.length) {
      const next = [];
      for (const key of frontier) {
        const d0 = dist.get(key);
        if (d0 >= rngEff) continue;
        const [cx, cy] = key.split(',').map(Number);
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx, ny = cy + dy;
          if (!inBoard(nx, ny)) continue;
          const nk = nx + ',' + ny;
          if (dist.has(nk)) continue;
          if (tKeys.has(nk)) {                     // 抵达目标
            if (d0 + 1 <= rngEff) { reach = d0 + 1; break bfs; }
            continue;
          }
          const occ = pieceAt(state, nx, ny);
          if (occ && occ.owner !== p.owner) continue; // 其他敌方棋子 = 墙
          dist.set(nk, d0 + 1);
          next.push(nk);
        }
      }
      frontier = next;
    }
    if (reach >= 0) out.push(t);
  }
  return out;
}

/** 奶妈的可治疗对象（射程内血量未满的己方） */
function healTargets(state, p) {
  return state.pieces.filter((q) =>
    !q.dead && q.owner === p.owner && q.hp < q.maxHp &&
    nearestDist(p, q) <= effRange(p));
}

/** 24 号厚脸皮：来自正面的伤害至多 10。正面 = 攻击者位于受害者朝前线一侧。 */
function isFrontal(attacker, victim) {
  // victim 的基地在 y=1(owner0) / y=13(owner1)；从前线方向（远离基地一侧）袭来为正面
  return victim.owner === 0 ? attacker.y > victim.y : attacker.y < victim.y;
}
