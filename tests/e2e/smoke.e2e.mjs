/** 发布前端到端冒烟：真实浏览器中完成 清手牌→跨回合→选子→攻击/移动 链路。 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const edge = EDGE_CANDIDATES.find(existsSync);
if (!edge) { console.error('未找到 msedge.exe'); process.exit(1); }

const DRIVER = `
<script>
(function () {
  const out = { deployed: false, advanced: false, selected: false,
                attacked: false, moved: false, error: '' };
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

    // deploy 相位处理一张手牌；返回是否取得进展
    const drainOne = async () => {
      const s = st();
      if ($('#optfloat')) { click($('#optfloat button')); return true; }  // 冲锋等询问浮层
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
      if (!(await until(() => st().phase !== 'deploy' ||
          st().hand[st().curPlayer].length < before, 5000)))
        throw new Error('手牌处理卡死');
      return true;
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
      // busy 锁会吞掉本次真实点击。#btn-restart 的 disabled 即 ia.busy；optfloat 出现时
      // busy 由 choose 持有（合法等待应答），放行交给主循环的浮层分支处理。
      if (!(await until(() => { const b = $('#btn-restart'); return !b || !b.disabled || $('#optfloat'); }, 8000)))
        throw new Error('动作链未在 8s 内播完');
      if (s.phase === 'deploy') { await drainOne(); continue; }
      if ($('#optfloat')) { click($('#optfloat button')); await wait(200); continue; }
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
      if (!(await until(() => $('.atk-ok') || $('.mv-ok'), 5000))) throw new Error('选中后无高亮');

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
      await wait(2500);                                    // 等动画链与链尾提交
    }
    if (!acted) throw new Error('24 轮内未能完成任何行动');
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
            parsed.selected && (parsed.attacked || parsed.moved);
if (!ok) {
  console.error('e2e 断言失败，out 对象：');
  console.error(JSON.stringify(parsed, null, 2));
  process.exit(1);
}
console.log('e2e OK:', JSON.stringify(parsed));
