import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Cpu, RefreshCw, ShieldAlert, ShieldCheck } from "@/lib/icons";
import type { SandboxMode } from "@/data/types";
import { useModels, selection, type Effort } from "@/data/models";
import { store, useApp } from "@/store/state";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives/popover";

const patchCodex = (p: Partial<{ model: string; effort: Effort; sandbox: SandboxMode }>) => store.set((s) => ({ config: { ...s.config, codex: { ...s.config.codex, ...p } } }));

const ACCESS: { id: SandboxMode; short: string; title: string; desc: string }[] = [
  { id: "read-only", short: "只读", title: "只读", desc: "只能看代码，不改文件、不跑命令" },
  { id: "workspace-write", short: "需审批", title: "工作区可写 · 需审批", desc: "改仓库内文件；联网、装依赖会先问你" },
  { id: "workspace-auto", short: "自动执行", title: "工作区可写 · 自动执行", desc: "仓库内自动跑命令，仍然禁止联网" },
  { id: "full-access", short: "完全访问", title: "完全访问", desc: "不受沙盒限制，只建议在隔离环境使用" },
];

const trigger = "inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-active";

/** 权限：左下角。完全访问用警示色，一眼能看出来 */
export function AccessPicker() {
  const sandbox = useApp((s) => s.config.codex.sandbox);
  const [open, setOpen] = useState(false);
  const cur = ACCESS.find((a) => a.id === sandbox)!;
  const risky = sandbox === "full-access";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn(trigger, risky ? "text-warning" : "text-muted-foreground hover:text-foreground")} aria-label={`权限：${cur.title}`}>
        {risky ? <ShieldAlert className="size-3.5 shrink-0" /> : <ShieldCheck className="size-3.5 shrink-0" />}
        <span className="truncate">{cur.short}</span>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" sideOffset={8} collisionPadding={8} className="w-72 rounded-xl border-border bg-popover p-1.5 shadow-pop">
        <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-subtle-foreground">Codex 能做什么</p>
        {ACCESS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => { patchCodex({ sandbox: a.id }); setOpen(false); }}
            className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left outline-none hover:bg-hover focus-visible:bg-hover"
          >
            <span className="min-w-0 flex-1">
              <span className={cn("flex items-center gap-1.5 text-sm font-medium", a.id === "full-access" ? "text-warning" : "text-foreground")}>
                {a.id === "full-access" && <ShieldAlert className="size-3.5" />}
                {a.title}
              </span>
              <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{a.desc}</span>
            </span>
            {a.id === sandbox && <Check className="mt-0.5 size-4 shrink-0 text-accent" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** 模型和思考强度：右下角，写明当前用的是什么 */
export function ModelPicker() {
  const { model, effort, cliPath } = useApp((s) => s.config.codex);
  const catalog = useModels(cliPath);
  const selected = catalog.models.find(m => m.model === model) ?? catalog.models.find(m => m.isDefault) ?? catalog.models[0];
  useEffect(() => {
    if (selected) {
      const next = selection(selected, effort);
      if (next.model !== model || next.effort !== effort) patchCodex(next);
    }
  }, [selected, model, effort]);
  const m = { name: selected?.displayName ?? (model || "CLI 默认模型") };
  const e = { label: effort };
  return (
    <Popover>
      <PopoverTrigger className={cn(trigger, "text-foreground")} aria-label={`模型：${m.name}，思考强度${e.label}`}>
        <Cpu className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{m.name}</span>
        <span className="text-muted-foreground">{e.label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" side="top" sideOffset={8} collisionPadding={8} className="w-72 rounded-xl border-border bg-popover p-1.5 shadow-pop">
        <div className="flex items-center justify-between px-2 pb-1">
          <p className="text-xs font-medium text-subtle-foreground">模型</p>
          <button type="button" onClick={catalog.refresh} disabled={catalog.loading} aria-label="刷新模型" title="刷新模型" aria-busy={catalog.loading} className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50">
            <RefreshCw aria-hidden className={cn("size-3.5", catalog.loading && "motion-safe:animate-spin")} />
          </button>
        </div>
        {catalog.error && <p role="alert" className="px-2 text-xs text-warning">{catalog.error}</p>}
        {catalog.models.map((x) => (
          <button key={x.id} type="button" onClick={() => patchCodex(selection(x, effort))} className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left outline-none hover:bg-hover focus-visible:bg-hover">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">{x.displayName}</span>
            </span>
            {x.model === model && <Check className="mt-0.5 size-4 shrink-0 text-accent" />}
          </button>
        ))}
        <div className="mx-1 my-1.5 border-t border-border" />
        <p className="px-2 pb-1.5 pt-1 text-xs font-medium text-subtle-foreground">思考强度</p>
        <div role="radiogroup" aria-label="思考强度" className="mx-1 grid grid-cols-3 gap-0.5 rounded-lg bg-muted p-0.5">
          {(selected?.supportedReasoningEfforts ?? []).map((x) => (
            <button
              key={x.reasoningEffort}
              type="button"
              role="radio"
              aria-checked={x.reasoningEffort === effort}
              onClick={() => patchCodex({ effort: x.reasoningEffort })}
              className={cn("h-7 rounded-md text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60", x.reasoningEffort === effort ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
            >
              {x.reasoningEffort}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
