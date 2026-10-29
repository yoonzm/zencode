import { taskNo } from "@/lib/task";
import type { RunState, ZTask } from "@/data/types";
import type { Filters } from "./state";
import { EMPTY_FILTERS } from "./state";
import { ME } from "@/data/identity";
import { fuzzy } from "@/lib/fuzzy";

export const GROUP_ORDER: RunState[] = ["waiting", "failed", "review", "running", "stopped", "queued", "idle", "done"];

export function filterTasks(tasks: ZTask[], f: Filters): ZTask[] {
  const q = f.query.trim();
  return tasks.filter((t) => {
    if (f.kind !== "all" && t.kind !== f.kind) return false;
    if (f.states.length && !f.states.includes(t.run.state)) return false;
    if (f.priorities.length && !f.priorities.includes(t.priority)) return false;
    if (f.assignee === "me" && t.assignee !== ME) return false;
    if (f.products.length && !f.products.includes(t.product)) return false;
    if (q) {
      const hay = `${t.kind === "bug" ? "bug" : "需求"} #${t.no} ${taskNo(t)} ${t.title} ${t.module} ${t.product} ${t.labels.join(" ")}`;
      if (!fuzzy(q, hay)) return false;
    }
    return true;
  });
}

// 执行中的任务每个 tick 都会更新 updatedAt，直接按它排会来回跳；
// 进行中的任务用开始时间作为排序依据，再用 id 兜底，保证顺序稳定
const LIVE = new Set(["queued", "running", "waiting"]);
const stamp = (t: ZTask) => (LIVE.has(t.run.state) ? (t.run.startedAt ?? t.createdAt ?? 0) : t.updatedAt);
const byId = (a: ZTask, b: ZTask) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function sortTasks(tasks: ZTask[], sort: "updated" | "priority" | "deadline"): ZTask[] {
  const arr = tasks.slice();
  if (sort === "priority") arr.sort((a, b) => a.priority - b.priority || stamp(b) - stamp(a) || byId(a, b));
  else if (sort === "deadline") arr.sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity) || a.priority - b.priority || byId(a, b));
  else arr.sort((a, b) => stamp(b) - stamp(a) || byId(a, b));
  return arr;
}

export interface Group {
  key: string;
  state?: RunState;
  label: string;
  items: ZTask[];
}

export function groupTasks(tasks: ZTask[], mode: "state" | "none"): Group[] {
  if (mode === "none") return [{ key: "all", label: "全部", items: tasks }];
  const map = new Map<RunState, ZTask[]>();
  for (const t of tasks) {
    const arr = map.get(t.run.state) ?? [];
    arr.push(t);
    map.set(t.run.state, arr);
  }
  return GROUP_ORDER.filter((s) => map.has(s)).map((s) => ({ key: s, state: s, label: s, items: map.get(s)! }));
}

export interface Preset {
  id: string;
  label: string;
  filters: Partial<Filters>;
}
export const PRESETS: Preset[] = [
  { id: "all", label: "全部任务", filters: {} },
  { id: "mine", label: "我的任务", filters: { assignee: "me" } },
  { id: "active", label: "执行中", filters: { states: ["running", "queued", "waiting", "stopped"] } },
  { id: "review", label: "待审核", filters: { states: ["review"] } },
  { id: "done", label: "已提交", filters: { states: ["done"] } },
];

export function presetFilters(p: Preset): Filters {
  return { ...EMPTY_FILTERS, ...p.filters };
}

export function activePreset(f: Filters): string | null {
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x) => b.includes(x));
  for (const p of PRESETS) {
    const pf = presetFilters(p);
    if (f.kind === pf.kind && f.assignee === pf.assignee && same(f.states, pf.states) && f.priorities.length === 0 && f.products.length === 0 && !f.query) return p.id;
  }
  return null;
}

export function hasActiveFilters(f: Filters): boolean {
  return f.kind !== "all" || f.states.length > 0 || f.priorities.length > 0 || f.assignee !== "all" || f.products.length > 0 || f.query.trim() !== "";
}
