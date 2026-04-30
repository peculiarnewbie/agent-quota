import {
  getClaudeCredentials,
  getCodexCredentials,
  getZaiCredentials,
  getOpenRouterCredentials,
  getOpencodeGoCredentials,
  getOpencodeZenCredentials,
  getCrofAICredentials,
} from "./credentials.js";

const DEFAULT_HTTP_TIMEOUT_MS = 8000;
const parsedHttpTimeoutMs = Number(process.env.USAGE_HTTP_TIMEOUT_MS);
const HTTP_TIMEOUT_MS =
  Number.isFinite(parsedHttpTimeoutMs) && parsedHttpTimeoutMs > 0
    ? parsedHttpTimeoutMs
    : DEFAULT_HTTP_TIMEOUT_MS;

const OPENCODE_GO_RE_MONTHLY_PCT_FIRST =
  /monthlyUsage:\$R\[\d+\]=\{[^}]*usagePercent:(\d+)[^}]*resetInSec:(\d+)[^}]*\}/;
const OPENCODE_GO_RE_MONTHLY_RESET_FIRST =
  /monthlyUsage:\$R\[\d+\]=\{[^}]*resetInSec:(\d+)[^}]*usagePercent:(\d+)[^}]*\}/;
const OPENCODE_GO_USAGE_SENTINEL = "Use your available balance";

