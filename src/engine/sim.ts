import { store } from "@/store/state";
import type { Run, ZTask } from "@/data/types";
import { applyStep } from "./run";
import { toast } from "@/store/toast";
import { navigate } from "@/lib/route";

const nextAt = new Map<string, number>();
let timer: number | undefined;

export function schedule(id: string, inMs: number) {
  nextAt.set(id, Date.now() + inMs);
}

export function updateTask(id: string, fn: (t: ZTask) => ZTask) {
  store.set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? fn(t) : t)) }));
}

export function getTask(id: string) {
  return store.get().tasks.find((t) => t.id === id);
}

const jitter = (ms: number) => ms * (0.8 + Math.random() * 0.5);

export const taskLabel = (t: Pick<ZTask, "kind" | "no">) => `${t.kind === "bug" ? "Bug" : "需求"} #${t.no}`;

function onFinished(t: ZTask, run: Run) {
  const s = store.get();
  const isOpen = location.hash === `#task-${t.id}`;
  const open = () => navigate({ name: "task", id: t.id });
  if (run.state === "review" && s.notify.done) {
    toast({ title: `${taskLabel(t)} 已完成，等待你审核`, desc: `${run.files.length} 个文件变更 · ${t.title}`, action: isOpen ? undefined : { label: "查看", run: open } });
  } else if (run.state === "failed" && s.notify.failed) {
    toast({ tone: "danger", title: `${taskLabel(t)} 执行失败`, desc: t.title, action: isOpen ? undefined : { label: "查看", run: open } });
  }
}

function tick() {
  const s = store.get();
  const now = Date.now();
  let running = s.tasks.filter((t) => t.run.state === "running").length;

  for (const t of s.tasks) {
    const r = t.run;

    if (r.state === "queued") {
      if (running < s.config.codex.concurrency && now - (r.startedAt ?? now) > 1600) {
        running++;
        updateTask(t.id, (x) => ({
          ...x,
          updatedAt: now,
          run: applyStep(
            { ...x.run, state: "running" },
            { delay: 0, ev: { kind: "system", text: `开始执行 · ${x.run.model} · ${x.run.branch ?? ""}`, tone: "info" } },
            now,
          ),
        }));
        schedule(t.id, 900);
      }
      continue;
    }

    if (r.state !== "running") {
      nextAt.delete(t.id);
      continue;
    }

    const due = nextAt.get(t.id);
    if (due == null) {
      schedule(t.id, 800);
      continue;
    }
    if (now < due) continue;

    const step = r.queue[0];
    let nr: Run;
    if (!step) {
      nr = { ...r, state: r.mr && r.end === "review" ? "done" : r.end };
    } else {
      nr = applyStep({ ...r, queue: r.queue.slice(1) }, step, now);
      if (nr.state === "running" && nr.queue.length === 0) nr = { ...nr, state: r.end };
    }
    if (nr.state === "review" && nr.mr) nr = { ...nr, state: "done" };

    const finished = nr.state === "review" || nr.state === "failed" || nr.state === "done";
    if (finished) {
      nr = { ...nr, finishedAt: now, unread: location.hash !== `#task-${t.id}` };
    }
    updateTask(t.id, (x) => ({ ...x, updatedAt: now, run: nr }));

    if (finished) {
      onFinished(t, nr);
      nextAt.delete(t.id);
    } else if (nr.state === "waiting") {
      nextAt.delete(t.id);
      const ap = [...nr.events].reverse().find((e) => e.kind === "approval");
      if (store.get().notify.approval) {
        toast({
          tone: "warn",
          title: `${taskLabel(t)} 需要你审批`,
          desc: ap && ap.kind === "approval" ? ap.cmd : undefined,
          duration: 7000,
          action: location.hash === `#task-${t.id}` ? undefined : { label: "去处理", run: () => navigate({ name: "task", id: t.id }) },
        });
      }
    } else {
      schedule(t.id, jitter(nr.queue[0]?.delay ?? 1200));
    }
  }
}

export function startSim() {
  if (timer != null) return;
  timer = window.setInterval(tick, 500);
}
