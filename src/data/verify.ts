import type { VerifyConfig, VerifyState } from "./types";

export const DEFAULT_VERIFY: VerifyConfig = {
  enabled: true,
  prompt: "",
};

export const verifyOf = (cfg?: Partial<VerifyConfig>): VerifyConfig => ({ enabled: cfg?.enabled ?? true, prompt: cfg?.prompt ?? DEFAULT_VERIFY.prompt });

export const VERIFY_LABEL: Record<VerifyState, string> = {
  preparing: "准备环境",
  selfcheck: "自检",
  planning: "制定测试计划",
  "awaiting-plan": "等你确认计划",
  running: "端到端验证",
  passed: "验证通过",
  failed: "验证未通过",
  unverified: "未验证",
};
export const verifyDone = (s?: VerifyState) => s === "passed" || s === "failed" || s === "unverified";
export const verifyBusy = (s?: VerifyState) => !!s && !verifyDone(s);

