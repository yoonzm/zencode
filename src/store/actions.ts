import { flushPrefs, store, applyTheme, EMPTY_FILTERS, type Filters, type ThemePref } from "./state";
import { toast } from "./toast";
import { getTask, updateTask } from "@/engine/tasks";
import type { Run, ZTask } from "@/data/types";
import { sleep, uid } from "@/lib/utils";
import { navigate } from "@/lib/route";
import { desktopCall } from "@/lib/desktop";
import { parsePatch } from "@/lib/diff";


// ── 偏好 ─────────────────────────────────────────────────
export function setTheme(t: ThemePref) {
  store.set({ theme: t });
  applyTheme(t);
}
export function cycleTheme() {
  const cur = store.get().theme;
  setTheme(cur === "light" ? "dark" : cur === "dark" ? "system" : "light");
}
export function toggleSidebar() {
  store.set((s) => ({ sidebarOpen: !s.sidebarOpen }));
}
export function setPalette(open: boolean) {
  store.set({ paletteOpen: open });
}
export function setShortcuts(open: boolean) {
  store.set({ shortcutsOpen: open });
}

export function askConfirm(c: NonNullable<ReturnType<typeof store.get>["confirm"]>) {
  if (store.get().confirm?.busy) return;
  store.set({ confirm: c });
}
export function closeConfirm() {
  if (store.get().confirm?.busy) return;
  store.set({ confirm: null });
}
export async function runConfirm() {
  const c = store.get().confirm;
  if (!c || c.busy) return;
  store.set({ confirm: { ...c, busy: true, error: undefined } });
  try {
    await c.onConfirm();
    store.set({ confirm: null });
  } catch (e) {
    store.set({ confirm: { ...c, error: e instanceof Error ? e.message : String(e) } });
  }
}

