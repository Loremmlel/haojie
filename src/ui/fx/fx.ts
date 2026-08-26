/* fx.ts · 特效宿主（Task 8 接 initFx/playNew/playChain 与全部特效）
 * playChain 空壳：Task 6 起 act/runSpellCast 已调用它，本任务不播放任何动画。 */
import type { Game } from '../../engine/types.ts';

export async function playChain(_g: Game): Promise<void> {
  // Task 8：按 events 游标逐条播放；当前为空实现
}
