import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ArrowDown, ChevronRight, CircleCheck, CircleDashed, CircleX, FilePen, FilePlus, FileSearch, ListChecks, ShieldAlert, ShieldCheck, Sparkles, Terminal, TriangleAlert, Play, Info } from "@/lib/icons";
import type { RunEvent, ZTask } from "@/data/types";
import { Inline } from "@/lib/inline";
import { clockTime, fmtDuration } from "@/lib/time";
import { Avatar } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/fields";
import { EmptyState } from "@/components/ui/empty";
import { ShimmerText } from "@/components/magic/effects";
import { decideApproval, focusDiffFile, startRun } from "@/store/actions";
import { SANDBOX_LABEL } from "@/data/types";
import { useApp } from "@/store/state";

type Filter = "all" | "talk" | "cmd" | "edit";

const FILTERS: Record<Filter, RunEvent["kind"][] | null> = {
  all: null,
  talk: ["message", "user", "plan", "error", "system"],
  cmd: ["command", "test", "approval"],
  edit: ["edit", "read"],
};

function Rail({ icon, tone, last, children, at }: { icon: any; tone?: string; last?: boolean; children: any; at?: number }) {
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="relative flex gap-3 pb-3.5">
      {!last && <span className="absolute bottom-0 left-[9.5px] top-6 w-px bg-border" aria-hidden />}
      <span className={cn("relative z-[1] mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-background", tone ?? "text-muted-foreground")}>{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {at != null && <time className="mt-0.5 hidden shrink-0 font-mono text-[11px] tabular-nums text-subtle-foreground @md:block">{clockTime(at)}</time>}
    </motion.li>
  );
}

function Paragraphs({ text }: { text: string }) {
  return (
    <div className="selectable space-y-2 text-sm leading-[1.65] text-foreground">
      {text.split("\n\n").map((p, i) => (
        <p key={i}>
          <Inline text={p} />
        </p>
      ))}
    </div>
  );
}

