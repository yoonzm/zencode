import { cn } from "@/lib/utils";
import { Command, Moon, PanelLeft, PanelLeftClose, Search, Settings, Sun, Monitor } from "@/lib/icons";
import { useApp } from "@/store/state";
import { cycleTheme, setPalette, toggleSidebar } from "@/store/actions";
import { toast } from "@/store/toast";
import { navigate, useRoute } from "@/lib/route";
import { useMedia } from "@/lib/hooks";
import { Tip } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { Logo } from "@/components/logo";

function demoToast() {
  toast({ title: "窗口控件仅在桌面应用中生效", desc: "当前是网页预览，这里只演示 macOS / Windows 的窗口样式。", tone: "info", duration: 2600 });
}

function MacLights() {
  return (
    <div className="no-drag group/lights flex items-center gap-2 pl-3.5 pr-2" aria-hidden>
      {[
        ["bg-danger", "关闭"],
        ["bg-warning", "最小化"],
        ["bg-success", "缩放"],
      ].map(([c, l]) => (
        <button key={l} tabIndex={-1} onClick={demoToast} className={cn("size-3 rounded-full opacity-90 ring-1 ring-inset ring-foreground/15 transition-opacity hover:opacity-100", c)} aria-label={l} />
      ))}
    </div>
  );
}

function WinControls() {
  const base = "grid h-full w-[46px] place-items-center text-foreground transition-colors";
  return (
    <div className="no-drag flex h-full items-stretch" aria-hidden>
      <button tabIndex={-1} onClick={demoToast} className={cn(base, "hover:bg-hover")} aria-label="最小化">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button tabIndex={-1} onClick={demoToast} className={cn(base, "hover:bg-hover")} aria-label="最大化">
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" rx="1" /></svg>
      </button>
      <button tabIndex={-1} onClick={demoToast} className={cn(base, "hover:bg-danger hover:text-white")} aria-label="关闭">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
    </div>
  );
}

export function TitleBar() {
  const platform = useApp((s) => s.platform);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const showControls = useApp((s) => s.windowControls);
  const theme = useApp((s) => s.theme);
  const tasks = useApp((s) => s.tasks);
  const route = useRoute();
  const roomy = useMedia("(min-width: 700px)");
  const mac = platform === "mac";
  const controls = showControls && roomy;

  let title = "任务";
  if (route.name === "task") {
    const t = tasks.find((x) => x.id === route.id);
    title = t ? `${t.kind === "bug" ? "Bug" : "需求"} #${t.no}` : "任务";
  } else if (route.name === "prefs") title = "设置";
  else if (route.name === "setup") title = "首次配置";

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <header className={cn("drag-region app-chrome relative z-30 flex shrink-0 items-center bg-surface", mac ? "h-11" : "h-9")}>
      {controls && mac && <MacLights />}
      <div className={cn("no-drag flex items-center gap-1", !(controls && mac) && "pl-2")}>
        {!mac && <Logo size={16} className="mx-1.5 text-foreground" />}
        <Tip label={sidebarOpen ? "收起侧边栏" : "展开侧边栏"} keys={["mod", "B"]}>
          <button
            onClick={toggleSidebar}
            aria-label={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
            aria-pressed={sidebarOpen}
            className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
          </button>
        </Tip>
      </div>

      <div className={cn("pointer-events-none absolute inset-x-0 flex items-center justify-center text-sm font-medium text-muted-foreground", mac ? "" : "")} aria-hidden>
        <span className="truncate px-24">{title}</span>
      </div>

      <div className="no-drag ml-auto flex h-full items-center gap-1 pr-2">
        <button
          onClick={() => setPalette(true)}
          className={cn(
            "group hidden h-7 items-center gap-2 rounded-md border border-border bg-card/70 pl-2 pr-1.5 text-sm text-muted-foreground outline-none transition-colors hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 sm:flex",
            roomy ? "w-56" : "w-auto",
          )}
          aria-label="打开命令面板"
        >
          <Search className="size-3.5" />
          <span className="flex-1 truncate text-left">搜索或输入命令</span>
          <Kbd keys={["mod", "K"]} />
        </button>
        <button onClick={() => setPalette(true)} aria-label="打开命令面板" className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 sm:hidden">
          <Command className="size-4" />
        </button>
        <Tip label={`主题：${theme === "light" ? "浅色" : theme === "dark" ? "深色" : "跟随系统"}`}>
          <button onClick={cycleTheme} aria-label="切换主题" className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
            <ThemeIcon className="size-4" />
          </button>
        </Tip>
        <Tip label="设置" keys={["mod", ","]}>
          <button onClick={() => navigate({ name: "prefs", section: "general" })} aria-label="设置" className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
            <Settings className="size-4" />
          </button>
        </Tip>
      </div>
      {controls && !mac && <WinControls />}
    </header>
  );
}
