/* OptionFloat.tsx · 选项浮层（input.js mountOptionFloat 平移为声明式渲染）
 * 根元素保留 id="optfloat"（评审 N4：e2e 经 #optfloat button 元素选择器寻址，不依赖类名）。
 * choice 为 option 时渲染：选项按钮 + cancelable 取消键，点击调 finishChoice。
 * Task 4：本地 AnimatePresence（choice 清空时 exit 播完才卸载）；根定位已迁
 * `translate` 个体属性，Motion 独占 transform 驱动 y/scale/opacity。 */
import { motion, AnimatePresence } from 'motion/react';
import { useInteraction, finishChoice } from '../interactionStore.ts';
import s from './OptionFloat.module.css';

const OPTFLOAT_EASE = [.2, .9, .3, 1.15] as const;

export default function OptionFloat() {
  const ia = useInteraction();
  const spec = ia.choice?.spec;
  return (
    <AnimatePresence>
      {spec && spec.kind === 'option' && (
        <motion.div id="optfloat"
          initial={{ opacity: 0, y: 26, scale: .97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: .98 }}
          transition={{ duration: .22, ease: OPTFLOAT_EASE }}>
          <div className={s.title}>{spec.hint || '请选择'}</div>
          {spec.options.map((opt) => (
            <button key={opt.value} className={s.btn} onClick={() => finishChoice(opt.value)}>
              {opt.label}
            </button>
          ))}
          {spec.cancelable && (
            <button className={s.cancel} onClick={() => finishChoice(null)}>取消</button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
