import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Sparkles, X } from "@/lib/icons";
import { useApp } from "@/store/state";
import { importManual, setImportOpen } from "@/store/actions";
import { SAMPLE_SOURCE, type Candidate } from "@/data/parse";
import { PRIORITY_LABEL, type Priority } from "@/data/types";
import { Modal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Segmented, Select } from "@/components/ui/fields";
import { navigate } from "@/lib/route";
import { desktopCall } from "@/lib/desktop";
import { flushPrefs } from "@/store/state";

const TEXTAREA = "w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-sm leading-[1.6] text-foreground outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-ring/60";

/** 新增需求：粘贴原始文字 → AI 整理成列表 → 确认后导入为任务。与禅道无关，也不会写回禅道。 */
export function ImportDialog() {
  const open = useApp((s) => s.importOpen);
  const mappings = useApp((s) => s.config.mappings);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const request = useRef(0);
  const [error, setError] = useState("");
  const [tried, setTried] = useState(false);

  const products = useMemo(() => mappings.filter((m) => m.repos.length > 0).map((m) => m.product), [mappings]);
  useEffect(() => {
    request.current++;
    if (!open) {
      setError("");
      setText("");
      setCands(null);
      setBusy(false);
      setTried(false);
    }
  }, [open]);

  const close = () => { if (!busy) setImportOpen(false); };
  const organize = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    const token = ++request.current;
    try {
      await flushPrefs();
      const candidates = await desktopCall("organizeRequirements", { source: text });
      if (token === request.current) setCands(candidates);
    } catch (e) { if (token === request.current) setError(String(e)); }
    finally { if (token === request.current) setBusy(false); }
  };
  const submit = async () => {
    if (busy || !cands) return;
    setTried(true);
    if (chosen.some(c => !products.includes(c.product) || !c.title.trim())) { setError("请填写标题并选择已配置的产品。"); return; }
    setBusy(true); setError("");
    try { await importManual(cands, text); } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const set = (id: string, p: Partial<Candidate>) => setCands((l) => l?.map((c) => (c.id === id ? { ...c, ...p } : c)) ?? l);
  const chosen = cands?.filter((c) => c.on) ?? [];
  const missing = chosen.filter((c) => !c.product).length;

  return (
    <Modal
      open={open}
      onClose={close}
      hideClose={busy}
      size="lg"
      title="新增需求"
      description={cands ? "确认整理结果，没问题就导入。" : "粘贴或输入原始需求，AI 会整理成任务列表。"}
      className="sm:max-w-2xl"
      footer={
        cands ? (
          <>
            <span className="mr-auto text-xs text-muted-foreground">{tried && missing > 0 ? <span className="text-danger">还有 {missing} 项没选产品</span> : `已选 ${chosen.length} / ${cands.length} 项`}</span>
            <Button variant="ghost" disabled={busy} onClick={() => setCands(null)}>返回修改</Button>
            <Button
              disabled={chosen.length === 0 || busy}
              loading={busy}
              onClick={submit}
            >
              导入 {chosen.length} 项
            </Button>
          </>
        ) : (
          <>
            <button type="button" className="mr-auto rounded-sm text-sm text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60" disabled={busy} onClick={() => setText(SAMPLE_SOURCE)}>填入示例</button>
            <Button variant="ghost" disabled={busy} onClick={close}>取消</Button>
            <Button disabled={!text.trim() || busy} loading={busy} onClick={organize}><Sparkles />{busy ? "正在整理…" : "AI 整理"}</Button>
          </>
        )
      }
    >
      {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
      <fieldset disabled={busy} aria-busy={busy} className="min-w-0">
      {!cands ? (
        <div className="space-y-2">
          <textarea
            aria-label="原始需求"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            autoFocus
            spellCheck={false}
            disabled={busy}
            placeholder={"把需求、会议纪要、聊天记录、报错日志直接粘贴到这里。\n一次可以有好几件事，AI 会拆开整理。"}
            className={TEXTAREA}
          />
          {products.length === 0 && (
            <p className="text-xs text-warning">还没有配置产品和仓库，整理后无法选择产品。
              <button className="ml-1 text-accent hover:underline" onClick={() => { close(); navigate({ name: "prefs", section: "repos" }); }}>去配置</button>
            </p>
          )}
        </div>
      ) : (
        <ul className="-mx-1 max-h-[55vh] space-y-3 overflow-y-auto px-1">
          {cands.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">没有整理出内容，请回去补充一些文字。</li>}
          {cands.map((c) => (
            <li key={c.id} className={"rounded-lg border border-border bg-card p-3 " + (c.on ? "" : "opacity-55")}>
              <div className="flex items-center gap-2">
                <Checkbox checked={c.on} onChange={(v) => set(c.id, { on: v })} label={<span className="sr-only">导入</span>} />
                <Input value={c.title} onChange={(e: any) => set(c.id, { title: e.target.value })} aria-label="标题" className="font-medium" />
                <Button variant="ghost" size="icon-sm" aria-label="移除" onClick={() => setCands((l) => l!.filter((x) => x.id !== c.id))}><X /></Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                <Segmented size="sm" label="类型" value={c.kind} onChange={(v) => set(c.id, { kind: v })} options={[{ value: "story", label: "需求" }, { value: "bug", label: "Bug" }]} />
                <div className="w-40">
                  <Select value={c.product} onChange={(v) => set(c.id, { product: v })} options={products.map((p) => ({ value: p, label: p }))} placeholder="选择产品" invalid={tried && c.on && !c.product} />
                </div>
                <div className="w-28">
                  <Select value={String(c.priority)} onChange={(v) => set(c.id, { priority: Number(v) as Priority })} options={([1, 2, 3, 4] as Priority[]).map((p) => ({ value: String(p), label: `P${p} ${PRIORITY_LABEL[p]}` }))} />
                </div>
              </div>
              <div className="mt-2 space-y-2 pl-6">
                <textarea value={c.description} onChange={(e) => set(c.id, { description: e.target.value })} rows={2} aria-label="描述" className={TEXTAREA} />
                <textarea
                  value={c.criteria.join("\n")}
                  onChange={(e) => set(c.id, { criteria: e.target.value.split("\n") })}
                  rows={3}
                  aria-label="验收标准，每行一条"
                  placeholder="验收标准，每行一条"
                  className={TEXTAREA}
                />
              </div>
            </li>
          ))}
          <li>
            <Button variant="ghost" size="sm" onClick={() => setCands((l) => [...(l ?? []), { id: `c-${Date.now()}`, title: "", kind: "story", product: "", module: "其他", priority: 3, description: "", criteria: [], on: true }])}>
              <Plus />手动加一项
            </Button>
          </li>
        </ul>
      )}
      </fieldset>
    </Modal>
  );
}
