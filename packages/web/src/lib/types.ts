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

/** Fixed providers that are never multi-row. */
export type FixedService = "claude" | "cursor";

export const FIXED_SERVICES: readonly FixedService[] = ["claude", "cursor"] as const;

export function isCodexService(service: string): boolean {
  return service === "codex" || service.startsWith("codex-");
}

export function isOpencodeService(service: string): boolean {
  return service === "opencode" || service.startsWith("opencode-");
}

/** Usage-tracking section (not credits). */
export function isUsageService(service: string): boolean {
  return (
    isCodexService(service) ||
    isOpencodeService(service) ||
    (FIXED_SERVICES as readonly string[]).includes(service)
  );
}

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
  /** Card title override (e.g. Codex / OpenCode account label). */
  displayName?: string;
  /** Account email when known (Codex WHAM / id_token). */
  accountEmail?: string;
}

export interface OpencodeGoAccountPublic {
  id: string;
  label?: string;
  workspaceId?: string;
  authCookieMasked?: string;
  hasCookie: boolean;
  service: string;
}

export interface CodexAccountPublic {
  id: string;
  label?: string;
  local: boolean;
  authJson?: string;
  service: string;
}

export interface SettingsPublic {
  opencodeGoAccounts: OpencodeGoAccountPublic[];
  codexAccounts: CodexAccountPublic[];
  configPath: string;
}
