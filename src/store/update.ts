import { listen } from "@tauri-apps/api/event";
import { desktopCall } from "@/lib/desktop";
import { store, flushPrefs, type UpdateState } from "./state";
import { askConfirm } from "./actions";
import { toast } from "./toast";

const set = (patch: Partial<UpdateState>) => store.set(s => ({ update: { ...s.update, ...patch } }));
let request = 0;
let operation = false;
let dismissedVersion: string | undefined;
export const updateBusy = () => operation;

export async function initUpdates() {
  const info = await desktopCall("updateInfo");
  store.set({ appVersion: info.version });
  await desktopCall("resumeAfterUpdate");
}

export async function checkUpdate(manual = false) {
  if (operation || ["ready", "installing"].includes(store.get().update.status)) return;
  const id = ++request;
  const channel = store.get().channel;
  operation = true;
  set({ status: "checking", error: undefined });
  try {
    const result = await desktopCall("checkUpdate", { channel });
    if (id !== request) return;
    store.set({ update: { ...result, checkedAt: Date.now(), dismissed: result.version === dismissedVersion } });
    if (!manual && result.status === "available" && result.version !== dismissedVersion)
      toast({ title: `ZenCode ${result.version} 可更新`, desc: "在侧栏底部查看更新内容", tone: "info", duration: 5000 });
  } catch (e) {
    if (id === request) {
      set({ status: "error", error: String(e) });
      if (manual) toast({ title: "检查更新失败", desc: String(e), tone: "danger", duration: 6000 });
    }
  } finally { operation = false; }
}

export async function changeChannel(channel: "stable" | "beta") {
  if (operation || store.get().update.status === "ready") return;
  ++request;
  store.set({ channel, update: { status: "idle" } });
  await checkUpdate(true);
}

export async function downloadUpdate() {
  if (operation || store.get().update.status !== "available") return;
  operation = true;
  set({ status: "downloading", progress: null, error: undefined });
  let off: (() => void) | undefined;
  try {
    off = await listen<{ progress: number | null }>("desktop:update", e => set({ progress: e.payload.progress }));
    const result = await desktopCall("downloadUpdate");
    set(result);
  } catch (e) {
    set({ status: "available", error: `下载失败：${String(e)}` });
    toast({ title: "更新下载失败", desc: String(e), tone: "danger", duration: 6000 });
  } finally { off?.(); operation = false; }
}

export async function installUpdate() {
  if (operation || store.get().update.status !== "ready") return;
  operation = true;
  set({ status: "installing", error: undefined });
  try {
    await flushPrefs();
    await desktopCall("installUpdate");
  } catch (e) {
    set({ status: "ready", error: String(e) });
    toast({ title: "未能安装更新", desc: String(e), tone: "danger", duration: 8000 });
  } finally { operation = false; }
}

export function requestInstall() {
  if (store.get().tasks.some(t => t.run.state === "waiting")) {
    toast({ title: "请先处理等待中的审批", desc: "权限审批和测试计划确认处理完成后，再安装更新。", tone: "warn", duration: 6000 });
    return;
  }
  const count = store.get().tasks.filter(t => ["running", "queued"].includes(t.run.state)).length;
  askConfirm({ title: "重新启动并更新？", desc: count ? `将暂停 ${count} 个执行或排队任务，保存会话后安装更新。新版本启动后会继续这些任务。` : "更新包已下载，安装后将重新启动 ZenCode。", confirmLabel: "重新启动并更新", onConfirm: () => { void installUpdate(); } });
}
export const dismissUpdate = () => { dismissedVersion = store.get().update.version; set({ dismissed: true }); };
