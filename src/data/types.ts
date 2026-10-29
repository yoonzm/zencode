export type TaskKind = "bug" | "story";

/** Codex 执行状态（与禅道自身状态是两回事） */
export type RunState =
  | "idle" // 待处理，尚未交给 Codex
  | "queued" // 排队中
  | "running" // 执行中
  | "waiting" // 等待你审批
  | "paused" // 已暂停
  | "review" // Codex 已完成，等待你审核
  | "done" // 已提交 MR
  | "failed"; // 失败

export type Priority = 1 | 2 | 3 | 4; // 禅道：1 最高

export interface Person {
  id: string;
  name: string;
}

export interface DescBlock {
  type: "p" | "steps" | "list" | "kv";
  title?: string;
  items?: string[];
  text?: string;
  rows?: [string, string][];
}

export interface Attachment {
  id?: number;
  name: string;
  size: string;
}

export interface HistoryItem {
  at: number;
  who: string;
  text: string;
}

// ── 执行事件 ──────────────────────────────────────────────

export type EventBody =
  | { kind: "message"; text: string }
  | { kind: "plan"; title: string; steps: { text: string; done: boolean }[] }
  | { kind: "read"; paths: string[] }
  | { kind: "command"; cmd: string; output?: string; exit: number; ms: number }
  | { kind: "edit"; path: string; add: number; del: number; created?: boolean }
  | { kind: "test"; name: string; passed: number; failed: number; total: number; note?: string }
  | { kind: "approval"; cmd: string; reason: string; decision?: "once" | "always" | "deny" }
  | { kind: "user"; text: string; ref?: string }
  | { kind: "system"; text: string; tone?: "info" | "success" | "warn" }
  | { kind: "error"; text: string; detail?: string };

export type RunEvent = EventBody & { id: string; at: number };

// ── Diff ─────────────────────────────────────────────────

export interface DiffLine {
  t: " " | "+" | "-";
  text: string;
  o?: number; // 旧文件行号
  n?: number; // 新文件行号
}
export interface Hunk {
  header: string;
  lines: DiffLine[];
}
export interface DiffFile {
  path: string;
  status: "modified" | "added";
  add: number;
  del: number;
  hunks: Hunk[];
}

export interface Run {
  state: RunState;
  branch?: string;
  model: string;
  startedAt?: number;
  finishedAt?: number;
  events: RunEvent[];
  files: DiffFile[];
  activity?: string;
  mr?: { iid: number; url: string };
  mrBusy?: boolean;
  viewed: string[];
  unread?: boolean;
}

export interface ZTask {
  id: string; // bug-3182 / story-2041
  no: number;
  kind: TaskKind;
  title: string;
  priority: Priority;
  severity?: 1 | 2 | 3 | 4;
  ztStatus: string; // 禅道状态（只读，从禅道同步）：激活 / 已解决 / 评审中 …
  product: string;
  module: string;
  moduleKey: string;
  sprint: string;
  assignee: string;
  reporter: string;
  createdAt: number;
  updatedAt: number;
  deadline?: number;
  repoId: string;
  labels: string[];
  description: DescBlock[];
  attachments: Attachment[];
  history: HistoryItem[];
  run: Run;
}

// ── 配置 ─────────────────────────────────────────────────

export type SandboxMode = "read-only" | "workspace-write" | "workspace-auto" | "full-access";

export interface ZentaoConfig {
  baseUrl: string;
  edition: "open" | "biz" | "max";
  auth: "password" | "token";
  account: string;
  secret: string;
  scope: "mine" | "products";
  /** 自动同步间隔（分钟，最小 1）；0 表示只手动同步 */
  syncIntervalMin: number;
  /** 跳过 TLS 证书验证（仅对这个服务生效） */
  insecureTls?: boolean;
  connected: boolean;
}
export interface GitlabConfig {
  baseUrl: string;
  token: string;
  targetBranch: string;
  mrDraft: boolean;
  insecureTls?: boolean;
  connected: boolean;
}
export interface CodexConfig {
  /** 留空表示从 PATH 查找本机已安装的 codex */
  cliPath: string;
  version?: string;
  model: string;
  sandbox: SandboxMode;
  concurrency: number;
  connected: boolean;
}
export interface RepoMapping {
  id: string;
  product: string;
  repo: string; // GitLab: group/project
  branch: string;
  testCmd: string;
}
export interface AppConfig {
  zentao: ZentaoConfig;
  gitlab: GitlabConfig;
  codex: CodexConfig;
  mappings: RepoMapping[];
}

export const STATE_LABEL: Record<RunState, string> = {
  idle: "待处理",
  queued: "排队中",
  running: "执行中",
  waiting: "等待审批",
  paused: "已暂停",
  review: "待审核",
  done: "已提交",
  failed: "失败",
};

export const PRIORITY_LABEL: Record<Priority, string> = { 1: "紧急", 2: "高", 3: "中", 4: "低" };

export const SANDBOX_LABEL: Record<SandboxMode, string> = {
  "read-only": "只读",
  "workspace-write": "工作区可写 · 需审批",
  "workspace-auto": "工作区可写 · 自动执行",
  "full-access": "完全访问",
};
