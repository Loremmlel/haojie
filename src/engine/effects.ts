/* effects.ts · 棋子效果之家：PieceEffect 基类 + EFFECTS 注册表 + 全局助手
 * 钩子只收编「以 defId 分发的硬编码分支」；状态驱动的通用管线步骤留在 engine。
 * 与 engine.ts 存在调用时循环引用（旧 abilities.ts↔engine.ts 同构）：
 * EFFECTS 顶层只做纯构造，交叉调用一律发生在运行时。 */

import { getDef, W, H, type Cell } from './data.ts';
import { rnd } from './rng.ts';
import { PNAME, ev, pushLog, snap, makePiece, pieceAt,
         type Session, type GameState, type Piece, type Owner, type ChoiceSpec, type ChoiceResult } from './state.ts';
import { mdist, inBoard, pieceCells, nearestDist, bfsEmptyCells, DIRS, isFrontal } from './geometry.ts';
import type { HandlerCtx } from './types.ts';
import { dealDamage, killPiece, heal, flushDeaths, performAttack } from './engine.ts';

/* ── 通用助手 ── */
function foesOf(state: GameState, owner: number): Piece[] {
  return state.pieces.filter((q) => !q.dead && q.owner !== owner);
}
/** 敌方随从（不含基地） */
function foeFollowers(state: GameState, owner: number): Piece[] {
  return foesOf(state, owner).filter((q) => getDef(q.defId).type === 'follower' || getDef(q.defId).type === 'grave');
}
/** 己方随从（不含基地） */
function myFollowers(state: GameState, owner: number): Piece[] {
  return state.pieces.filter((q) => !q.dead && q.owner === owner &&
    (getDef(q.defId).type === 'follower' || getDef(q.defId).type === 'grave'));
}
/** 12 号贴脸：与任意敌方距离 1 格 */
function adjacentFoe(st: GameState, p: Piece): boolean {
  return st.pieces.some((q) => !q.dead && q.owner !== p.owner && nearestDist(p, q) === 1);
}
/** 33 号刀魂的 n：以其为中心 3×3 内随从数量（双方、含自身、实时计算） */
function bladeN(st: GameState, p: Piece): number {
  let n = 0;
  for (const q of st.pieces) {
    if (q.dead) continue;
    const t = getDef(q.defId).type;
    if (t !== 'follower' && t !== 'grave') continue;
    for (const c of pieceCells(q)) {
      if (Math.abs(c.x - p.x) <= 1 && Math.abs(c.y - p.y) <= 1) { n++; break; }
    }
  }
  return Math.max(1, n);
}

/* ═════════════ 基类：默认实现 = 无特殊棋子的旧行为 ═════════════ */
export class PieceEffect {
  // ── 静态属性（定义性事实）──
  buffable = true;          // 10 投石机 = false（6 BUFF怪 增益过滤）
  isCatapult = false;       // 10 投石机 = true（标记引爆防御性守卫）

