import { useEffect, useMemo, useState } from "react";
import type { Shot } from "@/data/types";
import { desktopCall } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ImagePreview } from "@/components/ui/image-preview";
import { ChevronRight } from "@/lib/icons";

function ShotFrame({ id, shot }: { id: string; shot: Shot }) {
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
  return <div className={cn("relative size-full overflow-hidden rounded-md border bg-background", shot.failed ? "border-danger/70" : "border-border")}>
    {error ? <p role="status" className="p-1 text-xs text-danger" title={error}>加载失败</p> : src ?
      <img src={src} alt={shot.label} onError={() => setError("文件损坏或格式不支持")} className="size-full object-contain" /> :
      <p role="status" className="p-1 text-xs text-muted-foreground">加载中</p>}
    {shot.failed && <span className="absolute bottom-0.5 right-0.5 size-2 rounded-full bg-danger" />}
  </div>;
}

export function VerificationShots({ id }: { id: string }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [cur, setCur] = useState<number | null>(null);
  const images = useMemo(() => shots.map(shot => ({ id: `${id}:${shot.path}`, label: shot.label, failed: shot.failed, load: () => desktopCall("verificationShot", { id, path: shot.path }) })), [id, shots]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setShots([]); setCur(null);
    desktopCall("verificationShots", { id }).then(
      value => { if (active) setShots(value); },
      e => { if (active) setError(String(e.message ?? e)); },
    ).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, retry]);
  if (!loading && !error && !shots.length) return null;
  const stack = shots.slice(0, 4);
  const failedN = shots.filter(shot => shot.failed).length;
  const firstFail = shots.findIndex(shot => shot.failed);
  return (
    <section aria-label="验证截图">
      {loading && <p role="status" className="text-xs text-muted-foreground">正在读取截图…</p>}
      {error && <div role="status" className="text-xs text-danger">{error}<Button variant="ghost" size="sm" onClick={() => setRetry(x => x + 1)}>重试</Button></div>}
      {shots.length > 0 && <button
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
      <ImagePreview images={images} index={cur} onIndexChange={setCur} onClose={() => setCur(null)} title="验证截图" />
    </section>
  );
}
