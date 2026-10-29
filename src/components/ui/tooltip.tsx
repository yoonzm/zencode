import * as React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./primitives/tooltip";
import { Kbd } from "./kbd";

interface TipProps {
  label: string;
  keys?: string[];
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactElement;
  className?: string;
}

export { TooltipProvider };

/** 悬停提示：shadcn Tooltip（Radix）。子元素直接作为触发器。 */
export function Tip({ label, keys, side = "bottom", children }: TipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={6} className="flex items-center gap-2 bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">
        {label}
        {keys && <Kbd keys={keys} className="opacity-90 [&_kbd]:border-primary-foreground/30 [&_kbd]:bg-transparent [&_kbd]:text-primary-foreground [&_kbd]:shadow-none" />}
      </TooltipContent>
    </Tooltip>
  );
}
