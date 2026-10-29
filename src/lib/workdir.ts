import type { RepoMapping, ZTask } from "@/data/types";
export interface WorkDir { repo: string; name: string; path: string }
export function workDirs(t: ZTask, _mappings: RepoMapping[]): WorkDir[] {
  const path = (t.run as typeof t.run & { worktree?: string }).worktree;
  return path && !t.run.cleaned ? [{ repo: t.repoId, name: t.repoId.split("/").pop() ?? t.repoId, path }] : [];
}
export const fileDir = (t: ZTask, dirs: WorkDir[]) => dirs.find(d => d.repo === t.repoId) ?? dirs[0];
