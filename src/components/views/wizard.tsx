import { flushPrefs } from "@/store/state";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Lock, Rocket, Minus } from "@/lib/icons";
import type { AppConfig } from "@/data/types";
import { DEFAULT_CONFIG } from "@/data/defaults";
import { store, useApp } from "@/store/state";
import { navigate } from "@/lib/route";
import { sync } from "@/store/actions";
import { toast } from "@/store/toast";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { DotPattern } from "@/components/magic/effects";
import { CodexForm, GitlabForm, ZentaoForm } from "@/components/forms/config-forms";
import { useConnTest } from "@/components/forms/conn-test";
import { RepoMappingEditor, mappingHasError, mappingsValid } from "@/components/forms/repo-mapping";

const STEPS = [
  { id: "welcome", title: "欢迎", desc: "了解 ZenCode 怎么工作" },
  { id: "zentao", title: "连接禅道", desc: "读取你的 Bug 和需求" },
  { id: "gitlab", title: "连接 GitLab", desc: "推送分支、创建 Merge Request" },
  { id: "codex", title: "配置 Codex", desc: "检测本机环境、选择模型与权限" },
  { id: "repos", title: "仓库映射", desc: "产品对应哪个仓库" },
  { id: "done", title: "完成", desc: "检查并开始使用" },
] as const;

const BLANK: AppConfig = {
  zentao: { baseUrl: "", edition: "biz", auth: "token", account: "", secret: "", scope: "mine", syncIntervalMin: 5, autoRun: true, connected: false },
  gitlab: { baseUrl: "", token: "", targetBranch: "main", mrDraft: true, connected: false },
  codex: { cliPath: "", model: "Codex · 标准", sandbox: "workspace-write", concurrency: 3, connected: false },
  mappings: [{ id: "w1", product: "", repos: [{ id: "w1a", repo: "", branch: "", role: "", testCmd: "" }] }],
};