// ── 列表 ─────────────────────────────────────────────────
export function setFilters(patch: Partial<Filters>) {
  store.set((s) => ({ filters: { ...s.filters, ...patch } }));
}
export function resetFilters() {
  store.set({ filters: EMPTY_FILTERS });
}
let taskRevision = 0;
export async function sync(opts: { auto?: boolean } = {}) {
  if (store.get().syncing || cleaning) return;
  const revision = taskRevision;
  store.set({ syncing: true, lastSyncAttempt: Date.now(), syncError: undefined, ...(!opts.auto && store.get().tasks.length === 0 ? { listStatus: "loading" as const } : {}) });
  try {
    const tasks = await desktopCall("sync", { config: store.get().config });
    if (revision === taskRevision) store.set({ tasks: tasks.map(decodeTask), lastSync: Date.now(), listStatus: tasks.length ? "ready" : "empty" });
  }
  catch (e) {
    if (!opts.auto) report(e);
    store.set({ ...(!opts.auto ? { listStatus: "error" as const } : {}), syncError: e instanceof Error ? e.message : String(e) });
  }
  finally { store.set({ syncing: false }); }
}
function report(e: unknown) { toast({ title: "操作未完成", desc: e instanceof Error ? e.message : String(e), tone: "danger", duration: 8000 }); }
export const cleanable = (t: ZTask) => t.run.state === "done" && !t.run.cleaned;
let cleaning = false;
async function cleanup(mode: "auto" | "done" | "clear", products: string[] | "all" = "all", days = 30) {
  if (cleaning || (mode === "auto" && (store.get().syncing || store.get().listStatus === "loading" || location.hash === "#setup"))) return false;
  cleaning = true;
  taskRevision++;
  try {
    const result = await desktopCall("cleanup", { mode, products, days });
    if (result.count || mode !== "auto") store.set({ tasks: result.tasks.map(decodeTask), listStatus: result.tasks.length ? "ready" : "empty" });
    if (location.hash.startsWith("#task-") && !result.tasks.some((t: ZTask) => `#task-${t.id}` === location.hash)) navigate({ name: "tasks" });
    if (result.count || mode !== "auto") toast({ title: result.count ? `已清理 ${result.count} 个任务的数据` : "没有可清理的数据", tone: "success" });
    return true;
  } catch (e) { report(e); return false; }
  finally { cleaning = false; }
}
export function autoCleanup(days: number) { return cleanup("auto", "all", days); }
export function cleanDoneRuns() { return cleanup("done"); }
export function applyClear(products: string[] | "all") { return cleanup("clear", products); }
export function describeClear(products: string[] | "all") {
  const tasks = store.get().tasks.filter(t => products === "all" || products.includes(t.product));
  const active = tasks.filter(t => ["queued", "running", "waiting", "stopped"].includes(t.run.state)).length;
  return { count: tasks.length, notes: [
    "禅道里的任务不受影响，下次同步会作为新任务重新出现。手动新增的任务删除后无法通过同步找回。",
    active ? `其中 ${active} 个正在进行的任务会被终止。` : "",
    tasks.some(t => t.run.mr) ? "GitLab 上的 MR 保留，本地会失去对应关系。" : "",
    (store.get().config.zentao.autoRun ?? true) ? "同步后自动执行已开启，手动清除的任务重新同步后会自动执行。" : "",
  ].filter(Boolean) };
}
function runCall(op: string, args: object) { return desktopCall(op, { ...args, config: store.get().config }).catch(report); }
export function startRun(id: string, instruction?: string, ref?: string) { void runCall("start", { id, instruction: [ref, instruction].filter(Boolean).join("\n") }); }
export function stopRun(id: string) { void runCall("pause", { id }); }
export function continueRun(id: string) { startRun(id); }
function openWorkdir(id: string, opts: object) {
  const open = () => { void desktopCall("openWorkdir", { id, ...opts }).catch(report); };
  if (["running", "waiting", "queued"].includes(getTask(id)?.run.state ?? "")) {
    askConfirm({ title: "Codex 正在执行", desc: "现在编辑文件可能与 Codex 的改动互相覆盖，建议先停止任务。", confirmLabel: "仍要打开", onConfirm: open });
  } else open();
}
export function openInEditor(id: string, opts: { repo?: string; file?: string; line?: number } = {}) { openWorkdir(id, { ...opts, editor: true }); }
export function openFolder(id: string, repo?: string) { openWorkdir(id, { repo }); }
export function refreshDiff(id: string) { void desktopCall("refreshDiff", { id }).catch(report); }
export function deleteTask(id: string) {
  const task = getTask(id);
  if (!task) return;
  askConfirm({
    title: "删除这个任务？",
    desc: task.manual ? `${task.title} 是手动新增的，删除后无法通过同步找回。正在进行的执行会被终止，执行记录、独立工作区及其中的本地分支和未提交修改将一并删除，无法撤销。` : `${task.title} 将从 ZenCode 中删除，禅道中的任务不受影响。正在进行的执行会被终止，执行记录、独立工作区及其中的本地分支和未提交修改将一并删除，无法撤销。下次同步时此任务将从头开始。`,
    confirmLabel: "删除",
    busyLabel: "正在删除…",
    danger: true,
    onConfirm: async () => {
      const progress = (message: string) => store.set(s => ({ confirm: s.confirm ? { ...s.confirm, progress: message } : null }));
      progress("正在提交删除请求…");
      let off: (() => void) | undefined;
      try {
        off = await window.desktop?.onDeleteProgress?.(event => { if (event.id === id) progress(event.message); });
        const result = await desktopCall("delete", { id });
        taskRevision++;
        store.set(s => {
          const tasks = s.tasks.filter(t => t.id !== id);
          return { tasks, listStatus: tasks.length ? "ready" : "empty" };
        });
        if (location.hash === `#task-${id}`) navigate({ name: "tasks" });
        toast({ title: "任务已移除", desc: [result?.cleanupPending ? "文件正在后台清理。" : "", task.manual ? "" : "下次同步会从禅道重新拉回，并从头开始。"].join(""), tone: "info", ...(!task.manual ? { action: { label: "立即同步", run: () => { void sync(); } } } : {}) });
      } finally { off?.(); }
    },
  });
}
export function retryRun(id: string) { startRun(id); }
export function decideApproval(id: string, evId: string, decision: "once" | "always" | "deny") { void runCall("approve", { id, evId, decision }); }
export async function sendInstruction(id: string, text: string, ref?: string) {
  try {
    await desktopCall("start", { id, config: store.get().config, instruction: [ref, text].filter(Boolean).join("\n") });
    return true;
  } catch (e) { report(e); return false; }
}
export function createMr(id: string) { return runCall("mr", { id }); }
export function openExternal(url: string) { void desktopCall("open", { url }).catch(report); }
export function decodeTask(t: ZTask): ZTask {
  if ((t.run.state as string) === "paused") t.run.state = "stopped";
  if (!t.manual) t.description = t.description.map(b => b.text ? { ...b, text: new DOMParser().parseFromString(b.text, "text/html").body.textContent || "" } : b);
  const raw = (t.run as any).rawDiff as string | undefined;
  if (raw != null) t.run.files = raw.split(/^diff --git /m).slice(1).map(part => {
    const lines = part.split("\n");
    const plus = lines.find(l => l.startsWith("+++ b/"));
    const minus = lines.find(l => l.startsWith("--- a/"));
    const header = lines[0];
    const path = plus || minus ? (plus || minus)!.slice(6).replace(/\t.*$/, "") : header.slice(header.lastIndexOf(" b/") + 3);
    return { ...parsePatch(path, part.includes("new file mode") ? "added" : "modified", part), manual: ((t.run as any).manualFiles ?? []).includes(path) };
  });
  t.run.files = (t.run.files ?? []).filter(f => f.path !== ".verification" && !f.path.startsWith(".verification/"));
  return t;
}

