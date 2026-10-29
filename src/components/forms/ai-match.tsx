import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Loader, Sparkles } from "@/lib/icons";
import { desktopCall } from "@/lib/desktop";
import type { AiSuggestion, AppConfig, RepoMapping } from "@/data/types";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/fields";


const STEPS = ["从指派给我的 BUG／需求聚合产品，从 GitLab 个人活动聚合仓库，再分析关联"];
const key = (s: AiSuggestion) => `${s.product}|${s.repo}`;
const level = (c: number) => (c >= 0.85 ? { t: "高", cls: "bg-success/12 text-success" } : c >= 0.6 ? { t: "中", cls: "bg-warning/14 text-warning" } : { t: "低", cls: "bg-muted text-muted-foreground" });

/** 基于实际任务与仓库历史生成可审核的关联建议。 */
export function AiMatchDialog({ open, onClose, value, onApply, config }: { config: AppConfig; open: boolean; onClose: () => void; value: RepoMapping[]; onApply: (picked: AiSuggestion[]) => void }) {
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [scope, setScope] = useState("");
  const [step, setStep] = useState(0); // 0..STEPS.length；等于长度表示完成
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openEv, setOpenEv] = useState<string | null>(null);

  const exists = (s: AiSuggestion) => value.some((m) => m.product === s.product && m.repos.some((r) => r.repo === s.repo));
  const groups = useMemo(() => {
    const m = new Map<string, AiSuggestion[]>();
    for (const s of suggestions) m.set(s.product, [...(m.get(s.product) ?? []), s]);
    return [...m.entries()];
  }, [suggestions]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setOpenEv(null);
    setError(""); setWarnings([]); setScope(""); setSuggestions([]); setPicked(new Set());
    let active = true;
    desktopCall("matchRepos", { config }).then((result: { suggestions: AiSuggestion[]; warnings: string[]; scope: string }) => {
      if (!active) return;
      const list = result.suggestions;
      setWarnings(result.warnings); setScope(result.scope);
      setSuggestions(list);
      setPicked(new Set(list.filter(s => s.confidence >= 0.6 && !exists(s)).map(key)));
      setStep(STEPS.length);
    }).catch(e => { if (active) { setError(String(e)); setStep(STEPS.length); } });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const done = step >= STEPS.length;
  const chosen = suggestions.filter((s) => picked.has(key(s)));
  const toggle = (s: AiSuggestion, on: boolean) => setPicked((p) => { const n = new Set(p); on ? n.add(key(s)) : n.delete(key(s)); return n; });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI 自动匹配"
      description="仅分析「指派给我」的 BUG／需求所属产品，以及 GitLab 当前用户近 90 天参与的仓库。结合任务与提交历史给出建议，应用所选后才会修改当前映射。"
      className="sm:max-w-2xl"
      footer={
        <>
          <span className="mr-auto text-xs text-muted-foreground">{done ? `将新增 ${chosen.length} 个仓库关联` : "分析中…"}</span>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!done || chosen.length === 0} onClick={() => { onApply(chosen); onClose(); }}>
            <Sparkles />应用所选
          </Button>
        </>
      }
    >
      {!done ? (
        <ol className="space-y-2.5 py-2" aria-live="polite">
          {STEPS.map((t, i) => (
            <li key={t} className={cn("flex items-center gap-2.5 text-sm", i > step ? "text-subtle-foreground" : "text-foreground")}>
              {i < step ? <Check className="size-4 text-success" /> : i === step ? <Loader className="size-4 animate-spin text-accent" /> : <span className="size-4 rounded-full border border-border-strong" />}
              {t}
            </li>
          ))}
        </ol>
      ) : (
        <div className="-mx-1 max-h-[55vh] space-y-4 overflow-y-auto px-1">
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {scope && <p className="text-xs leading-5 text-muted-foreground">{scope}</p>}
          {warnings.length > 0 && <details className="rounded-md border border-warning/30 p-2 text-xs text-warning"><summary>分析范围提示（{warnings.length} 项）</summary><ul className="mt-2 space-y-1">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
          {!error && suggestions.length === 0 && <p className="text-sm text-muted-foreground">没有找到可靠关联，请手动添加仓库。</p>}
          {groups.map(([product, list]) => (
            <section key={product} aria-label={product}>
              <h3 className="mb-1.5 flex items-center gap-2 text-sm font-medium text-foreground">
                {product}
                <span className="text-xs font-normal text-muted-foreground">{list.length > 1 ? `${list.length} 个仓库` : ""}</span>
              </h3>
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {list.map((s) => {
                  const k = key(s);
                  const lv = level(s.confidence);
                  const has = exists(s);
                  return (
                    <li key={k} className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Checkbox checked={has || picked.has(k)} onChange={(v) => !has && toggle(s, v)} label={<span className="font-mono text-xs text-foreground">{s.repo}</span>} className={cn(has && "opacity-60")} />
                        {s.role && <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{s.role}</span>}
                        <span className="font-mono text-xs text-muted-foreground">{s.branch}</span>
                        <span className="ml-auto flex items-center gap-2">
                          {has && <span className="text-xs text-muted-foreground">已关联</span>}
                          <span className={cn("rounded-full px-1.5 text-[11px] font-medium tabular-nums", lv.cls)}>{lv.t} {Math.round(s.confidence * 100)}%</span>
                        </span>
                      </div>
                      <p className="mt-1 pl-6 text-xs leading-5 text-muted-foreground">{s.evidence[0]}</p>
                      {s.evidence.length > 1 && (
                        <>
                          <button type="button" onClick={() => setOpenEv(openEv === k ? null : k)} aria-expanded={openEv === k} className="mt-0.5 ml-6 inline-flex items-center gap-0.5 rounded-sm text-xs text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">
                            <ChevronDown className={cn("size-3 transition-transform", openEv === k && "rotate-180")} />其余 {s.evidence.length - 1} 条依据
                          </button>
                          {openEv === k && (
                            <ul className="mt-1 list-disc space-y-0.5 pl-10 text-xs leading-5 text-muted-foreground">
                              {s.evidence.slice(1).map((e) => <li key={e}>{e}</li>)}
                            </ul>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <p className="text-xs leading-5 text-subtle-foreground">低置信度的建议默认不勾选。应用后可以在映射里继续修改分支。</p>
        </div>
      )}
    </Modal>
  );
}
