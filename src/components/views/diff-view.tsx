import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronRight, CircleCheck, FilePen, FilePlus, GitCompare, Plus } from "@/lib/icons";
import type { DiffFile, DiffLine, ZTask } from "@/data/types";
import { toSplitRows } from "@/lib/diff";
import { highlightLine, langOf } from "@/lib/highlight";
import { Segmented, Checkbox } from "@/components/ui/fields";
import { EmptyState } from "@/components/ui/empty";
import { Tip } from "@/components/ui/tooltip";
import { markViewed, quoteLine } from "@/store/actions";
import { useApp } from "@/store/state";

function Code({ lang, text }: { lang: string | null; text: string }) {
  return <span className="selectable whitespace-pre" dangerouslySetInnerHTML={{ __html: highlightLine(lang, text) || "&nbsp;" }} />;
}

const BG = { "+": "bg-diff-add-bg", "-": "bg-diff-del-bg", " ": "" } as const;
const GUT = { "+": "bg-diff-add-gutter text-foreground", "-": "bg-diff-del-gutter text-foreground", " ": "text-subtle-foreground" } as const;

function UnifiedLine({ l, lang, onQuote }: { l: DiffLine; lang: string | null; onQuote?: () => void }) {
  return (
    <div className={cn("group/line relative grid grid-cols-[3rem_3rem_1.25rem_1fr] font-mono text-[12.5px] leading-5", BG[l.t])}>
      <span className={cn("select-none px-2 text-right tabular-nums", GUT[l.t])}>{l.o ?? ""}</span>
      <span className={cn("select-none px-2 text-right tabular-nums", GUT[l.t])}>{l.n ?? ""}</span>
      <span className={cn("select-none text-center", l.t === "+" ? "text-success" : l.t === "-" ? "text-danger" : "text-transparent")}>{l.t === " " ? "·" : l.t}</span>
      <div className="min-w-0 pr-10"><Code lang={lang} text={l.text} /></div>
      {onQuote && (
        <Tip label="引用这一行并追加指令" side="left" className="absolute right-2 top-0 hidden h-5 items-center group-hover/line:flex">
          <button onClick={onQuote} aria-label="引用这一行并追加指令" className="grid size-4 place-items-center rounded-[4px] bg-accent text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
            <Plus className="size-3" strokeWidth={3} />
          </button>
        </Tip>
      )}
    </div>
  );
}

function SplitHalf({ l, lang, side }: { l?: DiffLine; lang: string | null; side: "l" | "r" }) {
  if (!l) return <div className="grid grid-cols-[3rem_1fr] bg-muted/40"><span /><span /></div>;
  const kind = l.t;
  return (
    <div className={cn("grid grid-cols-[3rem_1fr] font-mono text-[12.5px] leading-5", BG[kind])}>
      <span className={cn("select-none px-2 text-right tabular-nums", GUT[kind])}>{side === "l" ? l.o : l.n}</span>
      <div className="min-w-0 overflow-hidden pl-2 pr-2"><Code lang={lang} text={l.text} /></div>
    </div>
  );
}

