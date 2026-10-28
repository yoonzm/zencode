import { useEffect } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { store, hydrate } from "@/store/state";
import { cycleTheme, setPalette, setShortcuts, toggleSidebar } from "@/store/actions";
import { navigate } from "@/lib/route";
import { hasMod } from "@/lib/platform";
import { isTyping } from "@/lib/hooks";
import { decodeTask } from "@/store/actions";
import { toast } from "@/store/toast";

export function App() {
  useEffect(() => {
    const error = (message: string) => toast({ title: "桌面服务错误", desc: message, tone: "danger", duration: 8000 });
    hydrate().then(() => {
      store.set({ tasks: store.get().tasks.map(decodeTask) });
      if (!store.get().setupDone && !location.hash) navigate({ name: "setup" });
    }).catch(e => error(e.message));
    const offTask = window.desktop?.onTask(task => store.set(s => ({ tasks: s.tasks.map(t => t.id === task.id ? decodeTask(task) : t) })));
    const offError = window.desktop?.onError(error);
    const onError = (e: Event) => error((e as CustomEvent).detail);
    window.addEventListener("desktop-error", onError);

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
      offTask?.(); offError?.(); window.removeEventListener("desktop-error", onError);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return <AppShell />;
}
