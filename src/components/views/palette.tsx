import { Fragment, useEffect, useMemo, useState } from "react";
import { Command as Cmdk } from "cmdk";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/primitives/dialog";
import { cn } from "@/lib/utils";
import { ArrowRight, Bug, Command as CommandIcon, CornerDownLeft, GitBranch, GitPullRequest, Inbox, Keyboard, ListFilter, Monitor, Moon, PanelLeft, Pause, Play, RefreshCw, RotateCcw, Rocket, Search, Settings, Sun, Eye, Code, Lightbulb, User, Sparkles, Loader } from "@/lib/icons";
import { useApp, store } from "@/store/state";
import { useRoute, navigate } from "@/lib/route";
import { fuzzy } from "@/lib/fuzzy";
import { setPalette, setShortcuts, setTheme, setFilters, resetFilters, sync, toggleSidebar, startRun, pauseRun, resumeRun, createMr, retryRun, setTab, openTask } from "@/store/actions";
import { EMPTY_FILTERS } from "@/store/state";
import { copyText } from "@/lib/clipboard";
import { Kbd } from "@/components/ui/kbd";
import { StateIcon } from "@/components/ui/status";
import { STATE_LABEL } from "@/data/types";

interface Cmd {
  id: string;
  group: string;
  title: string;
  hint?: string;
  keys?: string[];
  keywords?: string;
  icon?: any;
  node?: any;
  run: () => void;
}

