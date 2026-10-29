import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronsUpDown, FolderGit, Inbox, Moon, Monitor, PanelLeft, PanelLeftClose, RefreshCw, Search, Settings, Sparkles, Sun, User, CircleCheck, GitPullRequest, RotateCcw, Rocket } from "@/lib/icons";
import { useApp } from "@/store/state";
import { PRESETS, activePreset, filterTasks, presetFilters } from "@/store/select";
import { cycleTheme, setFilters, setPalette, sync, toggleSidebar } from "@/store/actions";
import { store } from "@/store/state";
import { navigate, useRoute } from "@/lib/route";
import { Logo } from "@/components/logo";
import { DropMenu } from "@/components/ui/menu";
import { Kbd } from "@/components/ui/kbd";
import { Tip } from "@/components/ui/tooltip";
import { StateIcon } from "@/components/ui/status";
import type { RunState } from "@/data/types";

export const SIDEBAR_W = 264;
export const RAIL_W = 48;

function NavItem({ icon: Icon, label, count, active, onClick, mono }: { icon?: any; label: string; count?: number; active?: boolean; onClick: () => void; mono?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
        active ? "bg-active font-medium text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
      )}
    >
      {Icon && <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")} />}
      <span className={cn("min-w-0 flex-1 truncate", mono && "font-mono text-xs")}>{label}</span>
      {count != null && count > 0 && <span className="tabular-nums text-xs text-subtle-foreground">{count}</span>}
    </button>
  );
}

function SectionTitle({ children }: { children: any }) {
  return <h2 className="px-2 pb-1 pt-4 text-xs font-medium text-subtle-foreground">{children}</h2>;
}

const PRESET_ICON: Record<string, any> = { all: Inbox, mine: User, active: Sparkles, review: GitPullRequest, done: CircleCheck };

const ICON_BTN =
  "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60";

function ThemeButton() {
  const theme = useApp((s) => s.theme);
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label = theme === "light" ? "浅色" : theme === "dark" ? "深色" : "跟随系统";
  return (
    <Tip label={`主题：${label}`} side="top">
      <button onClick={cycleTheme} aria-label={`切换主题，当前：${label}`} className={ICON_BTN}>
        <Icon className="size-4" />
      </button>
    </Tip>
  );
}

