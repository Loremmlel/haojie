/* ═══════════════ rng.js · 可序列化种子随机数 ═══════════════
 * mulberry32：状态就是一个 32 位整数，直接存在游戏状态里，
 * 悔棋恢复快照后随机序列完全一致（确定性重放）。
 * ═════════════════════════════════════════════════════════ */

/** 推进并返回一个 [0,1) 随机数；state.seed 被原地更新。 */
function rnd(state) {
  let t = (state.seed = (state.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** [lo, hi] 整数随机。 */
function rndInt(state, lo, hi) {
  return lo + Math.floor(rnd(state) * (hi - lo + 1));
}

/** 从数组均匀取一个元素。 */
function rndPick(state, arr) {
  return arr[Math.floor(rnd(state) * arr.length)];
}
