import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rndInt } from '../src/engine/rng.ts';
import { W, H, BASE_HP, DEFS, getDef } from '../src/engine/data.ts';
import { makePiece, pieceAt, pieceByUid, newGame } from '../src/engine/state.ts';
import { nearestDist, effRange } from '../src/engine/rules.ts';
// 注：本测试文件同时 import H 于 data 行（见下），state.ts 的 newGame 需要用它放红方基地
import type { Piece, GameState } from '../src/engine/state.ts';

test('toolchain smoke', () => {
  assert.equal(1 + 1, 2);
});

test('data: 棋子库完整性', () => {
  assert.equal(W * H, 117); assert.equal(BASE_HP, 300); assert.equal(DEFS.length, 26);
  for (const d of DEFS) { assert.ok(getDef(d.id), `缺档案 ${d.id}`); }
  assert.equal(getDef(-1).type, 'base');
  assert.equal(getDef(-2).type, 'grave');
  assert.equal(getDef(-3).type, 'grave');
  assert.equal(getDef(33).name, '刀魂');
});

test('rng: 种子确定性', () => {
  const a = { seed: 42 }, b = { seed: 42 };
  for (let i = 0; i < 100; i++) assert.equal(rndInt(a, 1, 26), rndInt(b, 1, 26));
});

test('state: pieceAt 支持 big 与死亡过滤', () => {
  const st: GameState = newGame(7);
  const big = makePiece(st, 0, 5, 3, 3);
  big.big = true; st.pieces.push(big);
  assert.equal(pieceAt(st, 4, 4), big);           // 2×2 右下角
  assert.equal(pieceByUid(st, big.uid), big);
  big.dead = true;
  assert.equal(pieceAt(st, 3, 3), null);
});

test('rules: nearestDist 按占据格最近计算', () => {
  const st = newGame(1);
  const a = makePiece(st, 0, 26, 1, 1); st.pieces.push(a);
  const b = makePiece(st, 1, 5, 4, 4); b.big = true; st.pieces.push(b);
  // big 占 (4,4)(5,4)(4,5)(5,5)，最近格 (4,4)：|4-1|+|4-1|=6
  assert.equal(nearestDist(a, b), 6);
});

test('rules: effRange 非刀魂返回静态射程', () => {
  const st = newGame(2);
  const p = makePiece(st, 0, 9, 1, 1); st.pieces.push(p);   // 射手 rng=5
  assert.equal(effRange(st, p), 5);
});
