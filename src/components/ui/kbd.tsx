import { cn } from "@/lib/utils";
import { keyLabel } from "@/lib/platform";
import { useApp } from "@/store/state";

/** 快捷键。keys 里写 "mod" 会按平台显示 ⌘ 或 Ctrl。 */
export function Kbd({ keys, className }: { keys: string[]; className?: string }) {
  const platform = useApp((s) => s.platform);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={keys.map((k) => keyLabel(k, platform)).join(" ")}>
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-border-strong bg-card px-1 font-sans text-[10.5px] font-medium leading-none text-muted-foreground shadow-sm"
        >
          {keyLabel(k, platform)}
        </kbd>
      ))}
    </span>
  );
}
