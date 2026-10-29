import { store } from "@/store/state";
import { useState, useEffect } from "react";
import { Plus, Trash, Wand, FolderGit } from "@/lib/icons";
import type { RepoMapping, AppConfig } from "@/data/types";
import { desktopCall } from "@/lib/desktop";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/fields";
import { uid } from "@/lib/utils";
import { toast } from "@/store/toast";
import { EmptyState } from "@/components/ui/empty";

export function mappingErrors(m: RepoMapping) {
  return {
    repo: !m.repo.trim() ? "请填写 GitLab 仓库" : !/^[\w.-]+(\/[\w.-]+)+$/.test(m.repo.trim()) ? "格式应为 group/project" : "",
    branch: !m.branch.trim() ? "请选择分支" : "",
    product: !m.product ? "请选择禅道产品" : "",
  };
}
export const mappingsValid = (list: RepoMapping[]) => list.length > 0 && list.every((m) => !Object.values(mappingErrors(m)).some(Boolean));

export function RepoMappingEditor({ value, onChange, showErrors, config }: { value: RepoMapping[]; onChange: (v: RepoMapping[]) => void; showErrors?: boolean; config?: AppConfig }) {
  const [products, setProducts] = useState<string[]>(value.map(m => m.product));
  useEffect(() => { desktopCall("products").then(setProducts).catch(() => {}); }, []);
  const gitlab = (config || store.get().config).gitlab;
  const [repos, setRepos] = useState<{ path: string; defaultBranch: string }[]>([]);
  const [branches, setBranches] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const selectedRepos = JSON.stringify([...new Set(value.map(m => m.repo).filter(Boolean))].sort());
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(""); setRepos([]); setBranches({});
    const cfg = { gitlab };
    const reportError = (e: unknown) => { if (active) setLoadError(String(e)); };
    Promise.allSettled([
      desktopCall("gitlabRepos", { config: cfg }).then(list => { if (active) setRepos(list); }).catch(reportError),
      ...(JSON.parse(selectedRepos) as string[]).map(repo =>
        desktopCall("gitlabBranches", { config: cfg, repo }).then(list => {
          if (active) setBranches(prev => ({ ...prev, [repo]: list }));
        }).catch(reportError)),
    ]).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [gitlab.baseUrl, gitlab.token, gitlab.insecureTls, selectedRepos, reload]);
  const findRepo = (path: string) => repos.find(r => r.path === path);
  const repoOptions = (cur: string) => {
    const list = repos.map(r => ({ value: r.path, label: r.path }));
    return cur && !findRepo(cur) ? [{ value: cur, label: cur, hint: "已保存，尚未确认访问权限" }, ...list] : list;
  };
  const branchOptions = (repo: string, cur: string) => {
    const list = (branches[repo] || []).map(b => ({ value: b, label: b }));
    return cur && !list.some(b => b.value === cur) ? [{ value: cur, label: cur }, ...list] : list;
  };
  const [matching, setMatching] = useState(false);
  const update = (id: string, patch: Partial<RepoMapping>) => onChange(value.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const used = new Set(value.map((m) => m.product));

  const autoMatch = async () => {
    setMatching(true);
    try {
      const matched = await desktopCall("matchRepos", { config: config || store.get().config }) as RepoMapping[];
      const next = value.map(m => { const match = matched.find(x => x.product === m.product); return match && !m.repo.trim() ? { ...m, repo: match.repo, branch: m.branch || match.branch } : m; });
      onChange([...next, ...matched.filter(m => !used.has(m.product))]);
      toast({ title: `匹配到 ${matched.length} 个同名 GitLab 项目`, desc: "请核对仓库和目标分支；名称不唯一的项目需要手动选择。", tone: "info" });
    } catch (e) { toast({ title: "匹配失败", desc: String(e), tone: "danger" }); }
    finally { setMatching(false); }
  };

  const add = () =>
    onChange([...value, { id: uid("m"), product: products.find((p) => !used.has(p)) ?? "", repo: "", branch: "", testCmd: "" }]);

  return (
    <div className="space-y-3">
      {loading && <p role="status" className="text-xs text-muted-foreground">正在加载 GitLab 仓库和分支…</p>}
      {loadError && <p role="alert" className="text-xs text-danger">{loadError}</p>}
      <Button variant="ghost" loading={loading} onClick={() => setReload(n => n + 1)}>刷新仓库和分支</Button>
      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong">
          <EmptyState icon={FolderGit} title="还没有仓库映射" desc="每个禅道产品对应一个 GitLab 仓库和目标分支。每次新执行都会重新拉取代码。" actions={<Button variant="primary" onClick={add}><Plus />添加映射</Button>} className="py-8" />
        </div>
      ) : (
        <ul className="space-y-3">
          {value.map((m, i) => {
            const e = mappingErrors(m);
            const showE = showErrors;
            return (
              <li key={m.id} className="rounded-lg border border-border bg-card p-3.5">
                <div className="mb-3 flex items-center gap-2">
                  <FolderGit className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">映射 {i + 1}</span>
                  <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={`删除映射 ${i + 1}`} onClick={() => onChange(value.filter((x) => x.id !== m.id))}>
                    <Trash />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                    禅道产品
                    <Select value={m.product} onChange={(v: string) => update(m.id, { product: v })} options={products.map((p) => ({ value: p, label: p }))} invalid={showE && !!e.product} />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                    GitLab 仓库
                    <Select
                      value={m.repo}
                      onChange={(v: string) => update(m.id, { repo: v, branch: findRepo(v)?.defaultBranch ?? "" })}
                      options={repoOptions(m.repo)}
                      placeholder="选择仓库"
                      invalid={showE && !!e.repo}
                    />
                    {showE && e.repo && <span className="text-danger" role="alert">{e.repo}</span>}
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                    目标分支
                    <Select
                      value={m.branch}
                      onChange={(v: string) => update(m.id, { branch: v })}
                      options={branchOptions(m.repo, m.branch)}
                      placeholder={m.repo ? "选择分支" : "先选择仓库"}
                      invalid={showE && !!e.branch}
                    />
                    {showE && e.branch && <span className="text-danger" role="alert">{e.branch}</span>}
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                    测试命令（可选）
                    <Input value={m.testCmd} onChange={(ev: any) => update(m.id, { testCmd: ev.target.value })} placeholder="pnpm test" className="font-mono text-xs" spellCheck={false} />
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={add}><Plus />添加映射</Button>
        <Button variant="ghost" loading={matching} onClick={autoMatch}><Wand />按名称自动匹配</Button>
      </div>
    </div>
  );
}
