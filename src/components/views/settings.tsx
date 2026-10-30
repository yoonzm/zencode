import { DEFAULT_PROMPT, REPORT_NAME, WEEKDAYS, buildReport, reportCard, sendReport, setReport, type ReportKind } from "@/store/report";
import { FEISHU_HOOK, buildCard } from "@/store/push";
import { checkUpdate, downloadUpdate, requestInstall, changeChannel } from "@/store/update";
import { flushPrefs } from "@/store/state";
import { desktopCall } from "@/lib/desktop";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { FileText, Bell, Check, Cpu, FolderGit, GitBranch, Info, Keyboard, Palette, Plug, Rocket, RotateCcw, Sliders, Trash, ListChecks, ChevronLeft, Moon, Sun, Monitor } from "@/lib/icons";
import type { AppConfig } from "@/data/types";
import { store, useApp, type Notify, type ThemePref } from "@/store/state";
import { applyClear, cleanDoneRuns, cleanable, describeClear, askConfirm, sync, setTheme } from "@/store/actions";
import { toast } from "@/store/toast";
import { navigate, useRoute } from "@/lib/route";
import { useMedia } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Select, Checkbox, Input, Segmented, Toggle } from "@/components/ui/fields";
import { Modal } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { CodexForm, GitlabForm, ZentaoForm } from "@/components/forms/config-forms";
import { useConnTest } from "@/components/forms/conn-test";
import { RepoMappingEditor, mappingsValid } from "@/components/forms/repo-mapping";
import { GROUPS } from "@/components/views/overlays";
import { Logo } from "@/components/logo";

const SECTIONS = [
  { id: "general", label: "通用", icon: Palette },
  { id: "zentao", label: "禅道", icon: ListChecks },
  { id: "gitlab", label: "GitLab", icon: GitBranch },
  { id: "codex", label: "Codex", icon: Cpu },
  { id: "repos", label: "仓库映射", icon: FolderGit },
  { id: "notifications", label: "通知", icon: Bell },
  { id: "reports", label: "日报周报", icon: FileText },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "advanced", label: "高级", icon: Sliders },
  { id: "about", label: "关于", icon: Info },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

