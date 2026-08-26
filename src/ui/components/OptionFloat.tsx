/* OptionFloat.tsx · 选项浮层（input.js mountOptionFloat 平移为声明式渲染）
 * 根元素保留 id="optfloat"（评审 N4：e2e 经 #optfloat button 元素选择器寻址，不依赖类名）。
 * choice 为 option 时渲染：选项按钮 + cancelable 取消键，点击调 finishChoice。 */
import { useInteraction, finishChoice } from '../interactionStore.ts';
import s from './OptionFloat.module.css';

export default function OptionFloat() {
  const ia = useInteraction();
  const spec = ia.choice?.spec;
  if (!spec || spec.kind !== 'option') return null;
  return (
    <div id="optfloat">
      <div className={s.title}>{spec.hint || '请选择'}</div>
      {spec.options.map((opt) => (
        <button key={opt.value} className={s.btn} onClick={() => finishChoice(opt.value)}>
          {opt.label}
        </button>
      ))}
      {spec.cancelable && (
        <button className={s.cancel} onClick={() => finishChoice(null)}>取消</button>
      )}
    </div>
  );
}
