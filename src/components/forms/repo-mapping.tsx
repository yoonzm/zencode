import { Modal } from "@/components/ui/dialog";
import { useEffect, useState } from "react";
import { Plus, Trash, FolderGit, RefreshCw, Sparkles, X, Play, FileText } from "@/lib/icons";
import type { AppConfig, AiSuggestion, RepoLink, RepoMapping } from "@/data/types";
import { desktopCall } from "@/lib/desktop";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/fields";
import { toast } from "@/store/toast";
import { projectPromptOf } from "@/data/project-prompt";
import { Tip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty";
import { cn, uid } from "@/lib/utils";
import { useNow } from "@/lib/hooks";
import { relTime } from "@/lib/time";
import { store } from "@/store/state";

import { AiMatchDialog } from "./ai-match";
import { VerificationToolDialog } from "./verification-tool";

export function mappingErrors(m: RepoMapping) {
  const seen = new Set<string>();
  return {
    product: !m.product ? "请选择禅道产品" : "",
    empty: m.repos.length === 0 ? "至少添加一个仓库" : "",
    repos: m.repos.map((r) => {
      const dup = !!r.repo && seen.has(r.repo);
      seen.add(r.repo);
      return { repo: !r.repo ? "请选择仓库" : dup ? "这个仓库已经添加过" : "", branch: r.repo && !r.branch ? "请选择分支" : "" };
    }),
  };
}
export const mappingHasError = (m: RepoMapping) => {
  const e = mappingErrors(m);
  return !!e.product || !!e.empty || e.repos.some((r) => r.repo || r.branch);
};
export const mappingsValid = (list: RepoMapping[]) => list.length > 0 && list.every((m) => !mappingHasError(m));

const newLink = (): RepoLink => ({ id: uid("r"), repo: "", branch: "", role: "", testCmd: "" });

function Label({ children, error }: { children: React.ReactNode; error?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {children}
      {error && <span className="font-normal text-danger" role="alert">{error}</span>}
    </label>
  );
}

function ProjectPromptSection({ m, onChange, config }: { m: RepoMapping; onChange: (prompt: string) => void; config: AppConfig }) {
  const value = projectPromptOf(m);
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <FileText aria-hidden="true" className="size-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">项目专有提示词</p>
        <p className="text-xs text-muted-foreground">{value.trim() ? "已配置 · 各阶段按需使用环境、开发和测试约定" : "可填写环境、开发和测试约定；AI 自动判断验证需求"}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>{value.trim() ? "编辑" : "填写"}</Button>
      {open && <ProjectPromptDialog m={m} config={config} value={value} onClose={() => setOpen(false)} onSave={(x) => { onChange(x); setOpen(false); }} />}
    </div>
  );
}

