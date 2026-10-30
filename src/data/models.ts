import { useEffect, useState } from "react";
import { desktopCall } from "@/lib/desktop";
import type { CodexConfig } from "./types";
export type Effort = string;
export interface ModelInfo {
  id: string; model: string; displayName: string; description: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
}
export const modelText = (c: Pick<CodexConfig, "model" | "effort">) => [c.model || "CLI 默认模型", c.effort].filter(Boolean).join(" ? ");
export function selection(model: ModelInfo, effort: string) {
  return { model: model.model, effort: model.supportedReasoningEfforts.some(e => e.reasoningEffort === effort) ? effort : model.defaultReasoningEffort };
}
export function useModels(cliPath: string) {
  const [state, setState] = useState<{ path: string; models: ModelInfo[]; loading: boolean; error: string }>({ path: cliPath, models: [], loading: true, error: "" });
  const [revision, refresh] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ path: cliPath, models: [], loading: true, error: "" });
    desktopCall("codexModels", { cliPath }).then((models: ModelInfo[]) => {
      if (active) setState({ path: cliPath, models, loading: false, error: models.length ? "" : "Codex 未返回可选模型" });
    }).catch(e => { if (active) setState({ path: cliPath, models: [], loading: false, error: String(e.message ?? e) }); });
    return () => { active = false; };
  }, [cliPath, revision]);
  return { ...state, loading: state.path !== cliPath || state.loading, models: state.path === cliPath ? state.models : [], refresh: () => refresh(n => n + 1) };
}
