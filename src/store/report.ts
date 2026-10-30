import { store, type ReportCfg, type ReportLog } from "./state";
import { toast } from "./toast";
import { FEISHU_HOOK, type FeishuCard } from "./push";
import { taskRef } from "@/lib/task";
import { desktopCall } from "@/lib/desktop";
import { flushPrefs } from "./state";
import { uid } from "@/lib/utils";

export type ReportKind = "daily" | "weekly";
export const REPORT_NAME: Record<ReportKind, string> = { daily: "日报", weekly: "周报" };
export const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export const DEFAULT_PROMPT: Record<ReportKind, string> = {
  daily: "根据今天的任务进展写日报，2 到 5 条，每条一句话：做了什么、结果如何。有失败或卡住的单独写一条。",
  weekly: "根据本周的任务进展写周报，2 到 5 条，按重要程度排序，合并同类项，每条一句话。最后一条写下周计划，没有就不写。",
};

const md = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;

function period(kind: ReportKind, now: number) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (kind === "weekly") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 本周一
  return { start: d.getTime(), label: kind === "daily" ? md(new Date(now)) : `${md(d)} – ${md(new Date(now))}` };
}

/** Summarize task results using Codex and the configured prompt. */
export async function buildReport(kind: ReportKind, now = Date.now()): Promise<{ items: string[]; stats: string; label: string }> {
  const { start, label } = period(kind, now);
  const tasks = store.get().tasks.filter((t) => Math.max(t.updatedAt, t.run.finishedAt ?? 0) >= start && Math.max(t.updatedAt, t.run.finishedAt ?? 0) <= now && ["done", "completed", "review", "failed"].includes(t.run.state));
  const mr = tasks.filter((t) => t.run.mr);
  const review = tasks.filter((t) => t.run.state === "review");
  const failed = tasks.filter((t) => t.run.state === "failed");
  const lines: string[] = [];
  for (const t of mr) lines.push(`${taskRef(t)} ${t.title}：已提交 Merge Request !${t.run.mr!.iid}`);
  for (const t of review) {
    const v = t.run.verify;
    const res = v?.state === "passed" ? "验证通过，待审核" : v?.state === "failed" ? "验证未通过，需要处理" : "已改完，待审核";
    lines.push(`${taskRef(t)} ${t.title}：${res}`);
  }
  for (const t of tasks.filter(t => t.run.state === "completed" && !t.run.mr)) lines.push(`${taskRef(t)} ${t.title}：已完成`);
  for (const t of failed) lines.push(`${taskRef(t)} ${t.title}：执行失败，需要处理`);
  let items = lines;
  const stats = `完成 ${mr.length + review.length} 项 · 提交 MR ${mr.length} 个 · 失败 ${failed.length} 项`;
  if (items.length) items = await desktopCall("reportGenerate", { config: store.get().config, prompt: store.get().reports[kind].prompt, items, stats, label });
  return { items, stats, label };
}

export function reportCard(kind: ReportKind, r: { items: string[]; stats: string; label: string }): FeishuCard {
  return { kind: "report", tone: "info", title: `${REPORT_NAME[kind]} · ${r.label}`, lines: [...r.items.map((t, i) => [String(i + 1), t] as [string, string]), ["统计", r.stats]] };
}

const feishuReady = () => {
  const f = store.get().feishu;
  return f.enabled && FEISHU_HOOK.test(f.webhook.trim());
};

const addLog = (l: Omit<ReportLog, "id" | "at">) => store.set((s) => ({ reports: { ...s.reports, log: [{ ...l, id: uid("rl"), at: Date.now() }, ...s.reports.log].slice(0, 10) } }));

export function setReport(kind: ReportKind, p: Partial<ReportCfg>) {
  store.set((s) => ({ reports: { ...s.reports, [kind]: { ...s.reports[kind], ...p, ...(p.enabled ? { since: Date.now() } : {}) } } }));
}

/** 立即发送（手动）或到点发送（自动） */
const busy = new Set<ReportKind>();
const attempted = new Map<ReportKind, number>();
export async function sendReport(kind: ReportKind, opts: { manual: boolean; key?: string }) {
  if (busy.has(kind)) return;
  busy.add(kind);
  attempted.set(kind, Date.now());
  try {
    if (!feishuReady()) {
      if (opts.manual) toast({ tone: "warn", title: "还没有配置飞书", desc: "先在「通知」里填好飞书的 Webhook 地址。" });
      return;
    }
    const r = await buildReport(kind);
    if (!r.items.length) {
      addLog({ kind, manual: opts.manual, key: opts.key, items: [], stats: r.stats, result: "skipped" });
      if (opts.manual) toast({ tone: "info", title: `这段时间没有进展`, desc: `没有发送${REPORT_NAME[kind]}。` });
      return;
    }
    await flushPrefs();
    await desktopCall("reportSend", { card: reportCard(kind, r) });
    addLog({ kind, manual: opts.manual, key: opts.key, items: r.items, stats: r.stats, result: "sent" });
    if (opts.manual) toast({ tone: "success", title: "已发送" });
  } catch (e) { toast({ tone: "danger", title: "报表未发送", desc: String(e instanceof Error ? e.message : e) }); } finally { busy.delete(kind); }
}

/** 到点自动发：工作日发日报，周报在设定的那天发。错过不超过 4 小时的补发一次。 */
export function tickReports(now = Date.now()) {
  const { reports } = store.get();
  const d = new Date(now);
  const dow = (d.getDay() + 6) % 7 + 1; // 1..7
  const ymd = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  (["daily", "weekly"] as ReportKind[]).forEach((kind) => {
    const c = reports[kind];
    if (!c.enabled || !feishuReady() || now - (attempted.get(kind) ?? 0) < 300_000) return;
    if (kind === "daily" ? dow > 5 : dow !== c.weekday) return;
    const [h, m] = c.time.split(":").map(Number);
    const at = new Date(now).setHours(h, m, 0, 0);
    const key = `${kind}-${ymd}`;
    if (now < at || now - at > 4 * 3600_000 || (c.since ?? 0) > at || reports.log.some((l) => l.key === key)) return;
    sendReport(kind, { manual: false, key });
  });
}
