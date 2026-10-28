import { desktopCall } from "@/lib/desktop";
import { store } from "@/store/state";
import { Paperclip } from "@/lib/icons";
import type { ZTask } from "@/data/types";
import { PRIORITY_LABEL } from "@/data/types";
import { personName } from "@/data/identity";
import { fmtDate, relTime } from "@/lib/time";
import { Avatar } from "@/components/ui/status";
import { toast } from "@/store/toast";

function Block({ title, children }: { title?: string; children: any }) {
  return (
    <section className="space-y-1.5">
      {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
      {children}
    </section>
  );
}

export function ZentaoTab({ task }: { task: ZTask }) {
  const fields: [string, any][] = [
    ["禅道状态", task.ztStatus],
    ["所属产品", task.product],
    ["所属模块", task.module],
    ["所属迭代", task.sprint],
    ["优先级", `P${task.priority} ${PRIORITY_LABEL[task.priority]}`],
    ...(task.severity ? ([["严重程度", `${task.severity} 级`]] as [string, any][]) : []),
    ["指派给", <span key="a" className="inline-flex items-center gap-1.5"><Avatar id={task.assignee} size={16} />{personName(task.assignee)}</span>],
    ["创建者", personName(task.reporter)],
    ["创建时间", fmtDate(task.createdAt)],
    ["截止日期", task.deadline ? fmtDate(task.deadline) : "未设置"],
  ];
  return (
    <div className="h-full overflow-y-auto px-5 py-5">
      <div className="mx-auto grid max-w-3xl gap-8 @4xl:grid-cols-[1fr_15rem]">
        <div className="selectable space-y-5 text-sm leading-[1.7] text-foreground">
          {task.description.map((b, i) => (
            <Block key={i} title={b.title}>
              {b.type === "p" && <p className="text-foreground/90">{b.text}</p>}
              {b.type === "steps" && (
                <ol className="list-decimal space-y-1 pl-5 marker:text-subtle-foreground">
                  {b.items!.map((s, k) => <li key={k}>{s}</li>)}
                </ol>
              )}
              {b.type === "list" && (
                <ul className="list-disc space-y-1 pl-5 marker:text-subtle-foreground">
                  {b.items!.map((s, k) => <li key={k}>{s}</li>)}
                </ul>
              )}
              {b.type === "kv" && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  {b.rows!.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Block>
          ))}

          {task.attachments.length > 0 && (
            <Block title="附件">
              <ul className="space-y-1">
                {task.attachments.map((a) => (
                  <li key={a.name}>
                    <button
                      onClick={() => void desktopCall("attachment", { id: task.id, fileId: a.id, config: store.get().config }).then(() => toast({ title: "附件已下载", desc: "已在文件管理器中定位。" })).catch(e => toast({ title: "附件下载失败", desc: String(e), tone: "danger" }))}
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-left text-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      <Paperclip className="size-3.5 text-muted-foreground" />
                      {a.name}
                      <span className="text-xs text-muted-foreground">{a.size}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </div>

        <aside className="space-y-6 text-sm">
          <dl className="space-y-2.5">
            {fields.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">{k}</dt>
                <dd className="min-w-0 truncate text-right text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">操作记录</h3>
            <ol className="space-y-2 border-l border-border pl-3">
              {task.history.slice().reverse().map((h, i) => (
                <li key={i} className="relative text-xs leading-5 text-muted-foreground">
                  <span className="absolute -left-[16.5px] top-1.5 size-1.5 rounded-full bg-border-strong" aria-hidden />
                  <span className="text-foreground">{h.who}</span> {h.text}
                  <span className="block text-subtle-foreground">{relTime(h.at)}</span>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
