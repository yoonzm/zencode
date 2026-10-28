import { useState, useEffect } from "react";
import { Plus, Trash, Wand, FolderGit } from "@/lib/icons";
import type { RepoMapping } from "@/data/types";
import { desktopCall } from "@/lib/desktop";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/fields";
import { sleep, uid } from "@/lib/utils";
import { toast } from "@/store/toast";
import { EmptyState } from "@/components/ui/empty";

export function mappingErrors(m: RepoMapping) {
  return {
    repo: !m.repo.trim() ? "请填写 GitLab 仓库" : !/^[\w.-]+(\/[\w.-]+)+$/.test(m.repo.trim()) ? "格式应为 group/project" : "",
    localPath: !m.localPath.trim() ? "请填写本地路径" : "",
    product: !m.product ? "请选择禅道产品" : "",
  };
}
export const mappingsValid = (list: RepoMapping[]) => list.length > 0 && list.every((m) => !Object.values(mappingErrors(m)).some(Boolean));

export function RepoMappingEditor({ value, onChange, showErrors }: { value: RepoMapping[]; onChange: (v: RepoMapping[]) => void; showErrors?: boolean }) {
  const [products, setProducts] = useState<string[]>(value.map(m => m.product));
  useEffect(() => { desktopCall("products").then(setProducts).catch(() => {}); }, []);
  const [matching, setMatching] = useState(false);
  const update = (id: string, patch: Partial<RepoMapping>) => onChange(value.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const used = new Set(value.map((m) => m.product));

  const autoMatch = async () => {
    try { const names = await desktopCall("products"); setProducts(names); toast({ title: "已读取禅道产品", desc: "请手动指定 GitLab 仓库及本地克隆路径，避免匹配到错误仓库。", tone: "info" }); }
    catch (e) { toast({ title: "读取失败", desc: String(e), tone: "danger" }); }
  };

  const add = () =>
    onChange([...value, { id: uid("m"), product: products.find((p) => !used.has(p)) ?? "", repo: "", localPath: "", branch: "main", testCmd: "" }]);

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong">
          <EmptyState icon={FolderGit} title="还没有仓库映射" desc="每个禅道产品需要对应一个 GitLab 仓库和一份本地克隆，Codex 才知道在哪里改代码。" actions={<Button variant="primary" onClick={add}><Plus />添加映射</Button>} className="py-8" />
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
                    <Input value={m.repo} onChange={(ev: any) => update(m.id, { repo: ev.target.value })} placeholder="group/project" invalid={showE && !!e.repo} className="font-mono text-xs" spellCheck={false} />
                    {showE && e.repo && <span className="text-danger" role="alert">{e.repo}</span>}
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground sm:col-span-2">
                    本地仓库路径
                    <Input value={m.localPath} onChange={(ev: any) => update(m.id, { localPath: ev.target.value })} placeholder="~/code/project" invalid={showE && !!e.localPath} className="font-mono text-xs" spellCheck={false} />
                    {showE && e.localPath && <span className="text-danger" role="alert">{e.localPath}</span>}
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                    默认分支
                    <Input value={m.branch} onChange={(ev: any) => update(m.id, { branch: ev.target.value })} placeholder="main" className="font-mono text-xs" spellCheck={false} />
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
