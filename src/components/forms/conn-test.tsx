import { useEffect, useRef, useState } from "react";
import { cn, sleep } from "@/lib/utils";
import { CircleAlert, CircleCheck, CircleDashed, CircleX, Loader } from "@/lib/icons";
import type { CodexConfig, GitlabConfig, ZentaoConfig } from "@/data/types";

export type TestKind = "zentao" | "gitlab" | "codex";
type StepState = "pending" | "running" | "ok" | "error";

export interface TestState {
  status: "idle" | "running" | "ok" | "error";
  steps: { label: string; state: StepState }[];
  message?: string;
}

const STEPS: Record<TestKind, string[]> = {
  zentao: ["解析服务地址", "建立 TLS 连接", "验证账号凭据", "读取产品与项目"],
  gitlab: ["解析服务地址", "建立 TLS 连接", "验证 Personal Access Token", "检查权限范围（api · write_repository）"],
  codex: ["查找本机 Codex 命令行", "读取版本信息", "检查沙盒支持", "试运行一次只读任务"],
};

const isUrl = (s: string) => /^https?:\/\/[^\s/]+\.[^\s/]+/.test(s.trim()) || /^https?:\/\/localhost/.test(s.trim());
const bad = (s: string) => /fail|error|timeout/i.test(s);

type Cfg = ZentaoConfig | GitlabConfig | CodexConfig;

function evaluate(kind: TestKind, c: Cfg): { failAt: number; message: string } | { ok: string } {
  if (kind === "zentao") {
    const z = c as ZentaoConfig;
    if (!isUrl(z.baseUrl)) return { failAt: 0, message: "地址格式不正确，应形如 https://zentao.example.com" };
    if (bad(z.baseUrl)) return { failAt: 1, message: "连接超时（ETIMEDOUT）。请检查网络、VPN，或确认这个地址在当前网络可访问。" };
    if (!z.account.trim()) return { failAt: 2, message: "请填写禅道账号。" };
    if (!z.secret.trim()) return { failAt: 2, message: z.auth === "token" ? "请填写 API Token。可在禅道「个人中心 → 安全」里生成。" : "请填写密码。" };
    if (/bad/i.test(z.secret)) return { failAt: 2, message: "认证失败（HTTP 401）：账号或凭据不正确。" };
    return { ok: "已连接 · 张明 · 可见 5 个产品、12 个项目（演示数据）" };
  }
  if (kind === "gitlab") {
    const g = c as GitlabConfig;
    if (!isUrl(g.baseUrl)) return { failAt: 0, message: "地址格式不正确，应形如 https://gitlab.example.com" };
    if (bad(g.baseUrl)) return { failAt: 1, message: "连接超时（ETIMEDOUT）。自建 GitLab 通常需要先连上公司网络。" };
    if (!g.token.trim()) return { failAt: 2, message: "请填写 Personal Access Token。" };
    if (!g.token.startsWith("glpat-")) return { failAt: 2, message: "Token 格式无效，GitLab 的 Personal Access Token 以 glpat- 开头。" };
    if (/bad/i.test(g.token)) return { failAt: 3, message: "Token 缺少 write_repository 权限，无法推送分支和创建 Merge Request。" };
    return { ok: "已连接 · @zhangming · 具备 api、write_repository 权限（演示数据）" };
  }
  const x = c as CodexConfig;
  const path = x.cliPath.trim();
  if (path && /missing|notfound|bad/i.test(path)) return { failAt: 0, message: `在 ${path} 没有找到 codex。请检查路径，或清空路径让 ZenCode 从 PATH 里查找。` };
  if (path && !/codex/i.test(path)) return { failAt: 1, message: "这个文件不像是 Codex 命令行，读取版本失败。" };
  return { ok: `已就绪 · codex-cli 0.46.0 · ${path ? path : "来自 PATH"} · 沙盒可用（演示数据）` };
}

const idle = (kind: TestKind): TestState => ({ status: "idle", steps: STEPS[kind].map((label) => ({ label, state: "pending" })) });

export function useConnTest(kind: TestKind) {
  const [state, setState] = useState<TestState>(() => idle(kind));
  const token = useRef(0);
  useEffect(() => () => void (token.current = -1), []);

  const reset = () => {
    token.current++;
    setState(idle(kind));
  };

  /** 返回 true 表示通过 */
  const run = async (cfg: Cfg): Promise<boolean> => {
    const mine = ++token.current;
    const verdict = evaluate(kind, cfg);
    const labels = STEPS[kind];
    const steps = labels.map((label) => ({ label, state: "pending" as StepState }));
    setState({ status: "running", steps: steps.slice() });
    for (let i = 0; i < labels.length; i++) {
      steps[i] = { ...steps[i], state: "running" };
      setState({ status: "running", steps: steps.slice() });
      await sleep(420 + Math.random() * 260);
      if (token.current !== mine) return false;
      if ("failAt" in verdict && verdict.failAt === i) {
        steps[i] = { ...steps[i], state: "error" };
        setState({ status: "error", steps: steps.slice(), message: verdict.message });
        return false;
      }
      steps[i] = { ...steps[i], state: "ok" };
      setState({ status: "running", steps: steps.slice() });
    }
    setState({ status: "ok", steps: steps.slice(), message: "ok" in verdict ? verdict.ok : "" });
    return true;
  };

  return { state, run, reset };
}

const ICON: Record<StepState, any> = {
  pending: <CircleDashed className="size-4 text-subtle-foreground" />,
  running: <Loader className="size-4 animate-spin text-accent" />,
  ok: <CircleCheck className="size-4 text-success" />,
  error: <CircleX className="size-4 text-danger" />,
};

export function ConnTestPanel({ state }: { state: TestState }) {
  if (state.status === "idle") return null;
  return (
    <div className="anim-fade rounded-lg border border-border bg-card p-3" role="status" aria-live="polite">
      <ul className="space-y-1.5">
        {state.steps.map((s) => (
          <li key={s.label} className={cn("flex items-center gap-2 text-sm", s.state === "pending" ? "text-subtle-foreground" : s.state === "error" ? "text-danger" : "text-foreground")}>
            {ICON[s.state]}
            {s.label}
          </li>
        ))}
      </ul>
      {state.status === "ok" && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-success/10 px-2.5 py-2 text-sm text-success">
          <CircleCheck className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </p>
      )}
      {state.status === "error" && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-danger/10 px-2.5 py-2 text-sm text-danger" role="alert">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </p>
      )}
    </div>
  );
}
