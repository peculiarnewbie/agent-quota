import {
    getClaudeCredentials,
    getCodexCredentials,
    getZaiCredentials,
    getOpenRouterCredentials,
    getOpencodeGoCredentials,
    getOpencodeZenCredentials,
    getCrofaiCredentials,
    getCursorCredentials,
} from "./credentials";

export interface UsageWindow {
    used: string;
    remaining: string;
    resetsIn: string;
    resetsAtMs: number;
    usedPercent: number;
    label?: string;
}

export interface ServiceUsage {
    service: string;
    status: "ok" | "error" | "no_credentials" | "throttled";
    error?: string;
    hint?: string;
    fiveHour?: UsageWindow;
    sevenDay?: UsageWindow;
    monthly?: UsageWindow;
    plan?: string;
    source?: string;
}

const DEFAULT_HTTP_TIMEOUT_MS = 8000;

const DEFAULT_CLAUDE_COOLDOWN_MS = 4 * 5 * 60 * 1000; // 4x the 5-min browser refresh
const parsedClaudeCooldownMs = Number(process.env.CLAUDE_FETCH_COOLDOWN_MS);
const CLAUDE_FETCH_COOLDOWN_MS =
    Number.isFinite(parsedClaudeCooldownMs) && parsedClaudeCooldownMs > 0
        ? parsedClaudeCooldownMs
        : DEFAULT_CLAUDE_COOLDOWN_MS;

let lastClaudeFetchMs = 0;
const parsedHttpTimeoutMs = Number(process.env.USAGE_HTTP_TIMEOUT_MS);
const HTTP_TIMEOUT_MS =
    Number.isFinite(parsedHttpTimeoutMs) && parsedHttpTimeoutMs > 0
        ? parsedHttpTimeoutMs
        : DEFAULT_HTTP_TIMEOUT_MS;

const OPENCODE_GO_RE_MONTHLY_PCT_FIRST =
    /monthlyUsage:\$R\[\d+\]\s*=\s*\{[^{}]*usagePercent\s*:\s*(\d+(?:\.\d+)?)[^{}]*resetInSec\s*:\s*(\d+)[^{}]*\}/i;
const OPENCODE_GO_RE_MONTHLY_RESET_FIRST =
    /monthlyUsage:\$R\[\d+\]\s*=\s*\{[^{}]*resetInSec\s*:\s*(\d+)[^{}]*usagePercent\s*:\s*(\d+(?:\.\d+)?)[^{}]*\}/i;
const OPENCODE_GO_RE_MONTHLY_GENERIC_PCT_FIRST =
    /monthlyUsage\s*:\s*\{[^{}]*usagePercent\s*:\s*(\d+(?:\.\d+)?)[^{}]*resetInSec\s*:\s*(\d+)[^{}]*\}/i;
const OPENCODE_GO_RE_MONTHLY_GENERIC_RESET_FIRST =
    /monthlyUsage\s*:\s*\{[^{}]*resetInSec\s*:\s*(\d+)[^{}]*usagePercent\s*:\s*(\d+(?:\.\d+)?)[^{}]*\}/i;

function formatDurationSeconds(totalSeconds: number): string {
    if (totalSeconds <= 0) return "Now";

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function formatResetTime(isoTime: string | null | undefined): string {
    if (!isoTime) return "N/A";
    try {
        const resetDt = new Date(isoTime);
        const now = new Date();
        const deltaMs = resetDt.getTime() - now.getTime();
        return formatDurationSeconds(Math.floor(deltaMs / 1000));
    } catch {
        return isoTime.slice(0, 19);
    }
}

async function httpGet(url: string, headers: Record<string, string>): Promise<[number, unknown]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    try {
        const response = await fetch(url, { headers, signal: controller.signal });
        const text = await response.text();
        try {
            return [response.status, JSON.parse(text)];
        } catch {
            return [response.status, text];
        }
    } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
            return [0, `Request timed out after ${HTTP_TIMEOUT_MS}ms`];
        }
        return [0, e instanceof Error ? e.message : String(e)];
    } finally {
        clearTimeout(timeoutId);
    }
}