function ProjectPromptDialog({ m, value, config, onClose, onSave }: { m: RepoMapping; config: AppConfig; value: string; onClose: () => void; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [tool, setTool] = useState<"draft" | "trial" | null>(null);
  const dirty = text !== value;
  return (
    <Modal open onClose={() => { if (!tool) onClose(); }} size="lg" className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl"
      title={`项目专有提示词 · ${m.product || "未选择产品"}`}
      description="在任务分析、开发、自检和验证阶段按需使用。AI 会结合提示词与本次改动判断是否需要验证，并制定步骤。"
      footer={<>
        <div className="mr-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={mappingHasError(m)} onClick={() => setTool("draft")}><Sparkles />AI 生成草稿</Button>
          <Button variant="ghost" size="sm" disabled={mappingHasError(m)} onClick={() => setTool("trial")}><Play />试运行验证</Button>
        </div>
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button variant="primary" disabled={!dirty} onClick={() => onSave(text)}>保存</Button>
      </>}
    >
      <label htmlFor="project-prompt" className="mb-2 block text-sm font-medium">环境、开发与测试约定</label>
      <textarea id="project-prompt" value={text} onChange={(ev) => setText(ev.target.value)} rows={16} spellCheck={false}
        placeholder={"## 开发前准备\n依赖版本、本地路径、启动方式、测试环境地址。\n\n## 如何开发\n代码风格、目录规范、需要遵守的项目约定。\n\n## 如何验证\n何时需要验证、测试命令、操作步骤和预期结果。"}
        className="block h-[60dvh] min-h-48 max-h-[calc(90dvh-15rem)] w-full resize-y rounded-md border border-input bg-background px-3 py-2.5 font-mono text-[13px] leading-[1.65] text-foreground outline-none placeholder:font-sans placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
      />
      <p className="mt-2 text-xs text-muted-foreground">留空时，AI 根据仓库资料和本次改动判断。试运行仅检查验证流程，不执行开发改动。</p>
      {mappingHasError(m) && <p className="mt-3 text-xs text-muted-foreground">选择产品、仓库和分支后可生成草稿或试运行。</p>}
      {tool && <VerificationToolDialog mode={tool} mapping={{ ...m, projectPrompt: text }} config={config} onApply={setText} onClose={() => setTool(null)} />}
    </Modal>
  );
}

export function RepoMappingEditor({ value, onChange, showErrors, config }: { value: RepoMapping[]; onChange: (v: RepoMapping[]) => void; showErrors?: boolean; config?: AppConfig }) {
  const [aiOpen, setAiOpen] = useState(false);
  const [products, setProducts] = useState<string[]>(value.map(m => m.product));
  const cfg = config || store.get().config;
  const { gitlab, zentao } = cfg;
  const [catalogAt, setCatalogAt] = useState(0);
  const [repos, setRepos] = useState<{ path: string; defaultBranch: string }[]>([]);
  const [branches, setBranches] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const selectedRepos = JSON.stringify([...new Set(value.flatMap(m => m.repos.map(r => r.repo)).filter(Boolean))].sort());
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(""); setRepos([]); setBranches({});
    const cfg = { gitlab, zentao };
    const reportError = (e: unknown) => { if (active) setLoadError(String(e)); };
    Promise.allSettled([
      desktopCall("products", { config: cfg }).then(list => { if (active) setProducts(list); }),
      desktopCall("gitlabRepos", { config: cfg }).then(list => { if (active) setRepos(list); }),
      ...(JSON.parse(selectedRepos) as string[]).map(repo =>
        desktopCall("gitlabBranches", { config: cfg, repo }).then(list => {
          if (active) setBranches(prev => ({ ...prev, [repo]: list }));
        })),
    ]).then(results => {
      const failures = results.filter(r => r.status === "rejected");
      if (failures.length) reportError(failures.map(r => String(r.reason)).join("\n"));
      else if (active) setCatalogAt(Date.now());
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [gitlab.baseUrl, gitlab.token, gitlab.insecureTls, selectedRepos, reload, zentao.baseUrl, zentao.secret, zentao.account, zentao.auth, zentao.insecureTls]);
  const findRepo = (path: string) => repos.find(r => r.path === path);
  const busy = loading;
  const refreshCatalog = () => setReload(n => n + 1);
  const now = useNow(30_000);

  const updateMap = (id: string, fn: (m: RepoMapping) => RepoMapping) => onChange(value.map((m) => (m.id === id ? fn(m) : m)));
  const updateLink = (mid: string, rid: string, patch: Partial<RepoLink>) => updateMap(mid, (m) => ({ ...m, repos: m.repos.map((r) => (r.id === rid ? { ...r, ...patch } : r)) }));
  const used = new Set(value.map((m) => m.product));

  const addMapping = () => onChange([...value, { id: uid("m"), product: products.find((p) => !used.has(p)) ?? "", repos: [newLink()], projectPrompt: "" }]);

  const applyAi = (picked: AiSuggestion[]) => {
    let next = value.map((m) => ({ ...m, repos: [...m.repos] }));
    for (const s of picked) {
      let m = next.find((x) => x.product === s.product);
      if (!m) { m = { id: uid("m"), product: s.product, repos: [] }; next.push(m); }
      if (!m.repos.some((r) => r.repo === s.repo)) m.repos.push({ id: uid("r"), repo: s.repo, branch: s.branch, role: s.role, testCmd: "" });
      // 清理空白占位行
      m.repos = m.repos.filter((r) => r.repo || m!.repos.length === 1);
    }
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {value.length > 0 && <Button variant="secondary" onClick={() => setAiOpen(true)}><Sparkles />AI 自动匹配</Button>}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{busy ? "正在从禅道和 GitLab 刷新…" : catalogAt ? `产品、仓库和分支列表 · 刷新于 ${relTime(catalogAt, now)}` : "尚未刷新成功"}</span>
          <Tip label="重新读取产品、仓库和分支">
            <Button variant="ghost" size="icon-sm" onClick={refreshCatalog} disabled={busy} aria-label="刷新产品、仓库和分支">
              <RefreshCw className={busy ? "animate-spin" : undefined} />
            </Button>
          </Tip>
        </div>
      </div>

      {loadError && <p role="alert" className="text-xs text-danger">{loadError}</p>}
      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong">
          <EmptyState
            icon={FolderGit}
            title="还没有仓库映射"
            desc="每个禅道产品对应一个或多个 GitLab 仓库。每个仓库独立执行、审核并创建 MR，每次执行都会重新拉取代码。"
            actions={<><Button variant="primary" onClick={() => setAiOpen(true)}><Sparkles />AI 自动匹配</Button><Button variant="secondary" onClick={addMapping}><Plus />手动添加</Button></>}
            className="py-8"
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {value.map((m, i) => {
            const e = mappingErrors(m);
            const productOpts = products.filter((p) => p === m.product || !used.has(p)).map((p) => ({ value: p, label: p }));
            return (
              <li key={m.id} className="rounded-lg border border-border bg-card p-3.5">
                <div className="mb-3 flex items-start gap-2">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                    <Label error={showErrors ? e.product : ""}>
                      产品
                      <Combobox value={m.product} onChange={(v: string) => (value.some((x) => x.id !== m.id && x.product === v) ? toast({ title: "这个产品已经添加过", tone: "warn", duration: 2400 }) : updateMap(m.id, (x) => ({ ...x, product: v })))} options={productOpts} placeholder="选择或输入产品名" searchPlaceholder="搜索，或直接输入产品名…" creatable={() => "禅道里没有这个产品时，直接用这个名字"} invalid={showErrors && !!e.product} onRefresh={refreshCatalog} refreshing={busy} />
                    </Label>
                  </div>
                  <Button variant="ghost" size="icon-sm" className="mt-[1.375rem]" aria-label={`删除产品映射 ${i + 1}`} onClick={() => onChange(value.filter((x) => x.id !== m.id))}>
                    <Trash />
                  </Button>
                </div>

                <ul className="space-y-2">
                  {m.repos.map((r) => {
                    const re = e.repos[m.repos.indexOf(r)];
                    const branchList = (branches[r.repo] ?? []).map((b) => ({ value: b, label: b, hint: b === findRepo(r.repo)?.defaultBranch ? "默认分支" : undefined }));
                    const branchOpts = r.branch && !branchList.some((o) => o.value === r.branch) ? [{ value: r.branch, label: r.branch, hint: "已保存，尚未确认分支" }, ...branchList] : branchList;
                    const repoOpts = repos.map((x) => ({ value: x.path, label: x.path, hint: `默认分支 ${x.defaultBranch}` }));
                    if (r.repo && !findRepo(r.repo)) repoOpts.unshift({ value: r.repo, label: r.repo, hint: "已保存，尚未确认访问权限" });
                    return (
                      <li key={r.id} className="flex items-start gap-2">
                        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                          <Label error={showErrors ? re?.repo : ""}>
                            <span className={m.repos.indexOf(r) === 0 ? "" : "sr-only"}>GitLab 仓库</span>
                            <Combobox value={r.repo} onChange={(v: string) => updateLink(m.id, r.id, { repo: v, branch: findRepo(v)?.defaultBranch ?? "" })} options={repoOpts} placeholder="选择仓库" searchPlaceholder="搜索仓库…" invalid={showErrors && !!re?.repo} onRefresh={refreshCatalog} refreshing={busy} />
                          </Label>
                          <Label error={showErrors ? re?.branch : ""}>
                            <span className={m.repos.indexOf(r) === 0 ? "" : "sr-only"}>目标分支</span>
                            <Combobox value={r.branch} onChange={(v: string) => updateLink(m.id, r.id, { branch: v })} options={branchOpts} placeholder={r.repo ? "选择分支" : "先选择仓库"} searchPlaceholder="搜索分支…" disabled={!r.repo} invalid={showErrors && !!re?.branch} onRefresh={refreshCatalog} refreshing={busy} />
                          </Label>
                        </div>
                        {m.repos.length === 1 && <span className="size-7 shrink-0" aria-hidden />}
                        {m.repos.length > 1 && (
                          <Button variant="ghost" size="icon-sm" className={m.repos.indexOf(r) === 0 ? "mt-[1.375rem]" : ""} aria-label={`移除仓库 ${r.repo || ""}`} onClick={() => updateMap(m.id, (x) => ({ ...x, repos: x.repos.filter((y) => y.id !== r.id) }))}>
                            <X />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {showErrors && e.empty && <p className="mt-2 text-xs text-danger" role="alert">{e.empty}</p>}
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => updateMap(m.id, (x) => ({ ...x, repos: [...x.repos, newLink()] }))}>
                  <Plus />添加仓库
                </Button>
                <ProjectPromptSection m={m} config={cfg} onChange={(v) => updateMap(m.id, (x) => ({ ...x, projectPrompt: v }))} />
              </li>
            );
          })}
        </ul>
      )}
      {value.length > 0 && (
        <Button variant="secondary" onClick={addMapping}><Plus />添加产品</Button>
      )}
      <AiMatchDialog config={cfg} open={aiOpen} onClose={() => setAiOpen(false)} value={value} onApply={applyAi} />
    </div>
  );
}