/** 侧边栏收起后的窄栏：展开、搜索、设置、主题 */
export function SidebarRail() {
  const route = useRoute();
  return (
    <div className="app-chrome flex h-full flex-col items-center gap-1 py-2" style={{ width: RAIL_W }}>
      <Tip label="展开侧边栏" keys={["mod", "B"]} side="right">
        <button onClick={toggleSidebar} aria-label="展开侧边栏" className={ICON_BTN}>
          <PanelLeft className="size-4" />
        </button>
      </Tip>
      <Tip label="搜索或输入命令" keys={["mod", "K"]} side="right">
        <button onClick={() => setPalette(true)} aria-label="打开命令面板" className={ICON_BTN}>
          <Search className="size-4" />
        </button>
      </Tip>
      <div className="flex-1" />
      <ThemeButton />
      <Tip label="设置" keys={["mod", ","]} side="right">
        <button
          onClick={() => navigate({ name: "prefs", section: "general" })}
          aria-label="设置"
          aria-current={route.name === "prefs" ? "page" : undefined}
          className={cn(ICON_BTN, route.name === "prefs" && "bg-active text-foreground")}
        >
          <Settings className="size-4" />
        </button>
      </Tip>
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const tasks = useApp((s) => s.tasks);
  const filters = useApp((s) => s.filters);
  const config = useApp((s) => s.config);
  const route = useRoute();
  const syncing = useApp((s) => s.syncing);

  const counts = useMemo(() => Object.fromEntries(PRESETS.map((p) => [p.id, filterTasks(tasks, presetFilters(p)).length])), [tasks]);
  const repoCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) m.set(t.repoId, (m.get(t.repoId) ?? 0) + 1);
    return m;
  }, [tasks]);
  const recent = useMemo(
    () =>
      tasks
        .filter((t) => (["running", "waiting", "paused", "queued", "failed", "review"] as RunState[]).includes(t.run.state))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [tasks],
  );
  const [showAllRecent, setShowAllRecent] = useState(false);
  const RECENT_LIMIT = 10;
  const recentShown = showAllRecent ? recent : recent.slice(0, RECENT_LIMIT);

  const active = route.name === "prefs" || route.name === "setup" ? null : activePreset(filters);
  const go = () => onNavigate?.();


  return (
    <div className="app-chrome flex h-full flex-col" style={{ width: SIDEBAR_W }}>
      <div className="flex items-center gap-1 px-2 pt-2">
        <div className="min-w-0 flex-1">
        <DropMenu
          buttonClassName="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/60 data-[open]:bg-active"
          trigger={
            <>
              <Logo size={20} className="text-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold leading-4 text-foreground">ZenCode</span>
                <span className="block truncate text-xs leading-4 text-muted-foreground">{config.zentao.baseUrl.replace(/^https?:\/\//, "")}</span>
              </span>
              <ChevronsUpDown className="size-3.5 text-subtle-foreground" />
            </>
          }
          width="w-60"
          entries={[
            { label: "立即同步禅道", icon: RefreshCw, onClick: () => sync() },
            { label: "重新运行配置向导", icon: Rocket, onClick: () => navigate({ name: "setup" }) },
            { separator: true },
            { label: "重新同步数据", icon: RotateCcw, onClick: () => sync() },
          ]}
        />
        </div>
        <Tip label="收起侧边栏" keys={["mod", "B"]}>
          <button onClick={toggleSidebar} aria-label="收起侧边栏" className={ICON_BTN}>
            <PanelLeftClose className="size-4" />
          </button>
        </Tip>
      </div>

      <div className="px-2 pt-1">
        <button
          onClick={() => setPalette(true)}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-card/60 px-2 text-sm text-muted-foreground outline-none transition-colors hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">搜索…</span>
          <Kbd keys={["mod", "K"]} />
        </button>
      </div>

      <nav aria-label="任务视图" className="flex-1 overflow-y-auto px-2 pb-2">
        <SectionTitle>任务</SectionTitle>
        <div className="space-y-0.5">
          {PRESETS.map((p) => (
            <NavItem
              key={p.id}
              icon={PRESET_ICON[p.id]}
              label={p.label}
              count={p.id === "all" ? undefined : counts[p.id]}
              active={active === p.id}
              onClick={() => {
                store.set({ filters: presetFilters(p) });
                navigate({ name: "tasks" });
                go();
              }}
            />
          ))}
        </div>

        <SectionTitle>仓库</SectionTitle>
        <div className="space-y-0.5">
          {config.mappings.map((m) => {
            const on = filters.repos.length === 1 && filters.repos[0] === m.repo && route.name !== "prefs";
            return (
              <NavItem
                key={m.id}
                icon={FolderGit}
                label={m.repo.split("/")[1]}
                count={repoCounts.get(m.repo)}
                active={on}
                onClick={() => {
                  setFilters({ repos: on ? [] : [m.repo] });
                  navigate({ name: "tasks" });
                  go();
                }}
                mono
              />
            );
          })}
        </div>

        {recent.length > 0 && (
          <>
            <SectionTitle>最近会话</SectionTitle>
            <div className="space-y-0.5">
              {recentShown.map((t) => {
                const on = route.name === "task" && route.id === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      navigate({ name: "task", id: t.id });
                      go();
                    }}
                    className={cn(
                      "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
                      on ? "bg-active text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
                    )}
                  >
                    <StateIcon state={t.run.state} className="size-3.5" />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    {t.run.unread && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="未读" />}
                  </button>
                );
              })}
              {recent.length > RECENT_LIMIT && (
                <button
                  onClick={() => setShowAllRecent((v) => !v)}
                  aria-expanded={showAllRecent}
                  className="flex h-7 w-full items-center rounded-md px-2 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {showAllRecent ? "收起" : `显示更多（还有 ${recent.length - RECENT_LIMIT} 个）`}
                </button>
              )}
            </div>
          </>
        )}
      </nav>

      <div className="flex items-center gap-1 border-t border-border px-2 py-2">
        <button
          onClick={() => {
            navigate({ name: "prefs", section: "general" });
            go();
          }}
          aria-current={route.name === "prefs" ? "page" : undefined}
          className={cn(
            "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
            route.name === "prefs" ? "bg-active text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
          )}
        >
          <Settings className="size-4" />
          <span className="flex-1 text-left">设置</span>
          <Kbd keys={["mod", ","]} />
        </button>
        <ThemeButton />
      </div>
      {syncing && <span className="sr-only" role="status">正在同步</span>}
    </div>
  );
}
