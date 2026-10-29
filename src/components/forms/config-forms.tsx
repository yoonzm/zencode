import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronRight, Eye, EyeOff, ShieldAlert, ShieldCheck, Wand, Minus, Plus } from "@/lib/icons";
import type { CodexConfig, GitlabConfig, SandboxMode, ZentaoConfig } from "@/data/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented, Select, Toggle } from "@/components/ui/fields";
import { ConnTestPanel, useConnTest, type TestState } from "./conn-test";
import { useApp } from "@/store/state";
import { toast } from "@/store/toast";

export function SecretInput({ value, onChange, id, describedBy, invalid, placeholder }: any) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} aria-describedby={describedBy} invalid={invalid} type={show ? "text" : "password"} value={value} onChange={(e: any) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} className="pr-9 font-mono text-xs" />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "隐藏" : "显示"} className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
        {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}

export interface FormHandle {
  test: TestState;
  runTest: () => Promise<boolean>;
}

function TestBar({ onRun, state, label = "测试连接" }: { onRun: () => void; state: TestState; label?: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="secondary" loading={state.status === "running"} onClick={onRun}>{state.status === "running" ? "正在测试…" : state.status === "idle" ? label : "重新测试"}</Button>
        {state.status === "ok" && <span className="text-sm text-success">连接成功</span>}
      </div>
      <ConnTestPanel state={state} />
    </div>
  );
}


