import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Inbox, ListFilter, RefreshCw, Search, SearchX, WifiOff, X, Layers, ArrowUpDown, Rows, LayoutList } from "@/lib/icons";
import { useApp, store } from "@/store/state";
import { filterTasks, groupTasks, hasActiveFilters, sortTasks } from "@/store/select";
import { resetFilters, setFilters, sync } from "@/store/actions";
import { navigate, useRoute } from "@/lib/route";
import { useNow } from "@/lib/hooks";
import { dueLabel, relTime, shortTime } from "@/lib/time";
import { STATE_LABEL, PRIORITY_LABEL, type Priority, type RunState, type ZTask } from "@/data/types";
import { Avatar, KindIcon, PriorityIcon, StateIcon, StatePill } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import { Checkbox, Segmented } from "@/components/ui/fields";
import { DropMenu, type MenuEntry } from "@/components/ui/menu";
import { Tip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/magic/effects";

// ── 筛选 chip ─────────────────────────────────────────────

function FilterChip<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; label: string; icon?: any }[]; value: T[]; onChange: (v: T[]) => void }) {
  const on = value.length > 0;
  const summary = value.length === 1 ? options.find((o) => o.value === value[0])?.label : `${value.length} 项`;
  return (
    <Popover className="relative shrink-0">
      <PopoverButton
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
          on ? "border-accent/35 bg-accent/10 text-accent" : "border-dashed border-border-strong text-muted-foreground hover:border-solid hover:bg-hover hover:text-foreground",
        )}
      >
        {label}
        {on && <span className="max-w-24 truncate">· {summary}</span>}
        <ChevronDown className="size-3 opacity-70" />
      </PopoverButton>
      <PopoverPanel
        anchor={{ to: "bottom start", gap: 6, padding: 8 }}
        transition
        className="z-[75] min-w-44 rounded-lg border border-border bg-popover p-1 shadow-pop outline-none transition duration-100 ease-out data-[closed]:scale-[0.97] data-[closed]:opacity-0"
      >
        <div className="max-h-72 overflow-y-auto">
          {options.map((o) => {
            const sel = value.includes(o.value);
            return (
              <div key={String(o.value)} className="rounded-md px-2 py-1.5 hover:bg-hover">
                <Checkbox
                  checked={sel}
                  onChange={() => onChange(sel ? value.filter((v) => v !== o.value) : [...value, o.value])}
                  label={
                    <span className="flex items-center gap-2">
                      {o.icon}
                      {o.label}
                    </span>
                  }
                />
              </div>
            );
          })}
        </div>
        {on && (
          <button onClick={() => onChange([])} className="mt-1 w-full rounded-md border-t border-border px-2 pb-1 pt-2 text-left text-xs text-muted-foreground outline-none hover:text-foreground">
            清除此项
          </button>
        )}
      </PopoverPanel>
    </Popover>
  );
}

// ── 行 ───────────────────────────────────────────────────

