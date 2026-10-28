import { store } from '@/store/state';
import type { ZTask } from '@/data/types';
export function updateTask(id: string, fn: (task: ZTask) => ZTask) {
  store.set(s => ({ tasks: s.tasks.map(task => task.id === id ? fn(task) : task) }));
}
export function getTask(id: string) { return store.get().tasks.find(task => task.id === id); }