function htmlToText(html: string): string {
    return html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function parseDurationSeconds(value: string): number | null {
    let totalSeconds = 0;
    let matched = false;

    for (const match of value.matchAll(
        /(\d+)\s*(weeks?|days?|hours?|minutes?|seconds?|w|d|h|m|s)\b/gi,
    )) {
        const amount = Number(match[1]);
        if (!Number.isFinite(amount)) continue;
        const unit = match[2]?.toLowerCase();
        if (!unit) continue;

        matched = true;

        if (unit === "w" || unit.startsWith("week")) totalSeconds += amount * 604800;
        else if (unit === "d" || unit.startsWith("day")) totalSeconds += amount * 86400;
        else if (unit === "h" || unit.startsWith("hour")) totalSeconds += amount * 3600;
        else if (unit === "m" || unit.startsWith("minute")) totalSeconds += amount * 60;
        else if (unit === "s" || unit.startsWith("second")) totalSeconds += amount;
    }

    return matched ? totalSeconds : null;
}

function parseOpencodeGoUsageTextWindow(
    text: string,
    label: string,
): { usagePercent: number; resetInSec: number } | null {
    const source = String(text || "");
    const lowerSource = source.toLowerCase();
    const lowerLabel = label.toLowerCase();
    const start = lowerSource.indexOf(lowerLabel);
    if (start < 0) return null;

    const nextLabels = [
        "rolling usage",
        "weekly usage",
        "monthly usage",
        "use your available balance",
    ];
    let end = source.length;

    for (const nextLabel of nextLabels) {
        if (nextLabel === lowerLabel) continue;
        const nextIndex = lowerSource.indexOf(nextLabel, start + lowerLabel.length);
        if (nextIndex >= 0 && nextIndex < end) end = nextIndex;
    }

    const section = source.slice(start, end);
    const percentMatch = section.match(/(\d{1,3}(?:\.\d+)?)\s*%/i);
    const resetIndex = section.toLowerCase().indexOf("resets in");
    if (!percentMatch || resetIndex < 0) return null;

    const usagePercent = Number(percentMatch[1]);
    const resetInSec = parseDurationSeconds(section.slice(resetIndex + "resets in".length));
    if (!Number.isFinite(usagePercent) || resetInSec === null) return null;

    return { usagePercent, resetInSec };
}

function parseOpencodeGoUsageWindows(
    html: string,
): Partial<Record<"rolling" | "weekly" | "monthly", { usagePercent: number; resetInSec: number }>> {
    const text = htmlToText(html);

    return {
        rolling: parseOpencodeGoUsageTextWindow(text, "Rolling Usage") ?? undefined,
        weekly: parseOpencodeGoUsageTextWindow(text, "Weekly Usage") ?? undefined,
        monthly: parseOpencodeGoUsageTextWindow(text, "Monthly Usage") ?? undefined,
    };
}

function parseOpencodeGoMonthlyUsage(
    html: string,
): { usagePercent: number; resetInSec: number } | null {
    if (!html || typeof html !== "string") return null;

    const pctFirst = OPENCODE_GO_RE_MONTHLY_PCT_FIRST.exec(html);
    if (pctFirst) {
        const usagePercent = Number(pctFirst[1]);
        const resetInSec = Number(pctFirst[2]);
        if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
            return { usagePercent, resetInSec };
        }
    }

    const resetFirst = OPENCODE_GO_RE_MONTHLY_RESET_FIRST.exec(html);
    if (resetFirst) {
        const resetInSec = Number(resetFirst[1]);
        const usagePercent = Number(resetFirst[2]);
        if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
            return { usagePercent, resetInSec };
        }
    }

    const genericPctFirst = OPENCODE_GO_RE_MONTHLY_GENERIC_PCT_FIRST.exec(html);
    if (genericPctFirst) {
        const usagePercent = Number(genericPctFirst[1]);
        const resetInSec = Number(genericPctFirst[2]);
        if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
            return { usagePercent, resetInSec };
        }
    }

    const genericResetFirst = OPENCODE_GO_RE_MONTHLY_GENERIC_RESET_FIRST.exec(html);
    if (genericResetFirst) {
        const resetInSec = Number(genericResetFirst[1]);
        const usagePercent = Number(genericResetFirst[2]);
        if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
            return { usagePercent, resetInSec };
        }
    }

    return parseOpencodeGoUsageWindows(html).monthly ?? null;
}

