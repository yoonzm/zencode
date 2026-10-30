import { useEffect, useRef, useState } from "react";
import type { Shot } from "@/data/types";
import { desktopCall } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ChevronLeft, ChevronRight, X } from "@/lib/icons";

function ShotFrame({ id, shot, big }: { id: string; shot: Shot; big?: boolean }) {
  const [src, setSrc] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setSrc(undefined); setError("");
    desktopCall("verificationShot", { id, path: shot.path }).then(
      value => { if (active) setSrc(value); },
      e => { if (active) setError(String(e.message ?? e)); },
    );
    return () => { active = false; };
  }, [id, shot.path]);
  return (
    <div className={cn("relative overflow-hidden rounded-md border bg-background", shot.failed ? "border-danger/70" : "border-border", big ? "flex min-h-0 items-center justify-center" : "size-full")}>
      {error ? <p role="status" className={cn("text-xs text-danger", big ? "p-3" : "p-1")} title={error}>{big ? `截图无法预览：${error}` : "加载失败"}</p> : src ?
        <img src={src} alt={shot.label} onError={() => setError("文件损坏或格式不支持")} className={cn("w-full object-contain", big ? "max-h-[calc(100dvh-12rem)]" : "h-full")} /> :
        <p role="status" className={cn("text-xs text-muted-foreground", big ? "p-3" : "p-1")}>{big ? "正在加载截图…" : "加载中"}</p>}
      {shot.failed && (big ? <span className="absolute right-2 top-2 rounded bg-danger px-1.5 text-xs font-medium text-white">未达预期</span> : <span className="absolute bottom-0.5 right-0.5 size-2 rounded-full bg-danger" />)}
    </div>
  );
}

export function VerificationShots({ id }: { id: string }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [cur, setCur] = useState<number | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setShots([]); setCur(null);
    desktopCall("verificationShots", { id }).then(
      value => { if (active) setShots(value); },
      e => { if (active) setError(String(e.message ?? e)); },
    ).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, retry]);
  const go = (d: number) => setCur(c => c == null || !shots.length ? null : (c + d + shots.length) % shots.length);
  useEffect(() => {
    if (cur == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); go(e.key === "ArrowLeft" ? -1 : 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, shots.length]);
  if (!loading && !error && !shots.length) return null;
  const selected = cur == null ? undefined : shots[cur];
  const stack = shots.slice(0, 4);
  const failedN = shots.filter(shot => shot.failed).length;
  const firstFail = shots.findIndex(shot => shot.failed);
  return (
    <section aria-label="验证截图">
      {loading && <p role="status" className="text-xs text-muted-foreground">正在读取截图…</p>}
      {error && <div role="status" className="text-xs text-danger">{error}<Button variant="ghost" size="sm" onClick={() => setRetry(x => x + 1)}>重试</Button></div>}
      {shots.length > 0 && <button
        ref={trigger}
        type="button"
        aria-label={`查看 ${shots.length} 张截图${failedN ? `，${failedN} 张未达预期` : ""}`}
        onClick={() => setCur(firstFail >= 0 ? firstFail : 0)}
        className="group flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left outline-none transition-colors hover:border-border-strong hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <span className="flex shrink-0 items-center pl-1" aria-hidden="true">
          {stack.map((shot, i) => <span key={shot.id} className="-ml-2.5 h-9 w-12 rounded-md bg-card ring-2 ring-card first:ml-0" style={{ zIndex: stack.length - i }}>
            <ShotFrame id={id} shot={shot} />
          </span>)}
          {shots.length > stack.length && <span className="-ml-2.5 grid h-9 min-w-9 place-items-center rounded-md bg-muted px-1.5 text-xs font-medium text-muted-foreground ring-2 ring-card">+{shots.length - stack.length}</span>}
        </span>
        <span className="min-w-0 flex-1 text-sm">
          <span className="font-medium text-foreground">{shots.length} 张截图</span>
          {failedN > 0 && <span className="ml-2 text-danger">{failedN} 张未达预期</span>}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
      </button>}
      <DialogPrimitive.Root open={cur != null} onOpenChange={open => !open && setCur(null)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/92" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onCloseAutoFocus={e => { e.preventDefault(); trigger.current?.focus(); }}
            onClick={e => e.target === e.currentTarget && setCur(null)}
            className="fixed inset-0 z-[81] flex flex-col items-center justify-center gap-5 px-4 py-6 outline-none sm:px-16"
          >
            <DialogPrimitive.Title className="sr-only">{selected?.label ?? "截图"}</DialogPrimitive.Title>
            <DialogPrimitive.Close aria-label="关闭" className="absolute right-4 top-4 grid size-10 place-items-center rounded-full border border-white/25 text-white/85 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60">
              <X className="size-5" />
            </DialogPrimitive.Close>
            {selected && <>
              <p className={cn("max-w-[min(1200px,100%)] truncate text-sm", selected.failed ? "text-danger" : "text-white/75")} title={selected.label}>{selected.label}</p>
              <div className="min-h-0 w-[min(1200px,100%)]">
                <ShotFrame key={selected.id} id={id} shot={selected} big />
              </div>
              <div className="flex shrink-0 items-center gap-4 text-white/85">
                <button type="button" aria-label="上一张" onClick={() => go(-1)} disabled={shots.length < 2} className="grid size-10 place-items-center rounded-full outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-30"><ChevronLeft className="size-5" /></button>
                <span aria-live="polite" className="min-w-28 text-center text-sm tabular-nums">第 {(cur ?? 0) + 1} 张，共 {shots.length} 张</span>
                <button type="button" aria-label="下一张" onClick={() => go(1)} disabled={shots.length < 2} className="grid size-10 place-items-center rounded-full outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-30"><ChevronRight className="size-5" /></button>
              </div>
            </>}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </section>
  );
}
