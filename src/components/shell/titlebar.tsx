import { taskRef } from "@/lib/task";
import { Moon, PanelLeft, PanelLeftClose, Search, Sun, Monitor } from "@/lib/icons";
import { useApp } from "@/store/state";
import { cycleTheme, setPalette, toggleSidebar } from "@/store/actions";
import { useRoute } from "@/lib/route";
import { Tip } from "@/components/ui/tooltip";
import { Logo } from "@/components/logo";

const iconBtn =
  "no-drag grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60";

/** Business toolbar; native OS decorations provide the window controls. */
export function TitleBar() {
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const theme = useApp((s) => s.theme);
  const tasks = useApp((s) => s.tasks);
  const route = useRoute();

  let title = "任务";
  if (route.name === "task") {
    const t = tasks.find((x) => x.id === route.id);
    title = t ? taskRef(t) : "任务";
  } else if (route.name === "prefs") title = "设置";
  else if (route.name === "setup") title = "首次配置";

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const themeLabel = theme === "light" ? "浅色" : theme === "dark" ? "深色" : "跟随系统";

  return (
    <header className="drag-region app-chrome relative z-30 flex h-10 shrink-0 items-center gap-1 bg-surface px-2">
      {route.name !== "setup" && (
        <Tip label={sidebarOpen ? "收起侧边栏" : "展开侧边栏"} keys={["mod", "B"]}>
          <button onClick={toggleSidebar} aria-label={sidebarOpen ? "收起侧边栏" : "展开侧边栏"} aria-pressed={sidebarOpen} className={iconBtn}>
            {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
          </button>
        </Tip>
      )}
      {(!sidebarOpen || route.name === "setup") && <Logo size={16} className="ml-1 text-foreground" />}

      <div className="pointer-events-none absolute inset-x-0 flex items-center justify-center text-sm font-medium text-muted-foreground" aria-hidden>
        <span className="truncate px-24">{title}</span>
      </div>

      <div className="no-drag ml-auto flex items-center gap-1">
        {/* 侧边栏收起时，搜索入口仍然可用；展开时用侧边栏里的搜索框 */}
        {!sidebarOpen && route.name !== "setup" && (
          <Tip label="搜索或输入命令" keys={["mod", "K"]}>
            <button onClick={() => setPalette(true)} aria-label="打开命令面板" className={iconBtn}>
              <Search className="size-4" />
            </button>
          </Tip>
        )}
        <Tip label={`主题：${themeLabel}`}>
          <button onClick={cycleTheme} aria-label={`切换主题，当前：${themeLabel}`} className={iconBtn}>
            <ThemeIcon className="size-4" />
          </button>
        </Tip>
      </div>
    </header>
  );
}
