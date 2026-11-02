import type { RepoMapping } from "./types";

export const projectPromptOf = (mapping: Pick<RepoMapping, "projectPrompt" | "verify">): string =>
  mapping.projectPrompt ?? mapping.verify?.prompt ?? "";

export function migrateProjectPrompt<T extends Pick<RepoMapping, "projectPrompt" | "verify">>(mapping: T) {
  const { verify: _legacy, ...rest } = mapping;
  return { ...rest, projectPrompt: projectPromptOf(mapping) };
}
