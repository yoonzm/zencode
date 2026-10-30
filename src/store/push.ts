import { taskRef } from "@/lib/task";
import type { Run, ZTask } from "@/data/types";

export type PushKind = "attention" | "result";
export type PushTone = "danger" | "warn" | "success" | "info";

export interface FeishuCard {
  kind: PushKind;
  tone: PushTone;
  title: string;
  lines: [string, string][];
}

export const FEISHU_HOOK = /^https:\/\/open\.(feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[\w-]{8,}$/;

/** 消息只放标题、结论和链接，不带需求描述和代码 */
export function buildCard(ev: "approval" | "plan" | "failed" | "verify-failed" | "done" | "mr", t: Pick<ZTask, "id" | "kind" | "no" | "title" | "product"> & { manual?: boolean }, run: Pick<Run, "files" | "branch" | "verify" | "mr" | "startedAt" | "finishedAt">): FeishuCard {
  const ref = taskRef(t);
  const base: [string, string][] = [["任务", `${ref} ${t.title}`], ["产品", t.product]];
  const stat: [string, string][] = [["改动", `${run.files.length} 个文件`]];
  switch (ev) {
    case "approval": return { kind: "attention", tone: "warn", title: "需要你审批", lines: base };
    case "plan": return { kind: "attention", tone: "warn", title: "测试计划等你确认", lines: base };
    case "failed": return { kind: "attention", tone: "danger", title: "执行失败", lines: [...base, ...stat] };
    case "verify-failed": return { kind: "attention", tone: "danger", title: "验证未通过", lines: [...base, ...stat] };
    case "mr": return { kind: "result", tone: "success", title: `已创建 Merge Request !${run.mr?.iid ?? ""}`, lines: [...base, ["分支", String(run.branch)], ...(run.mr ? [["链接", run.mr.url] as [string, string]] : [])] };
    default: return { kind: "result", tone: "success", title: run.verify?.state === "passed" ? "任务完成，验证通过" : "任务完成，未验证", lines: [...base, ...stat] };
  }
}