function buildUsageWindow(
    label: string,
    usagePercent: number,
    resetInSec: number,
): UsageWindow {
    const usedPercent = Math.max(0, Math.min(100, usagePercent));
    const safeResetInSec = Math.max(0, resetInSec);

    return {
        label,
        used: `${usedPercent}%`,
        remaining: `${100 - usedPercent}%`,
        resetsIn: formatDurationSeconds(safeResetInSec),
        resetsAtMs: Date.now() + safeResetInSec * 1000,
        usedPercent,
    };
}

function sanitizeHint(data: unknown): string {
    return String(data).replace(/\s+/g, " ").trim().slice(0, 200);
}

export async function getClaudeUsage(): Promise<ServiceUsage> {
    const now = Date.now();
    if (now - lastClaudeFetchMs < CLAUDE_FETCH_COOLDOWN_MS) {
        const remainingMs = CLAUDE_FETCH_COOLDOWN_MS - (now - lastClaudeFetchMs);
        const remainingMin = Math.ceil(remainingMs / 60000);
        return {
            service: "claude",
            status: "throttled",
            error: "Rate limited",
            hint: `Skipped: retry in ~${remainingMin} min (cooldown to avoid 429)`,
        };
    }

    const creds = getClaudeCredentials();

    if (!creds) {
        return {
            service: "claude",
            status: "no_credentials",
            error: "No credentials found",
            hint: "Run 'claude' and authenticate first",
        };
    }

    const headers = {
        Authorization: `Bearer ${creds.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
    };

    const [status, data] = await httpGet("https://api.anthropic.com/api/oauth/usage", headers);
    lastClaudeFetchMs = Date.now();

    if (status === 200 && typeof data === "object" && data !== null) {
        const d = data as Record<string, unknown>;
        const result: ServiceUsage = {
            service: "claude",
            status: "ok",
            source: creds.source,
        };

        if (d.five_hour && typeof d.five_hour === "object") {
            const fh = d.five_hour as Record<string, unknown>;
            const util = typeof fh.utilization === "number" ? fh.utilization : 0;
            const resetsAtMs = fh.resets_at ? new Date(fh.resets_at as string).getTime() : 0;
            result.fiveHour = {
                used: `${util.toFixed(1)}%`,
                remaining: `${(100 - util).toFixed(1)}%`,
                resetsIn: formatResetTime(fh.resets_at as string),
                resetsAtMs,
                usedPercent: util,
            };
        }

        if (d.seven_day && typeof d.seven_day === "object") {
            const sd = d.seven_day as Record<string, unknown>;
            const util = typeof sd.utilization === "number" ? sd.utilization : 0;
            const resetsAtMs = sd.resets_at ? new Date(sd.resets_at as string).getTime() : 0;
            result.sevenDay = {
                used: `${util.toFixed(1)}%`,
                remaining: `${(100 - util).toFixed(1)}%`,
                resetsIn: formatResetTime(sd.resets_at as string),
                resetsAtMs,
                usedPercent: util,
            };
        }

        return result;
    }

    if (status === 401) {
        return {
            service: "claude",
            status: "error",
            error: "Token expired",
            hint: "Run 'claude' to re-authenticate",
            source: creds.source,
        };
    }

    return {
        service: "claude",
        status: "error",
        error: `HTTP ${status}`,
        hint: String(data).slice(0, 200),
        source: creds.source,
    };
}

export async function getCodexUsage(): Promise<ServiceUsage> {
    const creds = getCodexCredentials();

    if (!creds || (!creds.accessToken && !creds.apiKey)) {
        return {
            service: "codex",
            status: "no_credentials",
            error: "No credentials found",
            hint: "Run 'codex login' or set OPENAI_API_KEY",
        };
    }

    if (creds.accessToken && creds.accountId) {
        const headers = {
            Authorization: `Bearer ${creds.accessToken}`,
            "chatgpt-account-id": creds.accountId,
            "User-Agent": "codex-cli",
            "Content-Type": "application/json",
        };

        const [status, data] = await httpGet("https://chatgpt.com/backend-api/wham/usage", headers);

        if (status === 200 && typeof data === "object" && data !== null) {
            const d = data as Record<string, unknown>;
            const result: ServiceUsage = {
                service: "codex",
                status: "ok",
                source: creds.source,
            };

            if (d.plan_type) {
                result.plan = String(d.plan_type);
            }

            if (d.rate_limit && typeof d.rate_limit === "object") {
                const rl = d.rate_limit as Record<string, unknown>;

                if (rl.primary_window && typeof rl.primary_window === "object") {
                    const pw = rl.primary_window as Record<string, unknown>;
                    const usedPct = typeof pw.used_percent === "number" ? pw.used_percent : 0;
                    const resetSecs =
                        typeof pw.reset_after_seconds === "number" ? pw.reset_after_seconds : 0;
                    const resetsAtMs = Date.now() + resetSecs * 1000;

                    result.fiveHour = {
                        used: `${usedPct}%`,
                        remaining: `${100 - usedPct}%`,
                        resetsIn: formatDurationSeconds(resetSecs),
                        resetsAtMs,
                        usedPercent: usedPct,
                    };
                }

                if (rl.secondary_window && typeof rl.secondary_window === "object") {
                    const sw = rl.secondary_window as Record<string, unknown>;
                    const usedPct = typeof sw.used_percent === "number" ? sw.used_percent : 0;
                    const resetSecs =
                        typeof sw.reset_after_seconds === "number" ? sw.reset_after_seconds : 0;
                    const resetsAtMs = Date.now() + resetSecs * 1000;

                    result.sevenDay = {
                        used: `${usedPct}%`,
                        remaining: `${100 - usedPct}%`,
                        resetsIn: formatDurationSeconds(resetSecs),
                        resetsAtMs,
                        usedPercent: usedPct,
                    };
                }
            }

            return result;
        }
    }

    if (creds.apiKey) {
        const headers = {
            Authorization: `Bearer ${creds.apiKey}`,
            "Content-Type": "application/json",
        };
        const [status] = await httpGet("https://api.openai.com/v1/models", headers);

        if (status === 200) {
            return {
                service: "codex",
                status: "ok",
                source: creds.source,
                hint: "API key valid - subscription quota requires OAuth login",
            };
        }
    }

    return {
        service: "codex",
        status: "error",
        error: "Authentication failed",
        hint: "Run 'codex login' to re-authenticate",
        source: creds.source,
    };
}

export async function getZaiUsage(): Promise<ServiceUsage> {
    const creds = getZaiCredentials();

    if (!creds) {
        return {
            service: "zai",
            status: "no_credentials",
            error: "No credentials found",
            hint: "Set ZAI_API_KEY environment variable or create ~/.zai/config.json",
        };
    }

    const headers = {
        Authorization: creds.apiKey,
        "Content-Type": "application/json",
    };

    const [status, data] = await httpGet("https://api.z.ai/api/monitor/usage/quota/limit", headers);

    if (status === 200 && typeof data === "object" && data !== null) {
        const d = data as Record<string, unknown>;

        if (d.success && d.data && typeof d.data === "object") {
            const dd = d.data as Record<string, unknown>;
            const limits = Array.isArray(dd.limits) ? dd.limits : [];
            const result: ServiceUsage = {
                service: "zai",
                status: "ok",
                source: creds.source,
            };

            for (const limit of limits) {
                if (typeof limit !== "object" || limit === null) continue;
                const l = limit as Record<string, unknown>;

                if (l.type === "TOKENS_LIMIT") {
                    const pct = typeof l.percentage === "number" ? l.percentage : 0;
                    const resetTs = typeof l.nextResetTime === "number" ? l.nextResetTime : 0;

                    const deltaSeconds = Math.floor((resetTs - Date.now()) / 1000);

                    result.fiveHour = {
                        used: `${pct}%`,
                        remaining: `${100 - pct}%`,
                        resetsIn: formatDurationSeconds(deltaSeconds),
                        resetsAtMs: resetTs,
                        usedPercent: pct,
                    };
                }
            }

            return result;
        }
    }

    return {
        service: "zai",
        status: "error",
        error: `HTTP ${status}`,
        hint: "Check https://z.ai/manage-apikey/billing",
        source: creds.source,
    };
}

export async function getOpenRouterUsage(): Promise<ServiceUsage> {
    const creds = getOpenRouterCredentials();

    if (!creds) {
        return {
            service: "openrouter",
            status: "no_credentials",
            error: "No credentials found",
            hint: "Set OPENROUTER_API_KEY environment variable",
        };
    }

    const headers = {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
    };

    const [status, data] = await httpGet("https://openrouter.ai/api/v1/credits", headers);

    if (status === 200 && typeof data === "object" && data !== null) {
        const d = data as Record<string, unknown>;

        if (d.data && typeof d.data === "object") {
            const dd = d.data as Record<string, unknown>;
            const totalCredits = typeof dd.total_credits === "number" ? dd.total_credits : 0;
            const totalUsage = typeof dd.total_usage === "number" ? dd.total_usage : 0;
            const remaining = totalCredits - totalUsage;

            const usedPercent = totalCredits > 0 ? (totalUsage / totalCredits) * 100 : 0;

            return {
                service: "openrouter",
                status: "ok",
                source: creds.source,
                fiveHour: {
                    used: `$${totalUsage.toFixed(2)}`,
                    remaining: `$${remaining.toFixed(2)}`,
                    resetsIn: "--",
                    resetsAtMs: 0,
                    usedPercent,
                },
            };
        }
    }

    return {
        service: "openrouter",
        status: "error",
        error: `HTTP ${status}`,
        hint: "Check https://openrouter.ai/credits",
        source: creds.source,
    };
}

export async function getOpencodeGoUsage(): Promise<ServiceUsage> {
    const creds = getOpencodeGoCredentials();

    if (!creds) {
        return {
            service: "opencode-go",
            status: "no_credentials",
            error: "No credentials found",
            hint: "Set OPENCODE_GO_WORKSPACE_ID and OPENCODE_GO_AUTH_COOKIE",
        };
    }

    const [status, data] = await httpGet(
        `https://opencode.ai/workspace/${encodeURIComponent(creds.workspaceId)}/go`,
        {
            Accept: "text/html",
            Cookie: `auth=${creds.authCookie}`,
            "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0",
        },
    );

    if (status === 200) {
        const html = typeof data === "string" ? data : JSON.stringify(data);
        const windows = parseOpencodeGoUsageWindows(html);
        const monthly = windows.monthly ?? parseOpencodeGoMonthlyUsage(html);

        if (windows.rolling || windows.weekly || monthly) {
            return {
                service: "opencode-go",
                status: "ok",
                source: creds.source,
                fiveHour: windows.rolling
                    ? buildUsageWindow("rolling", windows.rolling.usagePercent, windows.rolling.resetInSec)
                    : undefined,
                sevenDay: windows.weekly
                    ? buildUsageWindow("weekly", windows.weekly.usagePercent, windows.weekly.resetInSec)
                    : undefined,
                monthly: monthly
                    ? buildUsageWindow("monthly", monthly.usagePercent, monthly.resetInSec)
                    : undefined,
            };
        }

        return {
            service: "opencode-go",
            status: "error",
            error: "Could not parse OpenCode Go usage from dashboard",
            hint: "OpenCode may have changed the dashboard markup",
            source: creds.source,
        };
    }

    return {
        service: "opencode-go",
        status: "error",
        error: `HTTP ${status}`,
        hint: sanitizeHint(data) || "Refresh your OpenCode auth cookie",
        source: creds.source,
    };
}

