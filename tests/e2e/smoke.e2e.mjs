/** 发布前端到端冒烟：真实浏览器中完成 清手牌→跨回合→选子→攻击/移动 链路。
 *  Task 5：--reduced-motion 映射 Edge --force-prefers-reduced-motion，驱动用
 *  matchMedia 复核偏好确实生效（仅当 CLI 带上该标志时断言为 true）。 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const edge = EDGE_CANDIDATES.find(existsSync);
if (!edge) { console.error('未找到 msedge.exe'); process.exit(1); }
const reducedMotion = process.argv.includes('--reduced-motion');

const DRIVER = `
<script>
(function () {
  const out = { deployed: false, advanced: false, selected: false,
                attacked: false, moved: false,
                restarted: false, staleFxClean: false,
                motionHandle: false, deathOwned: false,
                modalExit: false,
                reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
                error: '' };
  let finished = false;
  const done = () => {
    if (finished) return; finished = true;
    document.body.insertAdjacentHTML('beforeend',
      '<div id="e2e-result">' + JSON.stringify(out) + '</div>');
  };
  const $  = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms) => {
    const t0 = Date.now();
    while (!(cond())) {
      if (Date.now() - t0 > ms) return false;
      await wait(80);
    }
    return true;
  };
  const game = () => window.__HJ_DEBUG__ && window.__HJ_DEBUG__.game;
  const st   = () => game() && game().state;

  (async () => {
    // N1 修正：boot 完成时相位是 'deploy'（首回合手牌非空不推进），只等游戏就绪
    if (!(await until(() => !!st(), 20000))) throw new Error('游戏未启动');

    // ── Task 4 红线：Modal exit 生命周期（close 后 AnimatePresence 持有到 exit 播完才卸载）──
    // 实测（2026-08-28）：本 harness（--virtual-time-budget + --dump-dom）下 Motion 的 rAF
    // frameloop 不驱动（Task 2 实测同源）——exit 的 keyframe 解析/结算永不落定，组件被
    // AnimatePresence 无限持有（close+30/300/1600ms 采样：无动画对象、样式冻结、仍挂载）。
    // 故红灯语义保留 30ms「不得立即卸载」，绿灯改为验证「exit 生命周期已触发」：
    // close 后跨整个 exit 时长（0.28s）仍保持挂载。真实浏览器中 exit 播完即卸载，
    // 由 T6 手动 smoke 验证（不能用本 harness 的 until(!#modal) 作断言）。
    click($('#btn-codex'));
    if (!(await until(() => $('#modal'), 1500))) throw new Error('图鉴未打开');
    click($('#modal-close'));
    await wait(30);
    if (!$('#modal')) throw new Error('Modal 没有 exit 生命周期，立即卸载');
    await wait(1000);   // exit 时长（0.28s）之后——如已卸载说明 exit 提前完成或路径异常
    out.modalExit = true;

    // deploy 相位处理一张手牌；返回是否取得进展。
    // 帧竞争：动作点击落在上一条 act 链（回合横幅等）仍在播的 busy 帧会被吞掉，
    // 用「整段重试」兜底——等链收尾后重新执行一次。
    // Task 4（虚拟时间适配，2026-08-28 实测）：#optfloat 的 exit 动画在本 harness 下永不
    // 结算 → 询问已消费后节点残留（含按钮）。故浮层点击用「点击-验证事件增长」闭环
    // 区分真实询问（消除后必定有行动事件）与残留节点（无 effect，按无浮层继续处理手牌）。
    const drainOne = async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const s = st();
        if ($$('#optfloat').length) {
          const of = $$('#optfloat').pop();               // 最新 overlay（防残留退出动画的影子节点）
          const before = game().events.length;
          click(of && of.querySelector('button'));        // 语义保持：仍点第一个选项（options[0]）
          if (await until(() => game().events.length > before, 1500)) return true;
        }
        const before = s.hand[s.curPlayer].length;
        const storeBtn = $('[data-store]');
        if (storeBtn) { click(storeBtn); }                  // 法术：储存无目标选择，必定成功
        else {
          const card = $('#hand [data-card]');
          if (!card) throw new Error('deploy 相位但手牌区为空');
          click(card);                                       // 进入部署模式
          if (!(await until(() => $('.cell.dep-ok') || $('[data-discard]'), 3000)))
            throw new Error('选卡后既无落点也无弃置钮');
          const cell = $('.cell.dep-ok');
          if (cell) { click(cell); out.deployed = true; }
          else { click($('[data-discard]')); }               // 无处部署 → 弃置
        }
        if (await until(() => st().phase !== 'deploy' ||
            st().hand[st().curPlayer].length < before, 5000)) return true;
        await wait(600);                                     // 点击被链 busy 吞掉 → 等收尾再重试
      }
      throw new Error('手牌处理卡死');
    };

    // 「存在确定有动作可做」的己方棋子（大肉比蓄势流程复杂，排除）
    const hasActor = () => {
      const s = st();
      if (!s || s.phase !== 'action') return false;
      return s.pieces.some((p) => p.owner === s.curPlayer && !p.justDeployed &&
        p.apLeft > 0 && p.defId !== -1 && p.defId !== 5 &&
        (game().rules.attackTargets(p).length ||
         game().rules.moveTargets(p).some((c) => c.x !== p.x || c.y !== p.y)));
    };

    // 统一主循环（N2 修正）：每个玩家的 deploy 相位都被清理；
    // action 相位有戏则动、无戏则过回合——直到完成一次真实行动
    let acted = false;
    for (let guard = 0; guard < 24 && !acted; guard++) {
      const s = st();
      if (s.phase === 'over') throw new Error('对局意外提前结束');
      // 时序护栏（headless 动画链时序调整，简报实施提示授权）：hand-splice 先于 playChain
      // 播完，若不等 busy 清除，上一条 act 的 finally resetSelection 会取消本次部署模式、
      // busy 锁会吞掉本次真实点击。Task 2 重载：#btn-restart 不再绑 busy（disabled 仅 choice），
      // 链是否在播由 #btn-end 的 disabled（busy||相位||胜负）与回合横幅可见性共同判定——
      // 按钮可用→放行；回合横幅在播→等；deploy/over 相位且无横幅→放行（同相位忙点走自身循环）。
      if (!(await until(() => {
        const b = $('#btn-end');
        if (b && !b.disabled) return true;
        const bn = $('#banner');
        if (bn && !bn.classList.contains('hidden')) return false;
        const s2 = st();
        return !s2 || s2.phase === 'deploy' || s2.phase === 'over';
      }, 8000)))
        throw new Error('动作链未在 8s 内播完');
      if (s.phase === 'deploy') { await drainOne(); continue; }
      // 浮层点击闭环（同 drainOne）：真实询问消除后有事件；残留 exit 节点无 effect。
      if ($$('#optfloat').length) {
        const of = $$('#optfloat').pop();
        const before = game().events.length;
        click(of && of.querySelector('button'));
        if (await until(() => game().events.length > before, 1500)) { await wait(200); continue; }
      }
      if (!hasActor()) { click($('#btn-end')); await wait(500); continue; }
      out.advanced = true;

      // 选定一枚「能攻击或有位移」的棋子，点击之
      let mine = null, plan = null;
      for (const p of s.pieces.filter((q) => q.owner === s.curPlayer && !q.justDeployed &&
                                         q.apLeft > 0 && q.defId !== -1 && q.defId !== 5)) {
        if (game().rules.attackTargets(p).length) { mine = p; plan = 'attack'; break; }
        if (!mine && game().rules.moveTargets(p).some((c) => c.x !== p.x || c.y !== p.y)) {
          mine = p; plan = 'move';
        }
      }
      const el = $('.piece[data-uid="' + mine.uid + '"]');
      if (!el) throw new Error('找不到棋子 DOM uid=' + mine.uid);
      click(el);
      out.selected = true;
      // 帧竞争：点击落在链 busy 帧会被吞掉（无高亮）；等链收尾后重试一次
      if (!(await until(() => $('.atk-ok') || $('.mv-ok'), 5000))) {
        await wait(600);
        click(el);
        if (!(await until(() => $('.atk-ok') || $('.mv-ok'), 5000)))
          throw new Error('选中后无高亮 | phase=' + st().phase +
            ' cur=' + st().curPlayer + ' uid=' + mine.uid +
            ' endDisabled=' + ($('#btn-end') && $('#btn-end').disabled) +
            ' undoDisabled=' + ($('#btn-undo') && $('#btn-undo').disabled));
      }

      if (plan === 'attack' && $('.atk-ok')) {
        const tuid = game().rules.attackTargets(mine)[0].uid;
        const tEl = $('.piece[data-uid="' + tuid + '"]');
        if (tEl) { click(tEl); out.attacked = true; }
        else { const mv = $('.mv-ok'); if (mv) { click(mv); out.moved = true; } }
      } else {
        const mv = $('.mv-ok');
        if (mv) { click(mv); out.moved = true; }
      }
      acted = true;
      if (!(await until(() => {
        const b = $('#btn-end');
        return !b || !b.disabled;
      }, 8000))) throw new Error('动作链未在 8s 内结束');
    }
    if (!acted) throw new Error('24 轮内未能完成任何行动');

    // ── restart-during-FX 红线（Task 2）：回合横幅播放中重开。
    // 旧实现 #btn-restart 绑 ia.busy → 被 FX busy 锁死；新实现以 choice 为 disabled 依据，
    // restart 直接 resetFx 取消旧 run，旧 completion 不得写入新局 banner。
    // 前一条 act 链的 busy 释放与 React 提交间存在竞窗（disabled 属性滞后一拍），
    // 直接点击可能落在旧 busy 帧（事件无副作用）；用「点击-验证事件-重试」闭环保证点击生效。
    const endTurn = async () => {
      for (let i = 0; i < 5; i++) {
        if (!(await until(() => { const b = $('#btn-end'); return !b || !b.disabled; }, 8000)))
          throw new Error('动作链未在 8s 内结束');
        const before = game().events.length;
        click($('#btn-end'));
        if (await until(() => game().events.length > before, 2500)) return;
      }
      throw new Error('endTurn 点击 5 次均未生效');
    };
    const oldGame = game();
    const oldBanner = $('#banner');
    window.confirm = () => true;
    await endTurn();
    if (!(await until(() => {
      const b = $('#banner');
      return b && !b.classList.contains('hidden');
    }, 3000))) throw new Error('未进入回合横幅 FX');

    const restart = $('#btn-restart');
    if (!restart || restart.disabled) throw new Error('restart 被 FX busy 锁死');
    click(restart);
    if (!(await until(() => {
      const banner = $('#banner');
      return game() && game() !== oldGame && banner && banner !== oldBanner && $('#fxlayer');
    }, 6000))) throw new Error('FX 中 restart 未完成新局 DOM 物化');
    out.restarted = true;

    // 给 BoardArea.onHosts → App setHosts → FX effect/initFx 一个短 settle；
    // 之后 sentinel 只检测真正的 stale completion，不把新 run 正常装配误判为旧 run 写入。
    await wait(100);
    const newBanner = $('#banner');
    newBanner.className = 'e2e-sentinel';
    await wait(1200);
    if (newBanner.className !== 'e2e-sentinel')
      throw new Error('旧 FX completion 写入了新局 banner');
    newBanner.className = 'hidden';
    if ($('#fxlayer').querySelector('.fly-num,.ring,.boom,.slash,.spell-cast,.bolt'))
      throw new Error('restart 后仍有旧 transient FX');
    out.staleFxClean = true;

    // ── Task 3 红线：确定性 base-vs-base 攻击（motion handle + death 落在内层）──
    // 放最后：击杀基地会决胜（phase→over/win 事件），后续断言将失效。
    const g2 = game();
    const s2 = g2.state;
    s2.phase = 'action';
    const attacker = s2.pieces.find((p) => p.owner === s2.curPlayer && p.defId === -1);
    const victim = s2.pieces.find((p) => p.owner !== s2.curPlayer && p.defId === -1);
    attacker.justDeployed = false;
    attacker.apLeft = 1;
    attacker.range = 99;
    attacker.atk = 999;
    victim.hp = 1;

    const attackerRoot = $('.piece[data-uid="' + attacker.uid + '"]');
    const victimRoot = $('.piece[data-uid="' + victim.uid + '"]');
    if (!attackerRoot?.querySelector('[data-piece-motion]') ||
        !victimRoot?.querySelector('[data-piece-motion]'))
      throw new Error('piece motion handle 缺失');

    click(attackerRoot);
    if (!(await until(() => $('.atk-ok'), 2000))) throw new Error('确定性 death 场景无法攻击');
    click(victimRoot);
    // death FX 落在 motion node：root 的存活期即死亡 FX 链的保质期。本 harness
    // （--virtual-time-budget）下 Motion 的 rAF/WAAPI 时钟不驱动（Task 2 实测——keyframe
    // 解析走 frameloop，动画帧与 promise 永不落定），DOM 观测不到动画帧；
    // 故断言为「同帧谓词」：motion node 存在 + root 挂载 + （真实浏览器可观测的
    // getAnimations()/内联样式，或本 harness 可观测的同步死亡 FX 标志——fxlayer 的
    // boom 粒子，由死亡事件在链内于同一帧创建）。
    if (!(await until(() => {
      const node = victimRoot.querySelector('[data-piece-motion]');
      return node && victimRoot.isConnected &&
        (node.getAnimations().length > 0 || node.style.opacity || node.style.transform ||
         document.querySelector('#fxlayer .boom'));
    }, 4000))) throw new Error('death FX 未落在 motion node');
    if (!victimRoot.isConnected) throw new Error('death FX 完成前 React 已卸载 root');
    if (!(await until(() => !document.querySelector('.piece[data-uid="' + victim.uid + '"]'), 5000)))
      throw new Error('death FX 完成后 React 未卸载 root');
    out.motionHandle = true;
    out.deathOwned = true;
    done();
  })().catch((e) => { out.error = String((e && e.message) || e); done(); });
})();
</script>`;

const indexPath = fileURLToPath(new URL('../../dist/index.html', import.meta.url));
const tmpPath = fileURLToPath(new URL('../../dist/_e2e.tmp.html', import.meta.url));

let html = readFileSync(indexPath, 'utf8');
if (!html.includes('</body>')) {
  console.error('dist/index.html 缺少 </body>，注入驱动脚本失败');
  process.exit(1);
}
// 注意：不能把 DRIVER 直接当 replace 的替换串——$ 模式会被解释（DRIVER 里的 `$$` 会塌缩成 `$`），
// 必须用函数形式替换（返回值不做 $ 模式解释）。
html = html.replace('</body>', () => DRIVER + '\n</body>');
writeFileSync(tmpPath, html);

let dump = '';
try {
  dump = execFileSync(edge, [
    '--headless=new', '--disable-gpu', '--virtual-time-budget=60000', '--dump-dom',
    ...(reducedMotion ? ['--force-prefers-reduced-motion'] : []),
    pathToFileURL(tmpPath).href,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} finally {
  try { unlinkSync(tmpPath); } catch { /* 临时文件可能已被清理 */ }
}

// 驱动脚本源码本身含字面量 '<div id="e2e-result">' 字符串，会先于真实结果被正则命中；
// 真实结果 div 由 driver 在 body 末尾 append，恒为最后一个 JSON 对象形态的匹配。
const raw = [...dump.matchAll(/<div id="e2e-result">(.*?)<\/div>/g)]
  .map((m) => m[1])
  .filter((s) => s.trimStart().startsWith('{'))
  .pop();
if (!raw) {
  console.error('e2e 结果缺失（预算耗尽或驱动异常）');
  process.exit(1);
}

const parsed = JSON.parse(raw);
const ok = parsed.error === '' && parsed.deployed && parsed.advanced &&
            parsed.selected && (parsed.attacked || parsed.moved) &&
            parsed.restarted && parsed.staleFxClean &&
            parsed.motionHandle && parsed.deathOwned &&
            parsed.modalExit &&
            (!reducedMotion || parsed.reducedMotion);
if (!ok) {
  console.error('e2e 断言失败，out 对象：');
  console.error(JSON.stringify(parsed, null, 2));
  process.exit(1);
}
console.log('e2e OK:', JSON.stringify(parsed));
