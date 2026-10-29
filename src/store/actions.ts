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
  const active = tasks.filter(t => ["queued", "running", "waiting", "paused"].includes(t.run.state)).length;
  return { count: tasks.length, notes: [
    "禅道里的任务不受影响，下次同步会作为新任务重新出现。",
    active ? `其中 ${active} 个正在进行的任务会被终止。` : "",
    tasks.some(t => t.run.mr) ? "GitLab 上的 MR 保留，本地会失去对应关系。" : "",
    (store.get().config.zentao.autoRun ?? true) ? "同步后自动执行已开启，手动清除的任务重新同步后会自动执行。" : "",
  ].filter(Boolean) };
}
function runCall(op: string, args: object) { return desktopCall(op, { ...args, config: store.get().config }).catch(report); }
export function startRun(id: string, instruction?: string, ref?: string) { void runCall("start", { id, instruction: [ref, instruction].filter(Boolean).join("\n") }); }
export function pauseRun(id: string) { void runCall("pause", { id }); }
export function resumeRun(id: string) { startRun(id); }
export function stopRun(id: string) { askConfirm({ title: "终止本次执行？", desc: "终止 Codex 进程，保留独立工作区、改动和执行记录。", confirmLabel: "终止执行", danger: true, onConfirm: () => { void runCall("stop", { id }); } }); }
export function deleteTask(id: string) {
  const task = getTask(id);
  if (!task) return;
  askConfirm({
    title: "删除这个任务？",
    desc: `${task.title} 只会从 ZenCode 中删除，禅道中的任务不受影响。正在进行的执行会被终止，执行记录将从任务中移除。已有独立工作区和 Git 分支保留在磁盘，但不会复用；下次同步时此任务将从头开始。`,
    confirmLabel: "删除",
    danger: true,
    onConfirm: async () => {
      try {
        await desktopCall("delete", { id });
        taskRevision++;
        store.set(s => {
          const tasks = s.tasks.filter(t => t.id !== id);
          return { tasks, listStatus: tasks.length ? "ready" : "empty" };
        });
        if (location.hash === `#task-${id}`) navigate({ name: "tasks" });
        toast({ title: "已删除任务", desc: "下次同步会从禅道重新拉回，并从头开始。", tone: "info", action: { label: "立即同步", run: () => { void sync(); } } });
      } catch (e) { report(e); }
    },
  });
}
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
