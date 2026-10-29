import { useEffect, useState } from "react";
import { Plus, Trash, FolderGit, RefreshCw, Sparkles, X } from "@/lib/icons";
import type { AppConfig, AiSuggestion, RepoLink, RepoMapping } from "@/data/types";
import { desktopCall } from "@/lib/desktop";
import { Button } from "@/components/ui/button";
import { Combobox, Input } from "@/components/ui/fields";
import { Tip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty";
import { uid } from "@/lib/utils";
import { useNow } from "@/lib/hooks";
import { relTime } from "@/lib/time";
import { store } from "@/store/state";

import { AiMatchDialog } from "./ai-match";

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
const ROLES = ["前端", "后端", "网关", "微服务", "移动端", "公共库"];

function Label({ children, error }: { children: React.ReactNode; error?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {children}
      {error && <span className="font-normal text-danger" role="alert">{error}</span>}
    </label>
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

  const addMapping = () => onChange([...value, { id: uid("m"), product: products.find((p) => !used.has(p)) ?? "", repos: [newLink()] }]);

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
        <Button variant="secondary" onClick={() => setAiOpen(true)}><Sparkles />AI 自动匹配</Button>
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
                <div className="mb-3 flex items-end gap-2">
                  <div className="min-w-0 flex-1 sm:max-w-xs">
                    <Label error={showErrors ? e.product : ""}>
                      禅道产品
                      <Combobox value={m.product} onChange={(v: string) => updateMap(m.id, (x) => ({ ...x, product: v }))} options={productOpts} placeholder="选择产品" searchPlaceholder="搜索产品…" invalid={showErrors && !!e.product} onRefresh={refreshCatalog} refreshing={busy} />
                    </Label>
                  </div>
                  <span className="pb-1.5 text-xs text-muted-foreground">{m.repos.length} 个仓库</span>
                  <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`删除产品映射 ${i + 1}`} onClick={() => onChange(value.filter((x) => x.id !== m.id))}>
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
                      <li key={r.id} className="relative rounded-md bg-muted/50 p-3">
                        {m.repos.length > 1 && (
                          <Button variant="ghost" size="icon-xs" className="absolute right-1.5 top-1.5" aria-label={`移除仓库 ${r.repo || ""}`} onClick={() => updateMap(m.id, (x) => ({ ...x, repos: x.repos.filter((y) => y.id !== r.id) }))}>
                            <X />
                          </Button>
                        )}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Label error={showErrors ? re?.repo : ""}>
                            GitLab 仓库
                            <Combobox value={r.repo} onChange={(v: string) => updateLink(m.id, r.id, { repo: v, branch: findRepo(v)?.defaultBranch ?? "" })} options={repoOpts} placeholder="选择仓库" searchPlaceholder="搜索仓库…" invalid={showErrors && !!re?.repo} onRefresh={refreshCatalog} refreshing={busy} />
                          </Label>
                          <Label error={showErrors ? re?.branch : ""}>
                            目标分支
                            <Combobox value={r.branch} onChange={(v: string) => updateLink(m.id, r.id, { branch: v })} options={branchOpts} placeholder={r.repo ? "选择分支" : "先选择仓库"} searchPlaceholder="搜索分支…" disabled={!r.repo} invalid={showErrors && !!re?.branch} onRefresh={refreshCatalog} refreshing={busy} />
                          </Label>
                          <Label>
                            标签（可选）
                            <Input value={r.role} onChange={(ev: any) => updateLink(m.id, r.id, { role: ev.target.value })} placeholder="前端 / 后端 / 微服务" list="repo-roles" maxLength={12} />
                          </Label>
                          <Label>
                            测试命令（可选）
                            <Input value={r.testCmd} onChange={(ev: any) => updateLink(m.id, r.id, { testCmd: ev.target.value })} placeholder="pnpm test" className="font-mono text-xs" spellCheck={false} />
                          </Label>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {showErrors && e.empty && <p className="mt-2 text-xs text-danger" role="alert">{e.empty}</p>}
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => updateMap(m.id, (x) => ({ ...x, repos: [...x.repos, newLink()] }))}>
                  <Plus />添加仓库
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <datalist id="repo-roles">{ROLES.map((r) => <option key={r} value={r} />)}</datalist>
      {value.length > 0 && (
        <Button variant="secondary" onClick={addMapping}><Plus />添加产品</Button>
      )}
      <AiMatchDialog config={cfg} open={aiOpen} onClose={() => setAiOpen(false)} value={value} onApply={applyAi} />
    </div>
  );
}
