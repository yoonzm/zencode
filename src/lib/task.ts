import type { ZTask } from "@/data/types";

type Ref = Pick<ZTask, "kind" | "no"> & { manual?: boolean };

/** 列表和标题里显示的编号：禅道任务是禅道编号，手动新增的任务是 N1、N2… */
export const taskNo = (t: Ref) => (t.manual ? `N${t.no}` : String(t.no));
export const kindLabel = (t: Pick<ZTask, "kind">) => (t.kind === "bug" ? "Bug" : "需求");
export const taskRef = (t: Ref) => (t.manual ? `${kindLabel(t)} ${taskNo(t)}` : `${kindLabel(t)} #${t.no}`);
