import { useEffect } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { store } from "@/store/state";
import { cycleTheme, setPalette, setShortcuts, toggleSidebar } from "@/store/actions";
import { navigate } from "@/lib/route";
import { hasMod } from "@/lib/platform";
import { isTyping } from "@/lib/hooks";
import { startSim } from "@/engine/sim";

export function App() {
  useEffect(() => {
    // 首次启动：没有指定路由时进入配置向导
    if (!store.get().setupDone && !location.hash) navigate({ name: "setup" });
    // 列表首次加载
    const t = window.setTimeout(() => {
      if (store.get().listStatus === "loading") store.set({ listStatus: "ready" });
    }, 700);
    startSim();

    const onKey = (e: KeyboardEvent) => {
      if (hasMod(e) && !e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "k") { e.preventDefault(); setPalette(!store.get().paletteOpen); return; }
        if (k === "b") { e.preventDefault(); toggleSidebar(); return; }
        if (k === ",") { e.preventDefault(); navigate({ name: "prefs", section: "general" }); return; }
      }
      if (hasMod(e) && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); cycleTheme(); return; }
      if (e.key === "?" && !isTyping(e.target) && !store.get().paletteOpen) { e.preventDefault(); setShortcuts(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return <AppShell />;
}