function formatDurationSeconds(totalSeconds) {
  if (totalSeconds <= 0) return "Now";

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatResetTime(isoTime) {
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

async function httpGet(url, headers) {
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

function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDurationSeconds(value) {
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

function parseOpencodeGoUsageTextWindow(text, label) {
  const start = text.indexOf(label);
  if (start < 0) return null;

  const nextLabels = [
    "Rolling Usage",
    "Weekly Usage",
    "Monthly Usage",
    OPENCODE_GO_USAGE_SENTINEL,
  ];
  let end = text.length;

  for (const nextLabel of nextLabels) {
    if (nextLabel === label) continue;
    const nextIndex = text.indexOf(nextLabel, start + label.length);
    if (nextIndex >= 0 && nextIndex < end) end = nextIndex;
  }

  const section = text.slice(start, end);
  const percentMatch = section.match(/(\d{1,3})\s*%/i);
  const resetIndex = section.search(/Resets in/i);
  if (!percentMatch || resetIndex < 0) return null;

  const usagePercent = Number(percentMatch[1]);
  const resetInSec = parseDurationSeconds(section.slice(resetIndex + "Resets in".length));
  if (!Number.isFinite(usagePercent) || resetInSec === null) return null;

  return { usagePercent, resetInSec };
}

function parseOpencodeGoUsageWindows(html) {
  const text = htmlToText(html);

  return {
    rolling: parseOpencodeGoUsageTextWindow(text, "Rolling Usage") ?? undefined,
    weekly: parseOpencodeGoUsageTextWindow(text, "Weekly Usage") ?? undefined,
    monthly: parseOpencodeGoUsageTextWindow(text, "Monthly Usage") ?? undefined,
  };
}

function parseOpencodeGoMonthlyUsage(html) {
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

  return parseOpencodeGoUsageWindows(html).monthly ?? null;
}

function buildUsageWindow(label, usagePercent, resetInSec) {
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

function sanitizeHint(data) {
  return String(data).replace(/\s+/g, " ").trim().slice(0, 200);
}

export async function getClaudeUsage() {
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

  if (status === 200 && typeof data === "object" && data !== null) {
    const d = data;
    const result = {
      service: "claude",
      status: "ok",
      source: creds.source,
    };

    if (d.five_hour && typeof d.five_hour === "object") {
      const fh = d.five_hour;
      const util = typeof fh.utilization === "number" ? fh.utilization : 0;
      const resetsAtMs = fh.resets_at ? new Date(fh.resets_at).getTime() : 0;
      result.fiveHour = {
        used: `${util.toFixed(1)}%`,
        remaining: `${(100 - util).toFixed(1)}%`,
        resetsIn: formatResetTime(fh.resets_at),
        resetsAtMs,
        usedPercent: util,
      };
    }

    if (d.seven_day && typeof d.seven_day === "object") {
      const sd = d.seven_day;
      const util = typeof sd.utilization === "number" ? sd.utilization : 0;
      const resetsAtMs = sd.resets_at ? new Date(sd.resets_at).getTime() : 0;
      result.sevenDay = {
        used: `${util.toFixed(1)}%`,
        remaining: `${(100 - util).toFixed(1)}%`,
        resetsIn: formatResetTime(sd.resets_at),
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

export async function getCodexUsage() {
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
      const d = data;
      const result = {
        service: "codex",
        status: "ok",
        source: creds.source,
      };

      if (d.plan_type) {
        result.plan = String(d.plan_type);
      }

      if (d.rate_limit && typeof d.rate_limit === "object") {
        const rl = d.rate_limit;

        if (rl.primary_window && typeof rl.primary_window === "object") {
          const pw = rl.primary_window;
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
          const sw = rl.secondary_window;
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

export async function getZaiUsage() {
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
    const d = data;

    if (d.success && d.data && typeof d.data === "object") {
      const dd = d.data;
      const limits = Array.isArray(dd.limits) ? dd.limits : [];
      const result = {
        service: "zai",
        status: "ok",
        source: creds.source,
      };

      for (const limit of limits) {
        if (typeof limit !== "object" || limit === null) continue;
        const l = limit;

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

export async function getOpenRouterUsage() {
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
    const d = data;

    if (d.data && typeof d.data === "object") {
      const dd = d.data;
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

export async function getOpencodeGoUsage() {
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

export async function getOpencodeZenUsage() {
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
    const d = data;
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

function secondsUntilMidnight() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
}

export async function getCrofAIUsage() {
  const creds = getCrofAICredentials();

  if (!creds) {
    return {
      service: "crof-ai",
      status: "no_credentials",
      error: "No credentials found",
      hint: "Set CROF_AI_API_KEY and optionally CROF_AI_DAILY_LIMIT",
    };
  }

  const headers = {
    Authorization: `Bearer ${creds.apiKey}`,
    "Content-Type": "application/json",
  };

  const [status, data] = await httpGet("https://crof.ai/usage_api/", headers);

  if (status === 200 && typeof data === "object" && data !== null) {
    const d = data;
    const usableRequests = typeof d.usable_requests === "number" ? d.usable_requests : null;
    const credits = typeof d.credits === "number" ? d.credits : 0;

    const result = {
      service: "crof-ai",
      status: "ok",
      source: creds.source,
    };

    if (usableRequests !== null && creds.dailyLimit > 0) {
      const used = creds.dailyLimit - usableRequests;
      const usedPercent = Math.max(0, Math.min(100, (used / creds.dailyLimit) * 100));
      const resetSecs = secondsUntilMidnight();

      result.daily = {
        label: "daily",
        used: `${used}`,
        remaining: `${usableRequests}`,
        resetsIn: formatDurationSeconds(resetSecs),
        resetsAtMs: Date.now() + resetSecs * 1000,
        usedPercent,
      };
    } else if (usableRequests !== null) {
      result.daily = {
        label: "daily",
        used: "--",
        remaining: `${usableRequests}`,
        resetsIn: "--",
        resetsAtMs: 0,
        usedPercent: 0,
      };
      result.hint = "Set CROF_AI_DAILY_LIMIT to show usage percentage";
    } else {
      result.daily = {
        label: "daily",
        used: "--",
        remaining: credits > 0 ? `${credits.toFixed(4)} credits` : "--",
        resetsIn: "--",
        resetsAtMs: 0,
        usedPercent: 0,
      };
    }

    return result;
  }

  return {
    service: "crof-ai",
    status: "error",
    error: `HTTP ${status}`,
    hint: String(data).slice(0, 200),
    source: creds.source,
  };
}

export async function getAllUsage() {
  const fetchers = [
    { service: "claude", run: getClaudeUsage },
    { service: "codex", run: getCodexUsage },
    { service: "zai", run: getZaiUsage },
    { service: "opencode-go", run: getOpencodeGoUsage },
    { service: "openrouter", run: getOpenRouterUsage },
    { service: "opencode-zen", run: getOpencodeZenUsage },
    { service: "crof-ai", run: getCrofAIUsage },
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
    };
  });
}