export async function getOpencodeZenUsage(): Promise<ServiceUsage> {
    const creds = getOpencodeZenCredentials();

    if (!creds) {
        return {
            service: "opencode-zen",
            status: "no_credentials",
            error: "No credentials found",
            hint: "Set OPENCODE_API_KEY environment variable",
        };
    }

    const headers = {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
    };

    const [status, data] = await httpGet("https://opencode.ai/zen/v1/balance", headers);

    if (status === 200 && typeof data === "object" && data !== null) {
        const d = data as Record<string, unknown>;
        const balance = typeof d.balance === "number" ? d.balance : 0;
        const currency = typeof d.currency === "string" ? d.currency : "USD";

        return {
            service: "opencode-zen",
            status: "ok",
            source: creds.source,
            fiveHour: {
                used: "--",
                remaining: `${currency} ${balance.toFixed(2)}`,
                resetsIn: "--",
                resetsAtMs: 0,
                usedPercent: 0,
            },
        };
    }

    if (status === 404) {
        return {
            service: "opencode-zen",
            status: "error",
            error: "Balance endpoint not available",
            hint: "API may not support balance queries yet",
            source: creds.source,
        };
    }

    return {
        service: "opencode-zen",
        status: "error",
        error: `HTTP ${status}`,
        hint: "Check https://opencode.ai/zen",
        source: creds.source,
    };
}

