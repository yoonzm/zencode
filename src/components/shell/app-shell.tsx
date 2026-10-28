import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/state";
import { toggleSidebar } from "@/store/actions";
import { useRoute } from "@/lib/route";
import { useMedia } from "@/lib/hooks";
import { TitleBar } from "@/components/shell/titlebar";
import { Sidebar, SIDEBAR_W } from "@/components/shell/sidebar";
import { TasksView } from "@/components/views/tasks-view";
import { Wizard } from "@/components/views/wizard";
import { Settings } from "@/components/views/settings";
import { CommandPalette } from "@/components/views/palette";
import { ConfirmHost, ShortcutsDialog } from "@/components/views/overlays";
import { ToastViewport } from "@/components/ui/toast";
import { store } from "@/store/state";

export function AppShell() {
  const route = useRoute();
  const open = useApp((s) => s.sidebarOpen);
  const compact = useMedia("(max-width: 859px)");
  const full = route.name === "setup";
  const showInline = open && !compact && !full;
  const showDrawer = open && compact && !full;

  // 窄屏下路由变化后自动收起抽屉
  useEffect(() => {
    if (compact && store.get().sidebarOpen) store.set({ sidebarOpen: false });
    // 仅在断点切换时执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);

  return (
    <div className="flex h-dvh flex-col bg-surface text-foreground">
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        {!full && (
          <div className="shrink-0 overflow-hidden transition-[width] duration-200 ease-out" style={{ width: showInline ? SIDEBAR_W : 0 }} aria-hidden={!showInline}>
            <div inert={!showInline ? ("" as any) : undefined}><Sidebar /></div>
          </div>
        )}
        {showDrawer && (
          <>
            <button aria-label="关闭侧边栏" className="anim-fade fixed inset-0 z-40 bg-scrim" onClick={toggleSidebar} />
            <aside className="anim-rise fixed bottom-0 left-0 top-9 z-50 border-r border-border bg-surface shadow-pop" style={{ width: SIDEBAR_W }}>
              <Sidebar onNavigate={toggleSidebar} />
            </aside>
          </>
        )}
        <main className={cn("min-w-0 flex-1 overflow-hidden bg-background", !full && showInline && "rounded-tl-xl border-l border-t border-border")}>
          {route.name === "setup" ? <Wizard /> : route.name === "prefs" ? <Settings /> : <TasksView />}
        </main>
      </div>
      <ToastViewport />
      <CommandPalette />
      <ConfirmHost />
      <ShortcutsDialog />
    </div>
  );
}