function Highlight({ text, idx }: { text: string; idx: number[] }) {
  if (!idx.length) return <>{text}</>;
  const set = new Set(idx);
  const parts: any[] = [];
  let buf = "";
  let on = false;
  const flush = () => {
    if (!buf) return;
    parts.push(on ? <mark key={parts.length} className="bg-transparent font-semibold text-accent">{buf}</mark> : <Fragment key={parts.length}>{buf}</Fragment>);
    buf = "";
  };
  [...text].forEach((ch, i) => {
    const m = set.has(i);
    if (m !== on) {
      flush();
      on = m;
    }
    buf += ch;
  });
  flush();
  return <>{parts}</>;
}

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const tasks = useApp((s) => s.tasks);
  const route = useRoute();
  const [q, setQ] = useState("");

  useEffect(() => {
    if (open) {
      setQ("");
    }
  }, [open]);

  const close = () => setPalette(false);
  const done = (fn: () => void) => () => {
    close();
    // 等对话框收起后再执行，避免焦点被抢回
    setTimeout(fn, 60);
  };

  const cmds = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [];
    const cur = route.name === "task" ? tasks.find((t) => t.id === route.id) : undefined;
    if (cur) {
      const st = cur.run.state;
      const label = `${cur.kind === "bug" ? "Bug" : "需求"} #${cur.no}`;
      if (st === "idle") list.push({ id: "c-start", group: "当前任务", title: "交给 Codex 执行", hint: label, icon: Play, run: done(() => startRun(cur.id)) });
      if (st === "running") list.push({ id: "c-pause", group: "当前任务", title: "暂停执行", hint: label, icon: Pause, run: done(() => pauseRun(cur.id)) });
      if (st === "paused") list.push({ id: "c-resume", group: "当前任务", title: "恢复执行", hint: label, icon: Play, run: done(() => resumeRun(cur.id)) });
      if (st === "review") list.push({ id: "c-mr", group: "当前任务", title: "创建 Merge Request", hint: label, icon: GitPullRequest, run: done(() => createMr(cur.id)) });
      if (st === "failed") list.push({ id: "c-retry", group: "当前任务", title: "重试", hint: label, icon: RotateCcw, run: done(() => retryRun(cur.id)) });
      list.push({ id: "c-instr", group: "当前任务", title: "追加指令…", hint: label, icon: Sparkles, keywords: "输入 指令 要求", run: done(() => { setTab("run"); setTimeout(() => document.getElementById("composer")?.focus(), 30); }) });
      list.push({ id: "c-run", group: "当前任务", title: "查看执行过程", icon: Loader, keys: ["1"], run: done(() => setTab("run")) });
      list.push({ id: "c-diff", group: "当前任务", title: "查看代码变更", icon: Code, keys: ["2"], run: done(() => setTab("diff")) });
      list.push({ id: "c-zt", group: "当前任务", title: "查看禅道原文", icon: Eye, keys: ["3"], run: done(() => setTab("zentao")) });
      if (cur.run.branch) list.push({ id: "c-copy", group: "当前任务", title: "复制分支名", hint: cur.run.branch, icon: GitBranch, run: done(() => copyText(cur.run.branch!, "已复制分支名")) });
    }

    list.push(
      { id: "g-sync", group: "操作", title: "从禅道同步任务", icon: RefreshCw, keywords: "刷新 sync", run: done(() => sync()) },
      { id: "g-sidebar", group: "操作", title: "收起 / 展开侧边栏", icon: PanelLeft, keys: ["mod", "B"], run: done(toggleSidebar) },
      { id: "g-settings", group: "操作", title: "打开设置", icon: Settings, keys: ["mod", ","], keywords: "偏好 配置", run: done(() => navigate({ name: "prefs", section: "general" })) },
      { id: "g-wizard", group: "操作", title: "重新运行配置向导", icon: Rocket, keywords: "首次 引导 setup", run: done(() => navigate({ name: "setup" })) },
      { id: "g-keys", group: "操作", title: "显示键盘快捷键", icon: Keyboard, keys: ["?"], run: done(() => setShortcuts(true)) },
      { id: "t-light", group: "外观", title: "主题：浅色", icon: Sun, keywords: "亮色 light", run: done(() => setTheme("light")) },
      { id: "t-dark", group: "外观", title: "主题：深色", icon: Moon, keywords: "暗色 dark", run: done(() => setTheme("dark")) },
      { id: "t-system", group: "外观", title: "主题：跟随系统", icon: Monitor, keywords: "system auto", run: done(() => setTheme("system")) },
      { id: "f-bug", group: "筛选", title: "只看 Bug", icon: Bug, run: done(() => { setFilters({ kind: "bug" }); navigate({ name: "tasks" }); }) },
      { id: "f-story", group: "筛选", title: "只看需求", icon: Lightbulb, run: done(() => { setFilters({ kind: "story" }); navigate({ name: "tasks" }); }) },
      { id: "f-mine", group: "筛选", title: "只看我的任务", icon: User, run: done(() => { setFilters({ assignee: "me" }); navigate({ name: "tasks" }); }) },
      { id: "f-active", group: "筛选", title: "只看执行中", icon: Sparkles, run: done(() => { setFilters({ states: ["running", "queued", "waiting", "paused"] }); navigate({ name: "tasks" }); }) },
      { id: "f-review", group: "筛选", title: "只看待审核", icon: GitPullRequest, run: done(() => { setFilters({ states: ["review"] }); navigate({ name: "tasks" }); }) },
      { id: "f-clear", group: "筛选", title: "清除全部筛选", icon: ListFilter, run: done(() => resetFilters()) },
      { id: "p-zt", group: "设置", title: "禅道连接", icon: Settings, run: done(() => navigate({ name: "prefs", section: "zentao" })) },
      { id: "p-gl", group: "设置", title: "GitLab 连接", icon: Settings, run: done(() => navigate({ name: "prefs", section: "gitlab" })) },
      { id: "p-cx", group: "设置", title: "Codex 与权限", icon: Settings, run: done(() => navigate({ name: "prefs", section: "codex" })) },
      { id: "p-map", group: "设置", title: "仓库映射", icon: Settings, run: done(() => navigate({ name: "prefs", section: "repos" })) },
    );

    for (const t of tasks) {
      list.push({
        id: `task-${t.id}`,
        group: "任务",
        title: `${t.kind === "bug" ? "Bug" : "需求"} #${t.no} ${t.title}`,
        keywords: `${t.module} ${t.product} ${t.no}`,
        node: <StateIcon state={t.run.state} />,
        hint: STATE_LABEL[t.run.state],
        run: done(() => openTask(t.id)),
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, route.name === "task" ? route.id : "", open]);

  const results = useMemo(() => {
    const query = q.trim();
    if (!query) {
      const ctx = cmds.filter((c) => c.group === "当前任务").slice(0, 6);
      const base = cmds.filter((c) => ["g-sync", "g-settings", "t-dark", "g-keys"].includes(c.id));
      const recent = cmds.filter((c) => c.group === "任务").slice(0, 4);
      return [...ctx, ...base, ...recent].map((c) => ({ c, idx: [] as number[], score: 0 }));
    }
    const out: { c: Cmd; idx: number[]; score: number }[] = [];
    for (const c of cmds) {
      const m = fuzzy(query, c.title);
      const m2 = m ?? fuzzy(query, `${c.title} ${c.keywords ?? ""} ${c.group}`);
      if (m2) out.push({ c, idx: m ? m.idx : [], score: m2.score + (c.group === "任务" ? -4 : 0) });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 40);
  }, [q, cmds]);

  // 按相邻同组合并成分组，保持搜索结果的排序
  const groups: { label: string; items: typeof results }[] = [];
  for (const r of results) {
    const label = q.trim() ? r.c.group : r.c.group === "任务" ? "最近任务" : r.c.group;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(r);
    else groups.push({ label, items: [r] });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        showCloseButton={false}
        className="top-[10vh] max-w-xl translate-y-0 gap-0 overflow-hidden rounded-xl border-border bg-popover p-0 shadow-pop sm:top-[12vh] sm:max-w-xl"
      >
        <DialogTitle className="sr-only">命令面板</DialogTitle>
        <DialogDescription className="sr-only">搜索任务，或输入命令</DialogDescription>
        <Cmdk shouldFilter={false} loop label="命令面板" className="flex max-h-[min(30rem,76vh)] flex-col">
          <div className="flex items-center gap-2.5 border-b border-border px-3.5">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Cmdk.Input
              autoFocus
              value={q}
              onValueChange={setQ}
              aria-label="搜索任务或命令"
              placeholder="搜索任务、输入命令…"
              className="h-12 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-subtle-foreground"
            />
            <Kbd keys={["esc"]} />
          </div>
          <Cmdk.List className="min-h-0 flex-1 overflow-y-auto p-1.5">
            <Cmdk.Empty className="px-3 py-10 text-center text-sm text-muted-foreground">
              没有找到「{q}」。试试任务编号、标题关键词，或「设置」「同步」。
            </Cmdk.Empty>
            {groups.map((g) => (
              <Cmdk.Group
                key={g.label}
                heading={g.label}
                className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle-foreground"
              >
                {g.items.map(({ c, idx }) => (
                  <Cmdk.Item
                    key={c.id}
                    value={c.id}
                    onSelect={c.run}
                    className="group flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none data-[selected=true]:bg-active"
                  >
                    <span className="grid size-5 shrink-0 place-items-center text-muted-foreground">
                      {c.node ?? (c.icon ? <c.icon className="size-4" /> : <CommandIcon className="size-4" />)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      <Highlight text={c.title} idx={idx} />
                    </span>
                    {c.hint && <span className="hidden max-w-[40%] shrink-0 truncate text-xs text-muted-foreground sm:block">{c.hint}</span>}
                    {c.keys ? <Kbd keys={c.keys} /> : <CornerDownLeft className="hidden size-3.5 shrink-0 text-subtle-foreground group-data-[selected=true]:block" />}
                  </Cmdk.Item>
                ))}
              </Cmdk.Group>
            ))}
          </Cmdk.List>
          <div className="flex items-center gap-4 border-t border-border bg-surface px-3.5 py-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Kbd keys={["up"]} /><Kbd keys={["down"]} />选择</span>
            <span className="inline-flex items-center gap-1.5"><Kbd keys={["enter"]} />执行</span>
            <span className="ml-auto hidden sm:inline">{results.length} 项</span>
          </div>
        </Cmdk>
      </DialogContent>
    </Dialog>
  );
}
