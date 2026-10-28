import { Menu, MenuButton, MenuItem, MenuItems, MenuSeparator } from "@headlessui/react";
import { cn } from "@/lib/utils";
import { Check } from "@/lib/icons";
import { Kbd } from "./kbd";

export interface MenuEntry {
  label?: string;
  icon?: any;
  keys?: string[];
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
  heading?: string;
  onClick?: () => void;
}

interface DropMenuProps {
  trigger: any;
  entries: MenuEntry[];
  buttonClassName?: string;
  buttonProps?: Record<string, any>;
  align?: "start" | "end";
  side?: "bottom" | "top";
  width?: string;
}

export function DropMenu({ trigger, entries, buttonClassName, buttonProps, align = "start", side = "bottom", width = "min-w-52" }: DropMenuProps) {
  return (
    <Menu>
      <MenuButton className={buttonClassName} {...buttonProps}>
        {trigger}
      </MenuButton>
      <MenuItems
        anchor={{ to: `${side} ${align}`, gap: 6, padding: 8 }}
        transition
        className={cn(
          "z-[75] rounded-lg border border-border bg-popover p-1 shadow-pop outline-none transition duration-100 ease-out data-[closed]:scale-[0.97] data-[closed]:opacity-0 [--anchor-gap:6px]",
          width,
        )}
      >
        {entries.map((e, i) =>
          e.separator ? (
            <MenuSeparator key={i} className="my-1 h-px bg-border" />
          ) : e.heading ? (
            <div key={i} className="px-2 pb-0.5 pt-1.5 text-xs font-medium text-subtle-foreground" role="presentation">
              {e.heading}
            </div>
          ) : (
            <MenuItem key={i} disabled={e.disabled}>
              <button
                type="button"
                onClick={e.onClick}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none data-[disabled]:opacity-45",
                  e.danger ? "text-danger data-[focus]:bg-danger/10" : "text-foreground data-[focus]:bg-active",
                )}
              >
                {e.icon ? <e.icon className="size-4 shrink-0 text-muted-foreground" /> : <span className="size-4 shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                {e.checked && <Check className="size-3.5 text-accent" />}
                {e.keys && <Kbd keys={e.keys} />}
              </button>
            </MenuItem>
          ),
        )}
      </MenuItems>
    </Menu>
  );
}
