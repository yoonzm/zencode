import { createStore as createZustandStore, type StoreApi } from "zustand/vanilla";
import { useStore as useZustandStore } from "zustand";

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(fn: () => void): () => void;
}

/** 基于 zustand 的外部状态容器；保留 get / set / subscribe 的简单接口。 */
export function createStore<T extends object>(initial: T): Store<T> & { api: StoreApi<T> } {
  const api = createZustandStore<T>()(() => initial);
  return {
    api,
    get: () => api.getState(),
    set: (p) => api.setState(p as Partial<T> | ((s: T) => Partial<T>)),
    subscribe: (fn) => api.subscribe(fn),
  };
}

/** selector 需要返回稳定引用（原始值或 state 中的子对象） */
export function useStore<T extends object, S>(store: Store<T> & { api: StoreApi<T> }, selector: (s: T) => S): S {
  return useZustandStore(store.api, selector);
}
