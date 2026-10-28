import { useSyncExternalStore } from "react";

/**
 * 哈希路由。Artifact 宿主只放行 `#name` 形式（字母、数字、连字符），
 * 因此路由写成 #tasks、#task-bug-3182、#prefs-codex、#setup。
 */
export type Route =
  | { name: "tasks" }
  | { name: "task"; id: string }
  | { name: "setup" }
  | { name: "prefs"; section: string };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, "");
  if (h.startsWith("task-")) return { name: "task", id: h.slice(5) };
  if (h === "setup") return { name: "setup" };
  if (h === "prefs" || h.startsWith("prefs-")) return { name: "prefs", section: h.slice(6) || "general" };
  return { name: "tasks" };
}

export function toHash(r: Route): string {
  switch (r.name) {
    case "task": return `#task-${r.id}`;
    case "setup": return "#setup";
    case "prefs": return r.section && r.section !== "general" ? `#prefs-${r.section}` : "#prefs";
    default: return "#tasks";
  }
}

export function navigate(r: Route) {
  const next = toHash(r);
  if (location.hash !== next) location.hash = next;
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function useHash() {
  return useSyncExternalStore(subscribe, () => location.hash, () => "");
}

export function useRoute(): Route {
  const h = useHash();
  return parseHash(h);
}
