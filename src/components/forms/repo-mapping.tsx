import { useState } from "react";
import { Plus, Trash, Wand, FolderGit } from "@/lib/icons";
import type { RepoMapping } from "@/data/types";
import { ZENTAO_PRODUCTS } from "@/data/mock";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/fields";
import { sleep, uid } from "@/lib/utils";
import { toast } from "@/store/toast";
import { EmptyState } from "@/components/ui/empty";

const GUESS: Record<string, string> = {
  企业管理后台: "acme/web-console",
  支付中心: "acme/payment-service",
  "移动端 App": "acme/mobile-app",
  开放平台: "acme/open-api",
  数据看板: "acme/data-board",
};

export function mappingErrors(m: RepoMapping) {
  return {
    repo: !m.repo.trim() ? "请填写 GitLab 仓库" : !/^[\w.-]+(\/[\w.-]+)+$/.test(m.repo.trim()) ? "格式应为 group/project" : "",
    localPath: !m.localPath.trim() ? "请填写本地路径" : "",
    product: !m.product ? "请选择禅道产品" : "",
  };
}
export const mappingsValid = (list: RepoMapping[]) => list.length > 0 && list.every((m) => !Object.values(mappingErrors(m)).some(Boolean));

export function RepoMappingEditor({ value, onChange, showErrors }: { value: RepoMapping[]; onChange: (v: RepoMapping[]) => void; showErrors?: boolean }) {
  const [matching, setMatching] = useState(false);
  const update = (id: string, patch: Partial<RepoMapping>) => onChange(value.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const used = new Set(value.map((m) => m.product));

  const autoMatch = async () => {
    setMatching(true);
    await sleep(800);
    const free = ZENTAO_PRODUCTS.filter((p) => !used.has(p));
    let filled = 0;
    const next = value.map((m) => {
      if (m.repo.trim() && m.localPath.trim()) return m;
      const g = GUESS[m.product];
      if (!g) return m;
      filled++;
      return { ...m, repo: m.repo || g, localPath: m.localPath || `~/code/${g.split("/")[1]}` };
    });
    const added = free.map((p) => ({ id: uid("m"), product: p, repo: GUESS[p] ?? "", localPath: GUESS[p] ? `~/code/${GUESS[p].split("/")[1]}` : "", branch: "main", testCmd: "" }));
    onChange([...next, ...added]);
    setMatching(false);
    toast({ title: `已按名称匹配 ${filled + added.length} 项`, desc: "请核对仓库和路径是否正确 · 演示数据", sim: true, tone: "info", duration: 3600 });
  };

  const add = () =>
    onChange([...value, { id: uid("m"), product: ZENTAO_PRODUCTS.find((p) => !used.has(p)) ?? "", repo: "", localPath: "", branch: "main", testCmd: "" }]);

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
                    <Select value={m.product} onChange={(v: string) => update(m.id, { product: v })} options={ZENTAO_PRODUCTS.map((p) => ({ value: p, label: p }))} invalid={showE && !!e.product} />
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
