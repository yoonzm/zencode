import { useEffect, useRef, useState } from "react";
import type { Shot } from "@/data/types";
import { desktopCall } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";

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
    <div className={cn("relative overflow-hidden rounded-md border bg-background", shot.failed ? "border-danger/60" : "border-border", !big && "aspect-video")}>
      {error ? <p role="status" className="p-3 text-xs text-danger">截图无法预览：{error}</p> : src ?
        <img src={src} alt={shot.label} onError={() => setError("文件损坏或格式不支持")} className={cn("w-full object-contain", big ? "max-h-[65vh]" : "h-full")} /> :
        <p role="status" className="p-3 text-xs text-muted-foreground">正在加载截图…</p>}
      {shot.failed && <span className="absolute right-2 top-2 rounded bg-danger px-1.5 text-xs font-medium text-white">未达预期</span>}
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
  return (
    <section className="space-y-2" aria-label="验证截图">
      <h3 className="text-sm font-semibold">截图{shots.length > 0 && <span className="ml-2 font-normal text-muted-foreground">{shots.length} 张</span>}</h3>
      {loading && <p role="status" className="text-xs text-muted-foreground">正在读取截图…</p>}
      {error && <div role="status" className="text-xs text-danger">{error}<Button variant="ghost" size="sm" onClick={() => setRetry(x => x + 1)}>重试</Button></div>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shots.map((shot, i) => <li key={shot.id}>
          <button type="button" aria-label={`查看截图：${shot.label}`} onClick={e => { trigger.current = e.currentTarget; setCur(i); }} className="group block w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
            <div className="transition-transform group-hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none"><ShotFrame id={id} shot={shot} /></div>
            <span title={shot.label} className={cn("mt-1.5 line-clamp-1 block text-xs", shot.failed ? "text-danger" : "text-muted-foreground")}>{shot.label}</span>
          </button>
        </li>)}
      </ul>
      <Modal open={cur != null} onClose={() => setCur(null)} size="lg" className="sm:max-w-2xl" title={selected?.label ?? "截图"}
        onCloseAutoFocus={e => { e.preventDefault(); trigger.current?.focus(); }}
        description={cur != null ? `第 ${cur + 1} / ${shots.length} 张，可用左右方向键切换` : undefined}
        footer={shots.length > 1 ? <><Button variant="ghost" onClick={() => go(-1)}>上一张</Button><Button variant="ghost" onClick={() => go(1)}>下一张</Button></> : undefined}>
        {selected && <ShotFrame key={selected.id} id={id} shot={selected} big />}
      </Modal>
    </section>
  );
}
