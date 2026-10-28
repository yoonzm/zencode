import { cn } from "@/lib/utils";

interface EmptyProps {
  icon: any;
  title: string;
  desc?: any;
  actions?: any;
  tone?: "default" | "danger";
  className?: string;
  pattern?: boolean;
}

/** 空/错误状态：说明发生了什么，并给出下一步 */
export function EmptyState({ icon: Icon, title, desc, actions, tone = "default", className, pattern }: EmptyProps) {
  return (
    <div className={cn("relative grid place-items-center px-6 py-12 text-center", className)}>
      {pattern && <div className="dot-pattern pointer-events-none absolute inset-0" aria-hidden />}
      <div className="relative flex max-w-sm flex-col items-center">
        <div className={cn("mb-4 grid size-11 place-items-center rounded-xl border bg-card shadow-sm", tone === "danger" ? "border-danger/30 text-danger" : "border-border text-muted-foreground")}>
          <Icon className="size-5" aria-hidden />
        </div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {desc && <p className="mt-1.5 text-sm leading-5 text-muted-foreground">{desc}</p>}
        {actions && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
