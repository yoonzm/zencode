import * as React from "react";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { Input as ShadInput } from "./primitives/input";
import { Textarea as ShadTextarea } from "./primitives/textarea";
import { Switch } from "./primitives/switch";
import { Checkbox as ShadCheckbox } from "./primitives/checkbox";
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./primitives/select";
import { ToggleGroup, ToggleGroupItem } from "./primitives/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "./primitives/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./primitives/command";
import { Check, ChevronDown, RefreshCw } from "@/lib/icons";

type InputProps = Omit<React.ComponentProps<"input">, "ref"> & { invalid?: boolean };

/** 输入框：shadcn Input，加 invalid 便捷属性与紧凑尺寸。 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({ className, invalid, ...p }, ref) {
  return <ShadInput ref={ref as never} aria-invalid={invalid || undefined} className={cn("h-8 px-2.5 text-sm md:text-sm", className)} {...p} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, Omit<React.ComponentProps<"textarea">, "ref"> & { invalid?: boolean }>(function Textarea({ className, invalid, ...p }, ref) {
  return <ShadTextarea ref={ref as never} aria-invalid={invalid || undefined} className={cn("min-h-16 resize-none px-2.5 py-1.5 leading-5", className)} {...p} />;
});

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  children: (p: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode;
  className?: string;
  right?: React.ReactNode;
}

export function Field({ label, hint, error, children, className, right }: FieldProps) {
  const id = useId();
  const descId = `${id}-d`;
  const note = error || hint;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
        {right}
      </div>
      {children({ id, describedBy: note ? descId : undefined, invalid: !!error })}
      {note && (
        <p id={descId} className={cn("text-xs leading-4", error ? "text-danger" : "text-muted-foreground")} role={error ? "alert" : undefined}>
          {note}
        </p>
      )}
    </div>
  );
}

/** 开关：shadcn Switch（Radix）。 */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={label}
      className="h-5 w-9 data-[state=checked]:bg-accent data-[state=unchecked]:bg-border-strong"
      thumbClassName="size-4 data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0.5 data-[state=checked]:bg-accent-foreground data-[state=unchecked]:bg-subtle-foreground"
    />
  );
}

export interface Opt<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** 下拉选择：shadcn Select（Radix）。 */
export function Select<T extends string>({ value, onChange, options, id, className, placeholder = "请选择", invalid }: { value: T | ""; onChange: (v: T) => void; options: Opt<T>[]; id?: string; className?: string; placeholder?: string; invalid?: boolean }) {
  return (
    <ShadSelect value={value || undefined} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger id={id} aria-invalid={invalid || undefined} className={cn("h-8 w-full px-2.5 text-sm data-[size=default]:h-8", className)}>
        <SelectValue placeholder={placeholder}>{options.find((o) => o.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" sideOffset={4} className="rounded-lg border-border bg-popover shadow-pop">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="py-1.5">
            <span className="min-w-0">
              <span className="block truncate">{o.label}</span>
              {o.hint && <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </ShadSelect>
  );
}

/** 分段控件：shadcn ToggleGroup（单选）。 */
export function Segmented<T extends string>({ value, onChange, options, size = "md", label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; count?: number }[]; size?: "sm" | "md"; label: string; className?: string }) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      className={cn("inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5", className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <ToggleGroupItem
            key={o.value}
            value={o.value}
            className={cn(
              "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md font-medium shadow-none first:rounded-md last:rounded-md focus-visible:z-10",
              size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-sm",
              on ? "bg-card text-foreground shadow-sm hover:bg-card" : "bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground",
            )}
          >
            {o.label}
            {o.count != null && <span className={cn("tabular-nums text-xs", on ? "text-muted-foreground" : "text-subtle-foreground")}>{o.count}</span>}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

/** 复选框：shadcn Checkbox（Radix）。 */
export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex items-center gap-2 text-sm", className)}>
      <ShadCheckbox checked={checked} onCheckedChange={(v) => onChange(v === true)} className="data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground" />
      {label}
    </label>
  );
}

/** 可搜索的下拉：选项很多时用它代替 Select。onRefresh 存在时，列表底部和“没有匹配项”处会给出刷新入口。 */
export function Combobox<T extends string>({ value, onChange, options, id, placeholder = "请选择", searchPlaceholder = "搜索…", invalid, disabled, onRefresh, refreshing, className, creatable }: {
  value: T | "";
  onChange: (v: T) => void;
  options: Opt<T>[];
  id?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  /** 允许直接输入列表里没有的值 */
  creatable?: (text: string) => string;
  invalid?: boolean;
  disabled?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const cur = options.find((o) => o.value === value) ?? (creatable && value ? { value, label: value as string } : undefined);
  const typed = q.trim();
  const canCreate = !!creatable && !!typed && !options.some((o) => o.label === typed);
  const refresh = onRefresh && (
    <button type="button" onClick={onRefresh} disabled={refreshing} className="inline-flex items-center gap-1 rounded-sm text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60">
      <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />{refreshing ? "正在刷新…" : "刷新列表"}
    </button>
  );
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn("flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border-strong bg-card px-2.5 text-left text-sm font-normal shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger", className)}
        >
          <span className={cn("min-w-0 truncate", !cur && "text-muted-foreground")}>{cur?.label ?? placeholder}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-(--radix-popover-trigger-width) min-w-56 overflow-hidden p-0 shadow-pop">
        <Command>
          <CommandInput placeholder={searchPlaceholder} value={q} onValueChange={setQ} />
          <CommandList className="max-h-60">
            {canCreate && (
              <CommandItem value={`__create ${typed}`} forceMount onSelect={() => { onChange(typed as T); setOpen(false); setQ(""); }} className="py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">使用「{typed}」</span>
                  <span className="block truncate text-xs text-muted-foreground">{creatable!(typed)}</span>
                </span>
              </CommandItem>
            )}
            <CommandEmpty className={cn("px-3 py-4 text-center text-xs text-muted-foreground", canCreate && "hidden")}>
              <div>没有匹配项</div>
              {refresh && <div className="mt-1.5">找不到想要的？{refresh}</div>}
            </CommandEmpty>
            {options.map((o) => (
              <CommandItem key={o.value} value={`${o.label} ${o.hint ?? ""}`} onSelect={() => { onChange(o.value); setOpen(false); setQ(""); }} className="py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>}
                </span>
                {o.value === value && <Check className="size-4 text-foreground" />}
              </CommandItem>
            ))}
          </CommandList>
          {refresh && <div className="flex items-center justify-between border-t border-border px-2.5 py-1.5 text-xs text-muted-foreground"><span>{options.length} 项</span>{refresh}</div>}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
