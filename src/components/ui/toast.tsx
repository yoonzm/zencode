import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "@/lib/icons";
import { useApp, type Toast } from "@/store/state";
import { dismissToast } from "@/store/toast";

const ICON = { success: CircleCheck, info: Info, warn: TriangleAlert, danger: CircleAlert };
const TONE = { success: "text-success", info: "text-accent", warn: "text-warning", danger: "text-danger" };

function ToastItem({ t }: { t: Toast }) {
  const [hover, setHover] = useState(false);
  const left = useRef(t.duration);
  const started = useRef(0);
  useEffect(() => {
    if (hover) return;
    started.current = Date.now();
    const h = window.setTimeout(() => dismissToast(t.id), left.current);
    return () => {
      window.clearTimeout(h);
      left.current = Math.max(800, left.current - (Date.now() - started.current));
    };
  }, [hover, t.id]);
  const Icon = ICON[t.tone];
  return (
    <motion.div
      layout
      role="status"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
      transition={{ type: "spring", stiffness: 520, damping: 40 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border border-border bg-popover p-3 pr-2 shadow-pop sm:w-[372px]"
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[t.tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium leading-5 text-foreground">{t.title}</p>
        </div>
        {t.desc && <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{t.desc}</p>}
        {t.action && (
          <button
            type="button"
            onClick={() => {
              t.action!.run();
              dismissToast(t.id);
            }}
            className="mt-1.5 rounded-sm text-xs font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="关闭通知"
        onClick={() => dismissToast(t.id)}
        className="grid size-6 shrink-0 place-items-center rounded-md text-subtle-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <X className="size-3.5" />
      </button>
    </motion.div>
  );
}

export function ToastViewport() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex flex-col items-center gap-2 p-3 sm:items-end sm:p-4 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
      <AnimatePresence mode="popLayout" initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}
