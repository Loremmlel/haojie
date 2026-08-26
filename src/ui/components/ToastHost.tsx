/* ToastHost.tsx · toast 提示容器（v1 codex.js toast 语义：append + 2.6s 自动消失）
 * 订阅 toastBus 模块级发射器；warn=true 时挂 .warn 警告样式（红色边框）。
 * #toast 为全局 DOM id（e2e 稳定寻址），样式经 :global 留在本 module.css。 */
import { useEffect, useState } from 'react';
import { subscribeToast } from '../toastBus.ts';
import s from './ToastHost.module.css';

interface ToastItem { id: number; msg: string; warn: boolean }
let nextId = 1;

export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const unsub = subscribeToast((msg, warn) => {
      const id = nextId++;
      setItems((list) => [...list, { id, msg, warn }]);
      setTimeout(() => {
        setItems((list) => list.filter((t) => t.id !== id));
      }, 2600);
    });
    return unsub;
  }, []);
  return (
    <div id="toast">
      {items.map((t) => (
        <div key={t.id} className={`${s.item}${t.warn ? ` ${s.warn}` : ''}`}>{t.msg}</div>
      ))}
    </div>
  );
}
