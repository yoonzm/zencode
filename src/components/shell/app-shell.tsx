import { tickReports } from "@/store/report";
import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useApp } from "@/store/state";
import { autoCleanup, sync, toggleSidebar } from "@/store/actions";
import { useRoute } from "@/lib/route";
import { useMedia } from "@/lib/hooks";
import { TitleBar } from "@/components/shell/titlebar";
import { Sidebar, SidebarRail, RAIL_W, SIDEBAR_W } from "@/components/shell/sidebar";
import { TasksView } from "@/components/views/tasks-view";
import { Wizard } from "@/components/views/wizard";
import { Settings } from "@/components/views/settings";
import { ImportDialog } from "@/components/views/import-dialog";
import { CommandPalette } from "@/components/views/palette";
import { ConfirmHost, ShortcutsDialog } from "@/components/views/overlays";
import { ToastViewport } from "@/components/ui/toast";
import { store } from "@/store/state";
import { checkUpdate } from "@/store/update";

export function AppShell() {
  const hydrated = useApp(s => s.hydrated);
  const autoUpdate = useApp(s => s.autoUpdate);
  const channel = useApp(s => s.channel);
  useEffect(() => {
    if (!hydrated || !autoUpdate) return;
    const first = window.setTimeout(() => { void checkUpdate(); }, 4000);
    const interval = window.setInterval(() => { void checkUpdate(); }, 6 * 3600_000);
    return () => { clearTimeout(first); clearInterval(interval); };
  }, [hydrated, autoUpdate, channel]);
  useEffect(() => {
    if (!hydrated) return;
    tickReports();
    const h = window.setInterval(() => tickReports(), 30_000);
    return () => window.clearInterval(h);
  }, [hydrated]);
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

  // 定期自动同步：按设置的间隔（≥1 分钟）静默拉取；窗口在后台也照常同步
  const everyMin = useApp((s) => (s.config.zentao.connected ? (s.config.zentao.syncIntervalMin ?? 5) : 0));
  useEffect(() => {
    if (!everyMin || everyMin < 1) return;
    const ms = everyMin * 60_000;
    const due = () => {
      if (route.name === "setup") return;
      const s = store.get();
      if (s.update.status === "installing") return;
      if (Date.now() - Math.max(s.lastSync, s.lastSyncAttempt) >= ms - 500) void sync({ auto: true });
    };
    const h = window.setInterval(due, Math.min(ms, 15_000));
    return () => window.clearInterval(h);
  }, [everyMin, route.name]);

  const cleanupDays = useApp((s) => s.cleanupDays);
  useEffect(() => {
    const run = () => autoCleanup(cleanupDays);
    run();
    const h = window.setInterval(run, 60_000);
    return () => {
      window.clearInterval(h);
    };
  }, [cleanupDays]);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* 桌面端与浏览器自带窗口标题栏，宽屏不再重复绘制；窄屏才需要顶栏来打开抽屉 */}
      {compact && <TitleBar />}
      <div className="relative flex min-h-0 flex-1">
        {!full && !compact && (
          <motion.div
            className="h-full shrink-0 overflow-hidden border-r border-border bg-surface"
            initial={false}
            animate={{ width: showInline ? SIDEBAR_W : RAIL_W }}
            transition={{ type: "spring", stiffness: 520, damping: 46 }}
          >
            {showInline ? <Sidebar /> : <SidebarRail />}
          </motion.div>
        )}
        <AnimatePresence>
          {showDrawer && (
            <>
              <motion.button
                key="scrim"
                aria-label="关闭侧边栏"
                className="fixed inset-0 z-40 bg-scrim"
                onClick={toggleSidebar}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
              <motion.aside
                key="drawer"
                className="fixed bottom-0 left-0 top-10 z-50 border-r border-border bg-surface shadow-pop"
                style={{ width: SIDEBAR_W }}
                initial={{ x: -SIDEBAR_W }}
                animate={{ x: 0 }}
                exit={{ x: -SIDEBAR_W }}
                transition={{ type: "spring", stiffness: 520, damping: 46 }}
              >
                <Sidebar onNavigate={toggleSidebar} />
              </motion.aside>
            </>
          )}
        </AnimatePresence>
        <main className="min-w-0 flex-1 overflow-hidden bg-background">
          {route.name === "setup" ? <Wizard /> : route.name === "prefs" ? <Settings /> : <TasksView />}
        </main>
      </div>
      <ToastViewport />
      <CommandPalette />
      <ConfirmHost />
      <ImportDialog />
      <ShortcutsDialog />
    </div>
  );
}
