import { taskRef } from "@/lib/task";
import { openExternal } from "@/store/actions";
import { motion } from "motion/react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { Code, FolderOpen, ArrowLeft, Calendar, Copy, Ellipsis, ExternalLink, GitBranch, GitMerge, GitPullRequest, Link, Pause, Play, RotateCcw, TriangleAlert, Check, SearchX, Trash } from "@/lib/icons";
import { useApp } from "@/store/state";
import { PRIORITY_LABEL } from "@/data/types";
import { personName } from "@/data/identity";
import { refreshDiff, openFolder, openInEditor, clearUnread, createMr, deleteTask, retryRun, setTab } from "@/store/actions";
import { toast } from "@/store/toast";
import { useNow, isTyping } from "@/lib/hooks";
import { dueLabel, fmtDuration } from "@/lib/time";
import { copyText } from "@/lib/clipboard";
import { Avatar, KindIcon, PriorityIcon, StatePill } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { DropMenu, type MenuEntry } from "@/components/ui/menu";
import { workDirs } from "@/lib/workdir";
import { Tip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty";
import { ShimmerText } from "@/components/magic/effects";
import { Timeline } from "./timeline";
import { DiffView } from "./diff-view";
import { ZentaoTab } from "./zentao-tab";
import { VerifyTab, verdictTone } from "./verify-tab";
import { Composer } from "./composer";
import { navigate } from "@/lib/route";
import { store } from "@/store/state";
import type { ZTask } from "@/data/types";
import { startRun } from "@/store/actions";

function TabButton({ id, on, children, onClick }: { id: string; on: boolean; children: any; onClick: () => void }) {
  return (
    <button
      role="tab"
      id={`tab-${id}`}
      aria-selected={on}
      aria-controls={`panel-${id}`}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-9 items-center gap-1.5 px-1 text-sm font-medium outline-none transition-colors focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/60",
        on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {on && <motion.span layoutId="detail-tab-underline" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" transition={{ type: "spring", stiffness: 600, damping: 44 }} />}
    </button>
  );
}

function Actions({ task }: { task: ZTask }) {
  const run = task.run;
  const s = run.state;
  const now = useNow(s === "running" ? 1000 : 60_000);
  const add = run.files.reduce((a, f) => a + f.add, 0);
  const del = run.files.reduce((a, f) => a + f.del, 0);
  const elapsed = run.startedAt ? fmtDuration((s === "running" || s === "stopped" || s === "waiting" || s === "queued" ? now : run.finishedAt ?? now) - run.startedAt) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {s === "idle" && (
        <Button variant="primary" onClick={() => startRun(task.id)}>
          <Play />交给 Codex 执行
        </Button>
      )}
      {s === "queued" && (
        <Button variant="secondary" disabled>
          <ShimmerText>排队中…</ShimmerText>
        </Button>
      )}
      {s === "running" && (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">按 <Kbd keys={["esc"]} /> 或点输入框的停止键可以随时停下</span>
      )}
      {s === "waiting" && (
        <span className="inline-flex items-center gap-1.5 text-sm text-warning"><TriangleAlert className="size-4" />有一条命令等你审批</span>
      )}
      {s === "stopped" && (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">已停止，已有的改动都保留。发消息或点「继续」接着做</span>
      )}
      {s === "review" && (
        <>
          <Button variant="primary" loading={run.mrBusy} onClick={() => createMr(task.id)}>
            <GitPullRequest />{run.mr ? (run.mrBusy ? "正在确认 MR…" : "完成提交") : (run.mrBusy ? "正在创建 MR…" : "创建 Merge Request")}
          </Button>
          {run.mr && <>
            <Button variant="secondary" onClick={() => openExternal(run.mr!.url)}><ExternalLink />打开 MR !{run.mr.iid}</Button>
            <Button variant="ghost" onClick={() => copyText(run.mr!.url, "已复制 MR 链接")}><Copy />复制 MR 链接</Button>
            <span className="text-sm text-success" role="status">MR 已创建</span>
          </>}
        </>
      )}
      {s === "done" && (
        <>
          {run.mr && (
            <Button variant="secondary" onClick={() => openExternal(run.mr!.url)}>
              <GitMerge />MR !{run.mr.iid}<ExternalLink className="opacity-60" />
            </Button>
          )}
          <span className="inline-flex items-center gap-1.5 text-sm text-success"><Check className="size-4" />已提交 MR</span>
        </>
      )}
      {s === "failed" && (
        <>
          <Button variant="primary" onClick={() => retryRun(task.id)}><RotateCcw />重试</Button>
        </>
      )}
      {(run.events.length > 0 || run.files.length > 0) && (
        <span className="ml-auto flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
          {elapsed && <span>{s === "running" ? "已运行 " : "用时 "}{elapsed}</span>}
          {run.files.length > 0 && (
            <span>
              {run.files.length} 个文件 <span className="font-mono text-success">+{add}</span> <span className="font-mono text-danger">−{del}</span>
            </span>
          )}
        </span>
      )}
    </div>
  );
}

export function TaskDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const task = useApp((s) => s.tasks.find((t) => t.id === id));
  const tab = useApp((s) => s.tab);
  const mappings = useApp((s) => s.config.mappings);
  const unread = task?.run.unread;

  useEffect(() => {
    if (task && unread) clearUnread(id);
  }, [id, unread]);

  useEffect(() => {
    const refresh = () => refreshDiff(id);
    refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 5000);
    return () => { window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, [id]);

  // 1 / 2 / 3 / 4 切换页签
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (store.get().paletteOpen || store.get().confirm) return;
      if (e.key === "1") setTab("run");
      else if (e.key === "2") setTab("diff");
      else if (e.key === "3") setTab("verify");
      else if (e.key === "4") setTab("zentao");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!task) {
    return (
      <div className="h-full">
        <EmptyState
          icon={SearchX}
          title="找不到这个任务"
          desc="它可能已不在当前同步范围内，或链接已失效。"
          actions={<Button variant="secondary" onClick={() => navigate({ name: "tasks" })}>回到任务列表</Button>}
          className="h-full"
        />
      </div>
    );
  }

  const run = task.run;
  const dirs = workDirs(task, mappings);
  const noDir = run.state === "idle" || !!run.cleaned;
  const suffix = (d: { name: string }) => (dirs.length > 1 ? ` · ${d.name}` : "");
  const dirEntries: MenuEntry[] = dirs.length
    ? [
        ...dirs.map((d) => ({ label: `在 VS Code 中打开${suffix(d)}${noDir ? (run.cleaned ? "（已清理）" : "（尚未开始）") : ""}`, icon: Code, disabled: noDir, onClick: () => openInEditor(task.id, { repo: d.repo }) })),
        ...dirs.map((d) => ({ label: `在文件夹中打开${suffix(d)}`, icon: FolderOpen, disabled: noDir, onClick: () => openFolder(task.id, d.repo) })),
        { label: dirs.length > 1 ? "复制工作目录路径" : "复制路径", icon: Copy, disabled: noDir, onClick: () => copyText(dirs.map((d) => d.path).join("\n"), "已复制路径") },
      ]
    : [];
  const due = task.deadline && task.run.state !== "done" ? dueLabel(task.deadline) : null;
  const diffAdd = run.files.reduce((a, f) => a + f.add, 0);
  const diffDel = run.files.reduce((a, f) => a + f.del, 0);

  return (
    <article className="@container flex h-full min-h-0 flex-col bg-background" aria-label={`${task.title}`}>
      <header className="shrink-0 px-5 pt-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {onBack && (
            <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="返回任务列表" className="-ml-2">
              <ArrowLeft />
            </Button>
          )}
          <KindIcon kind={task.kind} />
          <span className="font-medium text-foreground">{taskRef(task)}</span>
          <span aria-hidden>·</span>
          <span className="min-w-0 truncate">{task.product} / {task.module}</span>
          {task.manual && <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">手动</span>}
          <div className="ml-auto flex items-center gap-0.5">
            {!task.manual && <Tip label="在禅道中打开">
              <Button variant="ghost" size="icon-sm" aria-label="在禅道中打开" onClick={() => openExternal(`${store.get().config.zentao.baseUrl}/${task.kind}-view-${task.no}.html`)}>
                <ExternalLink />
              </Button>
            </Tip>}
            <DropMenu
              align="end"
              buttonClassName="grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-[open]:bg-active"
              buttonProps={{ "aria-label": "更多操作" }}
              trigger={<Ellipsis className="size-4" />}
              entries={[
                ...dirEntries,
                ...(dirEntries.length ? [{ separator: true } as const] : []),
                { label: "复制分支名", icon: GitBranch, disabled: !run.branch, onClick: () => run.branch && copyText(run.branch, "已复制分支名") },
                ...(task.manual ? [] : [{ label: "复制禅道链接", icon: Link, onClick: () => copyText(`${store.get().config.zentao.baseUrl}/${task.kind}-view-${task.no}.html`, "已复制禅道链接") }]),
                { separator: true },
                { label: "删除任务…", icon: Trash, danger: true, onClick: () => deleteTask(task.id) },
              ]}
            />
          </div>
        </div>

        <h2 className="mt-2 text-pretty text-xl font-semibold leading-[1.45] text-foreground">{task.title}</h2>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <StatePill state={run.state} />
          <span className="inline-flex items-center gap-1.5"><PriorityIcon p={task.priority} />P{task.priority} {PRIORITY_LABEL[task.priority]}</span>
          <span className="inline-flex items-center gap-1.5"><Avatar id={task.assignee} size={18} />{personName(task.assignee)}</span>
          {due && (
            <span className={cn("inline-flex items-center gap-1.5", due.tone === "overdue" && "text-danger", due.tone === "soon" && "text-warning")}>
              <Calendar className="size-3.5" />{due.text}
            </span>
          )}
          {run.branch && (
            <button
              onClick={() => copyText(run.branch!, "已复制分支名")}
              className="inline-flex min-w-0 items-center gap-1.5 rounded-sm font-mono text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
              title="点击复制分支名"
            >
              <GitBranch className="size-3.5 shrink-0" /><span className="truncate">{run.branch}</span><Copy className="size-3 shrink-0 opacity-50" />
            </button>
          )}
        </div>

        <div className="mt-3.5">
          <Actions task={task} />
        </div>

        <div role="tablist" aria-label="任务详情" className="mt-3 flex items-center gap-5 border-b border-border">
          <TabButton id="run" on={tab === "run"} onClick={() => setTab("run")}>
            执行
            {run.state === "running" && <span className="dot-pulse size-1.5 rounded-full bg-accent" aria-hidden />}
          </TabButton>
          <TabButton id="diff" on={tab === "diff"} onClick={() => setTab("diff")}>
            变更
            {run.files.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">{run.files.length}</span>
            )}
          </TabButton>
          <TabButton id="verify" on={tab === "verify"} onClick={() => setTab("verify")}>
            验证
            {run.verify && (
              <span className={cn("text-[11px] font-medium", verdictTone(run.verify.state))}>
                {run.verify.state === "passed" ? "通过" : run.verify.state === "failed" ? "未通过" : run.verify.state === "unverified" ? "未验证" : "进行中"}
              </span>
            )}
          </TabButton>
          <TabButton id="zentao" on={tab === "zentao"} onClick={() => setTab("zentao")}>{task.manual ? "原文" : "禅道原文"}</TabButton>
          {tab === "diff" && run.files.length > 0 && (
            <span className="ml-auto hidden font-mono text-xs tabular-nums @md:block"><span className="text-success">+{diffAdd}</span> <span className="text-danger">−{diffDel}</span></span>
          )}
        </div>
      </header>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1">
        {run.cleaned && tab !== "zentao" ? (
          <EmptyState
            icon={Trash}
            title="执行数据已清理"
            desc="这个任务的执行记录、改动和工作目录已被清理。任务本身和 MR 链接都还在。"
            actions={run.mr ? <Button variant="secondary" onClick={() => openExternal(run.mr!.url)}><GitMerge />打开 MR !{run.mr.iid}</Button> : undefined}
            className="h-full"
          />
        ) : (
          <>
            {tab === "run" && <Timeline task={task} />}
            {tab === "diff" && <DiffView task={task} />}
            {tab === "verify" && <VerifyTab task={task} />}
          </>
        )}
        {tab === "zentao" && <ZentaoTab task={task} />}
      </div>

      {tab !== "zentao" && tab !== "verify" && !run.cleaned && <Composer task={task} />}
    </article>
  );
}
