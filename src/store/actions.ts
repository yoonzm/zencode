import { store, applyTheme, applyPlatform, EMPTY_FILTERS, type Filters, type ThemePref, type ListStatus } from "./state";
import { toast } from "./toast";
import { getTask, schedule, updateTask, taskLabel } from "@/engine/sim";
import { applyStep } from "@/engine/run";
import { followupSteps, genericScript } from "@/data/scripts";
import { emptyRun } from "@/engine/run";
import type { Run, ZTask } from "@/data/types";
import { sleep, uid } from "@/lib/utils";
import { resolvePlatform, type PlatformPref } from "@/lib/platform";
import { navigate } from "@/lib/route";
import { createInitialTasks } from "@/data/mock";

const simNote = "演示数据 · 未连接真实服务";

// ── 偏好 ─────────────────────────────────────────────────
export function setTheme(t: ThemePref) {
  store.set({ theme: t });
  applyTheme(t);
}
export function setPlatformPref(p: PlatformPref) {
  const platform = resolvePlatform(p);
  store.set({ platformPref: p, platform });
  applyPlatform(platform);
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
export function setListStatus(status: ListStatus) {
  store.set({ listStatus: status });
}

export async function sync(opts: { fail?: boolean } = {}) {
  const s0 = store.get();
  if (s0.syncing) return;
  const hadList = s0.listStatus === "ready";
  store.set({ syncing: true, listStatus: hadList ? "ready" : "loading" });
  await sleep(opts.fail ? 1100 : 900);
  if (opts.fail) {
    store.set({ syncing: false, listStatus: "error" });
    return;
  }
  const n = 1 + Math.floor(Math.random() * 3);
  store.set({ syncing: false, listStatus: "ready", lastSync: Date.now() });
  if (hadList) toast({ title: "已从禅道同步", desc: `更新 ${n} 项，没有新增冲突 · ${simNote}`, sim: true, duration: 3200 });
}

/** 把模拟数据恢复到初始（含执行中的任务），用于「重置演示」 */
export function resetDemo() {
  store.set({ tasks: createInitialTasks(), filters: EMPTY_FILTERS, listStatus: "ready" });
  toast({ title: "已重置演示数据", tone: "info" });
}

// ── 任务执行（全部为模拟） ────────────────────────────────
function userEv(text: string, ref?: string) {
  return { delay: 0, ev: { kind: "user" as const, text, ref } };
}

export function freshIdleRun(t: ZTask) {
  const script = genericScript(t);
  return { ...emptyRun(), scriptId: script.id, branch: script.branch, patchKeys: script.patches, queue: script.steps, end: script.end };
}

export function startRun(id: string, instruction?: string, ref?: string) {
  const t = getTask(id);
  if (!t) return;
  if (["running", "queued", "waiting", "paused"].includes(t.run.state)) return;
  const now = Date.now();
  const base = t.run.state === "idle" ? t.run : freshIdleRun(t);
  let run: Run = { ...base, state: "queued", startedAt: now, finishedAt: undefined, events: [], files: [], viewed: [], mr: undefined, unread: false, model: store.get().config.codex.model };
  if (instruction) run = applyStep(run, userEv(instruction, ref), now);
  updateTask(id, (x) => ({
    ...x,
    updatedAt: now,
    run,
    history: [...x.history, { at: now, who: "ZenCode", text: `已交给 Codex 执行（${run.branch}）` }],
  }));
  toast({ title: `${taskLabel(t)} 已交给 Codex`, desc: `已加入执行队列 · 已在禅道追加备注 · ${simNote}`, sim: true });
}

export function pauseRun(id: string) {
  const t = getTask(id);
  if (!t || t.run.state !== "running") return;
  const now = Date.now();
  updateTask(id, (x) => ({
    ...x,
    updatedAt: now,
    run: applyStep({ ...x.run, state: "paused" }, { delay: 0, ev: { kind: "system", text: "已暂停，进度已保留。恢复后从当前步骤继续", tone: "warn" } }, now),
  }));
  toast({ title: "已暂停", desc: `${taskLabel(t)} 的 Codex 会话已挂起 · ${simNote}`, tone: "info", sim: true, duration: 3000 });
}

export function resumeRun(id: string) {
  const t = getTask(id);
  if (!t || t.run.state !== "paused") return;
  const now = Date.now();
  updateTask(id, (x) => ({
    ...x,
    updatedAt: now,
    run: applyStep({ ...x.run, state: "running" }, { delay: 0, ev: { kind: "system", text: "已恢复执行", tone: "info" } }, now),
  }));
  schedule(id, 900);
  toast({ title: "已恢复执行", desc: taskLabel(t), tone: "info", sim: true, duration: 2600 });
}

export function stopRun(id: string) {
  const t = getTask(id);
  if (!t) return;
  askConfirm({
    title: "终止并丢弃本次执行？",
    desc: `${taskLabel(t)} 的 Codex 会话会被终止，分支 ${t.run.branch ?? ""} 上的改动和执行记录会被丢弃，任务回到「待处理」。此操作不可撤销。`,
    confirmLabel: "终止并丢弃",
    danger: true,
    onConfirm: () => {
      updateTask(id, (x) => ({ ...x, updatedAt: Date.now(), run: freshIdleRun(x), history: [...x.history, { at: Date.now(), who: "ZenCode", text: "已终止 Codex 执行并丢弃改动" }] }));
      toast({ title: "已终止并丢弃", desc: `${taskLabel(t)} 回到待处理 · ${simNote}`, tone: "info", sim: true });
    },
  });
}

export function retryRun(id: string) {
  const t = getTask(id);
  if (!t || t.run.state !== "failed") return;
  const now = Date.now();
  const run = t.run;
  const steps = run.retry ?? [];
  if (!steps.length) {
    startRun(id);
    return;
  }
  updateTask(id, (x) => ({ ...x, updatedAt: now, run: { ...x.run, state: "running", queue: steps, end: "review", finishedAt: undefined, retry: undefined } }));
  schedule(id, 700);
  toast({ title: "正在重试", desc: `${taskLabel(t)} · ${simNote}`, tone: "info", sim: true, duration: 2800 });
}

export function decideApproval(id: string, evId: string, decision: "once" | "always" | "deny") {
  const t = getTask(id);
  if (!t) return;
  const now = Date.now();
  updateTask(id, (x) => {
    const events = x.run.events.map((e) => (e.id === evId && e.kind === "approval" ? { ...e, decision } : e));
    let run: Run = { ...x.run, events, state: "running" };
    if (decision === "deny") {
      run = { ...run, queue: run.queue.filter((s) => !s.onlyIfApproved) };
      run = applyStep(run, { delay: 0, ev: { kind: "message", text: "好的，已跳过这条命令，继续完成其余步骤。" } }, now);
    }
    return { ...x, updatedAt: now, run };
  });
  schedule(id, 900);
  toast({
    title: decision === "deny" ? "已拒绝该命令" : decision === "always" ? "已允许，并记住此类命令" : "已允许一次",
    desc: simNote,
    tone: decision === "deny" ? "info" : "success",
    sim: true,
    duration: 2800,
  });
}

export function sendInstruction(id: string, text: string, ref?: string) {
  const t = getTask(id);
  const body = text.trim();
  if (!t || !body) return;
  const now = Date.now();
  const st = t.run.state;
  if (st === "idle") {
    startRun(id, body, ref);
    return;
  }
  if (st === "queued") {
    updateTask(id, (x) => ({ ...x, updatedAt: now, run: applyStep(x.run, userEv(body, ref), now) }));
    toast({ title: "已追加指令", desc: "开始执行时一并带上", sim: true, tone: "info", duration: 2600 });
    return;
  }
  const first = t.run.files[0]?.path;
  const fu = followupSteps(body, first);
  updateTask(id, (x) => {
    let run = applyStep(x.run, userEv(body, ref), now);
    run = { ...run, patchKeys: { ...run.patchKeys, ...fu.patches }, unread: false };
    if (st === "running" || st === "paused" || st === "waiting") {
      // 追加步骤插在剩余步骤之前；去掉它自带的终态，避免提前结束
      run = { ...run, queue: [...fu.steps.map((s) => ({ ...s, endState: undefined })), ...run.queue] };
    } else {
      // 已完成 / 已提交 / 失败：以追加指令再跑一轮
      run = { ...run, state: "running", finishedAt: undefined, queue: [...(st === "failed" ? run.retry ?? [] : []), ...fu.steps], end: "review", retry: undefined };
    }
    return { ...x, updatedAt: now, run };
  });
  if (st === "review" || st === "done" || st === "failed") schedule(id, 700);
  toast({
    title: st === "paused" ? "已追加指令，恢复后处理" : "已追加指令",
    desc: st === "running" || st === "waiting" ? `Codex 会在当前步骤完成后处理 · ${simNote}` : simNote,
    tone: "info",
    sim: true,
    duration: 3000,
  });
}

export async function createMr(id: string) {
  const t = getTask(id);
  if (!t || t.run.state !== "review" || t.run.mrBusy) return;
  updateTask(id, (x) => ({ ...x, run: { ...x.run, mrBusy: true } }));
  await sleep(1500);
  const cur = getTask(id);
  if (!cur) return;
  const iid = 474 + Math.floor(Math.random() * 40);
  const map = store.get().config.mappings.find((m) => m.product === cur.product);
  const target = map?.branch ?? store.get().config.gitlab.targetBranch;
  const zt = cur.kind === "bug" ? "已解决" : "已完成";
  const now = Date.now();
  updateTask(id, (x) => {
    let run = applyStep({ ...x.run, mrBusy: false }, { delay: 0, ev: { kind: "system", text: `已创建 Merge Request !${iid}：${x.run.branch} → ${target}`, tone: "success" } }, now);
    run = applyStep(run, { delay: 0, ev: { kind: "system", text: `已回写禅道：状态 → ${zt}，并附上 MR 链接`, tone: "success" } }, now + 1);
    run = { ...run, state: "done", finishedAt: now, mr: { iid, url: `https://gitlab.acme.cn/${x.repoId}/-/merge_requests/${iid}` } };
    return { ...x, updatedAt: now, ztStatus: zt, run, history: [...x.history, { at: now, who: "ZenCode", text: `创建 MR !${iid}，状态 → ${zt}` }] };
  });
  toast({
    title: `已创建 Merge Request !${iid}`,
    desc: `${cur.run.branch} → ${target}${store.get().config.gitlab.mrDraft ? "（草稿）" : ""} · 已回写禅道：${zt} · ${simNote}`,
    sim: true,
    duration: 6000,
    action: { label: "在 GitLab 打开", run: () => toast({ title: "这里是演示", desc: "正式版会在浏览器中打开 GitLab 的 MR 页面。", tone: "info" }) },
  });
}

export function markViewed(id: string, path: string, viewed: boolean) {
  updateTask(id, (x) => {
    const set = new Set(x.run.viewed);
    viewed ? set.add(path) : set.delete(path);
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