export async function getCrofaiUsage(): Promise<ServiceUsage> {
    const creds = getCrofaiCredentials();

    if (!creds) {
        return {
            service: "crofai",
            status: "no_credentials",
            error: "No credentials found",
            hint: "Set CROFAI_SESSION or create ~/.config/opencode/opencode-quota/crofai.json",
        };
    }

    const [status, data] = await httpGet("https://crof.ai/user-api/credits", {
        Cookie: `session=${creds.session}`,
    });

    if (status === 200) {
        const raw = typeof data === "string" ? data.trim() : String(data);
        const balance = Number.parseFloat(raw);

        if (Number.isFinite(balance)) {
            return {
                service: "crofai",
                status: "ok",
                source: creds.source,
                fiveHour: {
                    used: "--",
                    remaining: `$${balance.toFixed(2)}`,
                    resetsIn: "--",
                    resetsAtMs: 0,
                    usedPercent: 0,
                },
            };
        }

        return {
            service: "crofai",
            status: "error",
            error: "Unexpected response format",
            hint: sanitizeHint(raw),
            source: creds.source,
        };
    }

    if (status === 401 || status === 403) {
        return {
            service: "crofai",
            status: "error",
            error: "Session expired",
            hint: "Update your CrofAI session token",
            source: creds.source,
        };
    }

    return {
        service: "crofai",
        status: "error",
        error: `HTTP ${status}`,
        hint: "Check https://crof.ai",
        source: creds.source,
    };
}

