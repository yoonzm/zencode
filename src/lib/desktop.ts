import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ZTask } from '@/data/types';
declare global { interface Window { desktop?: { call: (op: string, args?: any) => Promise<any>; onTask: (fn: (task: ZTask) => void) => () => void; onError: (fn: (message: string) => void) => () => void }; } }
if ('__TAURI_INTERNALS__' in window) {
  const subscribe = (name: string, callback: (data: any) => void) => {
    let stopped = false;
    const promise = listen(name, event => callback(event.payload));
    promise.then(off => { if (stopped) off(); });
    return () => { stopped = true; promise.then(off => off()); };
  };
  window.desktop = {
    call: (op, args) => invoke('desktop_call', { op, args }).catch(error => { throw new Error(String(error)); }),
    onTask: fn => subscribe('desktop:task', fn),
    onError: fn => subscribe('desktop:error', fn),
  };
  document.addEventListener('mousedown', e => {
    const target = e.target as HTMLElement;
    if (e.button === 0 && target.closest('.drag-region') && !target.closest('.no-drag,button,input')) void getCurrentWindow().startDragging();
  });
}
export async function desktopCall(op: string, args?: any) {
  if (!window.desktop) throw new Error('请通过 ZenCode 桌面应用使用此功能');
  return window.desktop.call(op, args);
}
