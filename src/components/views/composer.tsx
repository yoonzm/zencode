import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ArrowUp, Play, Plus, X } from "@/lib/icons";
import type { ZTask } from "@/data/types";
import { store, useApp } from "@/store/state";
import { continueRun, sendInstruction, startRun, stopRun } from "@/store/actions";
import { AccessPicker, ModelPicker } from "./codex-pickers";
import { ContextUsage } from "./context-usage";
import { BeamFrame } from "@/components/magic/effects";
import { ImagePreviews, useImagePaste } from "@/components/ui/image-paste";

export function Composer({ task, active = true }: { task: ZTask; active?: boolean }) {
  const [text, setText] = useState("");
  const [ref, setRef] = useState<string | undefined>();
  const pasted = useImagePaste(task.id);
  const [sending, setSending] = useState(false);
  const sendVersion = useRef(0);
  const sendLock = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const prefill = useApp((s) => s.prefill);
  const appliedPrefill = useRef<typeof prefill>(null);
  const state = task.run.state;
  const idle = state === "idle";

  // 任务切换时清空草稿引用
  useEffect(() => {
    sendVersion.current++;
    sendLock.current = false;
    setSending(false);
    setText("");
    setRef(undefined);
  }, [task.id]);

  // 从 Diff 引用代码位置
  useEffect(() => {
    if (!prefill || !active || prefill === appliedPrefill.current) return;
    appliedPrefill.current = prefill;
    setRef(prefill.ref);
    area.current?.focus();
  }, [prefill?.nonce, active]);

  // 自动增高
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(160, el.scrollHeight) + "px";
  }, [text, active]);

  const send = async () => {
    if (sendLock.current || pasted.reading) return;
    if (idle && !text.trim() && !pasted.images.length) {
      startRun(task.id);
      return;
    }
    if (state === "stopped" && !text.trim() && !pasted.images.length) {
      continueRun(task.id);
      return;
    }
    if (!text.trim() && !pasted.images.length) return;
    sendLock.current = true;
    const token = ++sendVersion.current;
    setSending(true);
    try {
      if (!await sendInstruction(task.id, text.trim(), ref, pasted.images)) return;
      if (token !== sendVersion.current) return;
      setText(""); setRef(undefined); pasted.clear();
    } finally { if (token === sendVersion.current) { sendLock.current = false; setSending(false); } }
  };

  const stoppable = (state === "running" || state === "waiting" || state === "queued") && !text.trim() && !pasted.images.length && !pasted.reading && !sending;
  const resumable = state === "stopped" && !text.trim() && !pasted.images.length;
  const canSend = !sending && !pasted.reading && (idle || resumable || text.trim().length > 0 || pasted.images.length > 0);

  // Esc：停止当前任务（没有打开弹窗和面板时）
  useEffect(() => {
    if (!active || (state !== "running" && state !== "waiting")) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (store.get().paletteOpen || store.get().confirm || document.querySelector('[role="dialog"], [role="menu"]')) return;
      stopRun(task.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, task.id, active]);

  return (
    <div className="shrink-0 bg-background px-4 pb-3 pt-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-3xl">
        <BeamFrame active={state === "running"} className="rounded-3xl">
          <div className="rounded-3xl border border-border bg-muted shadow-sm transition-[border-color,box-shadow] focus-within:border-border-strong focus-within:ring-[3px] focus-within:ring-accent/12">
            {pasted.images.length > 0 && <div className="px-3 pt-3"><ImagePreviews images={pasted.images} remove={pasted.remove} disabled={sending} /></div>}
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
              placeholder="和 Codex 一起工作"
              onChange={(e) => setText(e.target.value)}
              onPaste={pasted.onPaste}
              disabled={sending}
              onKeyDown={(e) => {
                const composing = e.nativeEvent.isComposing || e.keyCode === 229;
                if (e.key === "Enter" && !e.shiftKey && !composing) {
                  e.preventDefault();
                  if (canSend) send();
                }
              }}
              className="block max-h-40 min-h-[56px] w-full resize-none bg-transparent px-4 py-3.5 text-sm leading-5 text-foreground outline-none placeholder:text-subtle-foreground"
            />
            {(pasted.error || pasted.reading || sending) && <div className="space-y-2 px-4 pb-2" aria-busy={pasted.reading || sending}>
              {pasted.error && <p role="alert" className="text-xs text-danger">{pasted.error}</p>}
              {(pasted.reading || sending) && <p role="status" className="text-xs text-subtle-foreground">{pasted.reading ? "正在读取图片…" : "正在发送…"}</p>}
            </div>}
            <div className="flex items-center gap-1 px-2 pb-2">
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden aria-label="选择附加图片" onChange={(event) => { pasted.addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
              <button type="button" aria-label="添加图片" disabled={sending || pasted.reading} onClick={() => fileInput.current?.click()} className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50"><Plus aria-hidden="true" className="size-4" /></button>
              <AccessPicker />
              <span className="ml-auto" />
              <ContextUsage usage={task.run.contextUsage} />
              <ModelPicker />
              <button
                onClick={stoppable ? () => stopRun(task.id) : send}
                disabled={!stoppable && !canSend}
                aria-label={stoppable ? "停止" : resumable ? "继续执行" : idle ? "交给 Codex 执行" : "发送指令"}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
                  "w-7 rounded-full",
                  stoppable ? "bg-foreground text-background hover:bg-foreground/85" : canSend ? "bg-primary text-primary-foreground hover:bg-primary/88" : "bg-muted text-subtle-foreground",
                )}
              >
                {stoppable ? <span className="size-2.5 rounded-[3px] bg-current" /> : resumable ? <Play className="size-3.5" /> : <ArrowUp className="size-4" />}
              </button>
            </div>
          </div>
        </BeamFrame>
      </div>
    </div>
  );
}
