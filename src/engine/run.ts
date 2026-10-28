import type { DiffFile, EventBody, Run, RunEvent, RunState, Script, ScriptStep } from "@/data/types";
import { parsePatch } from "@/lib/diff";
import { uid } from "@/lib/utils";

export const DEFAULT_MODEL = "Codex · 标准";

export function emptyRun(): Run {
  return {
    state: "idle",
    model: DEFAULT_MODEL,
    events: [],
    files: [],
    queue: [],
    scriptId: "",
    patchKeys: {},
    end: "review",
    viewed: [],
  };
}

function upsertFile(files: DiffFile[], f: DiffFile): DiffFile[] {
  const i = files.findIndex((x) => x.path === f.path);
  if (i < 0) return [...files, f];
  const next = files.slice();
  next[i] = f;
  return next;
}

/** 把一个脚本步骤落成事件，同时更新 Diff 文件与状态。纯函数。 */
export function applyStep(run: Run, step: ScriptStep, at: number): Run {
  let files = run.files;
  const body = { ...step.ev } as EventBody;
  if (step.patch) {
    const p = run.patchKeys[step.patch];
    if (p) {
      const file = parsePatch(p.path, p.status, p.patch);
      files = upsertFile(files, file);
      if (body.kind === "edit") {
        body.add = file.add;
        body.del = file.del;
      }
    }
  }

  let events = run.events;
  if (body.kind === "plan") {
    const i = events.findIndex((e) => e.kind === "plan" && e.title === body.title);
    if (i >= 0) {
      events = events.slice();
      events[i] = { ...(body as RunEvent), id: events[i].id, at: events[i].at } as RunEvent;
      return { ...run, events, files };
    }
  }
  const ev = { ...body, id: uid("ev"), at } as RunEvent;
  events = [...events, ev];

  let state: RunState = run.state;
  if (body.kind === "approval") state = "waiting";
  if (step.endState) state = step.endState;
  return { ...run, events, files, state };
}

export function lastEventAt(run: Run, fallback: number) {
  return run.events.length ? run.events[run.events.length - 1].at : fallback;
}

interface SeedOpts {
  /** 起始时间距现在多少分钟（最后一条事件约在 20 秒前） */
  minutesAgo?: number;
  model?: string;
  scale?: number;
}

/** 从脚本构建一个已经执行到第 upTo 步的 Run */
export function seedRun(script: Script, upTo: number, state: RunState, opts: SeedOpts = {}): Run {
  const scale = opts.scale ?? 7;
  const steps = script.steps.slice(0, upTo);
  const total = steps.reduce((a, s) => a + s.delay * scale, 0);
  const now = Date.now();
  const start = now - Math.max(total + 20_000, (opts.minutesAgo ?? 0) * 60_000);
  let run: Run = {
    state: "running",
    branch: script.branch,
    model: opts.model ?? DEFAULT_MODEL,
    startedAt: start,
    events: [],
    files: [],
    queue: script.steps.slice(upTo),
    scriptId: script.id,
    patchKeys: script.patches,
    end: script.end,
    retry: script.retry,
    viewed: [],
  };
  let t = start;
  for (const s of steps) {
    t += s.delay * scale;
    run = applyStep(run, s, t);
  }
  run = { ...run, state };
  if (state === "review" || state === "done" || state === "failed") run.finishedAt = t;
  return run;
}
