import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { cn } from "@/lib/utils";
import { ArrowRight, Bug, Command as CommandIcon, CornerDownLeft, GitBranch, GitPullRequest, Inbox, Keyboard, ListFilter, Monitor, Moon, PanelLeft, Pause, Play, RefreshCw, RotateCcw, Rocket, Search, Settings, Sun, WifiOff, Wand, Eye, Code, Lightbulb, User, Sparkles, Loader, CircleCheck } from "@/lib/icons";
import { useApp, store } from "@/store/state";
import { useRoute, navigate } from "@/lib/route";
import { fuzzy } from "@/lib/fuzzy";
import { setPalette, setShortcuts, setTheme, setFilters, resetFilters, sync, toggleSidebar, setListStatus, resetDemo, startRun, pauseRun, resumeRun, createMr, retryRun, setTab, openTask } from "@/store/actions";
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
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
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
      { id: "s-fail", group: "状态模拟", title: "模拟：禅道同步失败", hint: "查看错误状态", icon: WifiOff, keywords: "错误 error", run: done(() => { navigate({ name: "tasks" }); setListStatus("error"); }) },
      { id: "s-empty", group: "状态模拟", title: "模拟：没有任务", hint: "查看空状态", icon: Inbox, keywords: "空 empty", run: done(() => { navigate({ name: "tasks" }); setListStatus("empty"); }) },
      { id: "s-load", group: "状态模拟", title: "模拟：列表加载中", hint: "查看骨架屏", icon: Loader, keywords: "加载 loading", run: done(() => { navigate({ name: "tasks" }); setListStatus("loading"); setTimeout(() => setListStatus("ready"), 2600); }) },
      { id: "s-ok", group: "状态模拟", title: "恢复正常列表", icon: CircleCheck, run: done(() => { setListStatus("ready"); }) },
      { id: "s-reset", group: "状态模拟", title: "重新同步数据", icon: Wand, run: done(resetDemo) },
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
      const sim = cmds.filter((c) => c.group === "状态模拟").slice(0, 3);
      return [...ctx, ...base, ...recent, ...sim].map((c) => ({ c, idx: [] as number[], score: 0 }));
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

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, results]);

  // 分组渲染（保持结果顺序，相邻同组合并标题）
  const rows: any[] = [];
  let lastGroup = "";
  results.forEach((r, i) => {
    if (r.c.group !== lastGroup) {
      rows.push({ type: "h", label: q.trim() ? r.c.group : r.c.group === "任务" ? "最近任务" : r.c.group });
      lastGroup = r.c.group;
    }
    rows.push({ type: "i", r, i });
  });

  const onKey = (e: import("react").KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Home") {
      setActive(0);
    } else if (e.key === "End") {
      setActive(results.length - 1);
    } else if (e.key === "Enter" && !e.nativeEvent?.isComposing) {
      e.preventDefault();
      results[active]?.c.run();
    }
  };

  return (
    <Dialog open={open} onClose={close} className="relative z-[80]">
      <DialogBackdrop transition className="fixed inset-0 bg-scrim transition duration-150 ease-out data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-start justify-center p-3 pt-[10vh] sm:p-4 sm:pt-[12vh]">
        <DialogPanel
          transition
          className="flex max-h-[min(30rem,76vh)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-pop outline-none transition duration-150 ease-out data-[closed]:scale-[0.97] data-[closed]:opacity-0"
        >
          <div className="flex items-center gap-2.5 border-b border-border px-3.5">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={input}
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              aria-activedescendant={results[active] ? `palette-opt-${active}` : undefined}
              aria-label="搜索任务或命令"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              placeholder="搜索任务、输入命令…"
              className="h-12 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-subtle-foreground"
            />
            <Kbd keys={["esc"]} />
          </div>
          <div ref={listRef} id="palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {results.length === 0 && (
              <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                没有找到「{q}」。试试任务编号、标题关键词，或「设置」「同步」。
              </div>
            )}
            {rows.map((row, k) =>
              row.type === "h" ? (
                <div key={`h${k}`} className="px-2.5 pb-1 pt-2.5 text-xs font-medium text-subtle-foreground" role="presentation">
                  {row.label}
                </div>
              ) : (
                <button
                  key={row.r.c.id}
                  id={`palette-opt-${row.i}`}
                  role="option"
                  aria-selected={row.i === active}
                  data-idx={row.i}
                  onMouseMove={() => active !== row.i && setActive(row.i)}
                  onClick={row.r.c.run}
                  className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none", row.i === active ? "bg-active" : "")}
                >
                  <span className="grid size-5 shrink-0 place-items-center text-muted-foreground">
                    {row.r.c.node ?? (row.r.c.icon ? <row.r.c.icon className="size-4" /> : <CommandIcon className="size-4" />)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    <Highlight text={row.r.c.title} idx={row.r.idx} />
                  </span>
                  {row.r.c.hint && <span className="hidden max-w-[40%] shrink-0 truncate text-xs text-muted-foreground sm:block">{row.r.c.hint}</span>}
                  {row.r.c.keys && <Kbd keys={row.r.c.keys} />}
                  {row.i === active && !row.r.c.keys && <CornerDownLeft className="size-3.5 shrink-0 text-subtle-foreground" />}
                </button>
              ),
            )}
          </div>
          <div className="flex items-center gap-4 border-t border-border bg-surface px-3.5 py-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Kbd keys={["up"]} /><Kbd keys={["down"]} />选择</span>
            <span className="inline-flex items-center gap-1.5"><Kbd keys={["enter"]} />执行</span>
            <span className="ml-auto hidden sm:inline">{results.length} 项</span>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