const TaskRow = memo(function TaskRow({ t, selected, compact, now }: { t: ZTask; selected: boolean; compact: boolean; now: number }) {
  const due = t.deadline && !["done"].includes(t.run.state) ? dueLabel(t.deadline, now) : null;
  const repoName = t.repoId.split("/")[1];
  return (
    <button
      role="option"
      aria-selected={selected}
      data-task-id={t.id}
      onClick={() => navigate({ name: "task", id: t.id })}
      className={cn(
        "group relative flex w-full items-center gap-2.5 px-4 text-left outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
        compact ? "h-9" : "h-[52px]",
        selected ? "bg-accent/10" : "hover:bg-hover",
      )}
    >
      <PriorityIcon p={t.priority} />
      <KindIcon kind={t.kind} className={cn(!compact && "self-start mt-[15px]")} />
      <span className={cn("w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground", !compact && "self-start mt-[15px]")}>{t.no}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", selected ? "font-medium text-foreground" : "text-foreground")}>{t.title}</span>
        {!compact && (
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <span className="truncate">{t.product} · {t.module}</span>
            <span aria-hidden>·</span>
            <span className="font-mono">{repoName}</span>
            {due && (
              <>
                <span aria-hidden>·</span>
                <span className={cn(due.tone === "overdue" && "text-danger", due.tone === "soon" && "text-warning")}>{due.text}</span>
              </>
            )}
          </span>
        )}
      </span>
      {compact && due && due.tone !== "normal" && (
        <span className={cn("hidden shrink-0 text-xs @lg:inline", due.tone === "overdue" ? "text-danger" : "text-warning")}>{due.text}</span>
      )}
      {compact && <span className="hidden max-w-28 shrink-0 truncate rounded-sm bg-muted px-1.5 py-px text-xs text-muted-foreground @xl:inline">{t.module}</span>}
      {t.run.unread && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="有新进展" />}
      <Avatar id={t.assignee} size={18} />
      <span className="hidden shrink-0 @md:block"><StatePill state={t.run.state} /></span>
      <span className="@md:hidden"><StateIcon state={t.run.state} /></span>
      <span className="hidden w-9 shrink-0 text-right text-xs tabular-nums text-subtle-foreground @lg:block">{shortTime(t.updatedAt, now)}</span>
    </button>
  );
});

function GroupHeader({ state, count, open, onToggle }: { state?: RunState; count: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className="sticky top-0 z-[5] flex h-8 w-full items-center gap-2 border-y border-border bg-surface/92 px-4 text-left text-xs font-medium text-muted-foreground outline-none backdrop-blur-sm first:border-t-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
    >
      <ChevronRight className={cn("size-3 transition-transform duration-150", open && "rotate-90")} />
      {state && <StateIcon state={state} className="size-3.5" />}
      <span className="text-foreground">{state ? STATE_LABEL[state] : "全部"}</span>
      <span className="tabular-nums text-subtle-foreground">{count}</span>
    </button>
  );
}

function ListSkeleton() {
  const widths = ["72%", "58%", "81%", "64%", "49%", "77%", "60%", "68%"];
  return (
    <div aria-busy="true" aria-label="正在加载任务" className="py-1">
      {widths.map((w, i) => (
        <div key={i} className="flex h-9 items-center gap-2.5 px-4">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="size-3.5 rounded-sm" />
          <Skeleton className="h-3 w-10" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5" style={{ width: w }} />
          </div>
          <Skeleton className="size-[18px] rounded-full" />
          <Skeleton className="hidden h-5 w-16 rounded-full @md:block" />
        </div>
      ))}
    </div>
  );
}

// ── 主体 ─────────────────────────────────────────────────