  // ── 查询钩子（纯函数）──
  effRange(_st: GameState, p: Piece): number { return p.range; }
  effAtk(st: GameState, p: Piece): number {
    let a = p.atk;
    for (const b of p.atkBuffs) if (st.turnCounter < b.until) a += b.amt;
    return a;
  }
  effActions(_st: GameState, p: Piece): number { return getDef(p.defId).acts; }
  effMv(_st: GameState, p: Piece): number { return p.mv; }
  /** 攻击目标计算用的射程（4 号蓄满 +1 的接缝，不外泄到 effRange 消费方） */
  attackRange(st: GameState, p: Piece): number { return this.effRange(st, p); }
  moveTargets(st: GameState, p: Piece): Cell[] {
    if (p.big) {
      const out: Cell[] = [];
      const occupied = new Set<string>();
      for (const q of st.pieces) {
        if (q.dead || q.uid === p.uid) continue;
        for (const c of pieceCells(q)) occupied.add(c.x + ',' + c.y);
      }
      for (const [dx, dy] of DIRS) {
        let ok = true;
        for (const c of pieceCells(p)) {
          const nx = c.x + dx, ny = c.y + dy;
          if (!inBoard(nx, ny) || occupied.has(nx + ',' + ny) || blocksAlly(st, nx, ny, p.owner)) { ok = false; break; }
        }
        if (ok) out.push({ x: p.x + dx, y: p.y + dy });
      }
      return out;
    }
    return bfsEmptyCells(st, p, this.effMv(st, p), (x, y) => blocksAlly(st, x, y, p.owner));
  }
  attackTargets(st: GameState, p: Piece): Piece[] {
    const out: Piece[] = [];
    const rngEff = this.attackRange(st, p);
    const myCells = new Set<string>(pieceCells(p).map((c) => c.x + ',' + c.y));
    const candidates = st.pieces.filter((q) =>
      !q.dead && q.owner !== p.owner && nearestDist(p, q) <= rngEff);
    for (const t of candidates) {
      const tKeys = new Set<string>(pieceCells(t).map((c) => c.x + ',' + c.y));
      const dist = new Map<string, number>();
      let frontier: string[] = [];
      for (const k of myCells) { dist.set(k, 0); frontier.push(k); }
      let reach = -1;
      bfs:
      while (frontier.length) {
        const next: string[] = [];
        for (const key of frontier) {
          const d0 = dist.get(key)!;
          if (d0 >= rngEff) continue;
          const [cx, cy] = key.split(',').map(Number);
          for (const [dx, dy] of DIRS) {
            const nx = cx + dx, ny = cy + dy;
            if (!inBoard(nx, ny)) continue;
            const nk = nx + ',' + ny;
            if (dist.has(nk)) continue;
            if (tKeys.has(nk)) { if (d0 + 1 <= rngEff) { reach = d0 + 1; break bfs; } continue; }
            const occ = pieceAt(st, nx, ny);
            if (occ && occ.owner !== p.owner) continue;
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
  modifyIncomingDamage(_st: GameState, _target: Piece, amount: number,
                       _src: Piece | null, _opts: { hit?: boolean }): { amount: number; frontal: boolean } {
    return { amount, frontal: false };
  }
  modifyAttackDamage(_st: GameState, _p: Piece, _target: Piece, dmg: number): { dmg: number; crit: boolean } {
    return { dmg, crit: false };
  }

  // ── 触发器钩子（副作用，默认空）──
  async onDeploy(_ctx: HandlerCtx, _s: Session, _p: Piece): Promise<void> {}
  async onTurnStart(_ctx: HandlerCtx, _s: Session, _p: Piece): Promise<void> {}
  async onMoveCommand(_ctx: HandlerCtx, _s: Session, _p: Piece, _x: number, _y: number): Promise<boolean> { return false; }
  async onAttackSelected(_ctx: HandlerCtx, _s: Session, _p: Piece, _t: Piece): Promise<boolean> { return false; }
  async onAttack(_ctx: HandlerCtx, _s: Session, _p: Piece, _target: Piece): Promise<boolean> { return false; }
  async onAttackDone(_ctx: HandlerCtx, _s: Session, _p: Piece, _target: Piece): Promise<void> {}
  async onDamaged(_s: Session, _target: Piece, _amount: number,
                  _src: Piece | null, _opts: { noCounter?: boolean }): Promise<void> {}
  async onKill(_s: Session, _killer: Piece, _victim: Piece): Promise<void> {}
  async onDeath(_ctx: HandlerCtx, _s: Session, _victim: Piece, _killer: Piece | null): Promise<void> {}

  // ── 全局查询钩子 ──
  blocksAllyCell(_st: GameState, _p: Piece, _x: number, _y: number, _owner: Owner): boolean { return false; }
  guardsAlly(_st: GameState, _blade: Piece, _ally: Piece): boolean { return false; }

  // ── 主动技能（无则缺省）──
  skillLabel?: string;
  skillUsable?(_p: Piece): boolean { return true; }
  skillTargetSpec?(_st: GameState, _p: Piece): ChoiceSpec { return { kind: 'none' }; }
  async skillExec?(_ctx: HandlerCtx, _s: Session, _p: Piece, _got: ChoiceResult): Promise<void> {}
}

/* ═════════════ 查询层棋子效果 ═════════════ */

/** 33 刀魂：随 3×3 内随从数实时波动攻/射程（名刀的另一形态，见 3 号 form） */
class BladeEffect extends PieceEffect {
  effRange(st: GameState, p: Piece): number { return bladeN(st, p); }
  effAtk(st: GameState, p: Piece): number {
    const now = st.turnCounter;
    let a = bladeN(st, p) * 40;
    for (const b of p.atkBuffs) if (now < b.until) a += b.amt;
    return a;
  }
}

/** 12 跑得快：贴脸减速减攻速（一个实现，旧 effActions/effMv 双份重复的收敛点）；遗言留墓地 */
class SpeedyEffect extends PieceEffect {
  effActions(st: GameState, p: Piece): number {
    let n = getDef(p.defId).acts;
    if (adjacentFoe(st, p)) n -= 1;
    return Math.max(0, n);
  }
  effMv(st: GameState, p: Piece): number {
    let m = p.mv;
    if (adjacentFoe(st, p)) m -= 1;
    return Math.max(0, m);
  }
  async onDeath(_ctx: HandlerCtx, s: Session, victim: Piece): Promise<void> {
    const grave = makePiece(s.state, victim.owner, -2, victim.x, victim.y);
    grave.justDeployed = false;
    s.state.pieces.push(grave);
    ev(s, { type: 'deploy', uid: grave.uid });
    pushLog(s.state, `👟 跑得快倒下了，原地留下一座墓地（0/70）。`);
  }
}

/** 13 直行侠：每次移动必须直线冲整整三格 */
class StraightEffect extends PieceEffect {
  moveTargets(st: GameState, p: Piece): Cell[] {
    const out: Cell[] = [];
    const occupied = new Set<string>();
    for (const q of st.pieces) {
      if (q.dead || q.uid === p.uid) continue;
      for (const c of pieceCells(q)) occupied.add(c.x + ',' + c.y);
    }
    for (const [dx, dy] of DIRS) {
      let ok = true;
      for (let i = 1; i <= 3; i++) {
        const nx = p.x + dx * i, ny = p.y + dy * i;
        if (!inBoard(nx, ny) || occupied.has(nx + ',' + ny) || blocksAlly(st, nx, ny, p.owner)) { ok = false; break; }
      }
      if (ok) out.push({ x: p.x + dx * 3, y: p.y + dy * 3 });
    }
    return out;
  }
}

/** 9 射手：一回合两次攻击不可指定同一目标 */
class ArcherEffect extends PieceEffect {
  attackTargets(st: GameState, p: Piece): Piece[] {
    return super.attackTargets(st, p).filter((t) => !p.hitThisTurn.includes(t.uid));
  }
  async onAttackDone(_ctx: HandlerCtx, _s: Session, p: Piece, target: Piece): Promise<void> {
    p.hitThisTurn.push(target.uid);
  }
}

/** 4 定炮：蓄力两回合才能开炮，蓄满 5 格射程 +1；行动仅蓄力/开炮 */
class CannonEffect extends PieceEffect {
  attackRange(st: GameState, p: Piece): number {
    return this.effRange(st, p) + (p.charge >= 5 ? 1 : 0);
  }
  attackTargets(st: GameState, p: Piece): Piece[] {
    if (p.charge < 2) return [];
    return super.attackTargets(st, p);
  }
  async onAttackDone(_ctx: HandlerCtx, _s: Session, p: Piece): Promise<void> { p.charge = 0; }
  skillLabel = '⚡ 蓄力';
  skillUsable(p: Piece): boolean { return p.charge < 5; }
  skillTargetSpec(): ChoiceSpec { return { kind: 'none' }; }
  async skillExec(_ctx: HandlerCtx, s: Session, p: Piece): Promise<void> {
    p.charge++;
    ev(s, { type: 'buff', uid: p.uid });
    pushLog(s.state, `🎯 定炮蓄力中……（${p.charge}/5）`);
  }
}

/** 23 独行侠：两回合一动爆发六次；周围一圈禁入友军 */
class LonerEffect extends PieceEffect {
  effActions(_st: GameState, p: Piece): number { return p.beatCount % 2 === 0 ? 6 : 0; }
  async onTurnStart(_ctx: HandlerCtx, _s: Session, p: Piece): Promise<void> { p.beatCount++; }
  blocksAllyCell(_st: GameState, p: Piece, x: number, y: number, owner: Owner): boolean {
    return p.owner === owner && mdist(x, y, p.x, p.y) <= 1;
  }
}

/** 21 神行千里：蓄气两回合后扣 10 血瞬移六格并出手一次 */
class TeleporterEffect extends PieceEffect {
  skillLabel = '🌀 神行千里';
  skillUsable(p: Piece): boolean { return p.charge >= 2 && p.hp > 10; }
  skillTargetSpec(): ChoiceSpec { return { kind: 'none' }; }
  async skillExec(ctx: HandlerCtx, s: Session, p: Piece): Promise<void> {
    p.hp -= 10;
    p.charge = 0;
    ev(s, { type: 'damage', uid: p.uid, amount: 10 });
    pushLog(s.state, `🌀 神行千里发动！扣除 10 血（${p.hp}/${p.maxHp}），请选择落点（≤6 格）。`, 'l-impt');
    const cells = bfsEmptyCells(s.state, p, 6, (x, y) => blocksAlly(s.state, x, y, p.owner));
    const dest = (await ctx.choose({ kind: 'cell', cells, hint: '神行：选择落点（可原地不动）' })) as Cell;
    if (dest.x !== p.x || dest.y !== p.y) {
      ev(s, { type: 'move', uid: p.uid, tx: dest.x, ty: dest.y });
      p.x = dest.x; p.y = dest.y;
    }
    const targets = attackTargets(s.state, p);
    if (!targets.length) { pushLog(s.state, '🌀 周围没有可攻击的目标，神行结束。'); return; }
    const t = await ctx.choose({ kind: 'piece', pieces: targets, hint: '进行一次攻击（取消则放弃）', cancelable: true });
    if (!t) { pushLog(s.state, '🌀 放弃了攻击。'); return; }
    await performAttack(ctx, s, p, t as Piece);
  }
}

/* ═════════════ 触发器 / 技能层棋子效果 ═════════════ */

/** 1 冲锋怪：伤害随机波动；部署可 -10 血换冲锋 */
class ChargerEffect extends PieceEffect {
  modifyAttackDamage(st: GameState, _p: Piece, _target: Piece, dmg: number): { dmg: number; crit: boolean } {
    const r = rnd(st);
    if (r < 1 / 12) return { dmg: dmg + 60, crit: true };
    if (r < 1 / 4) return { dmg: dmg + 20, crit: false };
    return { dmg, crit: false };
  }
  async onDeploy(ctx: HandlerCtx, s: Session, p: Piece): Promise<void> {
    const choice = await ctx.choose({
      kind: 'option',
      options: [
        { label: '⚡ 获得冲锋（−10 血）', value: 'charge' },
        { label: '🛡️ 保持满血', value: 'normal' },
      ],
      hint: '冲锋怪：是否牺牲 10 血量换取部署当回合即可行动？',
    });
    if (choice === 'charge') {
      p.hp -= 10;
      p.justDeployed = false;
      p.apLeft = this.effActions(s.state, p);
      pushLog(s.state, '⚔️ 冲锋怪嘶吼着冲入了战场！（本回合即可行动）', 'l-impt');
      ev(s, { type: 'buff', uid: p.uid });
    }
  }
}

/** 2 奶妈：可治疗友方（doAttack 层接管）；死亡时无视距离反击 */
class HealerEffect extends PieceEffect {
  async onAttackSelected(_ctx: HandlerCtx, s: Session, p: Piece, t: Piece): Promise<boolean> {
    if (t.hp >= t.maxHp) return false;
    if (nearestDist(p, t) > p.range) return false;
    snap(s); p.apLeft--;
    pushLog(s.state, `💉 奶妈为【${getDef(t.defId).name}】回复了 20 血量。`);
    ev(s, { type: 'attack', uid: p.uid, tuid: t.uid, healMode: true });
    await heal(s, t, 20);
    return true;
  }
  async onDeath(ctx: HandlerCtx, s: Session, victim: Piece): Promise<void> {
    const foes = foesOf(s.state, victim.owner);
    if (!foes.length) return;
    const t = await ctx.choose({
      kind: 'piece', pieces: foes, cancelable: true,
      hint: `奶妈的遗言：选择一名敌方单位进行无视距离的反击（20 伤害，可取消）`,
    });
    if (!t) { pushLog(s.state, '💉 奶妈安详地离去了……'); return; }
    pushLog(s.state, `💉 奶妈的遗言发动！无视距离对【${getDef((t as Piece).defId).name}】造成 20 伤害！`, 'l-impt');
    await dealDamage(s, t as Piece, victim.atk, null, {});
  }
}

/** 3 名刀（守护灵形态）：射程 6 内友方各自免死一次 */
class KatanaGuardEffect extends PieceEffect {
  guardsAlly(_st: GameState, blade: Piece, ally: Piece): boolean {
    return nearestDist(blade, ally) <= 6;
  }
}

/** 5 大肉比：先蓄势一回合再整体平移一格 */
class BigChargeEffect extends PieceEffect {
  async onMoveCommand(_ctx: HandlerCtx, s: Session, p: Piece, x: number, y: number): Promise<boolean> {
    if (p.charge <= 0) {
      snap(s);
      p.charge = 1;
      p.apLeft--;
      ev(s, { type: 'buff', uid: p.uid });
      pushLog(s.state, '🐘 大肉比深深蓄势……下次选择移动才会真正挪动！');
      return true;
    }
    const legal = this.moveTargets(s.state, p).some((c) => c.x === x && c.y === y);
    if (!legal) return false;
    snap(s);
    p.charge = 0;
    ev(s, { type: 'move', uid: p.uid, tx: x, ty: y });
    p.x = x; p.y = y;
    p.apLeft--;
    pushLog(s.state, `🐘 大肉比轰隆隆地挪到了 (${x},${y})！`);
    return true;
  }
}

/** 6 BUFF怪：技能令射程内友方下回合 +10 攻击（对投石机无效） */
class BuffGuyEffect extends PieceEffect {
  skillLabel = '📣 增益 +10攻';
  skillUsable(): boolean { return true; }
  skillTargetSpec(st: GameState, p: Piece): ChoiceSpec {
    return {
      kind: 'piece',
      pieces: myFollowers(st, p.owner).filter((q) => getEffect(q.defId).buffable !== false && nearestDist(p, q) <= this.effRange(st, p)),
      hint: '选择射程内的一名友方棋子获得下回合 +10 攻击（对投石机无效）',
    };
  }
  async skillExec(_ctx: HandlerCtx, s: Session, p: Piece, got: ChoiceResult): Promise<void> {
    const target = got as Piece;
    target.atkBuffs.push({ amt: 10, until: s.state.turnCounter + 3 });
    ev(s, { type: 'buff', uid: target.uid });
    pushLog(s.state, `📣 【${getDef(target.defId).name}】获得下回合 +10 攻击力！`, 'l-impt');
  }
}

/** 7 钩子：技能把射程内一名敌方棋子钩到身边 */
class HookEffect extends PieceEffect {
  skillLabel = '🪝 钩拉';
  skillUsable(): boolean { return true; }
  skillTargetSpec(st: GameState, p: Piece): ChoiceSpec {
    return {
      kind: 'piece',
      pieces: foeFollowers(st, p.owner).filter((q) => !q.big && nearestDist(p, q) <= this.effRange(st, p)),
      hint: '选择攻击范围内的一名敌方棋子，将其钩到身边',
    };
  }
  async skillExec(ctx: HandlerCtx, s: Session, p: Piece, got: ChoiceResult): Promise<void> {
    const target = got as Piece;
    const spots: Cell[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const x = p.x + dx, y = p.y + dy;
      if (!inBoard(x, y) || pieceAt(s.state, x, y)) continue;
      spots.push({ x, y });
    }
    let dest: Cell;
    if (spots.length === 0) { pushLog(s.state, '🪝 钩子周围没有空格，钩拉失败。'); return; }
    else if (spots.length === 1) dest = spots[0];
    else dest = (await ctx.choose({ kind: 'cell', cells: spots, hint: '选择把敌人钩到哪个位置' })) as Cell;
    ev(s, { type: 'hook', uid: target.uid, fx: p.x, fy: p.y, x0: target.x, y0: target.y, tx: dest.x, ty: dest.y });
    target.x = dest.x; target.y = dest.y;
    pushLog(s.state, `🪝 【${getDef(target.defId).name}】被钩到了 (${dest.x},${dest.y})！`, 'l-impt');
  }
}

/** 10 投石机：攻击改为挂引信标记（performAttack 层接管）；不受增益 */
class CatapultEffect extends PieceEffect {
  buffable = false;
  isCatapult = true;
  async onAttack(_ctx: HandlerCtx, s: Session, p: Piece, target: Piece): Promise<boolean> {
    pushLog(s.state, `🪨 投石机砸中了【${getDef(target.defId).name}】，附上引信标记！`);
    if (!target.dead) {
      target.mark10 = { owner: p.owner, srcUid: p.uid, expires: s.state.turnCounter + 2 };
      ev(s, { type: 'mark', uid: target.uid });
    }
    return true;
  }
}

/** 11 白嫖怪：死亡时下回合额外召唤一次 */
class FreeloaderEffect extends PieceEffect {
  async onDeath(_ctx: HandlerCtx, s: Session, victim: Piece): Promise<void> {
    s.state.extraDraw[victim.owner]++;
    pushLog(s.state, `🆓 白嫖怪死亡：${PNAME[victim.owner]}下回合将额外召唤一枚棋子！`, 'l-impt');
  }
}

/** 14 献祭炮：技能献祭友方，向某一列第一个敌人倾泻其攻击力 */
class SacrificeEffect extends PieceEffect {
  skillLabel = '🔥 献祭齐射';
  skillUsable(): boolean { return true; }
  skillTargetSpec(st: GameState, p: Piece): ChoiceSpec {
    return {
      kind: 'piece',
      pieces: myFollowers(st, p.owner).filter((q) => q.uid !== p.uid && nearestDist(p, q) <= this.effRange(st, p)),
      hint: '选择要献祭的友方棋子（将扣除你 10 点血量上限）',
    };
  }
  async skillExec(ctx: HandlerCtx, s: Session, p: Piece, got: ChoiceResult): Promise<void> {
    const victim = got as Piece;
    p.maxHp -= 10;
    p.hp = Math.min(p.hp, p.maxHp);
    ev(s, { type: 'damage', uid: p.uid, amount: 0, silentNum: true });
    pushLog(s.state, `🔥 献祭炮扣除了自己 10 点血量上限（上限 ${p.maxHp}）。`);
    const vAtk = this.effAtk(s.state, victim);
    await killPiece(s, victim, null);
    await flushDeaths(ctx, s);
    const cols: number[] = [];
    const rng = this.effRange(s.state, p);
    for (let c = Math.max(1, p.x - rng); c <= Math.min(W, p.x + rng); c++) cols.push(c);
    const colCells: (Cell & { col: number })[] = [];
    for (const c of cols) for (let y = 1; y <= H; y++) colCells.push({ x: c, y, col: c });
    const picked = (await ctx.choose({
      kind: 'cell', cells: colCells,
      hint: `选择轰击哪一列（对距你最近的敌方造成 ${vAtk} 伤害）`,
    })) as Cell & { col: number };
    let best: Piece | null = null, bestD = Infinity;
    for (const q of foesOf(s.state, p.owner)) {
      const covers = q.big ? (picked.col >= q.x && picked.col <= q.x + 1) : q.x === picked.col;
      if (!covers) continue;
      const d = nearestDist(p, q);
      if (d < bestD) { bestD = d; best = q; }
    }
    if (!best) { pushLog(s.state, `🔥 第 ${picked.col} 列上没有敌方单位，炮击落空……`); return; }
    pushLog(s.state, `🔥 献祭齐射命中第 ${picked.col} 列的【${getDef(best.defId).name}】，造成 ${vAtk} 伤害！`, 'l-impt');
    await dealDamage(s, best, vAtk, p, { hit: true });
  }
}

/** 15 蓄力怪：技能 +10 攻或 +1 射程，整场限 3 次 */
class ChargerSkillEffect extends PieceEffect {
  skillLabel = '🔋 强化(限3次)';
  skillUsable(p: Piece): boolean { return p.skillUses < 3; }
  skillTargetSpec(): ChoiceSpec {
    return {
      kind: 'option',
      options: [{ label: '+10 攻击力', value: 'atk' }, { label: '+1 攻击范围', value: 'rng' }],
      hint: '选择强化方式（整场限 3 次）',
    };
  }
  async skillExec(_ctx: HandlerCtx, s: Session, p: Piece, got: ChoiceResult): Promise<void> {
    p.skillUses++;
    if (got === 'atk') { p.atk += 10; pushLog(s.state, `🔋 蓄力怪强化：攻击力提升至 ${p.atk}！（剩余 ${3 - p.skillUses} 次）`); }
    else { p.range += 1; pushLog(s.state, `🔋 蓄力怪强化：射程提升至 ${p.range}！（剩余 ${3 - p.skillUses} 次）`); }
    ev(s, { type: 'buff', uid: p.uid });
  }
}

/** 16 伤害转化器：受友方伤害时反弹等量给射程内敌人（忠实迁移，友伤分支目前不可达） */
class ConverterEffect extends PieceEffect {
  async onDamaged(s: Session, target: Piece, amount: number,
                  src: Piece | null, opts: { noCounter?: boolean }): Promise<void> {
    if (!src || src.owner !== target.owner || opts.noCounter) return;
    ev(s, { type: 'counter', uid: target.uid });
    pushLog(s.state, `🔄 伤害转化器将 ${amount} 点友方伤害转化为反击！`);
    const foes = s.state.pieces.filter((q) => !q.dead && q.owner !== target.owner &&
                                           nearestDist(target, q) <= this.effRange(s.state, target));
    for (const f of foes) await dealDamage(s, f, amount, target, { noCounter: true });
  }
}

/** 19 路障小法师：技能召唤撑不过下回合的路障 */
class BarrierMageEffect extends PieceEffect {
  skillLabel = '🚧 召唤路障';
  skillUsable(): boolean { return true; }
  skillTargetSpec(st: GameState, p: Piece): ChoiceSpec {
    const cells: Cell[] = [];
    for (let y = 1; y <= H; y++) for (let x = 1; x <= W; x++) {
      if (!pieceAt(st, x, y) && mdist(p.x, p.y, x, y) <= this.effRange(st, p)) cells.push({ x, y });
    }
    return { kind: 'cell', cells, hint: '选择放置路障的空格（存活到你的下回合开始）' };
  }
  async skillExec(_ctx: HandlerCtx, s: Session, p: Piece, got: ChoiceResult): Promise<void> {
    const cell = got as Cell;
    const bar = makePiece(s.state, p.owner, -3, cell.x, cell.y);
    bar.diesAt = s.state.turnCounter + 2;
    bar.justDeployed = false;
    s.state.pieces.push(bar);
    ev(s, { type: 'deploy', uid: bar.uid });
    pushLog(s.state, `🚧 路障小法师在 (${cell.x},${cell.y}) 召唤了路障（它撑不过你的下回合开始）。`);
  }
}

/** 20 超级跑得快：被敌方击杀时反咬 20 伤害 */
class SuperSpeedyEffect extends PieceEffect {
  async onDeath(_ctx: HandlerCtx, s: Session, victim: Piece, killer: Piece | null): Promise<void> {
    if (!killer || killer.dead || killer.owner === victim.owner) return;
    pushLog(s.state, `💥 超级跑得快的遗言：对击杀者【${getDef(killer.defId).name}】造成 20 伤害！`, 'l-impt');
    await dealDamage(s, killer, 20, null, {});
  }
}

/** 24 厚脸皮：来自正面的伤害至多 10 */
class ThickFaceEffect extends PieceEffect {
  modifyIncomingDamage(_st: GameState, _target: Piece, amount: number,
                       src: Piece | null, opts: { hit?: boolean }): { amount: number; frontal: boolean } {
    if (src && opts.hit && isFrontal(src, _target)) return { amount: Math.min(amount, 10), frontal: true };
    return { amount, frontal: false };
  }
}

/** 26 杀手：连续击杀循环升级 +血 → +攻 → +射程 */
class AssassinEffect extends PieceEffect {
  async onKill(s: Session, killer: Piece): Promise<void> {
    killer.killCount++;
    const stage = ((killer.killCount - 1) % 4) + 1;
    if (stage === 1 || stage === 4) {
      killer.maxHp += 10;
      killer.hp = Math.min(killer.maxHp, killer.hp + 10);
      pushLog(s.state, `🔪 杀手完成第 ${killer.killCount} 杀：+10 血量上限并回复 10 血！（${killer.hp}/${killer.maxHp}）`, 'l-impt');
    } else if (stage === 2) {
      killer.atk += 5;
      pushLog(s.state, `🔪 杀手完成第 ${killer.killCount} 杀：+5 攻击力！（atk ${killer.atk}）`, 'l-impt');
    } else {
      killer.range += 1;
      pushLog(s.state, `🔪 杀手完成第 ${killer.killCount} 杀：+1 攻击范围！（射程 ${killer.range}）`, 'l-impt');
    }
    ev(s, { type: 'buff', uid: killer.uid });
  }
}

/* ═════════════ 注册表 / 兜底 / 转发 / 全局助手 ═════════════ */
export const EFFECTS: Record<number, PieceEffect> = {
  1: new ChargerEffect(), 2: new HealerEffect(), 3: new KatanaGuardEffect(),
  4: new CannonEffect(), 5: new BigChargeEffect(), 6: new BuffGuyEffect(),
  7: new HookEffect(), 9: new ArcherEffect(), 10: new CatapultEffect(),
  11: new FreeloaderEffect(), 12: new SpeedyEffect(), 13: new StraightEffect(),
  14: new SacrificeEffect(), 15: new ChargerSkillEffect(), 16: new ConverterEffect(),
  19: new BarrierMageEffect(), 20: new SuperSpeedyEffect(), 21: new TeleporterEffect(),
  23: new LonerEffect(), 24: new ThickFaceEffect(), 26: new AssassinEffect(),
  33: new BladeEffect(),
};

const DEFAULT = new PieceEffect();
/** 未注册的特殊单位（-1 基地 / -2 墓地 / -3 路障）兜底返回默认实例，杜绝 undefined 崩溃 */
export function getEffect(defId: number): PieceEffect { return EFFECTS[defId] ?? DEFAULT; }

export function effRange(st: GameState, p: Piece): number { return getEffect(p.defId).effRange(st, p); }
export function effAtk(st: GameState, p: Piece): number { return getEffect(p.defId).effAtk(st, p); }
export function effActions(st: GameState, p: Piece): number { return getEffect(p.defId).effActions(st, p); }
export function effMv(st: GameState, p: Piece): number { return getEffect(p.defId).effMv(st, p); }
export function moveTargets(st: GameState, p: Piece): Cell[] { return getEffect(p.defId).moveTargets(st, p); }
export function attackTargets(st: GameState, p: Piece): Piece[] { return getEffect(p.defId).attackTargets(st, p); }

/** 全局：某棋子效果是否阻止 owner 方进入 (x,y)（23 独行侠禁入圈） */
export function blocksAlly(st: GameState, x: number, y: number, owner: Owner): boolean {
  for (const q of st.pieces) {
    if (q.dead) continue;
    if (getEffect(q.defId).blocksAllyCell(st, q, x, y, owner)) return true;
  }
  return false;
}

/** 抽牌形态判定（名刀 → 刀魂）。game.ts 与 spells.ts 共用，消灭重复。 */
export function resolveDrawDefId(state: GameState, defId: number): number {
  const form = getDef(defId).form;
  if (form && rnd(state) >= form.keepProb) return form.to;
  return defId;
}
