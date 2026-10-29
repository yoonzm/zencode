import * as React from "react";
import { cn } from "@/lib/utils";
import { Check } from "@/lib/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./primitives/dropdown-menu";
import { Kbd } from "./kbd";

export interface MenuEntry {
  label?: string;
  icon?: React.ComponentType<{ className?: string }>;
  keys?: string[];
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
  heading?: string;
  onClick?: () => void;
}

interface DropMenuProps {
  trigger: React.ReactNode;
  entries: MenuEntry[];
  buttonClassName?: string;
  buttonProps?: Record<string, unknown>;
  align?: "start" | "end";
  side?: "bottom" | "top";
  width?: string;
}

/** 下拉菜单：shadcn DropdownMenu（Radix）。 */
export function DropMenu({ trigger, entries, buttonClassName, buttonProps, align = "start", side = "bottom", width = "min-w-52" }: DropMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn("data-[state=open]:bg-active", buttonClassName)} {...buttonProps}>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} sideOffset={6} collisionPadding={8} className={cn("rounded-lg border-border bg-popover p-1 shadow-pop", width)}>
        {entries.map((e, i) =>
          e.separator ? (
            <DropdownMenuSeparator key={i} className="my-1 bg-border" />
          ) : e.heading ? (
            <DropdownMenuLabel key={i} className="px-2 pb-0.5 pt-1.5 text-xs font-medium text-subtle-foreground">
              {e.heading}
            </DropdownMenuLabel>
          ) : (
            <DropdownMenuItem key={i} disabled={e.disabled} variant={e.danger ? "danger" : "default"} onSelect={() => e.onClick?.()} className="gap-2 py-1.5">
              {e.icon ? <e.icon className="size-4 shrink-0 text-muted-foreground" /> : <span className="size-4 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{e.label}</span>
              {e.checked && <Check className="size-3.5 text-accent" />}
              {e.keys && <Kbd keys={e.keys} />}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