const CURSOR_BASE_URL = "https://api2.cursor.sh";
const CURSOR_USAGE_URL = CURSOR_BASE_URL + "/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const CURSOR_PLAN_URL = CURSOR_BASE_URL + "/aiserver.v1.DashboardService/GetPlanInfo";
const CURSOR_CREDITS_URL = CURSOR_BASE_URL + "/aiserver.v1.DashboardService/GetCreditGrantsBalance";
const CURSOR_REFRESH_URL = CURSOR_BASE_URL + "/oauth/token";
const CURSOR_CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";

function decodeJwtExp(token: string): number | null {
    try {
        const parts = token.split('.');
        if (parts.length < 2) return null;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    } catch {
        return null;
    }
}

async function cursorRefreshToken(refreshToken: string): Promise<string | null> {
    try {
        const resp = await fetch(CURSOR_REFRESH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                grant_type: "refresh_token",
                client_id: CURSOR_CLIENT_ID,
                refresh_token: refreshToken,
            }),
        });
        if (!resp.ok) return null;
        const body = await resp.json() as Record<string, unknown>;
        return typeof body.access_token === 'string' ? body.access_token : null;
    } catch {
        return null;
    }
}

async function cursorConnectPost(url: string, token: string): Promise<[number, unknown]> {
    try {
        const resp = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "Connect-Protocol-Version": "1",
            },
            body: "{}",
        });
        const text = await resp.text();
        try { return [resp.status, JSON.parse(text)]; }
        catch { return [resp.status, text]; }
    } catch (e) {
        return [0, e instanceof Error ? e.message : String(e)];
    }
}

