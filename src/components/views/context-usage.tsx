import { useState } from "react";
import type { Run } from "@/data/types";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/primitives/tooltip";

const tokens = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value).toLowerCase();

export function ContextUsage({ usage }: { usage?: Run["contextUsage"] }) {
  const [open, setOpen] = useState(false);
  const used = usage && Number.isSafeInteger(usage.usedTokens) && usage.usedTokens >= 0 ? usage.usedTokens : null;
  const capacity = usage?.contextWindow && Number.isSafeInteger(usage.contextWindow) && usage.contextWindow > 0 ? usage.contextWindow : null;
  const percent = used !== null && capacity !== null ? Math.min(100, Math.round(used / capacity * 100)) : null;
  const summary = percent !== null ? `${percent}% 已用（剩余 ${100 - percent}%）` : "上下文用量暂不可用";
  const detail = used !== null ? `已用 ${tokens(used)} 标记${capacity !== null ? `，共 ${tokens(capacity)}` : "；窗口容量未知"}` : "等待 Codex 返回会话用量";
  const label = `上下文窗口：${summary}，${detail}`;
  return <TooltipProvider delayDuration={150}>
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} onClick={(event) => { event.preventDefault(); setOpen(v => !v); }} className={cn("grid size-7 shrink-0 place-items-center rounded-full outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/60", percent !== null && percent >= 95 ? "text-danger" : percent !== null && percent >= 80 ? "text-warning" : "text-muted-foreground")}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="8" cy="8" r="5.5" opacity="0.25" />
            {percent !== null ? <circle cx="8" cy="8" r="5.5" pathLength="100" strokeDasharray={`${percent} ${100 - percent}`} transform="rotate(-90 8 8)" /> : <circle cx="8" cy="8" r="5.5" strokeDasharray="2 4" opacity="0.5" />}
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8} collisionPadding={12} onEscapeKeyDown={(event) => { event.preventDefault(); setOpen(false); }} className="rounded-xl border border-border bg-popover px-3 py-2 text-center leading-5 text-popover-foreground shadow-pop">
        <p className="text-muted-foreground">上下文窗口</p>
        <p className="font-medium">{summary}</p>
        <p>{detail}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>;
}
