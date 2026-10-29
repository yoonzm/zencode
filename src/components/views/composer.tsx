import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ArrowUp, Cpu, Play, X } from "@/lib/icons";
import type { ZTask } from "@/data/types";
import { SANDBOX_LABEL } from "@/data/types";
import { store, useApp } from "@/store/state";
import { continueRun, sendInstruction, startRun, stopRun } from "@/store/actions";
import { Kbd } from "@/components/ui/kbd";
import { BeamFrame } from "@/components/magic/effects";

const PLACEHOLDER: Record<string, string> = {
  idle: "写下额外要求（可选），交给 Codex 时一并带上…",
  queued: "排队中，可以先补充要求…",
  running: "继续补充，会排在当前步骤之后处理…",
  waiting: "审批之前也可以先追加指令…",
  stopped: "告诉 Codex 接下来怎么做，或点上面的「继续」…",
  review: "要求修改，例如：补充边界用例、缩小改动范围…",
  done: "MR 已创建，仍可追加指令，Codex 会继续推送提交…",
  failed: "说明如何处理失败，或直接点「重试」…",
};

const SUGGEST: Record<string, string[]> = {
  review: ["补充单元测试", "解释一下这次改动", "缩小改动范围"],
  running: ["先别改公共接口", "改完后顺便补测试"],
  stopped: ["改用更保守的方案", "只保留已完成的部分"],
  failed: ["不要修改测试替身，改在用例里处理"],
  done: ["补一条回归测试"],
};

export function Composer({ task }: { task: ZTask }) {
  const [text, setText] = useState("");
  const [ref, setRef] = useState<string | undefined>();
  const area = useRef<HTMLTextAreaElement>(null);
  const prefill = useApp((s) => s.prefill);
  const config = useApp((s) => s.config);
  const state = task.run.state;
  const idle = state === "idle";

  // 任务切换时清空草稿引用
  useEffect(() => {
    setText("");
    setRef(undefined);
  }, [task.id]);

  // 从 Diff 引用代码位置
  useEffect(() => {
    if (!prefill) return;
    setRef(prefill.ref);
    area.current?.focus();
  }, [prefill?.nonce]);

  // 自动增高
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(160, el.scrollHeight) + "px";
  }, [text]);

  const send = async () => {
    if (idle && !text.trim()) {
      startRun(task.id);
      return;
    }
    if (!text.trim()) return;
    if (!await sendInstruction(task.id, text.trim(), ref)) return;
    setText("");
    setRef(undefined);
  };

  const stoppable = (state === "running" || state === "waiting" || state === "queued") && !text.trim();
  const canSend = idle || text.trim().length > 0;
  const chips = SUGGEST[state] ?? [];

  // Esc：停止当前任务（没有打开弹窗和面板时）
  useEffect(() => {
    if (state !== "running" && state !== "waiting") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (store.get().paletteOpen || store.get().confirm || document.querySelector('[role="dialog"], [role="menu"]')) return;
      stopRun(task.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, task.id]);

  return (
    <div className="shrink-0 border-t border-border bg-background px-4 pb-3 pt-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-3xl">
        {chips.length > 0 || state === "stopped" ? (
          !text && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {state === "stopped" && (
              <button
                onClick={() => continueRun(task.id)}
                className="inline-flex h-6 items-center gap-1 rounded-full bg-primary px-2.5 text-xs font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/88 focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <Play className="size-3" />继续
              </button>
            )}
            {chips.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setText(c);
                  area.current?.focus();
                }}
                className="h-6 rounded-full border border-border px-2.5 text-xs text-muted-foreground outline-none transition-colors hover:border-border-strong hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                {c}
              </button>
            ))}
          </div>
          )
        ) : null}
        <BeamFrame active={state === "running"} className="rounded-xl">
          <div className="rounded-xl border border-border-strong bg-card shadow-sm transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/18">
            {ref && (
              <div className="flex items-center gap-1.5 px-3 pt-2">
                <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted py-0.5 pl-2 pr-1 font-mono text-xs text-muted-foreground">
                  <span className="truncate">{ref}</span>
                  <button onClick={() => setRef(undefined)} aria-label="移除代码引用" className="grid size-4 place-items-center rounded-sm hover:bg-active">
                    <X className="size-3" />
                  </button>
                </span>
              </div>
            )}
            <textarea
              ref={area}
              id="composer"
              value={text}
              rows={1}
              aria-label="追加指令"
              placeholder={PLACEHOLDER[state]}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                const composing = e.nativeEvent.isComposing || e.keyCode === 229;
                if (e.key === "Enter" && !e.shiftKey && !composing) {
                  e.preventDefault();
                  if (canSend) send();
                }
              }}
              className="block max-h-40 min-h-[40px] w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-5 text-foreground outline-none placeholder:text-subtle-foreground"
            />
            <div className="flex items-center gap-2 px-2 pb-2 pl-3">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Cpu className="size-3.5 shrink-0" />
                <span className="truncate">{config.codex.model} · {SANDBOX_LABEL[config.codex.sandbox]}</span>
              </span>
              <span className="ml-auto hidden items-center gap-1 text-xs text-subtle-foreground sm:inline-flex">
                <Kbd keys={["enter"]} /> 发送
                <Kbd keys={["shift", "enter"]} className="ml-1" /> 换行
              </span>
              <button
                onClick={stoppable ? () => stopRun(task.id) : send}
                disabled={!stoppable && !canSend}
                aria-label={stoppable ? "停止" : idle ? "交给 Codex 执行" : "发送指令"}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
                  idle ? "rounded-lg px-2.5" : "w-7 rounded-full",
                  stoppable ? "bg-foreground text-background hover:bg-foreground/85" : canSend ? "bg-primary text-primary-foreground hover:bg-primary/88" : "bg-muted text-subtle-foreground",
                )}
              >
                {stoppable ? <span className="size-2.5 rounded-[3px] bg-current" /> : idle ? <><Play className="size-3.5" />交给 Codex</> : <ArrowUp className="size-4" />}
              </button>
            </div>
          </div>
        </BeamFrame>
      </div>
    </div>
  );
}
