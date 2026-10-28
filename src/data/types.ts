export type TaskKind = "bug" | "story";

/** Codex 执行状态（与禅道自身状态是两回事） */
export type RunState =
  | "idle" // 待处理，尚未交给 Codex
  | "queued" // 排队中
  | "running" // 执行中
  | "waiting" // 等待你审批
  | "paused" // 已暂停
  | "review" // Codex 已完成，等待你审核
  | "done" // 已提交 MR，并回写禅道
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

// ── 脚本（模拟 Codex 的执行过程） ─────────────────────────

export interface ScriptStep {
  ev: EventBody;
  /** 发出该事件前等待的毫秒数（模拟耗时） */
  delay: number;
  /** 关联到 script.patches 中的某个文件 */
  patch?: string;
  /** 仅在审批通过时执行 */
  onlyIfApproved?: boolean;
  /** 执行到这一步后切换状态 */
  endState?: RunState;
}

export interface Script {
  id: string;
  branch: string;
  steps: ScriptStep[];
  patches: Record<string, { path: string; status: "modified" | "added"; patch: string }>;
  /** 失败脚本：重试时使用的后续步骤 */
  retry?: ScriptStep[];
  end: RunState;
}

export interface Run {
  state: RunState;
  branch?: string;
  model: string;
  startedAt?: number;
  finishedAt?: number;
  events: RunEvent[];
  files: DiffFile[];
  /** 尚未执行的步骤 */
  queue: ScriptStep[];
  scriptId: string;
  patchKeys: Record<string, { path: string; status: "modified" | "added"; patch: string }>;
  end: RunState;
  retry?: ScriptStep[];
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
  ztStatus: string; // 禅道状态：激活 / 已解决 / 评审中 …
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
  connected: boolean;
}
export interface GitlabConfig {
  baseUrl: string;
  token: string;
  targetBranch: string;
  mrDraft: boolean;
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
  localPath: string;
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
