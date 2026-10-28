import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Bell, Check, Cpu, FolderGit, GitBranch, Info, Keyboard, Palette, Plug, Rocket, RotateCcw, Sliders, Trash, ListChecks, ChevronLeft, Moon, Sun, Monitor } from "@/lib/icons";
import type { AppConfig } from "@/data/types";
import { store, useApp, type ListStatus, type Notify, type ThemePref } from "@/store/state";
import { askConfirm, resetDemo, setListStatus, setPlatformPref, setTheme } from "@/store/actions";
import { toast } from "@/store/toast";
import { navigate, useRoute } from "@/lib/route";
import { useMedia } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Segmented, Toggle } from "@/components/ui/fields";
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
function ThemeCard({ id, label, icon: Icon, active }: { id: ThemePref; label: string; icon: any; active: boolean }) {
  const scope = id === "dark" ? "theme-dark" : "theme-light";
  return (
    <button
      onClick={() => setTheme(id)}
      aria-pressed={active}
      className={cn("group flex flex-col gap-2 rounded-xl border p-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60", active ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong")}
    >
      {id === "system" ? (
        <div className="relative h-16 overflow-hidden rounded-md border border-border">
          <div className="theme-light absolute inset-y-0 left-0 w-1/2 bg-background"><Preview /></div>
          <div className="theme-dark absolute inset-y-0 right-0 w-1/2 bg-background"><Preview right /></div>
        </div>
      ) : (
        <div className={cn(scope, "h-16 overflow-hidden rounded-md border border-border bg-background")}><Preview /></div>
      )}
      <span className="flex items-center gap-1.5 px-0.5 text-sm font-medium text-foreground">
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
  const platformPref = useApp((s) => s.platformPref);
  const density = useApp((s) => s.density);
  const windowControls = useApp((s) => s.windowControls);
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
        <Row title="窗口风格" desc="自动时按当前系统选择。桌面应用里会使用系统原生窗口控件。">
          <Segmented label="窗口风格" value={platformPref} onChange={setPlatformPref} options={[{ value: "auto", label: "自动" }, { value: "mac", label: "macOS" }, { value: "win", label: "Windows" }]} />
        </Row>
        <Row title="显示窗口控件" desc="在标题栏里绘制红黄绿或最小化/关闭按钮。">
          <Toggle label="显示窗口控件" checked={windowControls} onChange={(v) => store.set({ windowControls: v })} />
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
    save: () => {
      store.set((s) => ({ config: { ...s.config, [key]: draft } }));
      toast({ title: "设置已保存", desc: "仅保存在本机浏览器 · 演示", sim: true });
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
        onSave={() => {
          if (!valid) { setShowErrors(true); toast({ title: "有映射没有填写完整", desc: "请补全红色标出的字段后再保存。", tone: "warn" }); return; }
          store.set((s) => ({ config: { ...s.config, mappings: draft } }));
          toast({ title: "仓库映射已保存", sim: true });
        }}
      />
    </>
  );
}

function Notifications() {
  const n = useApp((s) => s.notify);
  const set = (k: keyof Notify) => (v: boolean) => store.set((s) => ({ notify: { ...s.notify, [k]: v } }));
  return (
    <Group>
      <Row title="任务完成" desc="Codex 完成修改、等待你审核时提醒。"><Toggle label="任务完成通知" checked={n.done} onChange={set("done")} /></Row>
      <Row title="需要审批" desc="Codex 要执行工作区以外的命令时提醒。"><Toggle label="审批通知" checked={n.approval} onChange={set("approval")} /></Row>
      <Row title="任务失败" desc="测试没通过或 Codex 异常退出时提醒。"><Toggle label="失败通知" checked={n.failed} onChange={set("failed")} /></Row>
      <Row title="提示音"><Toggle label="提示音" checked={n.sound} onChange={set("sound")} /></Row>
    </Group>
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

function Advanced() {
  const status = useApp((s) => s.listStatus);
  const opts: { value: ListStatus; label: string }[] = [
    { value: "ready", label: "正常" }, { value: "loading", label: "加载中" }, { value: "empty", label: "为空" }, { value: "error", label: "出错" },
  ];
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-1 text-sm font-medium text-foreground">状态模拟</h3>
        <p className="mb-2 text-xs leading-5 text-muted-foreground">切换任务列表的显示状态，方便查看加载、空和错误界面。</p>
        <Group>
          <Row title="任务列表状态"><Segmented label="任务列表状态" value={status} onChange={(v) => { setListStatus(v); navigate({ name: "tasks" }); }} options={opts} /></Row>
        </Group>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-medium text-foreground">数据</h3>
        <Group>
          <Row title="重置演示数据" desc="任务和执行记录恢复到初始状态。"><Button onClick={resetDemo}><RotateCcw />重置</Button></Row>
          <Row title="重新运行配置向导" desc="从头走一遍首次配置流程。"><Button onClick={() => navigate({ name: "setup" })}><Rocket />打开向导</Button></Row>
          <Row title="清除本地设置" desc="删除保存在浏览器里的主题、配置和偏好，并回到首次配置。">
            <Button
              variant="danger-ghost"
              onClick={() =>
                askConfirm({
                  title: "清除本地设置？",
                  desc: "主题、连接配置和仓库映射都会被删除，页面会重新加载。",
                  confirmLabel: "清除并重新加载",
                  danger: true,
                  onConfirm: () => {
                    try { localStorage.removeItem("zencode.prefs.v1"); } catch { /* 忽略 */ }
                    location.hash = "#setup";
                    location.reload();
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
  return (
    <div className="flex flex-col items-start gap-4">
      <Logo size={36} className="text-foreground" />
      <div>
        <p className="text-lg font-semibold text-foreground">ZenCode</p>
        <p className="text-sm text-muted-foreground">版本 0.1.0 · 界面原型</p>
      </div>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">
        这是 ZenCode 桌面应用的网页演示。所有任务、连接测试、Codex 执行和 Merge Request 都是本地模拟，没有任何网络请求发出。
      </p>
      <Plug className="hidden" />
    </div>
  );
}

const TITLE: Record<SectionId, string> = Object.fromEntries(SECTIONS.map((s) => [s.id, s.label])) as any;
const BODY: Record<SectionId, () => any> = {
  general: General, zentao: ZentaoSection, gitlab: GitlabSection, codex: CodexSection, repos: ReposSection,
  notifications: Notifications, shortcuts: Shortcuts, advanced: Advanced, about: About,
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