const FileBlock = memo(function FileBlock({ taskId, f, mode, viewed, forceOpen }: { taskId: string; f: DiffFile; mode: "unified" | "split"; viewed: boolean; forceOpen: number }) {
  const [open, setOpen] = useState(!viewed);
  const lang = useMemo(() => langOf(f.path), [f.path]);
  const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
  const name = f.path.split("/").pop();
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  return (
    <section id={`file-${f.path}`} className="scroll-mt-2 overflow-hidden rounded-lg border border-border bg-card" aria-label={f.path}>
      <header className="sticky top-0 z-[4] flex items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "折叠文件" : "展开文件"} className="grid size-5 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/60">
          <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} />
        </button>
        {f.status === "added" ? <FilePlus className="size-3.5 shrink-0 text-success" /> : <FilePen className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="selectable min-w-0 flex-1 truncate font-mono text-xs">
          <span className="text-muted-foreground">{dir}</span>
          <span className="font-medium text-foreground">{name}</span>
        </span>
        {f.status === "added" && <span className="rounded-sm bg-success/12 px-1 text-[11px] font-medium text-success">新增</span>}
        <span className="shrink-0 font-mono text-xs tabular-nums">
          <span className="text-success">+{f.add}</span> <span className="text-danger">−{f.del}</span>
        </span>
        <Checkbox
          checked={viewed}
          onChange={(v) => {
            markViewed(taskId, f.path, v);
            setOpen(!v);
          }}
          label={<span className="text-xs text-muted-foreground">已查看</span>}
        />
      </header>
      {open && (
        <div className="overflow-x-auto">
          {f.hunks.map((h, hi) => (
            <div key={hi} className="min-w-max">
              <div className="select-none bg-accent/8 px-3 py-0.5 font-mono text-xs text-muted-foreground">{h.header}</div>
              {mode === "unified"
                ? h.lines.map((l, li) => <UnifiedLine key={li} l={l} lang={lang} onQuote={l.n ? () => quoteLine(f.path, l.n!, l.text) : undefined} />)
                : toSplitRows(h.lines).map((r, ri) => (
                    <div key={ri} className="grid grid-cols-2 divide-x divide-border">
                      <SplitHalf l={r.left} lang={lang} side="l" />
                      <SplitHalf l={r.right} lang={lang} side="r" />
                    </div>
                  ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
});

export function DiffView({ task }: { task: ZTask }) {
  const files = task.run.files;
  const focus = useApp((s) => s.diffFocus);
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const [active, setActive] = useState<string | null>(null);
  const [force, setForce] = useState<Record<string, number>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const add = files.reduce((a, f) => a + f.add, 0);
  const del = files.reduce((a, f) => a + f.del, 0);
  const viewedCount = files.filter((f) => task.run.viewed.includes(f.path)).length;

  const jump = (path: string) => {
    setActive(path);
    setForce((m) => ({ ...m, [path]: (m[path] ?? 0) + 1 }));
    requestAnimationFrame(() => {
      const el = scroller.current?.querySelector(`[id="file-${CSS.escape(path)}"]`) as HTMLElement | null;
      (el ?? (document.getElementById(`file-${path}`) as HTMLElement | null))?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };

  useEffect(() => {
    if (focus && focus.taskId === task.id) jump(focus.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  if (files.length === 0) {
    return <EmptyState icon={GitCompare} pattern title="还没有代码变更" desc="Codex 修改文件后，改动会实时出现在这里。你可以逐个文件标记「已查看」，也可以点任意一行引用它并追加指令。" className="h-full" />;
  }

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2">
        <span className="text-xs text-muted-foreground">
          {files.length} 个文件 <span className="font-mono tabular-nums text-success">+{add}</span> <span className="font-mono tabular-nums text-danger">−{del}</span>
          <span className="ml-2">已查看 {viewedCount}/{files.length}</span>
        </span>
        <Segmented
          size="sm"
          label="Diff 视图"
          className="ml-auto"
          value={mode}
          onChange={setMode}
          options={[
            { value: "unified", label: "统一" },
            { value: "split", label: "并排" },
          ]}
        />
      </div>
      <div className="flex min-h-0 flex-1 border-t border-border">
        <nav aria-label="变更文件" className="hidden w-60 shrink-0 overflow-y-auto border-r border-border p-2 @3xl:block">
          <ul className="space-y-0.5">
            {files.map((f) => {
              const v = task.run.viewed.includes(f.path);
              const on = (active ?? files[0].path) === f.path;
              return (
                <li key={f.path}>
                  <button
                    onClick={() => jump(f.path)}
                    className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60", on ? "bg-active" : "hover:bg-hover")}
                  >
                    {v ? <CircleCheck className="size-3.5 shrink-0 text-success" /> : f.status === "added" ? <FilePlus className="size-3.5 shrink-0 text-success" /> : <FilePen className="size-3.5 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate font-mono text-xs", v ? "text-muted-foreground" : "text-foreground")}>{f.path.split("/").pop()}</span>
                      <span className="block truncate text-[11px] text-subtle-foreground">{f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums"><span className="text-success">+{f.add}</span> <span className="text-danger">−{f.del}</span></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto p-4 @3xl:p-5">
          <div className="mb-3 flex gap-1.5 overflow-x-auto @3xl:hidden">
            {files.map((f) => (
              <button key={f.path} onClick={() => jump(f.path)} className={cn("shrink-0 rounded-md border px-2 py-1 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60", (active ?? files[0].path) === f.path ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-muted-foreground")}>
                {f.path.split("/").pop()}
              </button>
            ))}
          </div>
          <div className="space-y-4">
            {files.map((f) => (
              <FileBlock key={f.path} taskId={task.id} f={f} mode={mode} viewed={task.run.viewed.includes(f.path)} forceOpen={force[f.path] ?? 0} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
