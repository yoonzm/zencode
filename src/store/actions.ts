import { store, applyTheme, EMPTY_FILTERS, type Filters, type ThemePref } from "./state";
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
  store.set({ confirm: c });
}
export function closeConfirm() {
  store.set({ confirm: null });
}

// ── 列表 ─────────────────────────────────────────────────
export function setFilters(patch: Partial<Filters>) {
  store.set((s) => ({ filters: { ...s.filters, ...patch } }));
}
export function resetFilters() {
  store.set({ filters: EMPTY_FILTERS });
}
export async function sync() {
  if (store.get().syncing) return;
  store.set({ syncing: true, syncError: undefined, ...(store.get().tasks.length === 0 ? { listStatus: "loading" as const } : {}) });
  try { const tasks = await desktopCall("sync", { config: store.get().config }); store.set({ tasks: tasks.map(decodeTask), lastSync: Date.now(), listStatus: tasks.length ? "ready" : "empty" }); }
  catch (e) { report(e); store.set({ listStatus: "error", syncError: e instanceof Error ? e.message : String(e) }); }
  finally { store.set({ syncing: false }); }
}
function report(e: unknown) { toast({ title: "操作未完成", desc: e instanceof Error ? e.message : String(e), tone: "danger", duration: 8000 }); }
function runCall(op: string, args: object) { return desktopCall(op, { ...args, config: store.get().config }).catch(report); }
export function startRun(id: string, instruction?: string, ref?: string) { void runCall("start", { id, instruction: [ref, instruction].filter(Boolean).join("\n") }); }
export function pauseRun(id: string) { void runCall("pause", { id }); }
export function resumeRun(id: string) { startRun(id); }
export function stopRun(id: string) { askConfirm({ title: "终止本次执行？", desc: "终止 Codex 进程，保留独立工作区、改动和执行记录。", confirmLabel: "终止执行", danger: true, onConfirm: () => { void runCall("stop", { id }); } }); }
export function retryRun(id: string) { startRun(id); }
export function decideApproval(id: string, evId: string, decision: "once" | "always" | "deny") { void runCall("approve", { id, evId, decision }); }
export function sendInstruction(id: string, text: string, ref?: string) { startRun(id, text, ref); }
export function createMr(id: string) { return runCall("mr", { id }); }
export function openExternal(url: string) { void desktopCall("open", { url }).catch(report); }
export function decodeTask(t: ZTask): ZTask {
  t.description = t.description.map(b => b.text ? { ...b, text: new DOMParser().parseFromString(b.text, "text/html").body.textContent || "" } : b);
  const raw = (t.run as any).rawDiff as string | undefined;
  if (raw) t.run.files = raw.split(/^diff --git /m).slice(1).map(part => {
    const lines = part.split("\n");
    const plus = lines.find(l => l.startsWith("+++ b/"));
    const minus = lines.find(l => l.startsWith("--- a/"));
    const header = lines[0];
    const path = plus || minus ? (plus || minus)!.slice(6).replace(/\t.*$/, "") : header.slice(header.lastIndexOf(" b/") + 3);
    return parsePatch(path, part.includes("new file mode") ? "added" : "modified", part);
  });
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

export function openTask(id: string, tab?: "run" | "diff" | "zentao") {
  navigate({ name: "task", id });
  if (tab) store.set({ tab });
}

export function setTab(tab: "run" | "diff" | "zentao") {
  store.set({ tab });
}

export function focusDiffFile(taskId: string, path: string) {
  store.set({ tab: "diff", diffFocus: { taskId, path, nonce: Date.now() } });
}

export const newId = uid;
