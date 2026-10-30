import { cn } from "@/lib/utils";
import { Check, CircleAlert, CircleX, Circle, Loader, ShieldCheck, RotateCcw, Globe, Server } from "@/lib/icons";
import type { Verify, VerifyStep, ZTask } from "@/data/types";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { reverify } from "@/store/actions";
import { VERIFY_LABEL, verifyBusy, verifyDone } from "@/data/verify";
import { relTime } from "@/lib/time";
import { navigate } from "@/lib/route";

const PHASES: { key: Verify["state"][]; label: string }[] = [
  { key: ["preparing"], label: "准备环境" },
  { key: ["selfcheck"], label: "自检" },
  { key: ["planning"], label: "测试计划" },
  { key: ["running"], label: "端到端验证" },
];

export function verdictTone(s?: Verify["state"]) {
  return s === "passed" ? "text-success" : s === "failed" ? "text-danger" : s === "unverified" ? "text-warning" : "text-accent";
}

function StepIcon({ s }: { s: VerifyStep["status"] }) {
  if (s === "passed") return <Check className="size-4 text-success" />;
  if (s === "failed") return <CircleX className="size-4 text-danger" />;
  if (s === "running") return <Loader className="size-4 animate-spin text-accent" />;
  return <Circle className="size-4 text-subtle-foreground" />;
}

function Progress({ v }: { v: Verify }) {
  const cur = PHASES.findIndex((p) => p.key.includes(v.state));
  return (
    <ol className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {PHASES.map((p, i) => (
        <li key={p.label} className={cn("flex items-center gap-1.5", i < cur ? "text-foreground" : i === cur ? "font-medium text-accent" : "text-subtle-foreground")}>
          {i < cur ? <Check className="size-3.5 text-success" /> : i === cur ? <Loader className="size-3.5 animate-spin" /> : <Circle className="size-3.5" />}
          {p.label}
        </li>
      ))}
    </ol>
  );
}

export function VerifyTab({ task }: { task: ZTask }) {
  const v = task.run.verify;
  const state = task.run.state;
  const failed = v?.steps.find((s) => s.status === "failed");

  if (!v) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title={state === "idle" ? "还没有验证记录" : state === "running" || state === "queued" ? "改完代码后按产品配置验证" : "没有验证记录"}
        desc="启用产品验证并填写验证说明后，Codex 会执行相关流程并报告实际结果。"
        className="h-full"
      />
    );
  }
  const busy = verifyBusy(v.state);
  const tone = verdictTone(v.state);
  const Icon = v.state === "passed" ? Check : v.state === "failed" ? CircleX : v.state === "unverified" || v.state === "awaiting-plan" ? CircleAlert : Loader;

  return (
    <div className="h-full overflow-y-auto px-5 py-5">
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="flex items-start gap-3">
          <Icon className={cn("mt-0.5 size-5 shrink-0", tone, busy && v.state !== "awaiting-plan" && "animate-spin")} />
          <div className="min-w-0 flex-1">
            <h3 role="status" className={cn("text-base font-semibold", tone)}>{VERIFY_LABEL[v.state]}</h3>
            {v.summary && <p className="mt-1 text-sm leading-[1.7] text-foreground/90">{v.summary}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {v.target && <span className="inline-flex items-center gap-1">{v.where === "server" ? <Server className="size-3.5" /> : <Globe className="size-3.5" />}{v.where === "server" ? "测试服务器" : "本机"} · <span className="font-mono">{v.target}</span></span>}
              {v.finishedAt ? <span>{relTime(v.finishedAt)}</span> : null}
            </div>
          </div>
          {verifyDone(v.state) && state === "review" && (
            <Button variant="secondary" size="sm" onClick={() => reverify(task.id)}><RotateCcw />重新验证</Button>
          )}
        </section>

        {busy && <Progress v={v} />}

        {v.state === "unverified" && !v.steps.length && (
          <button className="text-sm text-accent underline-offset-2 hover:underline" onClick={() => navigate({ name: "prefs", section: "repos" } as any)}>去产品里补充验证说明</button>
        )}


        {v.steps.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">测试计划{v.goal ? <span className="ml-2 font-normal text-muted-foreground">{v.goal}</span> : null}</h3>
            <ol className="divide-y divide-border rounded-lg border border-border">
              {v.steps.map((s) => (
                <li key={s.id} className="flex gap-3 px-3.5 py-2.5">
                  <span className="mt-0.5"><StepIcon s={s.status} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{s.title}</p>
                    <p className="text-xs text-muted-foreground">预期：{s.expect}</p>
                    {s.note && <p className={cn("mt-1 text-xs", s.status === "failed" ? "text-danger" : "text-muted-foreground")}>{s.note}</p>}
                  </div>
                  {s.at != null && v.recording && !busy && <span className="font-mono text-xs tabular-nums text-subtle-foreground">0:{String(s.at).padStart(2, "0")}</span>}
                </li>
              ))}
            </ol>
          </section>
        )}

        {v.checks.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">自检</h3>
            <ul className="space-y-1.5">
              {v.checks.map((c) => (
                <li key={c.name} className="flex items-center gap-2 text-sm">
                  {c.status === "passed" ? <Check className="size-4 text-success" /> : c.status === "failed" ? <CircleX className="size-4 text-danger" /> : <Circle className="size-4 text-subtle-foreground" />}
                  <span>{c.name}</span>
                  {c.detail && <span className="font-mono text-xs text-muted-foreground">{c.detail}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {v.logs.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">日志</h3>
            <pre className="selectable overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-[1.7]">
              {v.logs.map((l, i) => <div key={i} className={l.level === "error" ? "text-danger" : "text-muted-foreground"}>[{l.kind}] {l.text}</div>)}
            </pre>
          </section>
        )}
        {failed && <span className="hidden">{failed.id}</span>}
      </div>
    </div>
  );
}