export function markViewed(id: string, path: string, viewed: boolean) {
  updateTask(id, (x) => {
    const set = new Set(x.run.viewed);
    viewed ? set.add(path) : set.delete(path);
    void desktopCall("viewed", { id, paths: [...set] }).catch(report);
    return { ...x, run: { ...x.run, viewed: [...set] } };
  });
}

export function clearUnread(id: string) {
  const t = getTask(id);
  if (t?.run.unread) updateTask(id, (x) => ({ ...x, run: { ...x.run, unread: false } }));
}

/** 从 Diff 行发起追加指令：预填输入框并带上位置引用 */
export function quoteLine(path: string, line: number, text: string) {
  store.set({ prefill: { text: "", ref: `${path}:${line}`, nonce: Date.now() }, tab: store.get().tab });
  toast({ title: "已引用代码位置", desc: `${path}:${line} · 在下方输入框写下要求`, tone: "info", duration: 2400 });
  void text;
}

export function openTask(id: string, tab?: "run" | "diff" | "verify" | "zentao") {
  navigate({ name: "task", id });
  if (tab) store.set({ tab });
}

export function setTab(tab: "run" | "diff" | "verify" | "zentao") {
  store.set({ tab });
}

export function focusDiffFile(taskId: string, path: string) {
  store.set({ tab: "diff", diffFocus: { taskId, path, nonce: Date.now() } });
}

export const newId = uid;

export function decideVerify(id: string, go: boolean) { void runCall("verifyDecision", { id, go }); }
export function reverify(id: string) { void runCall("reverify", { id }); }

export const setImportOpen = (open: boolean) => store.set({ importOpen: open });
export async function importManual(cands: import("@/data/parse").Candidate[], source: string) {
  await flushPrefs();
  const made: ZTask[] = await desktopCall("importManual", { candidates: cands, source });
  taskRevision++;
  store.set(s => ({ tasks: [...made.map(decodeTask), ...s.tasks.filter(t => !made.some(m => m.id === t.id))], listStatus: "ready", importOpen: false }));
  toast({ title: `已导入 ${made.length} 个任务`, desc: "在待处理里，需要你手动交给 Codex", tone: "success" });
}
