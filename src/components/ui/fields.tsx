import { forwardRef, useId } from "react";
import { Listbox, ListboxButton, ListboxOption, ListboxOptions, Switch as HSwitch } from "@headlessui/react";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown } from "@/lib/icons";

const inputBase =
  "w-full rounded-md border border-border-strong bg-card text-sm text-foreground placeholder:text-subtle-foreground outline-none transition-[border-color,box-shadow] duration-100 hover:border-subtle-foreground focus:border-accent focus:ring-[3px] focus:ring-accent/18 disabled:opacity-55 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/20";

export const Input = forwardRef<HTMLInputElement, any>(function Input({ className, invalid, ...p }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(inputBase, "h-8 px-2.5", className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, any>(function Textarea({ className, invalid, ...p }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(inputBase, "min-h-16 resize-none px-2.5 py-1.5 leading-5", className)} {...p} />;
});

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  children: (p: { id: string; describedBy?: string; invalid: boolean }) => any;
  className?: string;
  right?: any;
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

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <HSwitch
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={label}
      className="group relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-border-strong outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background data-[checked]:bg-accent data-[disabled]:opacity-50"
    >
      <span className="size-4 translate-x-0.5 rounded-full bg-subtle-foreground shadow-sm transition duration-150 group-data-[checked]:translate-x-[18px] group-data-[checked]:bg-accent-foreground" />
    </HSwitch>
  );
}

export interface Opt<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export function Select<T extends string>({ value, onChange, options, id, className, placeholder = "请选择", invalid }: { value: T | ""; onChange: (v: T) => void; options: Opt<T>[]; id?: string; className?: string; placeholder?: string; invalid?: boolean }) {
  const cur = options.find((o) => o.value === value);
  return (
    <Listbox value={value} onChange={onChange}>
      <ListboxButton
        id={id}
        aria-invalid={invalid || undefined}
        className={cn(inputBase, "flex h-8 items-center gap-2 px-2.5 text-left data-[open]:border-accent", className)}
      >
        <span className={cn("min-w-0 flex-1 truncate", !cur && "text-subtle-foreground")}>{cur?.label ?? placeholder}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </ListboxButton>
      <ListboxOptions
        anchor={{ to: "bottom start", gap: 4, padding: 8 }}
        transition
        className="z-[75] max-h-72 min-w-[var(--button-width)] rounded-lg border border-border bg-popover p-1 shadow-pop outline-none transition duration-100 ease-out data-[closed]:opacity-0 [--anchor-gap:4px]"
      >
        {options.map((o) => (
          <ListboxOption key={o.value} value={o.value} className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground data-[focus]:bg-active">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{o.label}</span>
              {o.hint && <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>}
            </span>
            {o.value === value && <Check className="size-3.5 shrink-0 text-accent" />}
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = "md", label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: any; count?: number }[]; size?: "sm" | "md"; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-md font-medium outline-none transition-[background-color,color,box-shadow] duration-100 focus-visible:ring-2 focus-visible:ring-ring/60",
              size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-sm",
              on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.count != null && <span className={cn("tabular-nums text-xs", on ? "text-muted-foreground" : "text-subtle-foreground")}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: any; className?: string }) {
  return (
    <label className={cn("flex items-center gap-2 text-sm", className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="grid size-4 shrink-0 place-items-center rounded-[4px] border border-border-strong bg-card text-accent-foreground transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring/60 [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100">
        <Check className="size-3" strokeWidth={3} />
      </span>
      {label}
    </label>
  );
}
