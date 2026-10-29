import { useEffect, useState } from "react";
import type { AppConfig, RepoMapping, Verify, VerifyLog } from "@/data/types";
import { desktopCall } from "@/lib/desktop";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { VERIFY_LABEL } from "@/data/verify";

export interface ToolStatus {
  id: string;
  status: "running" | "done" | "error";
  message: string;
  logs: VerifyLog[];
  sources: { repo: string; branch: string; commit: string }[];
  waiting?: { id: string; kind: "plan" | "approval"; detail: Verify & { command?: string; reason?: string } };
  result?: { prompt?: string; verify?: Verify };
}

export function VerificationResult({ v }: { v: Verify }) {
  return <section className="space-y-2">
    <h4 className="text-sm font-semibold">{VERIFY_LABEL[v.state]}</h4>
    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{v.summary}</p>
    <ol className="space-y-2">
      {v.steps.map(s => <li key={s.id} className="rounded-md border border-border p-2 text-sm">
        <p>{s.title} · {s.status === "passed" ? "通过" : s.status === "failed" ? "未通过" : "待执行"}</p>
        <p className="text-xs text-muted-foreground">预期：{s.expect}</p>
        {s.note && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{s.note}</p>}
      </li>)}
    </ol>
  </section>;
}

export function VerificationToolDialog({ mode, mapping, config, onApply, onClose }: {
  mode: "draft" | "trial"; mapping: RepoMapping; config: AppConfig;
  onApply: (prompt: string) => void; onClose: () => void;
}) {
  // Keep the submitted configuration stable while catalog refreshes update the parent.
  const [input] = useState(() => ({ mode, mapping, config }));
  const [job, setJob] = useState<ToolStatus | null>(null);
  const [error, setError] = useState("");
  const [deciding, setDeciding] = useState(false);
  useEffect(() => {
    let active = true;
    let id = "";
    let timer: ReturnType<typeof setTimeout>;
    const cancel = () => { if (id) void desktopCall("verificationToolCancel", { id }).catch(() => {}); };
    const poll = async () => {
      try {
        const state: ToolStatus = await desktopCall("verificationToolStatus", { id });
        if (!active) return;
        setJob(state);
        if (state.status === "running") timer = setTimeout(poll, 700);
      } catch (e) { if (active) setError(String(e)); cancel(); }
    };
    void desktopCall("verificationToolStart", input).then(result => {
      id = result.id;
      if (!active) { cancel(); return; }
      void poll();
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; clearTimeout(timer); cancel(); };
  }, [input]);
  const decide = async (go: boolean) => {
    if (!job) return;
    setDeciding(true); setError("");
    try {
      await desktopCall("verificationToolDecide", { id: job.id, waitingId: job.waiting?.id, go });
      setJob(j => j && ({ ...j, waiting: undefined }));
    } catch (e) { setError(String(e)); }
    finally { setDeciding(false); }
  };
  const busy = !error && (!job || job.status === "running");
  return <Modal open onClose={onClose} title={mode === "draft" ? "AI 生成验证草稿" : "试运行验证说明"}
    description={mode === "draft" ? "分析所选分支的实际仓库文件。检查草稿后，点击应用才会替换当前验证说明。" : "按当前说明在独立工作目录执行，使用 Codex 中配置的权限。这里验证的是目标分支，不是任务尚未提交的改动。"}
    size="lg" footer={<>
      <Button variant="ghost" onClick={onClose}>{busy ? "取消并关闭" : "关闭"}</Button>
      {mode === "draft" && job?.status === "done" && job.result?.prompt && <Button onClick={() => { onApply(job.result!.prompt!); onClose(); }}>应用草稿</Button>}
    </>}>
    <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
      <p role="status" className="text-sm text-muted-foreground">{job?.message ?? "正在准备…"}</p>
      {(error || job?.status === "error") && <p role="alert" className="whitespace-pre-wrap text-sm text-danger">{error || job?.message}</p>}
      {job?.sources.length ? <ul className="text-xs text-muted-foreground">{job.sources.map(s => <li key={s.repo}>{s.repo} · {s.branch} · {s.commit.slice(0, 8)}</li>)}</ul> : null}
      {job?.waiting && <section className="space-y-3 rounded-md border border-warning/40 bg-warning/10 p-3">
        {job.waiting.kind === "plan" ? <VerificationResult v={job.waiting.detail} /> : <>
          <h4 className="text-sm font-semibold">执行请求等待审批</h4>
          <pre className="whitespace-pre-wrap break-all text-xs">{job.waiting.detail.command || "文件修改请求"}</pre>
          <p className="text-sm">{job.waiting.detail.reason}</p>
        </>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={deciding} onClick={() => void decide(false)}>{job.waiting.kind === "plan" ? "跳过验证" : "拒绝"}</Button>
          <Button loading={deciding} onClick={() => void decide(true)}>{job.waiting.kind === "plan" ? "开始验证" : "允许本次"}</Button>
        </div>
      </section>}
      {job?.result?.prompt && <pre className="selectable whitespace-pre-wrap break-words rounded-md border border-border p-3 text-sm leading-6">{job.result.prompt}</pre>}
      {job?.result?.verify && <VerificationResult v={job.result.verify} />}
      {!!job?.logs.length && <details><summary className="cursor-pointer text-sm">执行日志</summary><pre className="selectable mt-2 whitespace-pre-wrap break-all rounded-md bg-muted/50 p-3 text-xs">{job.logs.map(l => `[${l.kind}] ${l.text}`).join("\n\n")}</pre></details>}
    </div>
  </Modal>;
}