export function TaskListPane({ className }: { className?: string }) {
  const tasks = useApp((s) => s.tasks);
  const filters = useApp((s) => s.filters);
  const status = useApp((s) => s.listStatus);
  const syncing = useApp((s) => s.syncing);
  const lastSync = useApp((s) => s.lastSync);
  const group = useApp((s) => s.group);
  const sort = useApp((s) => s.sort);
  const density = useApp((s) => s.density);
  const config = useApp((s) => s.config);
  const route = useRoute();
  const now = useNow(20_000);
  const selectedId = route.name === "task" ? route.id : null;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const scroller = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => sortTasks(filterTasks(tasks, filters), sort), [tasks, filters, sort]);
  const groups = useMemo(() => groupTasks(filtered, group), [filtered, group]);
  const flat = useMemo(() => groups.filter((g) => !collapsed[g.key]).flatMap((g) => g.items), [groups, collapsed]);
  const kindCounts = useMemo(() => {
    const base = filterTasks(tasks, { ...filters, kind: "all" });
    return { all: base.length, bug: base.filter((t) => t.kind === "bug").length, story: base.filter((t) => t.kind === "story").length };
  }, [tasks, filters]);
  const active = hasActiveFilters(filters);
  const running = tasks.filter((t) => t.run.state === "running").length;

  // J / K 切换任务
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (store.get().paletteOpen || store.get().confirm) return;
      if (e.key !== "j" && e.key !== "k") return;
      if (!flat.length) return;
      const i = flat.findIndex((t) => t.id === selectedId);
      const next = e.key === "j" ? Math.min(flat.length - 1, i + 1) : Math.max(0, i === -1 ? 0 : i - 1);
      navigate({ name: "task", id: flat[next].id });
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    scroller.current?.querySelector(`[data-task-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId, status]);

  const viewEntries: MenuEntry[] = [
    { heading: "分组" },
    { label: "按执行状态", icon: Layers, checked: group === "state", onClick: () => store.set({ group: "state" }) },
    { label: "不分组", icon: LayoutList, checked: group === "none", onClick: () => store.set({ group: "none" }) },
    { separator: true },
    { heading: "排序" },
    { label: "最近更新", icon: ArrowUpDown, checked: sort === "updated", onClick: () => store.set({ sort: "updated" }) },
    { label: "优先级", icon: ArrowUpDown, checked: sort === "priority", onClick: () => store.set({ sort: "priority" }) },
    { label: "截止时间", icon: ArrowUpDown, checked: sort === "deadline", onClick: () => store.set({ sort: "deadline" }) },
    { separator: true },
    { heading: "密度" },
    { label: "紧凑（单行）", icon: Rows, checked: density === "compact", onClick: () => store.set({ density: "compact" }) },
    { label: "舒适（两行）", icon: Rows, checked: density === "comfortable", onClick: () => store.set({ density: "comfortable" }) },
  ];

  const repoOptions = config.mappings.map((m) => ({ value: m.repo, label: m.repo.split("/")[1] }));

  let body: any;
  if (status === "loading") body = <ListSkeleton />;
  else if (status === "error")
    body = (
      <EmptyState
        icon={WifiOff}
        tone="danger"
        title="无法连接禅道"
        desc={
          <>
            请求 <code className="font-mono text-xs">{config.zentao.baseUrl.replace(/^https?:\/\//, "")}/api.php/v1/bugs</code> 超时（ETIMEDOUT）。请检查网络或 VPN，并确认禅道地址和 Token 仍然有效。上次成功同步在 {relTime(lastSync, now)}。
          </>
        }
        actions={
          <>
            <Button variant="primary" loading={syncing} onClick={() => sync()}>重试</Button>
            <Button variant="secondary" onClick={() => navigate({ name: "prefs", section: "zentao" })}>检查连接设置</Button>
          </>
        }
        className="h-full"
      />
    );
  else if (status === "empty")
    body = (
      <EmptyState
        icon={Inbox}
        pattern
        title="没有分配给你的任务"
        desc="禅道里暂时没有指派给你的 Bug 或需求。可以调整同步范围，或在禅道创建任务后再同步。"
        actions={
          <>
            <Button variant="primary" loading={syncing} onClick={() => sync()}>同步禅道</Button>
            <Button variant="secondary" onClick={() => navigate({ name: "prefs", section: "zentao" })}>调整同步范围</Button>
          </>
        }
        className="h-full"
      />
    );
  else if (filtered.length === 0)
    body = (
      <EmptyState
        icon={SearchX}
        title="没有符合条件的任务"
        desc={filters.query ? `没有找到与「${filters.query}」匹配的任务。试试任务编号或标题里的关键词。` : "当前筛选条件下没有任务。放宽条件试试。"}
        actions={<Button variant="secondary" onClick={resetFilters}>清除全部筛选</Button>}
        className="h-full"
      />
    );
  else
    body = (
      <div role="listbox" aria-label="任务列表">
        {groups.map((g) => {
          const open = !collapsed[g.key];
          return (
            <section key={g.key} aria-label={g.state ? STATE_LABEL[g.state] : "全部"}>
              {group === "state" && <GroupHeader state={g.state} count={g.items.length} open={open} onToggle={() => setCollapsed((c) => ({ ...c, [g.key]: open }))} />}
              {open && g.items.map((t) => <TaskRow key={t.id} t={t} selected={t.id === selectedId} compact={density === "compact"} now={now} />)}
            </section>
          );
        })}
      </div>
    );

  return (
    <section className={cn("@container flex min-h-0 flex-col bg-background", className)} aria-label="任务">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <h1 className="text-base font-semibold text-foreground">任务</h1>
        <span className="tabular-nums text-xs text-muted-foreground">
          {status === "ready" ? (active ? `${filtered.length} / ${tasks.length}` : tasks.length) : ""}
        </span>
        {running > 0 && status === "ready" && (
          <span className="hidden items-center gap-1 text-xs text-accent @md:inline-flex">
            <span className="dot-pulse size-1.5 rounded-full bg-accent" aria-hidden />
            {running} 个执行中
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <span className="mr-1 hidden text-xs text-subtle-foreground @lg:block">{syncing ? "正在同步…" : `同步于 ${relTime(lastSync, now)}`}</span>
          <Tip label="从禅道同步">
            <Button variant="ghost" size="icon-sm" onClick={() => sync()} aria-label="从禅道同步" disabled={syncing}>
              <RefreshCw className={cn(syncing && "animate-spin")} />
            </Button>
          </Tip>
          <DropMenu
            align="end"
            width="min-w-48"
            buttonClassName="grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-[open]:bg-active"
            buttonProps={{ "aria-label": "视图选项" }}
            trigger={<ListFilter className="size-4" />}
            entries={viewEntries}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 px-4 pb-2">
        <Segmented
          label="任务类型"
          size="sm"
          value={filters.kind}
          onChange={(kind) => setFilters({ kind })}
          options={[
            { value: "all", label: "全部", count: kindCounts.all },
            { value: "bug", label: "Bug", count: kindCounts.bug },
            { value: "story", label: "需求", count: kindCounts.story },
          ]}
        />
        <label className="relative ml-auto min-w-0 flex-1">
          <span className="sr-only">搜索任务</span>
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <input
            id="task-search"
            value={filters.query}
            onChange={(e) => setFilters({ query: e.target.value })}
            placeholder="按编号或标题搜索"
            className="h-7 w-full rounded-md border border-border bg-card pl-7 pr-6 text-sm text-foreground outline-none placeholder:text-subtle-foreground hover:border-border-strong focus:border-accent focus:ring-[3px] focus:ring-accent/18"
          />
          {filters.query && (
            <button onClick={() => setFilters({ query: "" })} aria-label="清除搜索" className="absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-subtle-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          )}
        </label>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-4 pb-2.5">
        <FilterChip<RunState>
          label="状态"
          value={filters.states}
          onChange={(states) => setFilters({ states })}
          options={(["waiting", "failed", "review", "running", "paused", "queued", "idle", "done"] as RunState[]).map((s) => ({ value: s, label: STATE_LABEL[s], icon: <StateIcon state={s} className="size-3.5" /> }))}
        />
        <FilterChip<Priority>
          label="优先级"
          value={filters.priorities}
          onChange={(priorities) => setFilters({ priorities })}
          options={([1, 2, 3, 4] as Priority[]).map((p) => ({ value: p, label: `P${p} ${PRIORITY_LABEL[p]}`, icon: <PriorityIcon p={p} className="size-3.5" /> }))}
        />
        <FilterChip<"me">
          label="负责人"
          value={filters.assignee === "me" ? ["me"] : []}
          onChange={(v) => setFilters({ assignee: v.length ? "me" : "all" })}
          options={[{ value: "me", label: "只看我的", icon: <Avatar id="me" size={14} /> }]}
        />
        <FilterChip<string> label="仓库" value={filters.repos} onChange={(repos) => setFilters({ repos })} options={repoOptions} />
        {active && (
          <button onClick={resetFilters} className="ml-auto shrink-0 rounded-md px-1.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
            清除
          </button>
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto border-t border-border">
        {body}
      </div>
    </section>
  );
}

