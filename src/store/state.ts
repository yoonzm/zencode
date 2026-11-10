import { migrateProjectPrompt } from "@/data/project-prompt";
import { createStore, useStore } from "@/lib/store";
import type { AppConfig, Priority, RunState, ZTask } from "@/data/types";
import { STATE_LABEL } from "@/data/types";
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
  busy?: boolean;
  busyLabel?: string;
  progress?: string;
  error?: string;
  onConfirm: () => void | Promise<void>;
}

export interface Notify {
  done: boolean;
  approval: boolean;
  failed: boolean;
  sound: boolean;
}

export interface Feishu {
  enabled: boolean;
  webhook: string;
  secret: string;
  attention: boolean;
  result: boolean;
}

export interface ReportCfg {
  enabled: boolean;
  /** HH:mm */
  time: string;
  /** 周报在周几发，1 = 周一 … 7 = 周日 */
  weekday: number;
  prompt: string;
  /** 开启的时间，只发开启之后才到点的那一次 */
  since?: number;
}
export interface ReportLog {
  id: string;
  kind: "daily" | "weekly";
  at: number;
  /** 日期标识，防止同一天重复发 */
  key?: string;
  manual: boolean;
  items: string[];
  stats: string;
  /** sent：已发到飞书；skipped：这段时间没有进展 */
  result: "sent" | "skipped";
}
export interface Reports {
  daily: ReportCfg;
  weekly: ReportCfg;
  log: ReportLog[];
}

export interface Prefs {
  theme: ThemePref;
  density: "comfortable" | "compact";
  sidebarOpen: boolean;
  listWidth: number;
  group: "state" | "none";
  sort: "updated" | "priority" | "deadline";
  filters: Filters;
  collapsedGroups: Record<string, boolean>;
  setupDone: boolean;
  notify: Notify;
  feishu: Feishu;
  reports: Reports;
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
  listStatus: ListStatus;
  syncError?: string;
  syncing: boolean;
  lastSync: number;
  lastSyncAttempt: number;
  importOpen: boolean;
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
  filters: EMPTY_FILTERS,
  collapsedGroups: { completed: true },
  setupDone: false,
  notify: { done: true, approval: true, failed: true, sound: false },
  feishu: { enabled: false, webhook: "", secret: "", attention: true, result: true },
  reports: {
    daily: { enabled: false, time: "18:00", weekday: 5, prompt: "根据今天的任务进展写日报，2 到 5 条，每条一句话：做了什么、结果如何。有失败或卡住的单独写一条。" },
    weekly: { enabled: false, time: "18:00", weekday: 5, prompt: "根据本周的任务进展写周报，2 到 5 条，按重要程度排序，合并同类项，每条一句话。最后一条写下周计划，没有就不写。" },
    log: [],
  },
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
  listStatus: "loading",
  syncing: false,
  lastSync: 0,
  lastSyncAttempt: 0,
  importOpen: false,
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
const PERSIST_KEYS: (keyof Prefs)[] = ["theme", "density", "sidebarOpen", "listWidth", "group", "sort", "filters", "collapsedGroups", "setupDone", "notify", "feishu", "reports", "cleanupDays", "autoUpdate", "channel", "config"];
let lastPersisted = "";
let hydrated = false;
export async function hydrate() {
  const data = await desktopCall("load");
  // Only supported preferences are restored; obsolete prototype platform overrides are ignored.
  const prefs = Object.fromEntries(PERSIST_KEYS.filter(k => k in (data.prefs ?? {})).map(k => [k, data.prefs[k]]));
  const filters = prefs.filters ?? {};
  prefs.filters = {
    kind: ["all", "bug", "story"].includes(filters.kind) ? filters.kind : "all",
    states: Array.isArray(filters.states) ? filters.states.filter((s: unknown) => typeof s === "string" && Object.hasOwn(STATE_LABEL, s)) : [],
    priorities: Array.isArray(filters.priorities) ? filters.priorities.filter((p: unknown) => typeof p === "number" && [1, 2, 3, 4].includes(p)) : [],
    assignee: filters.assignee === "me" ? "me" : "all",
    products: Array.isArray(filters.products) ? filters.products.filter((p: unknown) => typeof p === "string") : [],
    query: typeof filters.query === "string" ? filters.query : "",
  };
  prefs.collapsedGroups = { ...defaultPrefs.collapsedGroups, ...Object.fromEntries(
    Object.entries(prefs.collapsedGroups ?? {}).filter(([state, collapsed]) => Object.hasOwn(STATE_LABEL, state) && typeof collapsed === "boolean"),
  ) };
  if (prefs.config?.gitlab) {
    const g = prefs.config.gitlab;
    prefs.config = { ...prefs.config, gitlab: { ...g, mrMode: ["manual", "auto-create", "auto-merge"].includes(g.mrMode) ? g.mrMode : "manual", mrDraft: g.mrMode ? !!g.mrDraft : false } };
    delete (prefs.config.gitlab as any).targetBranch;
  }
  prefs.feishu = { ...defaultPrefs.feishu, ...(prefs.feishu ?? {}) };
  prefs.reports = { daily: { ...defaultPrefs.reports.daily, ...prefs.reports?.daily }, weekly: { ...defaultPrefs.reports.weekly, ...prefs.reports?.weekly }, log: prefs.reports?.log ?? [] };
  prefs.cleanupDays = [7, 30, 60, 90].includes(prefs.cleanupDays) ? prefs.cleanupDays : 30;
  prefs.autoUpdate = prefs.autoUpdate !== false;
  prefs.channel = prefs.channel === "beta" ? "beta" : "stable";
  const config = prefs.config ?? defaultPrefs.config;
  prefs.config = { ...config, codex: { ...defaultPrefs.config.codex, ...config.codex }, mappings: (config.mappings ?? []).map((m: any) => migrateProjectPrompt(m.repos ? m : ({ id: m.id, product: m.product, projectPrompt: m.projectPrompt, verify: m.verify, repos: [{ id: `${m.id}-repo`, repo: m.repo ?? "", branch: m.branch ?? "", role: "", testCmd: m.testCmd ?? "" }] }))), zentao: { ...config.zentao, syncIntervalMin: config.zentao?.syncIntervalMin ?? 5, autoRun: config.zentao?.autoRun ?? true } };
  prefs.config.zentao.syncKind = ["bug", "story"].includes(config.zentao?.syncKind ?? "") ? config.zentao.syncKind : "all";
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