export async function getCursorUsage(): Promise<ServiceUsage> {
    const creds = getCursorCredentials();

    if (!creds) {
        return {
            service: "cursor",
            status: "no_credentials",
            error: "No credentials found",
            hint: "Sign in to Cursor app, or set CURSOR_ACCESS_TOKEN",
        };
    }

    let accessToken = creds.accessToken;

    const expMs = decodeJwtExp(accessToken);
    if (expMs && Date.now() > expMs - 5 * 60 * 1000) {
        if (!creds.refreshToken) {
            return {
                service: "cursor",
                status: "error",
                error: "Token expired",
                hint: "Re-sign in to Cursor, or provide CURSOR_REFRESH_TOKEN",
                source: creds.source,
            };
        }
        const refreshed = await cursorRefreshToken(creds.refreshToken);
        if (!refreshed) {
            return {
                service: "cursor",
                status: "error",
                error: "Token refresh failed",
                hint: "Re-sign in to Cursor",
                source: creds.source,
            };
        }
        accessToken = refreshed;
    }

    const [usageStatus, usageData] = await cursorConnectPost(CURSOR_USAGE_URL, accessToken);

    if (usageStatus === 401 || usageStatus === 403) {
        return {
            service: "cursor",
            status: "error",
            error: "Auth rejected",
            hint: "Re-sign in to Cursor",
            source: creds.source,
        };
    }

    if (usageStatus !== 200 || typeof usageData !== 'object' || usageData === null) {
        return {
            service: "cursor",
            status: "error",
            error: `HTTP ${usageStatus}`,
            hint: "Check Cursor subscription status",
            source: creds.source,
        };
    }

    const usage = usageData as Record<string, unknown>;
    const planUsage = usage.planUsage as Record<string, unknown> | undefined;

    if (!planUsage || (typeof planUsage.limit !== 'number' && typeof planUsage.totalPercentUsed !== 'number')) {
        return {
            service: "cursor",
            status: "error",
            error: "No active subscription",
            hint: "Check your Cursor plan",
            source: creds.source,
        };
    }

    const [, planData] = await cursorConnectPost(CURSOR_PLAN_URL, accessToken);
    let planName = "";
    if (typeof planData === 'object' && planData !== null) {
        const pi = (planData as Record<string, unknown>).planInfo as Record<string, unknown> | undefined;
        if (typeof pi?.planName === 'string') planName = pi.planName;
    }

    const limit = typeof planUsage.limit === 'number' ? planUsage.limit : 0;
    const totalSpend = typeof planUsage.totalSpend === 'number' ? planUsage.totalSpend : 0;
    const pctUsed = typeof planUsage.totalPercentUsed === 'number'
        ? planUsage.totalPercentUsed
        : (limit > 0 ? (totalSpend / limit) * 100 : 0);

    const billingPeriodMs = 30 * 24 * 60 * 60 * 1000;
    const cycleStart = Number(usage.billingCycleStart);
    const cycleEnd = Number(usage.billingCycleEnd);
    const resetsAtMs = Number.isFinite(cycleEnd) ? cycleEnd : 0;
    const periodMs = Number.isFinite(cycleStart) && Number.isFinite(cycleEnd) && cycleEnd > cycleStart
        ? cycleEnd - cycleStart : billingPeriodMs;

    const result: ServiceUsage = {
        service: "cursor",
        status: "ok",
        source: creds.source,
        plan: planName || undefined,
        fiveHour: {
            used: `${pctUsed.toFixed(1)}%`,
            remaining: `${(100 - pctUsed).toFixed(1)}%`,
            resetsIn: resetsAtMs > 0 ? formatResetTime(new Date(resetsAtMs).toISOString()) : "--",
            resetsAtMs,
            usedPercent: pctUsed,
            label: `${Math.round(periodMs / 86400000)}d usage`,
        },
    };

    const [, creditsData] = await cursorConnectPost(CURSOR_CREDITS_URL, accessToken);
    if (typeof creditsData === 'object' && creditsData !== null) {
        const cg = creditsData as Record<string, unknown>;
        if (cg.hasCreditGrants === true) {
            const totalCents = parseInt(String(cg.totalCents), 10) || 0;
            const usedCents = parseInt(String(cg.usedCents), 10) || 0;
            if (totalCents > 0) {
                result.sevenDay = {
                    used: `$${(usedCents / 100).toFixed(2)}`,
                    remaining: `$${((totalCents - usedCents) / 100).toFixed(2)}`,
                    resetsIn: "--",
                    resetsAtMs: 0,
                    usedPercent: (usedCents / totalCents) * 100,
                    label: "credits",
                };
            }
        }
    }

    return result;
}

export async function getAllUsage(): Promise<ServiceUsage[]> {
    const fetchers = [
        { service: "claude", run: getClaudeUsage },
        { service: "codex", run: getCodexUsage },
        { service: "zai", run: getZaiUsage },
        { service: "opencode-go", run: getOpencodeGoUsage },
        { service: "openrouter", run: getOpenRouterUsage },
        { service: "opencode-zen", run: getOpencodeZenUsage },
        { service: "crofai", run: getCrofaiUsage },
        { service: "cursor", run: getCursorUsage },
    ];

    const settled = await Promise.allSettled(fetchers.map((fetcher) => fetcher.run()));

    return settled.map((result, idx) => {
        const fetcher = fetchers[idx];

        if (result.status === "fulfilled") {
            return result.value;
        }

        const reason =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
        return {
            service: fetcher ? fetcher.service : "unknown",
            status: "error",
            error: "Failed to load usage",
            hint: reason.slice(0, 200),
        } satisfies ServiceUsage;
    });
}
