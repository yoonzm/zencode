import { useMemo } from "react";
import { cn, clamp } from "@/lib/utils";
import { useApp, store } from "@/store/state";
import { navigate, useRoute } from "@/lib/route";
import { useMedia } from "@/lib/hooks";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { DotPattern } from "@/components/magic/effects";
import { TaskListPane } from "./task-list";
import { TaskDetail } from "./task-detail";

function Resizer() {
  const w = useApp((s) => s.listWidth);
  const set = (v: number) => store.set({ listWidth: clamp(Math.round(v), 340, 640) });
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整列表宽度"
      aria-valuenow={w}
      aria-valuemin={340}
      aria-valuemax={640}
      tabIndex={0}
      onDoubleClick={() => set(448)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") set(w - 16);
        if (e.key === "ArrowRight") set(w + 16);
      }}
      onPointerDown={(e) => {
        const startX = e.clientX;
        const startW = w;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => set(startW + ev.clientX - startX);
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
      }}
      className="group relative z-10 w-px shrink-0 cursor-col-resize touch-none bg-border outline-none"
    >
      <span className="absolute inset-y-0 -left-1.5 -right-1.5 transition-colors group-hover:bg-accent/15 group-focus-visible:bg-accent/25 group-active:bg-accent/25" />
    </div>
  );
}

function DetailEmpty() {
  const tasks = useApp((s) => s.tasks);
  const next = useMemo(
    () => tasks.find((t) => t.run.state === "waiting") ?? tasks.find((t) => t.run.state === "failed") ?? tasks.find((t) => t.run.state === "review") ?? tasks.find((t) => t.priority === 1),
    [tasks],
  );
  return (
    <div className="relative grid h-full place-items-center overflow-hidden bg-background px-6">
      <DotPattern />
      <div className="relative flex max-w-sm flex-col items-center text-center">
        <Logo size={36} className="mb-4 text-foreground" />
        <h2 className="text-lg font-semibold text-foreground">选择一个任务</h2>
        <p className="mt-1.5 text-sm leading-5 text-muted-foreground">在左侧选择 Bug 或需求，查看 Codex 做了什么、改了哪些代码，并随时暂停或追加指令。</p>
        {next && (
          <Button variant="primary" className="mt-4" onClick={() => navigate({ name: "task", id: next.id })}>
            先看需要你处理的：{next.kind === "bug" ? "Bug" : "需求"} #{next.no}
          </Button>
        )}
        <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
          <li className="flex items-center justify-between gap-6"><span>上一个 / 下一个任务</span><span className="flex gap-1"><Kbd keys={["K"]} /><Kbd keys={["J"]} /></span></li>
          <li className="flex items-center justify-between gap-6"><span>切换 执行 / 变更 / 禅道原文</span><span className="flex gap-1"><Kbd keys={["1"]} /><Kbd keys={["2"]} /><Kbd keys={["3"]} /></span></li>
          <li className="flex items-center justify-between gap-6"><span>命令面板</span><Kbd keys={["mod", "K"]} /></li>
        </ul>
      </div>
    </div>
  );
}

export function TasksView() {
  const route = useRoute();
  const wide = useMedia("(min-width: 1000px)");
  const listWidth = useApp((s) => s.listWidth);
  const selectedId = route.name === "task" ? route.id : null;

  if (!wide) {
    return selectedId ? <TaskDetail id={selectedId} onBack={() => navigate({ name: "tasks" })} /> : <TaskListPane className="h-full" />;
  }
  return (
    <div className="flex h-full min-h-0">
      <div className={cn("shrink-0")} style={{ width: listWidth }}>
        <TaskListPane className="h-full" />
      </div>
      <Resizer />
      <div className="min-w-0 flex-1">{selectedId ? <TaskDetail id={selectedId} /> : <DetailEmpty />}</div>
    </div>
  );
}
