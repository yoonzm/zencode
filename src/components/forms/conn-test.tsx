import { desktopCall } from "@/lib/desktop";
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

type Cfg = ZentaoConfig | GitlabConfig | CodexConfig;

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
    const steps = [{ label: kind === "codex" ? "读取 CLI 版本与登录状态" : "验证凭据并读取服务数据", state: "running" as StepState }];
    setState({ status: "running", steps });
    try {
      const result = await desktopCall("test", { kind, config: cfg });
      const message = `${result}${kind !== "codex" && (cfg as ZentaoConfig | GitlabConfig).insecureTls ? " · 已跳过证书验证" : ""}`;
      if (token.current !== mine) return false;
      setState({ status: "ok", steps: steps.map(s => ({ ...s, state: "ok" })), message });
      return true;
    } catch (e) {
      if (token.current !== mine) return false;
      setState({ status: "error", steps: steps.map(s => ({ ...s, state: "error" })), message: e instanceof Error ? e.message : String(e) });
      return false;
    }
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
