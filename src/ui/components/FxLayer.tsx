/* FxLayer.tsx · 特效容器（命令式领地，Task 8 initFx 注入宿主引用）。
 * 宿主元素 id/#fxlayer、#banner 与 FX 特区样式留 global.css（fx 类名为硬编码字符串，哈希化即失效）。 */
import { forwardRef, useImperativeHandle, useRef } from 'react';
// FxLayer.module.css 为 Task 8 占位（#fxlayer/#banner 及 FX 特区样式留 global，见 Global Constraints 第 2 条）

export interface FxLayerHandle {
  fxLayer: HTMLDivElement | null;
  banner: HTMLDivElement | null;
}

const FxLayer = forwardRef<FxLayerHandle>(function FxLayer(_props, ref) {
  const fxRef = useRef<HTMLDivElement>(null);
  const bnRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ fxLayer: fxRef.current, banner: bnRef.current }), []);
  return (
    <>
      <div id="fxlayer" ref={fxRef} />
      <div id="banner" className="hidden" ref={bnRef} />
    </>
  );
});
export default FxLayer;