/** 高级：跳过 TLS 证书验证。证书类错误出现时自动展开。 */
function AdvancedTls({ checked, onChange, test }: { checked: boolean; onChange: (v: boolean) => void; test: TestState }) {
  const certError = test.status === "error" && /证书/.test(test.message ?? "");
  const [shown, setOpen] = useState(checked || certError);
  const panelId = useId();
  useEffect(() => { if (checked || certError) setOpen(true); }, [checked, certError]);
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen(!shown)}
        aria-expanded={shown}
        aria-controls={panelId}
        className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-foreground outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", shown && "rotate-90")} />
        高级
        {checked && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-warning/15 px-1.5 text-xs font-medium text-warning"><ShieldAlert className="size-3" />已跳过证书验证</span>}
      </button>
      {shown && (
        <div id={panelId} className="space-y-3 border-t border-border px-3 py-3">
          <div className="flex items-start gap-3">
            <Toggle checked={checked} onChange={onChange} label="跳过证书验证" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">跳过证书验证</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">内网服务使用自签名证书或私有 CA 时，可以只对这个服务的 API 连接关闭校验。其他连接不受影响，Git 推送仍使用本机 Git 的证书设置。</p>
            </div>
          </div>
          {checked && (
            <p className="flex items-start gap-2 rounded-md bg-warning/10 px-2.5 py-2 text-xs leading-5 text-warning" role="note">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              关闭后无法确认对方就是你的服务器，账号、密码和令牌有被截获的风险。建议只在可信的内网使用，并尽快改为导入公司根证书。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── 禅道 ─────────────────────────────────────────────────

export function ZentaoForm({ value, onChange, test, onTest, onDemo }: { value: ZentaoConfig; onChange: (p: Partial<ZentaoConfig>) => void; test: ReturnType<typeof useConnTest>["state"]; onTest: () => void; onDemo?: () => void }) {
  return (
    <div className="space-y-5">
      <Field label="服务地址" hint="禅道的访问地址，不含 /zentao 之外的路径。">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={value.baseUrl} onChange={(e: any) => onChange({ baseUrl: e.target.value, connected: false })} placeholder="https://zentao.example.com" inputMode="url" spellCheck={false} />}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="版本">
          {({ id }) => (
            <Select
              id={id}
              value={value.edition}
              onChange={(v: any) => onChange({ edition: v })}
              options={[
                { value: "open", label: "开源版" },
                { value: "biz", label: "企业版" },
                { value: "max", label: "旗舰版" },
              ]}
            />
          )}
        </Field>
        <Field label="认证方式">
          {() => (
            <Segmented
              label="认证方式"
              value={value.auth}
              onChange={(auth) => onChange({ auth, secret: "", connected: false })}
              options={[
                { value: "token", label: "API Token" },
                { value: "password", label: "账号密码" },
              ]}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="账号">
          {({ id }) => <Input id={id} value={value.account} onChange={(e: any) => onChange({ account: e.target.value, connected: false })} placeholder="zhangming" autoComplete="off" spellCheck={false} />}
        </Field>
        <Field label={value.auth === "token" ? "API Token" : "密码"}>
          {({ id }) => <SecretInput id={id} value={value.secret} onChange={(v: string) => onChange({ secret: v, connected: false })} placeholder={value.auth === "token" ? "在禅道个人中心生成" : "••••••••"} />}
        </Field>
      </div>
      <Field label="同步范围" hint="控制哪些任务出现在列表里。之后可以随时修改。">
        {() => (
          <Segmented
            label="同步范围"
            value={value.scope}
            onChange={(scope) => onChange({ scope })}
            options={[
              { value: "mine", label: "只同步指派给我的" },
              { value: "products", label: "所选产品下的全部" },
            ]}
          />
        )}
      </Field>
      <AdvancedTls checked={!!value.insecureTls} onChange={(v) => onChange({ insecureTls: v, connected: false })} test={test} />
      <TestBar onRun={onTest} state={test} />
      {onDemo && (
        <button type="button" onClick={onDemo} className="inline-flex items-center gap-1.5 rounded-sm text-sm text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">
          <Wand className="size-3.5" />填入演示数据并测试
        </button>
      )}
    </div>
  );
}

// ── GitLab ───────────────────────────────────────────────

export function GitlabForm({ value, onChange, test, onTest, onDemo }: { value: GitlabConfig; onChange: (p: Partial<GitlabConfig>) => void; test: ReturnType<typeof useConnTest>["state"]; onTest: () => void; onDemo?: () => void }) {
  return (
    <div className="space-y-5">
      <Field label="实例地址">
        {({ id }) => <Input id={id} value={value.baseUrl} onChange={(e: any) => onChange({ baseUrl: e.target.value, connected: false })} placeholder="https://gitlab.example.com" inputMode="url" spellCheck={false} />}
      </Field>
      <Field label="Personal Access Token" hint="需要 api 和 write_repository 权限。令牌只保存在本机钥匙串中。">
        {({ id, describedBy }) => <SecretInput id={id} describedBy={describedBy} value={value.token} onChange={(v: string) => onChange({ token: v, connected: false })} placeholder="glpat-xxxxxxxxxxxxxxxxxxxx" />}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="默认目标分支">
          {({ id }) => <Input id={id} value={value.targetBranch} onChange={(e: any) => onChange({ targetBranch: e.target.value })} placeholder="main" className="font-mono text-xs" spellCheck={false} />}
        </Field>
        <Field label="Merge Request">
          {() => (
            <label className="flex h-8 items-center gap-2.5 text-sm text-foreground">
              <Toggle checked={value.mrDraft} onChange={(v) => onChange({ mrDraft: v })} label="默认创建草稿 MR" />
              默认创建草稿 MR
            </label>
          )}
        </Field>
      </div>
      <AdvancedTls checked={!!value.insecureTls} onChange={(v) => onChange({ insecureTls: v, connected: false })} test={test} />
      <TestBar onRun={onTest} state={test} />
      {onDemo && (
        <button type="button" onClick={onDemo} className="inline-flex items-center gap-1.5 rounded-sm text-sm text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">
          <Wand className="size-3.5" />填入演示数据并测试
        </button>
      )}
    </div>
  );
}

// ── Codex ────────────────────────────────────────────────

const SANDBOX: { value: SandboxMode; title: string; desc: string; tone?: "rec" | "danger" }[] = [
  { value: "read-only", title: "只读", desc: "只能阅读代码，不能修改文件或运行命令。适合先看看 Codex 的思路。" },
  { value: "workspace-write", title: "工作区可写 · 需审批", desc: "可以修改仓库内的文件；联网、装依赖等越界操作会先问你。", tone: "rec" },
  { value: "workspace-auto", title: "工作区可写 · 自动执行", desc: "在仓库内自动执行命令，不再逐条询问。仍然禁止联网。" },
  { value: "full-access", title: "完全访问", desc: "不受沙盒限制，可联网和修改仓库之外的文件。只建议在隔离环境使用。", tone: "danger" },
];

export function CodexForm({ value, onChange, test, onTest, onDemo }: { value: CodexConfig; onChange: (p: Partial<CodexConfig>) => void; test: ReturnType<typeof useConnTest>["state"]; onTest: () => void; onDemo?: () => void }) {
  const platform = useApp((s) => s.platform);
  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-muted px-3 py-2.5 text-sm leading-5 text-muted-foreground">
        ZenCode 直接使用本机已安装并登录的 Codex，不需要在这里再填账号或密钥。点下方「检测本机 Codex」确认环境可用即可。
      </p>
      <Field
        label="自定义命令行路径（可选）"
        hint="留空时从系统 PATH 查找。只有 Codex 装在非常规位置时才需要填写。"
        right={
          value.cliPath ? (
            <button type="button" onClick={() => onChange({ cliPath: "", connected: false })} className="rounded-sm text-xs font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">
              清空，使用 PATH
            </button>
          ) : undefined
        }
      >
        {({ id }) => <Input id={id} value={value.cliPath} onChange={(e: any) => onChange({ cliPath: e.target.value, connected: false })} placeholder={platform === "mac" ? "/usr/local/bin/codex" : "C:\\Users\\you\\AppData\\Roaming\\npm\\codex.cmd"} className="font-mono text-xs" spellCheck={false} />}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="模型">
          {({ id }) => (
            <Select
              id={id}
              value={value.model}
              onChange={(v: any) => onChange({ model: v })}
              options={[
                { value: "Codex · 标准", label: "Codex · 标准", hint: "速度与质量均衡" },
                { value: "Codex · 高推理", label: "Codex · 高推理", hint: "复杂问题，更慢更贵" },
                { value: "Codex · 快速", label: "Codex · 快速", hint: "简单修改，更快" },
              ]}
            />
          )}
        </Field>
        <Field label="同时执行的任务数" hint="超过上限的任务会排队。">
          {() => (
            <div className="inline-flex h-8 items-center gap-1 self-start rounded-md border border-border-strong bg-card p-0.5">
              <Button variant="ghost" size="icon-xs" aria-label="减少" disabled={value.concurrency <= 1} onClick={() => onChange({ concurrency: value.concurrency - 1 })}><Minus /></Button>
              <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">{value.concurrency}</span>
              <Button variant="ghost" size="icon-xs" aria-label="增加" disabled={value.concurrency >= 5} onClick={() => onChange({ concurrency: value.concurrency + 1 })}><Plus /></Button>
            </div>
          )}
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-foreground">沙盒与审批</legend>
        <div role="radiogroup" aria-label="沙盒与审批" className="grid gap-2">
          {SANDBOX.map((o) => {
            const on = value.sandbox === o.value;
            return (
              <button
                key={o.value}
                role="radio"
                aria-checked={on}
                type="button"
                onClick={() => onChange({ sandbox: o.value })}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
                  on ? (o.tone === "danger" ? "border-danger/50 bg-danger/6" : "border-accent/50 bg-accent/6") : "border-border bg-card hover:border-border-strong",
                )}
              >
                <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border", on ? (o.tone === "danger" ? "border-danger" : "border-accent") : "border-border-strong")}>
                  {on && <span className={cn("size-2 rounded-full", o.tone === "danger" ? "bg-danger" : "bg-accent")} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {o.title}
                    {o.tone === "rec" && <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-1.5 text-xs font-medium text-success"><ShieldCheck className="size-3" />推荐</span>}
                    {o.tone === "danger" && <span className="inline-flex items-center gap-1 rounded-full bg-danger/12 px-1.5 text-xs font-medium text-danger"><ShieldAlert className="size-3" />风险</span>}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{o.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <TestBar onRun={onTest} state={test} label="检测本机 Codex" />
      {onDemo && (
        <button type="button" onClick={onDemo} className="inline-flex items-center gap-1.5 rounded-sm text-sm text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">
          <Wand className="size-3.5" />使用演示配置并检测
        </button>
      )}
    </div>
  );
}
