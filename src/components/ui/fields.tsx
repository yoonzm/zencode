import * as React from "react";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { Input as ShadInput } from "./primitives/input";
import { Textarea as ShadTextarea } from "./primitives/textarea";
import { Switch } from "./primitives/switch";
import { Checkbox as ShadCheckbox } from "./primitives/checkbox";
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./primitives/select";
import { ToggleGroup, ToggleGroupItem } from "./primitives/toggle-group";

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
