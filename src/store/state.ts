import { createStore, useStore } from "@/lib/store";
import type { AppConfig, Priority, RunState, ZTask } from "@/data/types";
import { DEFAULT_CONFIG } from "@/data/defaults";
import { desktopCall } from "@/lib/desktop";
import { loadJSON, saveJSON } from "@/lib/utils";
import { resolvePlatform, type Platform, type PlatformPref } from "@/lib/platform";

export type ThemePref = "light" | "dark" | "system";
export type ListStatus = "ready" | "loading" | "error" | "empty";

export interface Filters {
  kind: "all" | "bug" | "story";
  states: RunState[];
  priorities: Priority[];
  assignee: "all" | "me";
  repos: string[];
  query: string;
}
export const EMPTY_FILTERS: Filters = { kind: "all", states: [], priorities: [], assignee: "all", repos: [], query: "" };

export interface Toast {
  id: string;
  title: string;
  desc?: string;
  tone: "success" | "info" | "warn" | "danger";
  sim?: boolean;
  action?: { label: string; run: () => void };
  duration: number;
}

export interface ConfirmReq {
  title: string;
  desc: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

export interface Notify {
  done: boolean;
  approval: boolean;
  failed: boolean;
  sound: boolean;
}

export interface Prefs {
  theme: ThemePref;
  platformPref: PlatformPref;
  density: "comfortable" | "compact";
  windowControls: boolean;
  sidebarOpen: boolean;
  listWidth: number;
  group: "state" | "none";
  sort: "updated" | "priority" | "deadline";
  setupDone: boolean;
  notify: Notify;
  config: AppConfig;
}

export interface AppState extends Prefs {
  tasks: ZTask[];
  filters: Filters;
  listStatus: ListStatus;
  syncing: boolean;
  lastSync: number;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  toasts: Toast[];
  confirm: ConfirmReq | null;
  platform: Platform;
  prefill: { text: string; ref?: string; nonce: number } | null;
  diffFocus: { taskId: string; path: string; nonce: number } | null;
  tab: "run" | "diff" | "zentao";
}

const PREF_KEY = "zencode.prefs.v1";

const defaultPrefs: Prefs = {
  theme: "system",
  platformPref: "auto",
  density: "compact",
  windowControls: true,
  sidebarOpen: true,
  listWidth: 448,
  group: "state",
  sort: "updated",
  setupDone: false,
  notify: { done: true, approval: true, failed: true, sound: false },
  config: DEFAULT_CONFIG,
};

const saved = defaultPrefs;

export const store = createStore<AppState>({
  ...defaultPrefs,
  ...saved,
  notify: { ...defaultPrefs.notify, ...(saved.notify ?? {}) },
  config: { ...defaultPrefs.config, ...(saved.config ?? {}) },
  tasks: [],
  filters: EMPTY_FILTERS,
  listStatus: "loading",
  syncing: false,
  lastSync: 0,
  paletteOpen: false,
  shortcutsOpen: false,
  toasts: [],
  confirm: null,
  platform: resolvePlatform(saved.platformPref ?? "auto"),
  prefill: null,
  diffFocus: null,
  tab: "run",
});

export function useApp<S>(selector: (s: AppState) => S): S {
  return useStore(store, selector);
}

// ── 持久化 ────────────────────────────────────────────────
const PERSIST_KEYS: (keyof Prefs)[] = ["theme", "platformPref", "density", "windowControls", "sidebarOpen", "listWidth", "group", "sort", "setupDone", "notify", "config"];
let lastPersisted = "";
let hydrated = false;
export async function hydrate() {
  const data = await desktopCall("load");
  store.set({ ...data.prefs, platform: resolvePlatform(data.prefs.platformPref ?? "auto"), tasks: data.tasks, listStatus: "ready" });
  applyTheme(store.get().theme); applyPlatform(resolvePlatform(store.get().platformPref));
  localStorage.removeItem(PREF_KEY);
  hydrated = true;
}
let saveQueue: Promise<unknown> = Promise.resolve();
let saveFailed = false;
export function flushPrefs(): Promise<unknown> {
  if (saveFailed) { lastPersisted = ""; persistCurrent(); }
  return saveQueue;
}
function persistCurrent() {
  if (!hydrated) return;
  const s = store.get();
  const slim: Record<string, unknown> = {};
  for (const k of PERSIST_KEYS) slim[k] = s[k];
  const json = JSON.stringify(slim);
  if (json !== lastPersisted) {
    lastPersisted = json;
    saveFailed = false;
    saveQueue = saveQueue.catch(() => {}).then(() => desktopCall("save", JSON.parse(json)));
    saveQueue.catch(e => { saveFailed = true; window.dispatchEvent(new CustomEvent("desktop-error", { detail: String(e) })); });
  }
}
store.subscribe(persistCurrent);

// ── 主题与平台 ────────────────────────────────────────────
// 宿主（Artifact 查看器）可能自己设置了 data-theme；「跟随系统」时恢复它。
const root = document.documentElement;
const hostTheme = root.getAttribute("data-theme");

export function applyTheme(t: ThemePref) {
  if (t === "system") {
    if (hostTheme) root.setAttribute("data-theme", hostTheme);
    else root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", t);
  }
}
export function applyPlatform(p: Platform) {
  root.setAttribute("data-platform", p);
}

applyTheme(store.get().theme);
applyPlatform(store.get().platform);

/** 解析当前实际生效的明暗（用于图标/预览） */
export function effectiveDark(): boolean {
  const attr = root.getAttribute("data-theme");
  if (attr) return attr === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
