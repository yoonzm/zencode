import { cn, hueOf } from "@/lib/utils";
import { Bug, CircleAlert, CircleCheck, CircleDashed, CircleDot, CirclePause, CircleX, Clock, Lightbulb, Loader } from "@/lib/icons";
import { STATE_LABEL, type Priority, type RunState, type TaskKind } from "@/data/types";
import { personName } from "@/data/identity";

import { Avatar as HAvatar, Chip } from "@heroui/react";

export const STATE_TONE: Record<RunState, string> = {
  idle: "text-subtle-foreground",
  queued: "text-muted-foreground",
  running: "text-accent",
  waiting: "text-warning",
  paused: "text-muted-foreground",
  review: "text-accent",
  done: "text-success",
  failed: "text-danger",
};

const STATE_BG: Record<RunState, string> = {
  idle: "bg-muted text-muted-foreground",
  queued: "bg-muted text-muted-foreground",
  running: "bg-accent/12 text-accent",
  waiting: "bg-warning/14 text-warning",
  paused: "bg-muted text-muted-foreground",
  review: "bg-accent/12 text-accent",
  done: "bg-success/12 text-success",
  failed: "bg-danger/12 text-danger",
};

export function StateIcon({ state, className }: { state: RunState; className?: string }) {
  const c = cn("size-4 shrink-0", STATE_TONE[state], className);
  switch (state) {
    case "running":
      return <Loader className={cn(c, "animate-spin")} aria-hidden />;
    case "queued":
      return <Clock className={c} aria-hidden />;
    case "waiting":
      return <CircleAlert className={c} aria-hidden />;
    case "paused":
      return <CirclePause className={c} aria-hidden />;
    case "review":
      return <CircleDot className={c} aria-hidden />;
    case "done":
      return <CircleCheck className={c} aria-hidden />;
    case "failed":
      return <CircleX className={c} aria-hidden />;
    default:
      return <CircleDashed className={c} aria-hidden />;
  }
}

export function StatePill({ state, className, compact }: { state: RunState; className?: string; compact?: boolean }) {
  return (
    <Chip.Root size="sm" className={cn("h-5 gap-1 rounded-full px-1.5", STATE_BG[state], className)}>
      <StateIcon state={state} className={cn("size-3", "text-current")} />
      {!compact && <Chip.Label className="px-0">{STATE_LABEL[state]}</Chip.Label>}
    </Chip.Root>
  );
}

export function KindIcon({ kind, className }: { kind: TaskKind; className?: string }) {
  return kind === "bug" ? (
    <Bug className={cn("size-3.5 shrink-0 text-danger", className)} aria-label="Bug" />
  ) : (
    <Lightbulb className={cn("size-3.5 shrink-0 text-warning", className)} aria-label="需求" />
  );
}

/** 优先级：P1 用醒目的方块，其余用 1–3 根递增的条 */
export function PriorityIcon({ p, className }: { p: Priority; className?: string }) {
  if (p === 1) {
    return (
      <svg viewBox="0 0 16 16" className={cn("size-4 shrink-0", className)} role="img" aria-label="优先级：紧急">
        <rect x="2" y="2" width="12" height="12" rx="3" className="fill-danger" />
        <rect x="7.2" y="4.5" width="1.6" height="4.6" rx=".8" className="fill-card" />
        <rect x="7.2" y="10.4" width="1.6" height="1.6" rx=".8" className="fill-card" />
      </svg>
    );
  }
  const on = p === 2 ? 3 : p === 3 ? 2 : 1;
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4 shrink-0", className)} role="img" aria-label={`优先级：${p === 2 ? "高" : p === 3 ? "中" : "低"}`}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={2.5 + i * 4} y={9 - i * 3} width="3" height={5 + i * 3} rx="1" className={i < on ? "fill-foreground" : "fill-border-strong"} />
      ))}
    </svg>
  );
}

export function Avatar({ id, size = 20, className }: { id: string; size?: number; className?: string }) {
  const name = personName(id);
  return (
    <HAvatar.Root
      className={cn("zc-avatar shrink-0 rounded-full", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46), ["--h" as any]: hueOf(id) }}
      title={name}
      role="img"
      aria-label={name}
    >
      <HAvatar.Fallback className="grid size-full place-items-center rounded-full bg-transparent font-medium leading-none" style={{ fontSize: "inherit", color: "inherit" }}>{name.slice(-2)}</HAvatar.Fallback>
    </HAvatar.Root>
  );
}
