// 仅用于离线环境的类型检查：本机没有 @types/react。
// 在正常项目里安装 @types/react 与 @types/react-dom 后删除本文件即可。
declare module "react" {
  export type ReactNode = any;
  export type ReactElement = any;
  export type CSSProperties = Record<string, any>;
  export type ComponentType<P = any> = (props: P) => any;
  export type FC<P = any> = (props: P) => any;
  export type PropsWithChildren<P = {}> = P & { children?: ReactNode };
  export type RefObject<T> = { current: T | null };
  export type MutableRefObject<T> = { current: T };
  export type Ref<T> = any;
  export type ButtonHTMLAttributes<T> = Record<string, any>;
  export type InputHTMLAttributes<T> = Record<string, any>;
  export type HTMLAttributes<T> = Record<string, any>;
  export type TextareaHTMLAttributes<T> = Record<string, any>;
  export type KeyboardEvent<T = any> = any;
  export type MouseEvent<T = any> = any;
  export type ChangeEvent<T = any> = any;
  export type PointerEvent<T = any> = any;
  export type SVGProps<T> = Record<string, any>;
  export type Dispatch<A> = (a: A) => void;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export function useState<S>(init: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useEffect(fn: () => void | (() => void), deps?: readonly any[]): void;
  export function useLayoutEffect(fn: () => void | (() => void), deps?: readonly any[]): void;
  export function useMemo<T>(fn: () => T, deps: readonly any[]): T;
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: readonly any[]): T;
  export function useRef<T>(init: T): MutableRefObject<T>;
  export function useRef<T>(init: T | null): RefObject<T>;
  export function useRef<T = undefined>(): MutableRefObject<T | undefined>;
  export function useId(): string;
  export function useSyncExternalStore<T>(sub: (cb: () => void) => () => void, get: () => T, getServer?: () => T): T;
  export function useDeferredValue<T>(v: T): T;
  export function useTransition(): [boolean, (fn: () => void) => void];
  export function createContext<T>(v: T): any;
  export function useContext<T>(c: any): T;
  export function forwardRef<T, P>(fn: (props: P, ref: any) => any): any;
  export function memo<T>(c: T): T;
  export function startTransition(fn: () => void): void;
  export const Fragment: any;
  export const StrictMode: any;
  const React: any;
  export default React;
}
declare module "react/jsx-runtime" {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}
declare module "react-dom/client" {
  export function createRoot(el: Element): { render(n: any): void };
}
declare module "react-dom" {
  export function createPortal(children: any, container: Element): any;
  export function flushSync(fn: () => void): void;
}
declare namespace JSX {
  interface IntrinsicElements { [k: string]: any }
  interface Element { }
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicAttributes { key?: any }
}
declare module "@headlessui/react" {
  export const Dialog: any, DialogPanel: any, DialogBackdrop: any, DialogTitle: any, Description: any;
  export const Menu: any, MenuButton: any, MenuItems: any, MenuItem: any, MenuSeparator: any, MenuHeading: any, MenuSection: any;
  export const Popover: any, PopoverButton: any, PopoverPanel: any;
  export const Listbox: any, ListboxButton: any, ListboxOptions: any, ListboxOption: any;
  export const Switch: any, Field: any, Label: any;
  export const Transition: any, TransitionChild: any;
  export const Tab: any, TabGroup: any, TabList: any, TabPanels: any, TabPanel: any;
  export const CloseButton: any;
}
declare module "@floating-ui/react" {
  export const useFloating: any, useHover: any, useFocus: any, useDismiss: any, useRole: any, useInteractions: any;
  export const FloatingPortal: any, offset: any, flip: any, shift: any, autoUpdate: any, safePolygon: any;
}