function Row({ title, desc, children }: { title: string; desc?: string; children: any }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {desc && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Group({ children }: { children: any }) {
  return <div className="divide-y divide-border rounded-xl border border-border bg-card px-4">{children}</div>;
}

function SaveBar({ dirty, valid = true, onSave, onRevert }: { dirty: boolean; valid?: boolean; onSave: () => void; onRevert: () => void }) {
  return (
    <div className="sticky bottom-0 -mx-1 mt-6 flex items-center gap-2 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
      <span className="text-xs text-muted-foreground" aria-live="polite">{dirty ? "有未保存的修改" : "已是最新"}</span>
      <Button variant="ghost" className="ml-auto" disabled={!dirty} onClick={onRevert}>还原</Button>
      <Button variant="primary" disabled={!dirty || !valid} onClick={onSave}>保存</Button>
    </div>
  );
}

// ── 通用 ──────────────────────────────────────────────────
// Explicit cross-axis sizing overrides older WebView button defaults (align-items: flex-start).
function ThemeCard({ id, label, icon: Icon, active }: { id: ThemePref; label: string; icon: any; active: boolean }) {
  const scope = id === "dark" ? "theme-dark" : "theme-light";
  return (
    <button
      onClick={() => setTheme(id)}
      aria-pressed={active}
      className={cn("group flex min-w-0 flex-col items-stretch gap-2 rounded-xl border p-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60", active ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong")}
    >
      {id === "system" ? (
        <div className="relative h-16 w-full overflow-hidden rounded-md border border-border">
          <div className="theme-light absolute inset-y-0 left-0 w-1/2 bg-background"><Preview /></div>
          <div className="theme-dark absolute inset-y-0 right-0 w-1/2 bg-background"><Preview right /></div>
        </div>
      ) : (
        <div className={cn(scope, "h-16 w-full overflow-hidden rounded-md border border-border bg-background")}><Preview /></div>
      )}
      <span className="flex w-full items-center gap-1.5 px-0.5 text-sm font-medium text-foreground">
        <Icon className="size-3.5 text-muted-foreground" />
        {label}
        {active && <Check className="ml-auto size-3.5 text-accent" />}
      </span>
    </button>
  );
}
function Preview({ right }: { right?: boolean }) {
  return (
    <div className="flex h-full" aria-hidden>
      {!right && <div className="w-1/4 bg-surface" />}
      <div className="flex-1 space-y-1.5 p-2">
        <div className="h-1.5 w-3/4 rounded-full bg-foreground/70" />
        <div className="h-1.5 w-1/2 rounded-full bg-muted-foreground/50" />
        <div className="h-1.5 w-2/3 rounded-full bg-accent/70" />
      </div>
    </div>
  );
}

function General() {
  const theme = useApp((s) => s.theme);
  const density = useApp((s) => s.density);
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-medium text-foreground">外观</h3>
        <div className="grid grid-cols-3 gap-3">
          <ThemeCard id="light" label="浅色" icon={Sun} active={theme === "light"} />
          <ThemeCard id="dark" label="深色" icon={Moon} active={theme === "dark"} />
          <ThemeCard id="system" label="跟随系统" icon={Monitor} active={theme === "system"} />
        </div>
      </section>
      <Group>
        <Row title="列表密度" desc="紧凑模式一屏能看到更多任务。">
          <Segmented label="列表密度" value={density} onChange={(v) => store.set({ density: v })} options={[{ value: "compact", label: "紧凑" }, { value: "comfortable", label: "舒适" }]} />
        </Row>
      </Group>
    </div>
  );
}

// ── 连接配置（禅道 / GitLab / Codex） ─────────────────────
function useDraft<K extends "zentao" | "gitlab" | "codex">(key: K) {
  const saved = useApp((s) => s.config[key]);
  const [draft, setDraft] = useState(saved);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  return {
    draft,
    dirty,
    patch: (p: Partial<AppConfig[K]>) => setDraft((d) => ({ ...d, ...p })),
    set: setDraft,
    revert: () => setDraft(saved),
    save: async () => {
      store.set((s) => ({ config: { ...s.config, [key]: draft } }));
      try { await flushPrefs(); toast({ title: "设置已保存", desc: "保存在本机；凭据由操作系统加密" }); } catch { /* 保存错误由全局处理 */ }
    },
  };
}

function ZentaoSection() {
  const d = useDraft("zentao");
  const t = useConnTest("zentao");
  const run = async (cfg = d.draft) => { const ok = await t.run(cfg); d.patch({ connected: ok }); };
  return (
    <>
      <ZentaoForm value={d.draft} onChange={(p) => { d.patch(p); t.reset(); }} test={t.state} onTest={() => run()} />
      <SaveBar dirty={d.dirty} onSave={d.save} onRevert={() => { d.revert(); t.reset(); }} />
    </>
  );
}
function GitlabSection() {
  const d = useDraft("gitlab");
  const t = useConnTest("gitlab");
  const run = async (cfg = d.draft) => { const ok = await t.run(cfg); d.patch({ connected: ok }); };
  return (
    <>
      <GitlabForm value={d.draft} onChange={(p) => { d.patch(p); t.reset(); }} test={t.state} onTest={() => run()} />
      <SaveBar dirty={d.dirty} onSave={d.save} onRevert={() => { d.revert(); t.reset(); }} />
    </>
  );
}
function CodexSection() {
  const d = useDraft("codex");
  const t = useConnTest("codex");
  const run = async (cfg = d.draft) => { const ok = await t.run(cfg); d.patch({ connected: ok }); };
  return (
    <>
      <CodexForm value={d.draft} onChange={(p) => { d.patch(p); if (!("sandbox" in p || "model" in p || "concurrency" in p)) t.reset(); }} test={t.state} onTest={() => run()} />
      <SaveBar dirty={d.dirty} onSave={d.save} onRevert={() => { d.revert(); t.reset(); }} />
    </>
  );
}

function ReposSection() {
  const saved = useApp((s) => s.config.mappings);
  const [draft, setDraft] = useState(saved);
  const [showErrors, setShowErrors] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const valid = mappingsValid(draft);
  return (
    <>
      <RepoMappingEditor value={draft} onChange={setDraft} showErrors={showErrors} />
      <SaveBar
        dirty={dirty}
        onRevert={() => { setDraft(saved); setShowErrors(false); }}
        onSave={async () => {
          if (!valid) { setShowErrors(true); toast({ title: "有映射没有填写完整", desc: "请补全红色标出的字段后再保存。", tone: "warn" }); return; }
          store.set((s) => ({ config: { ...s.config, mappings: draft } }));
          try { await flushPrefs(); toast({ title: "仓库映射已保存" }); } catch { /* 保存错误由全局处理 */ }
        }}
      />
    </>
  );
}

const PREVIEW_TASK = { id: "demo", kind: "bug", no: 3182, title: "登录成功后未跳转到原访问页面", product: "企业管理后台" } as const;
const PREVIEW_RUN = { files: [{}, {}, {}, {}, {}], branch: "zencode/bug-3182", startedAt: Date.now() - 6 * 60000, finishedAt: Date.now(), verify: { state: "failed", summary: "登录后仍停留在首页，期望回到 /orders" } } as any;

const TONE_BAR: Record<string, string> = { danger: "bg-danger", warn: "bg-warning", success: "bg-success", info: "bg-accent" };

function FeishuPreview() {
  const [kind, setKind] = useState<"attention" | "result">("attention");
  const card = kind === "attention" ? buildCard("verify-failed", PREVIEW_TASK as any, PREVIEW_RUN) : buildCard("done", PREVIEW_TASK as any, { ...PREVIEW_RUN, verify: { state: "passed" } });
  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">群里收到的消息</span>
        <Segmented size="sm" label="消息类型" value={kind} onChange={setKind} options={[{ value: "attention", label: "需要你介入" }, { value: "result", label: "有结果" }]} />
      </div>
      <div className="max-w-sm overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <div className={cn("px-3.5 py-2 text-sm font-semibold text-white", TONE_BAR[card.tone])}>{card.title}</div>
        <dl className="space-y-1.5 px-3.5 py-3 text-[13px] leading-5">
          {card.lines.map(([k, v]) => (
            <div key={k} className="flex gap-3">
              <dt className="w-9 shrink-0 text-muted-foreground">{k}</dt>
              <dd className="min-w-0 flex-1 break-words text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-border px-3.5 py-2.5">
          <span className="inline-flex h-7 items-center rounded-md border border-border-strong px-3 text-xs font-medium text-foreground">回到 ZenCode 查看任务</span>
        </div>
      </div>
      {kind === "attention" && <p className="mt-2 text-xs text-subtle-foreground">消息里不带需求描述和代码。收到提醒后，回到 ZenCode 按任务编号查看。</p>}
    </div>
  );
}

function FeishuSection() {
  const f = useApp((s) => s.feishu);
  const set = (p: Partial<typeof f>) => store.set((s) => ({ feishu: { ...s.feishu, ...p } }));
  const hookOk = FEISHU_HOOK.test(f.webhook.trim());
  const bad = !!f.webhook.trim() && !hookOk;
  const [sending, setSending] = useState(false);
  const test = async () => {
    setSending(true);
    try {
      await desktopCall("feishuTest", { ...f, webhook: f.webhook.trim() });
      toast({ tone: "success", title: "测试消息已发送", desc: "去飞书群里看一下有没有收到。", duration: 3200 });
    } catch (e) {
      toast({ tone: "danger", title: "飞书测试发送失败", desc: String(e), duration: 6000 });
    } finally { setSending(false); }
  };
  return (
    <section className="mt-8">
      <h3 className="mb-1 text-sm font-medium text-foreground">飞书</h3>
      <p className="mb-3 text-xs leading-5 text-muted-foreground">人不在电脑旁时，任务的结果和需要你处理的事会推送到飞书群。建议建一个只有自己的群。</p>
      <Group>
        <Row title="推送到飞书" desc="先在群里添加「自定义机器人」，把它的 Webhook 地址粘贴到下面。">
          <Toggle label="推送到飞书" checked={f.enabled} onChange={(v) => set({ enabled: v })} />
        </Row>
        {f.enabled && (
          <>
            <div className="space-y-3 py-3.5">
              <label className="block text-xs font-medium text-muted-foreground">
                Webhook 地址
                <Input value={f.webhook} onChange={(e) => set({ webhook: e.target.value })} placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…" spellCheck={false} invalid={bad} className="mt-1.5 font-mono text-[13px]" />
                {bad && <span className="mt-1 block font-normal text-danger" role="alert">地址格式不对，请填写完整的飞书或 Lark 自定义机器人 Webhook 地址</span>}
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                签名密钥（机器人开启了签名校验时填写）
                <Input type="password" value={f.secret} onChange={(e) => set({ secret: e.target.value })} placeholder="可选" autoComplete="off" className="mt-1.5" />
              </label>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={!hookOk || sending} onClick={test}>{sending ? "发送中…" : "发送测试消息"}</Button>
                <span className="text-xs text-subtle-foreground">地址和密钥保存在系统凭据库</span>
              </div>
            </div>
            <Row title="需要你介入" desc="需要审批、等你确认测试计划、执行失败、验证未通过。每条单独发送到群。"><Toggle label="需要你介入" checked={f.attention} onChange={(v) => set({ attention: v })} /></Row>
            <Row title="有结果" desc="任务完成待审核、Merge Request 已创建。"><Toggle label="有结果" checked={f.result} onChange={(v) => set({ result: v })} /></Row>
          </>
        )}
      </Group>
      {f.enabled && <FeishuPreview />}
    </section>
  );
}

function Notifications() {
  const n = useApp((s) => s.notify);
  const set = (k: keyof Notify) => (v: boolean) => store.set((s) => ({ notify: { ...s.notify, [k]: v } }));
  return (
    <>
      <h3 className="mb-3 text-sm font-medium text-foreground">桌面</h3>
      <Group>
        <Row title="任务完成" desc="Codex 完成修改、等待你审核时提醒。"><Toggle label="任务完成通知" checked={n.done} onChange={set("done")} /></Row>
        <Row title="需要审批" desc="Codex 要执行工作区以外的命令时提醒。"><Toggle label="审批通知" checked={n.approval} onChange={set("approval")} /></Row>
        <Row title="任务失败" desc="测试没通过或 Codex 异常退出时提醒。"><Toggle label="失败通知" checked={n.failed} onChange={set("failed")} /></Row>
        <Row title="提示音"><Toggle label="提示音" checked={n.sound} onChange={set("sound")} /></Row>
      </Group>
      <FeishuSection />
    </>
  );
}

function CardView({ card }: { card: { tone: string; title: string; lines: [string, string][] } }) {
  return (
    <div className="max-w-sm overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <div className={cn("px-3.5 py-2 text-sm font-semibold text-white", TONE_BAR[card.tone])}>{card.title}</div>
        <dl className="space-y-1.5 px-3.5 py-3 text-[13px] leading-5">
          {card.lines.map(([k, v]) => (
            <div key={k} className="flex gap-3">
              <dt className="w-9 shrink-0 text-muted-foreground">{k}</dt>
              <dd className="min-w-0 flex-1 break-words text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-border px-3.5 py-2.5">
          <span className="inline-flex h-7 items-center rounded-md border border-border-strong px-3 text-xs font-medium text-foreground">在 ZenCode 打开</span>
        </div>
      </div>
  );
}

function ReportBlock({ kind }: { kind: ReportKind }) {
  const c = useApp((s) => s.reports[kind]);
  const feishu = useApp((s) => s.feishu);
  const ready = feishu.enabled && FEISHU_HOOK.test(feishu.webhook.trim());
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof buildReport>> | null>(null);
  const [busy, setBusy] = useState(false);
  const when = kind === "daily" ? `工作日 ${c.time}` : `${WEEKDAYS[c.weekday - 1]} ${c.time}`;
  return (
    <section>
      <Group>
        <Row title={REPORT_NAME[kind]} desc={kind === "daily" ? `${when} 发送，汇总今天的进展。` : `${when} 发送，汇总本周的进展。`}>
          <Toggle label={`${REPORT_NAME[kind]}`} checked={c.enabled} onChange={(v) => setReport(kind, { enabled: v })} />
        </Row>
        <div className="space-y-3 py-3.5">
          <div className="flex flex-wrap items-end gap-3">
            {kind === "weekly" && (
              <label className="w-28 text-xs font-medium text-muted-foreground">
                星期
                <div className="mt-1.5"><Select value={String(c.weekday)} onChange={(v) => setReport(kind, { weekday: Number(v) })} options={WEEKDAYS.map((w, i) => ({ value: String(i + 1), label: w }))} /></div>
              </label>
            )}
            <label className="w-28 text-xs font-medium text-muted-foreground">
              时间
              <Input type="time" value={c.time} onChange={(e) => e.target.value && setReport(kind, { time: e.target.value })} className="mt-1.5" />
            </label>
          </div>
          <label className="block text-xs font-medium text-muted-foreground">
            <span className="flex items-center justify-between">
              提示词
              {c.prompt !== DEFAULT_PROMPT[kind] && (
                <button type="button" onClick={() => setReport(kind, { prompt: DEFAULT_PROMPT[kind] })} className="rounded-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">恢复默认</button>
              )}
            </span>
            <textarea value={c.prompt} onChange={(e) => setReport(kind, { prompt: e.target.value })} rows={3} spellCheck={false} className="mt-1.5 block w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-sm font-normal leading-[1.6] text-foreground outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-ring/60" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { setPreview(await buildReport(kind)); } catch (e) { toast({ tone: "danger", title: "预览失败", desc: String(e) }); } finally { setBusy(false); } }}>预览</Button>
            <Button variant="ghost" size="sm" disabled={!ready || busy} onClick={async () => { setBusy(true); try { await sendReport(kind, { manual: true }); } finally { setBusy(false); } }}>立即发送</Button>
            {!ready && <span className="text-xs text-subtle-foreground">发送需要先配置飞书</span>}
          </div>
        </div>
      </Group>
      {preview && (
        <div className="mt-3 rounded-xl border border-border bg-muted/40 p-4">
          <div className="mb-3 text-xs font-medium text-muted-foreground">群里会收到</div>
          {preview.items.length ? <CardView card={reportCard(kind, preview)} /> : <p className="text-sm text-muted-foreground">这段时间还没有进展，到点时不会发送。</p>}
        </div>
      )}
    </section>
  );
}

function Reports() {
  const log = useApp((s) => s.reports.log);
  const feishu = useApp((s) => s.feishu);
  const ready = feishu.enabled && FEISHU_HOOK.test(feishu.webhook.trim());
  return (
    <div className="space-y-8">
      <p className="text-sm leading-6 text-muted-foreground">按任务进展自动写日报和周报，发到飞书群。电脑到点没开机，错过不超过 4 小时的会补发。这段时间没有进展就不发。</p>
      {!ready && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/8 px-3.5 py-2.5 text-sm text-foreground">
          还没有配置飞书，到点不会发送。
          <button type="button" onClick={() => navigate({ name: "prefs", section: "notifications" } as any)} className="rounded-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">去配置</button>
        </div>
      )}
      <ReportBlock kind="daily" />
      <ReportBlock kind="weekly" />
      {log.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium text-foreground">最近发送</h3>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card px-4">
            {log.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="w-9 shrink-0 font-medium text-foreground">{REPORT_NAME[l.kind]}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{l.result === "sent" ? `${l.items.length} 条 · ${l.stats}` : "没有进展，已跳过"}</span>
                <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">{new Date(l.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}{l.manual ? " · 手动" : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Shortcuts() {
  return (
    <div className="space-y-6">
      {GROUPS.map((g) => (
        <section key={g.title}>
          <h3 className="mb-2 text-sm font-medium text-foreground">{g.title}</h3>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card px-4">
            {g.rows.map(([label, keys]) => (
              <li key={label} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-foreground">{label}</span>
                <Kbd keys={keys} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

type ClearScope = "done" | "products" | "all";

/** 清除任务数据：先选范围，再确认。只动本地数据，禅道里的任务不受影响。 */
function ClearDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tasks = useApp((s) => s.tasks);
  const [scope, setScope] = useState<ClearScope>("done");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => { if (open) { setScope("done"); setPicked([]); } }, [open]);

  const products = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) m.set(t.product, (m.get(t.product) ?? 0) + 1);
    return [...m.entries()];
  }, [tasks]);
  const doneCount = tasks.filter(cleanable).length;
  const target: string[] | "all" = scope === "all" ? "all" : picked;
  const info = scope === "done" ? null : describeClear(target);
  const n = info?.count ?? 0;

  const OPTS: { id: ClearScope; title: string; desc: string; disabled?: boolean }[] = [
    { id: "done", title: "已提交任务的执行数据", desc: doneCount ? `${doneCount} 个任务。清理执行记录、改动和工作目录，保留任务和 MR 链接。` : "没有可清理的数据。", disabled: !doneCount },
    { id: "products", title: "指定产品的任务", desc: "清除所选产品下的全部本地任务，包括执行记录和分支信息。" },
    { id: "all", title: "全部本地任务", desc: `${tasks.length} 个任务。影响最大，请谨慎。`, disabled: !tasks.length },
  ];
  const canConfirm = scope === "done" ? doneCount > 0 : n > 0;

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      title="清除任务数据"
      description="选择清除范围。只影响本机数据，禅道里的任务不受影响。"
      className="sm:max-w-lg"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
          <Button
            variant={scope === "done" ? "primary" : "danger"}
            disabled={!canConfirm || busy}
            onClick={async () => { setBusy(true); try { if (await (scope === "done" ? cleanDoneRuns() : applyClear(target))) onClose(); } finally { setBusy(false); } }}
          >
            {scope === "done" ? "清理执行数据" : n ? `清除 ${n} 个任务` : "清除"}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="清除范围" className="space-y-2">
        {OPTS.map((o) => {
          const on = scope === o.id;
          return (
            <div key={o.id} className={cn("rounded-lg border transition-colors", on ? "border-accent bg-accent/5" : "border-border", o.disabled && "opacity-50")}>
              <button type="button" role="radio" aria-checked={on} disabled={o.disabled} onClick={() => setScope(o.id)} className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                <span className={cn("mt-1 grid size-4 shrink-0 place-items-center rounded-full border", on ? "border-accent" : "border-border-strong")}>{on && <span className="size-2 rounded-full bg-accent" />}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{o.title}</span>
                  <span className="block text-xs leading-5 text-muted-foreground">{o.desc}</span>
                </span>
              </button>
              {on && o.id === "products" && (
                <div className="space-y-1.5 border-t border-border px-3 py-2.5 pl-9">
                  {products.map(([p, c]) => (
                    <Checkbox key={p} checked={picked.includes(p)} onChange={(v) => setPicked((x) => (v ? [...x, p] : x.filter((y) => y !== p)))} label={<span>{p}<span className="ml-1.5 text-xs text-muted-foreground">{c} 个任务</span></span>} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {info && info.count > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 rounded-lg bg-muted/60 py-2.5 pl-7 pr-3 text-xs leading-5 text-muted-foreground">
          <li>将清除 {info.count} 个任务及其执行记录、改动和分支信息。</li>
          {info.notes.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
    </Modal>
  );
}

/** 任务数据：自动清理保留天数（7/30/60/90，不可关闭）+ 一个“清除”入口。 */
function TaskData() {
  const days = useApp((s) => s.cleanupDays);
  const [open, setOpen] = useState(false);
  return (
    <section>
      <h3 className="mb-1 text-sm font-medium text-foreground">任务数据</h3>
      <p className="mb-2 text-xs leading-5 text-muted-foreground">只影响本机数据，禅道里的任务不受影响。</p>
      <Group>
        <Row title="自动清理" desc={`超过 ${days} 天没有活动的任务，会从本地清除（含执行记录和工作目录）。`}>
          <Segmented label="保留天数" value={String(days)} onChange={(v) => store.set({ cleanupDays: Number(v) })} options={[7, 30, 60, 90].map((n) => ({ value: String(n), label: `${n} 天` }))} />
        </Row>
        <Row title="清除任务数据" desc="按范围手动清除。">
          <Button variant="danger-ghost" onClick={() => setOpen(true)}><Trash />清除</Button>
        </Row>
      </Group>
      <ClearDialog open={open} onClose={() => setOpen(false)} />
    </section>
  );
}

function Advanced() {
  return (
    <div className="space-y-6">
      <TaskData />
      <section>
        <h3 className="mb-2 text-sm font-medium text-foreground">账号与配置</h3>
        <Group>
          <Row title="重新同步数据" desc="重新从禅道读取任务，保留本地执行记录。"><Button onClick={() => void sync()}><RotateCcw />同步</Button></Row>
          <Row title="重新运行配置向导" desc="从头走一遍首次配置流程。"><Button onClick={() => navigate({ name: "setup" })}><Rocket />打开向导</Button></Row>
          <Row title="清除本地设置" desc="删除本机配置与钥匙串凭据，保留任务工作区。">
            <Button
              variant="danger-ghost"
              onClick={() =>
                askConfirm({
                  title: "清除本地设置？",
                  desc: "主题、连接配置和仓库映射都会被删除，页面会重新加载。",
                  confirmLabel: "清除并重新加载",
                  danger: true,
                  onConfirm: () => {
                    void flushPrefs().catch(() => {}).then(() => desktopCall("clearPrefs")).then(() => { location.hash = "#setup"; location.reload(); }).catch(e => toast({ title: "清除失败", desc: String(e), tone: "danger" }));
                  },
                })
              }
            >
              <Trash />清除
            </Button>
          </Row>
        </Group>
      </section>
    </div>
  );
}

function About() {
  const version = useApp((s) => s.appVersion);
  const u = useApp((s) => s.update);
  const auto = useApp((s) => s.autoUpdate);
  const channel = useApp((s) => s.channel);
  const busy = ["checking", "downloading", "installing"].includes(u.status);
  return (
    <div className="flex flex-col items-start gap-5">
      <Logo size={36} className="text-foreground" />
      <div>
        <p className="text-lg font-semibold text-foreground">ZenCode</p>
        <p className="text-sm text-muted-foreground">版本 {version || "读取中…"} · 桌面应用</p>
      </div>
      <div className="w-full">
        <Group>
          <Row
            title="检查更新"
            desc={
              u.status === "checking" ? "正在检查…"
              : u.status === "available" ? `发现新版本 ${u.version}`
              : u.status === "downloading" ? `正在下载 ${u.version}${u.progress == null ? "…" : `（${u.progress}%）`}`
              : u.status === "ready" ? `${u.version} 已下载，重新启动后生效`
              : u.status === "installing" ? "正在保存任务并安装更新…"
              : u.status === "error" ? (u.error || "检查失败，请重试")
              : u.status === "latest" ? `当前通道暂无可用更新${u.checkedAt ? ` · ${new Date(u.checkedAt).toLocaleString()}` : ""}`
              : "还没有检查过"
            }
          >
            {u.status === "available" ? (
              <Button onClick={() => downloadUpdate()}>下载更新</Button>
            ) : u.status === "ready" ? (
              <Button onClick={requestInstall}>重新启动并更新</Button>
            ) : (
              <Button variant="secondary" loading={busy} disabled={busy} onClick={() => checkUpdate(true)}>检查更新</Button>
            )}
          </Row>
          {(u.status === "available" || u.status === "ready" || u.status === "downloading") && u.notes && (
            <div className="py-3.5">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{u.version} 更新内容</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">{u.notes}</p>
            </div>
          )}
          <Row title="自动检查更新" desc="启动时和每隔几小时在后台检查一次，有新版本时在侧栏提示。">
            <Toggle checked={auto} onChange={(v) => store.set({ autoUpdate: v })} label="自动检查更新" />
          </Row>
          <Row title="更新通道" desc={channel === "beta" ? "预览版能更早用到新功能，但可能不稳定。" : "只接收正式版本更新，不自动降级。"}>
            <fieldset disabled={busy || u.status === "ready"}><Segmented label="更新通道" value={channel} onChange={(v) => { void changeChannel(v); }} options={[{ value: "stable", label: "稳定版" }, { value: "beta", label: "预览版" }]} /></fieldset>
          </Row>
        </Group>
      </div>
      {u.error && u.status !== "error" && <p role="alert" className="text-sm text-danger">{u.error}</p>}
      <p className="max-w-md text-sm leading-6 text-muted-foreground">
        ZenCode 通过本机 Codex CLI 处理禅道任务，并在审核后推送 GitLab MR。更新包来自 GitHub Releases，安装前会校验签名。
      </p>
      <Plug className="hidden" />
    </div>
  );
}

const TITLE: Record<SectionId, string> = Object.fromEntries(SECTIONS.map((s) => [s.id, s.label])) as any;
const BODY: Record<SectionId, () => any> = {
  general: General, zentao: ZentaoSection, gitlab: GitlabSection, codex: CodexSection, repos: ReposSection,
  notifications: Notifications, reports: Reports, shortcuts: Shortcuts, advanced: Advanced, about: About,
};

export function Settings() {
  const route = useRoute();
  const wide = useMedia("(min-width: 760px)");
  const raw = route.name === "prefs" ? route.section : "general";
  const known = SECTIONS.some((s) => s.id === raw);
  const id = (known ? raw : "general") as SectionId;
  // 窄屏：#prefs 先显示列表；选择后进入子页
  const showMenu = wide || location.hash === "#prefs";
  const Body = BODY[id];
  const go = (s: SectionId) => { location.hash = wide && s === "general" ? "#prefs" : `#prefs-${s}`; };

  const nav = (
    <nav aria-label="设置分类" className={cn("shrink-0 space-y-0.5 p-3", wide ? "w-56 border-r border-border" : "w-full")}>
      {wide && <button onClick={() => navigate({ name: "tasks" })} className="mb-2 flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><ChevronLeft className="size-4" />返回任务</button>}
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          onClick={() => go(s.id)}
          aria-current={wide && s.id === id ? "page" : undefined}
          className={cn("flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60", wide && s.id === id ? "bg-active font-medium text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground")}
        >
          <s.icon className="size-4" />
          {s.label}
        </button>
      ))}
    </nav>
  );

  if (!wide && showMenu) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="flex items-center gap-1 px-3 pt-3">
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: "tasks" })}><ChevronLeft />任务</Button>
        </div>
        <h1 className="px-5 pb-1 pt-2 text-xl font-semibold text-foreground">设置</h1>
        {nav}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {wide && nav}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div key={id} className="anim-fade mx-auto flex min-h-full max-w-2xl flex-col px-5 py-6 md:px-8 md:py-8">
          {!wide && <Button variant="ghost" size="sm" className="-ml-2 mb-2 self-start" onClick={() => { location.hash = "#prefs"; }}><ChevronLeft />设置</Button>}
          <h1 className="mb-5 text-xl font-semibold text-foreground">{TITLE[id]}</h1>
          <div className="flex-1"><Body /></div>
        </div>
      </div>
    </div>
  );
}
