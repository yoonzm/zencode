import { store, type Toast } from "./state";
import { uid } from "@/lib/utils";

export function toast(t: Omit<Toast, "id" | "duration" | "tone"> & { tone?: Toast["tone"]; duration?: number }) {
  const id = uid("toast");
  const item: Toast = { tone: "success", duration: 4200, ...t, id };
  store.set((s) => ({ toasts: [...s.toasts.slice(-3), item] }));
  return id;
}

export function dismissToast(id: string) {
  store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
