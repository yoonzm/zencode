export interface VerificationMessage {
  state: string;
  summary: string;
  target?: string;
  steps: { title: string; expect?: string; note?: string; status: string }[];
}

export function parseVerificationMessage(text: string): VerificationMessage | null {
  try {
    const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?/, "").replace(/\s*```$/, ""));
    if (!value || !["unverified", "passed", "failed", "awaiting-plan"].includes(value.state)
      || !["ui", "api", "checks"].includes(value.mode) || typeof value.summary !== "string"
      || !Array.isArray(value.steps) || !value.steps.every((step: unknown) => {
        if (!step || typeof step !== "object") return false;
        const s = step as Record<string, unknown>;
        return typeof s.title === "string" && ["pending", "running", "passed", "failed"].includes(String(s.status))
          && (s.expect === undefined || typeof s.expect === "string")
          && (s.note === undefined || typeof s.note === "string");
      }) || (value.target !== undefined && typeof value.target !== "string")) return null;
    return value;
  } catch { return null; }
}

export function isStreamingVerificationMessage(text: string): boolean {
  return /^(?:```(?:json)?\s*)?\{\s*"state"\s*:\s*"(?:unverified|passed|failed|awaiting-plan)"\s*,\s*"mode"\s*:\s*"(?:ui|api|checks)"/.test(text.trim());
}
