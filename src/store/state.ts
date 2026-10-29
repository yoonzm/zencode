import { createStore, useStore } from "@/lib/store";
import type { AppConfig, Priority, RunState, ZTask } from "@/data/types";
import { DEFAULT_CONFIG } from "@/data/defaults";
import { desktopCall } from "@/lib/desktop";
import { loadJSON, saveJSON } from "@/lib/utils";
import { detectPlatform, type Platform } from "@/lib/platform";

export type ThemePref = "light" | "dark" | "system";
export type ListStatus = "ready" | "loading" | "error" | "empty";

export interface Filters {
  kind: "all" | "bug" | "story";
  states: RunState[];
  priorities: Priority[];
  assignee: "all" | "me";
  products: string[];
  query: string;
}
export const EMPTY_FILTERS: Filters = { kind: "all", states: [], priorities: [], assignee: "all", products: [], query: "" };

export interface Toast {
  id: string;
  title: string;
  desc?: string;
  tone: "success" | "info" | "warn" | "danger";
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
  density: "comfortable" | "compact";
  sidebarOpen: boolean;
  listWidth: number;
  group: "state" | "none";
  sort: "updated" | "priority" | "deadline";
  setupDone: boolean;
  notify: Notify;
  cleanupDays: number;
  autoUpdate: boolean;
  channel: "stable" | "beta";
  config: AppConfig;
}

export interface AppState extends Prefs {
  hydrated: boolean;
  appVersion: string;
  update: UpdateState;
  tasks: ZTask[];
  filters: Filters;
  listStatus: ListStatus;
  syncError?: string;
  syncing: boolean;
  lastSync: number;
  lastSyncAttempt: number;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  toasts: Toast[];
  confirm: ConfirmReq | null;
  platform: Platform;
  prefill: { text: string; ref?: string; nonce: number } | null;
  diffFocus: { taskId: string; path: string; nonce: number } | null;
  tab: "run" | "diff" | "verify" | "zentao";
}

export interface UpdateState {
  status: "idle" | "checking" | "latest" | "available" | "downloading" | "ready" | "installing" | "error";
  version?: string;
  notes?: string;
  progress?: number | null;
  checkedAt?: number;
  error?: string;
  dismissed?: boolean;
}

const PREF_KEY = "zencode.prefs.v1";

const defaultPrefs: Prefs = {
  theme: "system",
  density: "compact",
  sidebarOpen: true,
  listWidth: 448,
  group: "state",
  sort: "updated",
  setupDone: false,
  notify: { done: true, approval: true, failed: true, sound: false },
  cleanupDays: 30,
  autoUpdate: true,
  channel: "stable",
  config: DEFAULT_CONFIG,
};

const saved = defaultPrefs;

export const store = createStore<AppState>({
  ...defaultPrefs,
  ...saved,
  hydrated: false,
  appVersion: "",
  update: { status: "idle" },
  notify: { ...defaultPrefs.notify, ...(saved.notify ?? {}) },
  config: { ...defaultPrefs.config, ...(saved.config ?? {}) },
  tasks: [],
  filters: EMPTY_FILTERS,
  listStatus: "loading",
  syncing: false,
  lastSync: 0,
  lastSyncAttempt: 0,
  paletteOpen: false,
  shortcutsOpen: false,
  toasts: [],
  confirm: null,
  platform: detectPlatform(),
  prefill: null,
  diffFocus: null,
  tab: "run",
});

export function useApp<S>(selector: (s: AppState) => S): S {
  return useStore(store, selector);
}

// ── 持久化 ────────────────────────────────────────────────
const PERSIST_KEYS: (keyof Prefs)[] = ["theme", "density", "sidebarOpen", "listWidth", "group", "sort", "setupDone", "notify", "cleanupDays", "autoUpdate", "channel", "config"];
let lastPersisted = "";
let hydrated = false;
export async function hydrate() {
  const data = await desktopCall("load");
  // Only supported preferences are restored; obsolete prototype platform overrides are ignored.
  const prefs = Object.fromEntries(PERSIST_KEYS.filter(k => k in (data.prefs ?? {})).map(k => [k, data.prefs[k]]));
  prefs.cleanupDays = [7, 30, 60, 90].includes(prefs.cleanupDays) ? prefs.cleanupDays : 30;
  prefs.autoUpdate = prefs.autoUpdate !== false;
  prefs.channel = prefs.channel === "beta" ? "beta" : "stable";
  const config = prefs.config ?? defaultPrefs.config;
  prefs.config = { ...config, mappings: (config.mappings ?? []).map((m: any) => m.repos ? m : ({ id: m.id, product: m.product, repos: [{ id: `${m.id}-repo`, repo: m.repo ?? "", branch: m.branch ?? "", role: "", testCmd: m.testCmd ?? "" }] })), zentao: { ...config.zentao, syncIntervalMin: config.zentao?.syncIntervalMin ?? 5, autoRun: config.zentao?.autoRun ?? true } };
  const platform: Platform = data.platform === "mac" || data.platform === "win" ? data.platform : detectPlatform();
  store.set({ ...prefs, platform, tasks: data.tasks, listStatus: data.tasks.length ? "ready" : "empty", syncError: undefined });
  applyTheme(store.get().theme); applyPlatform(platform);
  localStorage.removeItem(PREF_KEY);
  store.set({ hydrated: true });
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