export function Wizard() {
  const platform = useApp((s) => s.platform);
  const [i, setI] = useState(0);
  const [draft, setDraft] = useState<AppConfig>(BLANK);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const zt = useConnTest("zentao");
  const gl = useConnTest("gitlab");
  const cx = useConnTest("codex");
  const step = STEPS[i];
  const patch = <K extends keyof AppConfig>(k: K, p: Partial<AppConfig[K]>) => setDraft((d) => ({ ...d, [k]: { ...(d[k] as object), ...p } }));
  const mapOk = mappingsValid(draft.mappings);
  const invalidCount = draft.mappings.filter(mappingHasError).length;

  const go = (n: number) => {
    setI(Math.max(0, Math.min(STEPS.length - 1, n)));
  };

    const demoZ = { ...DEFAULT_CONFIG.zentao, connected: false };
  const demoG = { ...DEFAULT_CONFIG.gitlab, connected: false };
  const demoC = { ...DEFAULT_CONFIG.codex, connected: false };

  const testZ = async (cfg = draft.zentao) => { const ok = await zt.run(cfg); patch("zentao", { connected: ok }); return ok; };
  const testG = async (cfg = draft.gitlab) => { const ok = await gl.run(cfg); patch("gitlab", { connected: ok }); return ok; };
  const testC = async (cfg = draft.codex) => { const ok = await cx.run(cfg); patch("codex", { connected: ok }); return ok; };

  const skip = () => {
    setSkipped((s) => [...s, step.id]);
    go(i + 1);
  };

  const finish = async () => {
    store.set({ config: { ...draft }, setupDone: true });
    try { await flushPrefs(); } catch { return; }
    navigate({ name: "tasks" });
    sync();
    toast({ title: "配置完成", desc: "正在从禅道同步任务", tone: "success" });
  };

  const exitDemo = () => {
    store.set({ setupDone: true });
    navigate({ name: "tasks" });
    toast({ title: "已跳过配置", desc: "请在设置中完成连接后同步任务。", tone: "info", duration: 4200 });
  };

  const canNext =
    step.id === "welcome" ? true :
    step.id === "zentao" ? draft.zentao.connected :
    step.id === "gitlab" ? draft.gitlab.connected :
    step.id === "codex" ? draft.codex.connected :
    step.id === "repos" ? true : true;

  const summary = [
    { id: "zentao", label: "禅道", ok: draft.zentao.connected, detail: draft.zentao.connected ? draft.zentao.baseUrl.replace(/^https?:\/\//, "") : "稍后配置" },
    { id: "gitlab", label: "GitLab", ok: draft.gitlab.connected, detail: draft.gitlab.connected ? draft.gitlab.baseUrl.replace(/^https?:\/\//, "") : "稍后配置" },
    { id: "codex", label: "Codex", ok: draft.codex.connected, detail: draft.codex.connected ? `${draft.codex.model} · 并发 ${draft.codex.concurrency}` : "稍后配置" },
    { id: "repos", label: "仓库映射", ok: mapOk, detail: mapOk ? `${draft.mappings.length} 个产品已映射` : "稍后配置" },
  ];

  return (
    <div className="flex h-full min-h-0 bg-background">
      {/* 左侧步骤 */}
      <aside className="app-chrome relative hidden w-72 shrink-0 flex-col overflow-hidden border-r border-border bg-surface md:flex">
        <DotPattern className="opacity-60" />
        <div className="relative flex items-center gap-2.5 px-6 pb-6 pt-8">
          <Logo size={26} className="text-foreground" />
          <div>
            <p className="text-base font-semibold leading-5 text-foreground">ZenCode</p>
            <p className="text-xs text-muted-foreground">首次配置</p>
          </div>
        </div>
        <ol className="relative flex-1 space-y-1 px-4" aria-label="配置步骤">
          {STEPS.map((s, k) => {
            const done = k < i;
            const cur = k === i;
            const sk = skipped.includes(s.id);
            return (
              <li key={s.id}>
                <button
                  onClick={() => k <= i && go(k)}
                  disabled={k > i}
                  aria-current={cur ? "step" : undefined}
                  className={cn("flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default", cur ? "bg-card shadow-sm" : k < i ? "hover:bg-hover" : "")}
                >
                  <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-medium tabular-nums", done ? (sk ? "border-border-strong text-muted-foreground" : "border-success bg-success text-card") : cur ? "border-accent bg-accent text-accent-foreground" : "border-border-strong text-subtle-foreground")}>
                    {done ? (sk ? <Minus className="size-3" /> : <Check className="size-3" strokeWidth={3} />) : k + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-sm font-medium", cur || done ? "text-foreground" : "text-muted-foreground")}>{s.title}</span>
                    <span className="block text-xs leading-4 text-muted-foreground">{done && sk ? "已跳过" : s.desc}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="relative flex items-start gap-2 px-6 pb-6 pt-4 text-xs leading-5 text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          凭据加密保存在本机，仅用于连接你配置的服务。
        </p>
      </aside>

      {/* 右侧内容 */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border px-5 py-3 md:hidden">
          <p className="text-xs text-muted-foreground">步骤 {i + 1} / {STEPS.length}</p>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={i + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div key={step.id} className="anim-rise mx-auto max-w-xl px-6 py-8 md:py-12">
            {step.id === "welcome" && (
              <div>
                <Logo size={40} className="mb-6 text-foreground" />
                <h1 className="text-2xl font-semibold leading-8 text-foreground text-balance">把禅道里的待办，交给 Codex 去改</h1>
                <p className="mt-3 text-base leading-6 text-muted-foreground">ZenCode 读取分配给你的 Bug 和需求，让 Codex 拉取最新代码、修改并跑测试，你只需要审核结果，再一键创建 Merge Request。</p>
                <ul className="mt-8 space-y-4">
                  {[
                    ["先连接三样东西", "禅道提供任务，GitLab 接收代码，Codex 负责执行。"],
                    ["告诉它代码在哪", "把每个禅道产品对应到一个或多个 GitLab 仓库和分支，各仓库独立执行与审核。"],
                    ["你始终握有方向盘", "可以随时暂停、追加指令，越界的命令会先问你。"],
                  ].map(([t, d], k) => (
                    <li key={t} className="flex gap-3">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground">{k + 1}</span>
                      <span>
                        <span className="block text-sm font-medium text-foreground">{t}</span>
                        <span className="block text-sm leading-5 text-muted-foreground">{d}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {step.id !== "welcome" && step.id !== "done" && (
              <header className="mb-6">
                <h1 className="text-xl font-semibold leading-7 text-foreground">{step.title}</h1>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">{step.desc}</p>
              </header>
            )}

            {step.id === "zentao" && (
              <ZentaoForm
                value={draft.zentao}
                onChange={(p) => { patch("zentao", p); zt.reset(); }}
                test={zt.state}
                onTest={() => testZ()}

              />
            )}
            {step.id === "gitlab" && (
              <GitlabForm
                value={draft.gitlab}
                onChange={(p) => { patch("gitlab", p); gl.reset(); }}
                test={gl.state}
                onTest={() => testG()}

              />
            )}
            {step.id === "codex" && (
              <CodexForm
                value={draft.codex}
                onChange={(p) => { patch("codex", p); if ("sandbox" in p || "model" in p || "concurrency" in p) return; cx.reset(); }}
                test={cx.state}
                onTest={() => testC()}

              />
            )}
            {step.id === "repos" && (
              <div className="space-y-4">
                {showErrors && !mapOk && (
                  <p className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                    {draft.mappings.length === 0 ? "至少添加一个仓库映射。" : `还有 ${invalidCount} 个映射没有填写完整。`}
                  </p>
                )}
                <RepoMappingEditor config={draft} value={draft.mappings} onChange={(mappings) => setDraft((d) => ({ ...d, mappings }))} showErrors={showErrors} />
              </div>
            )}

            {step.id === "done" && (
              <div>
                <div className="mb-6 grid size-11 place-items-center rounded-xl bg-success/12 text-success"><Check className="size-6" strokeWidth={2.5} /></div>
                <h1 className="text-2xl font-semibold leading-8 text-foreground">准备好了</h1>
                <p className="mt-2 text-sm leading-5 text-muted-foreground">下面是你的配置。没有完成的项目可以之后在「设置」里补上。</p>
                <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
                  {summary.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                      <span className={cn("grid size-5 place-items-center rounded-full", s.ok ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
                        {s.ok ? <Check className="size-3" strokeWidth={3} /> : <Minus className="size-3" />}
                      </span>
                      <span className="text-sm font-medium text-foreground">{s.label}</span>
                      <span className="ml-auto truncate font-mono text-xs text-muted-foreground">{s.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-border bg-background px-5 py-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
          {step.id === "welcome" ? (
            <>
              <Button variant="ghost" onClick={exitDemo}>跳过，稍后配置</Button>
              <Button variant="primary" className="ml-auto" onClick={() => go(1)}>开始配置<ArrowRight /></Button>
            </>
          ) : step.id === "done" ? (
            <>
              <Button variant="ghost" onClick={() => go(i - 1)}><ArrowLeft />上一步</Button>
              <Button variant="primary" className="ml-auto" onClick={finish}><Rocket />进入 ZenCode</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => go(i - 1)}><ArrowLeft />上一步</Button>
              {step.id !== "repos" && !canNext && (
                <Button variant="ghost" className="ml-auto" onClick={skip}>稍后配置</Button>
              )}
              <Button
                variant="primary"
                className={cn(step.id === "repos" || canNext ? "ml-auto" : "")}
                disabled={step.id !== "repos" && !canNext}
                onClick={() => {
                  if (step.id === "repos") {
                    if (!mapOk) {
                      setShowErrors(true);
                      return;
                    }
                  }
                  go(i + 1);
                }}
              >
                下一步<ArrowRight />
              </Button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
