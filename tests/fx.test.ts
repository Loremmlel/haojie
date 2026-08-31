/* ═══════════════ fx.test.ts · fx 模块纯函数测试（node:test，零 DOM） ═══════════════
 * 覆盖 isDying 的扫描/游标 clamp 纯逻辑（deathPending）——undo 截断（模块级 evCursor
 * 保持高位、新链死亡事件回填 index 0..N）场景在 e2e 之外获得单元级覆盖。
 * 运行：npm test（与 engine.test.ts 同一套件，node --test 展开 tests/*.test.ts）。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deathPending } from '../src/ui/fx/fx.ts';
import type { GameEvent } from '../src/engine/state.ts';

const death = (uid: number): GameEvent => ({ type: 'death', uid, defId: 0 });
const move = (uid: number): GameEvent => ({ type: 'move', uid, tx: 1, ty: 1 });

test('fx: deathPending 常规扫描——未消费死亡事件命中', () => {
  const events = [move(1), death(2), move(3)];
  assert.equal(deathPending(events, 0, 2), true, '游标 0 时 index 1 的死亡事件命中');
  assert.equal(deathPending(events, 1, 2), true, '游标停在死亡事件本身时仍命中');
  assert.equal(deathPending(events, 2, 2), false, '游标越过死亡事件后不再命中');
  assert.equal(deathPending(events, 0, 1), false, '非死亡 uid 不命中');
});

test('fx: deathPending clamp——undo 截断后游标高位回 0 重扫', () => {
  // undo 截断 events 而模块级 evCursor 保持高位：新链死亡事件回填 index 0..N
  const truncated = [death(7)];
  assert.equal(deathPending(truncated, 5, 7), true, '游标越界 clamp 回 0，回填的死亡事件命中');
  assert.equal(deathPending(truncated, 999, 7), true, '任意越界游标同语义');
});

test('fx: deathPending clamp——空/无死亡事件时恒 false', () => {
  assert.equal(deathPending([], 3, 7), false, '空数组（游标越界 clamp 到 0）无命中');
  assert.equal(deathPending([move(1)], 2, 7), false, '越界游标下无死亡事件不命中');
});