function CommandBlock({ e, defaultOpen }: { e: Extract<RunEvent, { kind: "command" }>; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const ok = e.exit === 0;
  const hasOut = !!e.output && e.output.trim().length > 0;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        onClick={() => hasOut && setOpen((o) => !o)}
        aria-expanded={hasOut ? open : undefined}
        className={cn("flex w-full items-center gap-2 px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60", hasOut && "hover:bg-hover")}
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150", open && "rotate-90", !hasOut && "opacity-0")} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          <span className="select-none text-subtle-foreground">$ </span>
          {e.cmd}
        </span>
        <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs", ok ? "text-success" : "text-danger")}>
          {ok ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
          {ok ? "成功" : `退出码 ${e.exit}`}
        </span>
        <span className="hidden shrink-0 font-mono text-[11px] tabular-nums text-subtle-foreground @sm:inline">{(e.ms / 1000).toFixed(1)}s</span>
      </button>
      {open && hasOut && (
        <pre className="selectable max-h-60 overflow-auto border-t border-border bg-muted/60 px-3 py-2 font-mono text-xs leading-[18px] text-muted-foreground">{e.output}</pre>
      )}
      {open && !hasOut && null}
    </div>
  );
}

const Event = memo(function Event({ e, task, last, latest }: { e: RunEvent; task: ZTask; last: boolean; latest: boolean }) {
  const canDecide = task.run.state === "waiting";
  switch (e.kind) {
    case "message":
      return (
        <Rail icon={<Sparkles className="size-3.5 text-accent" />} last={last} at={e.at}>
          <Paragraphs text={e.text} />
        </Rail>
      );
    case "plan": {
      const done = e.steps.filter((s) => s.done).length;
      return (
        <Rail icon={<ListChecks className="size-3.5" />} last={last} at={e.at}>
          <div className="rounded-lg border border-border bg-card px-3 py-2.5">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-foreground">
              {e.title}
              <span className="tabular-nums text-xs font-normal text-muted-foreground">
                {done}/{e.steps.length}
              </span>
            </div>
            <ul className="space-y-1">
              {e.steps.map((s, i) => (
                <li key={i} className={cn("flex items-start gap-2 text-sm leading-5", s.done ? "text-muted-foreground" : "text-foreground")}>
                  {s.done ? <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" /> : <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" />}
                  <span className={cn(s.done && "line-through decoration-border-strong")}>{s.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </Rail>
      );
    }
    case "read":
      return (
        <Rail icon={<FileSearch className="size-3.5" />} last={last} at={e.at}>
          <p className="text-sm text-muted-foreground">读取了 {e.paths.length} 个文件</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {e.paths.map((p) => (
              <code key={p} className="selectable rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground">
                {p}
              </code>
            ))}
          </div>
        </Rail>
      );
    case "command":
      return (
        <Rail icon={<Terminal className="size-3.5" />} last={last} at={e.at}>
          <CommandBlock e={e} defaultOpen={e.exit !== 0 || (latest && !!e.output)} />
        </Rail>
      );
    case "edit":
      return (
        <Rail icon={e.created ? <FilePlus className="size-3.5 text-success" /> : <FilePen className="size-3.5" />} last={last} at={e.at}>
          <button
            onClick={() => focusDiffFile(task.id, e.path)}
            className="group inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-left outline-none transition-colors hover:border-border-strong hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <span className="text-sm text-muted-foreground">{e.created ? "新增" : "修改"}</span>
            <span className="min-w-0 truncate font-mono text-xs text-foreground">{e.path}</span>
            <span className="shrink-0 font-mono text-xs tabular-nums">
              <span className="text-success">+{e.add}</span> <span className="text-danger">−{e.del}</span>
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-0.5" />
          </button>
        </Rail>
      );
    case "test": {
      const ok = e.failed === 0;
      return (
        <Rail icon={ok ? <ShieldCheck className="size-3.5 text-success" /> : <CircleX className="size-3.5 text-danger" />} last={last} at={e.at}>
          <p className="text-sm text-foreground">
            <span className={ok ? "text-success" : "text-danger"}>{ok ? "测试通过" : "测试失败"}</span>{" "}
            <span className="tabular-nums">{e.passed}/{e.total}</span>
            <span className="text-muted-foreground"> · {e.name}{e.note ? ` · ${e.note}` : ""}</span>
          </p>
        </Rail>
      );
    }
    case "approval":
      return (
        <Rail icon={<ShieldAlert className="size-3.5 text-warning" />} last={last} at={e.at}>
          <div className="rounded-lg border border-warning/40 bg-warning/8 p-3">
            <p className="text-sm font-medium text-warning">需要你审批 · Codex 请求运行命令</p>
            <code className="selectable mt-2 block overflow-x-auto rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-xs text-foreground">{e.cmd}</code>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{e.reason}</p>
            {!e.decision && canDecide ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" onClick={() => decideApproval(task.id, e.id, "once")}>允许一次</Button>
                <Button size="sm" variant="secondary" onClick={() => decideApproval(task.id, e.id, "always")}>始终允许</Button>
                <Button size="sm" variant="danger-ghost" onClick={() => decideApproval(task.id, e.id, "deny")}>拒绝</Button>
              </div>
            ) : (
              <p className="mt-2 text-xs font-medium text-muted-foreground">
                {e.decision === "deny" ? "已拒绝" : e.decision === "always" ? "已允许，并记住此类命令" : e.decision === "once" ? "已允许一次" : "等待处理"}
              </p>
            )}
          </div>
        </Rail>
      );
    case "user":
      return (
        <Rail icon={<Avatar id="me" size={20} />} last={last} at={e.at}>
          <div className="rounded-lg bg-accent/10 px-3 py-2">
            <p className="mb-0.5 text-xs font-medium text-accent">你 · 追加指令</p>
            {e.ref && <code className="mb-1 inline-block rounded-sm bg-card px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground">{e.ref}</code>}
            <p className="selectable whitespace-pre-wrap text-sm leading-[1.6] text-foreground">{e.text}</p>
          </div>
        </Rail>
      );
    case "system":
      return (
        <Rail
          icon={e.tone === "success" ? <CircleCheck className="size-3.5 text-success" /> : e.tone === "warn" ? <TriangleAlert className="size-3.5 text-warning" /> : <Info className="size-3.5" />}
          last={last}
          at={e.at}
        >
          <p className="text-sm text-muted-foreground"><Inline text={e.text} /></p>
        </Rail>
      );
    case "error":
      return (
        <Rail icon={<TriangleAlert className="size-3.5 text-danger" />} last={last} at={e.at}>
          <div className="rounded-lg border border-danger/35 bg-danger/8 px-3 py-2">
            <p className="text-sm font-medium text-danger">{e.text}</p>
            {e.detail && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{e.detail}</p>}
          </div>
        </Rail>
      );
  }
});

function activity(task: ZTask): string {
  return task.run.activity || "分析问题";
}

export function Timeline({ task }: { task: ZTask }) {
  const [filter, setFilter] = useState<Filter>("all");
  const config = useApp((s) => s.config);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  const run = task.run;
  const events = useMemo(() => {
    const k = FILTERS[filter];
    return k ? run.events.filter((e) => k.includes(e.kind)) : run.events;
  }, [run.events, filter]);

  // 切换任务：直接跳到底部
  useEffect(() => {
    stick.current = true;
    setAway(false);
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [task.id]);

  // 新事件：贴底则跟随，否则提示
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else setAway(true);
  }, [run.events.length, run.state]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    stick.current = near;
    if (near) setAway(false);
  };

  if (run.state === "idle" && run.events.length === 0) {
    return (
      <div className="@container h-full overflow-y-auto">
        <EmptyState
          icon={Play}
          pattern
          title="还没有开始"
          desc="交给 Codex 后，这里会按时间顺序记录它读了什么、改了什么、跑了哪些命令。你可以随时停止，或追加指令。"
          actions={<Button variant="primary" onClick={() => startRun(task.id)}><Play />交给 Codex 执行</Button>}
          className="pt-14"
        />
        <dl className="mx-auto mb-10 grid max-w-sm grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-6 text-sm">
          <dt className="text-muted-foreground">分支</dt>
          <dd className="truncate font-mono text-xs leading-5 text-foreground">{run.branch}</dd>
          <dt className="text-muted-foreground">仓库</dt>
          <dd className="truncate font-mono text-xs leading-5 text-foreground">{task.repoId}</dd>
          <dt className="text-muted-foreground">模型</dt>
          <dd className="text-foreground">{config.codex.model}</dd>
          <dt className="text-muted-foreground">权限</dt>
          <dd className="text-foreground">{SANDBOX_LABEL[config.codex.sandbox]}</dd>
        </dl>
      </div>
    );
  }

  const live = run.state === "running" || run.state === "queued";
  const waiting = run.state === "waiting";
  const elapsed = run.startedAt ? fmtDuration((run.finishedAt ?? Date.now()) - run.startedAt) : null;

  return (
    <div className="@container relative flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-5 py-2">
        <span className="text-xs text-muted-foreground">
          {run.events.length} 个事件{elapsed ? ` · 用时 ${elapsed}` : ""}
        </span>
        <Segmented
          size="sm"
          label="事件过滤"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "全部" },
            { value: "talk", label: "消息" },
            { value: "cmd", label: "命令" },
            { value: "edit", label: "修改" },
          ]}
        />
      </div>
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-1" tabIndex={-1}>
        <ol aria-label="执行事件" className="mx-auto max-w-3xl">
          {events.map((e, i) => (
            <Event key={e.id} e={e} task={task} last={i === events.length - 1 && !live && !waiting} latest={i === events.length - 1} />
          ))}
          {events.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">这个类别下还没有事件</li>}
          {(live || waiting) && (
            <li className="flex items-center gap-3 pb-2" aria-live="polite">
              <span className="grid size-5 place-items-center">
                {waiting ? <ShieldAlert className="size-3.5 text-warning" /> : <span className="dot-pulse size-2 rounded-full bg-accent" />}
              </span>
              {waiting ? (
                <span className="text-sm text-warning">{run.verify?.state === "awaiting-plan" ? "等待你确认测试计划" : "等待你审批后继续"}</span>
              ) : run.state === "queued" ? (
                <ShimmerText className="text-sm">排队中，等待空闲的 Codex 会话…</ShimmerText>
              ) : (
                <ShimmerText className="text-sm">Codex 正在{activity(task)}…</ShimmerText>
              )}
            </li>
          )}
        </ol>
      </div>
      <AnimatePresence>
      {away && (
        <motion.button
          key="new-events"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.15 }}
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            stick.current = true;
            setAway(false);
          }}
          className="absolute bottom-3 left-1/2 inline-flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-popover px-3 text-xs font-medium text-foreground shadow-pop outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <ArrowDown className="size-3.5" />
          有新事件
        </motion.button>
      )}
      </AnimatePresence>
    </div>
  );
}
