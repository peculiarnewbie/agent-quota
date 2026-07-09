/** Client-side types for `/api/usage`. Keep in sync with `packages/server/src/types.rs`. */

export interface UsageWindow {
  used: string;
  remaining: string;
  resetsIn: string;
  resetsAtMs: number;
  usedPercent: number;
  label?: string;
}

export type ServiceStatus = "ok" | "error" | "no_credentials" | "throttled";

/** v1 provider ids — `GET /api/usage` always returns all four. */
export type V1Service = "codex" | "claude" | "cursor" | "opencode";

export const V1_SERVICES: readonly V1Service[] = [
  "codex",
  "claude",
  "cursor",
  "opencode",
] as const;

export interface ServiceUsage {
  service: string;
  status: ServiceStatus;
  error?: string;
  hint?: string;
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  monthly?: UsageWindow;
  plan?: string;
  /** Which credential/source won (required when status is `ok`). */
  source?: string;
}
