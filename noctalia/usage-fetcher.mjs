import { existsSync, readFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const PLUGIN_SETTINGS_PATH = join(
    HOME,
    ".config",
    "noctalia",
    "plugins",
    "ai-quota",
    "settings.json",
);
const PLUGIN_ENV_PATH = join(HOME, ".config", "noctalia", "plugins", "ai-quota", ".env");

function parseDotEnv(content) {
    const env = {};
    for (const rawLine of content.split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const idx = line.indexOf("=");
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
    return env;
}

function loadPluginEnv() {
    if (!existsSync(PLUGIN_ENV_PATH)) return {};
    try {
        const content = readFileSync(PLUGIN_ENV_PATH, "utf-8");
        return parseDotEnv(content);
    } catch {
        return {};
    }
}

function loadPluginSettings() {
    if (!existsSync(PLUGIN_SETTINGS_PATH)) return {};
    try {
        const parsed = JSON.parse(readFileSync(PLUGIN_SETTINGS_PATH, "utf-8"));
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

const pluginEnv = loadPluginEnv();
const pluginSettings = loadPluginSettings();

function getEnv(name, fallback = "") {
    if (process.env[name]) return process.env[name];
    if (pluginEnv[name]) return pluginEnv[name];
    if (pluginSettings[name]) return pluginSettings[name];
    return fallback;
}

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
        const deltaMs = resetDt.getTime() - Date.now();
        return formatDurationSeconds(Math.floor(deltaMs / 1000));
    } catch {
        return String(isoTime).slice(0, 19);
    }
}

async function httpGet(url, headers) {
    try {
        const response = await fetch(url, { headers });
        const text = await response.text();
        try {
            return [response.status, JSON.parse(text)];
        } catch {
            return [response.status, text];
        }
    } catch (e) {
        return [0, String(e)];
    }
}

function readJsonIfExists(path) {
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
        return null;
    }
}

function getClaudeCredentials() {
    const fromSettings = getEnv("CLAUDE_ACCESS_TOKEN") || pluginSettings.claudeAccessToken;
    if (fromSettings) return { accessToken: fromSettings, source: "settings/env" };

    const credPaths = [
        join(HOME, ".claude", ".credentials.json"),
        join(HOME, ".claude", "credentials.json"),
        join(HOME, ".config", "claude", "credentials.json"),
    ];

    for (const credPath of credPaths) {
        const creds = readJsonIfExists(credPath);
        if (!creds) continue;
        const token = creds?.claudeAiOauth?.accessToken || creds?.accessToken;
        if (token) return { accessToken: token, source: credPath };
    }

    return null;
}

function getCodexCredentials() {
    const result = { source: "" };
    const envKey = getEnv("OPENAI_API_KEY") || pluginSettings.openAiApiKey;
    if (envKey) {
        result.apiKey = envKey;
        result.source = "settings/env";
    }

    const authPaths = [
        join(HOME, ".codex", "auth.json"),
        join(HOME, ".config", "codex", "auth.json"),
    ];
    for (const authPath of authPaths) {
        const auth = readJsonIfExists(authPath);
        if (!auth) continue;
        if (!result.apiKey && auth.OPENAI_API_KEY) result.apiKey = auth.OPENAI_API_KEY;
        if (auth.tokens?.access_token) result.accessToken = auth.tokens.access_token;
        if (auth.tokens?.account_id) result.accountId = auth.tokens.account_id;
        if (result.accessToken || result.apiKey) {
            result.source = authPath;
            return result;
        }
    }

    return Object.keys(result).some((k) => k !== "source" && result[k]) ? result : null;
}

function getZaiCredentials() {
    const fromSettings =
        getEnv("ZAI_API_KEY") ||
        pluginSettings.zaiApiKey ||
        getEnv("ZAI_KEY") ||
        getEnv("ZHIPU_API_KEY") ||
        getEnv("ZHIPUAI_API_KEY");
    if (fromSettings) return { apiKey: fromSettings, source: "settings/env" };

    const configPaths = [
        join(HOME, ".zai", "config.json"),
        join(HOME, ".config", "zai", "config.json"),
    ];
    for (const configPath of configPaths) {
        const config = readJsonIfExists(configPath);
        if (!config) continue;
        if (config.apiKey || config.api_key) {
            return { apiKey: config.apiKey || config.api_key, source: configPath };
        }
    }

    return null;
}

function getOpenRouterCredentials() {
    const key = getEnv("OPENROUTER_API_KEY") || pluginSettings.openRouterApiKey;
    if (key) return { apiKey: key, source: "settings/env" };

    const configPaths = [
        join(HOME, ".config", "openrouter", "config.json"),
        join(HOME, ".openrouter", "config.json"),
    ];
    for (const configPath of configPaths) {
        const config = readJsonIfExists(configPath);
        if (!config) continue;
        if (config.OPENROUTER_API_KEY || config.apiKey || config.api_key) {
            return {
                apiKey: config.OPENROUTER_API_KEY || config.apiKey || config.api_key,
                source: configPath,
            };
        }
    }

    return null;
}

function getOpencodeZenCredentials() {
    const envKey = getEnv("OPENCODE_API_KEY") || pluginSettings.opencodeApiKey;
    if (envKey) return { apiKey: envKey, source: "settings/env" };

    const configPaths = [
        join(HOME, ".config", "opencode", "config.json"),
        join(HOME, ".opencode", "config.json"),
    ];
    for (const configPath of configPaths) {
        const config = readJsonIfExists(configPath);
        if (!config) continue;
        if (config.OPENCODE_API_KEY || config.apiKey || config.api_key) {
            return {
                apiKey: config.OPENCODE_API_KEY || config.apiKey || config.api_key,
                source: configPath,
            };
        }
    }

    return null;
}

async function getClaudeUsage() {
    const creds = getClaudeCredentials();
    if (!creds) {
        const claudePaths = [
            join(HOME, ".claude", ".credentials.json"),
            join(HOME, ".claude", "credentials.json"),
            join(HOME, ".config", "claude", "credentials.json"),
        ];
        return {
            service: "claude",
            status: "no_credentials",
            error: "No credentials found",
            hint: "Run 'claude' or add CLAUDE_ACCESS_TOKEN in plugin settings/.env",
        };
    }

    const [status, data] = await httpGet("https://api.anthropic.com/api/oauth/usage", {
        Authorization: `Bearer ${creds.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
    });

    if (status === 200 && typeof data === "object" && data) {
        const d = data;
        const result = { service: "claude", status: "ok", source: creds.source };

        if (d.five_hour && typeof d.five_hour === "object") {
            const util = typeof d.five_hour.utilization === "number" ? d.five_hour.utilization : 0;
            const resetsAtMs = d.five_hour.resets_at
                ? new Date(d.five_hour.resets_at).getTime()
                : 0;
            result.fiveHour = {
                used: `${util.toFixed(1)}%`,
                remaining: `${(100 - util).toFixed(1)}%`,
                resetsIn: formatResetTime(d.five_hour.resets_at),
                resetsAtMs,
                usedPercent: util,
            };
        }

        if (d.seven_day && typeof d.seven_day === "object") {
            const util = typeof d.seven_day.utilization === "number" ? d.seven_day.utilization : 0;
            const resetsAtMs = d.seven_day.resets_at
                ? new Date(d.seven_day.resets_at).getTime()
                : 0;
            result.sevenDay = {
                used: `${util.toFixed(1)}%`,
                remaining: `${(100 - util).toFixed(1)}%`,
                resetsIn: formatResetTime(d.seven_day.resets_at),
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

async function getCodexUsage() {
    const creds = getCodexCredentials();
    if (!creds || (!creds.accessToken && !creds.apiKey)) {
        const codexPaths = [
            join(HOME, ".codex", "auth.json"),
            join(HOME, ".config", "codex", "auth.json"),
        ];
        return {
            service: "codex",
            status: "no_credentials",
            error: "No credentials found",
            hint: "Run 'codex login' or add OPENAI_API_KEY in plugin settings/.env",
        };
    }

    if (creds.accessToken && creds.accountId) {
        const [status, data] = await httpGet("https://chatgpt.com/backend-api/wham/usage", {
            Authorization: `Bearer ${creds.accessToken}`,
            "chatgpt-account-id": creds.accountId,
            "User-Agent": "codex-cli",
            "Content-Type": "application/json",
        });

        if (status === 200 && typeof data === "object" && data) {
            const result = {
                service: "codex",
                status: "ok",
                source: creds.source,
            };

            if (data.plan_type) result.plan = String(data.plan_type);

            if (data.rate_limit && typeof data.rate_limit === "object") {
                const rl = data.rate_limit;

                if (rl.primary_window && typeof rl.primary_window === "object") {
                    const usedPct =
                        typeof rl.primary_window.used_percent === "number"
                            ? rl.primary_window.used_percent
                            : 0;
                    const resetSecs =
                        typeof rl.primary_window.reset_after_seconds === "number"
                            ? rl.primary_window.reset_after_seconds
                            : 0;
                    result.fiveHour = {
                        used: `${usedPct}%`,
                        remaining: `${100 - usedPct}%`,
                        resetsIn: formatDurationSeconds(resetSecs),
                        resetsAtMs: Date.now() + resetSecs * 1000,
                        usedPercent: usedPct,
                    };
                }

                if (rl.secondary_window && typeof rl.secondary_window === "object") {
                    const usedPct =
                        typeof rl.secondary_window.used_percent === "number"
                            ? rl.secondary_window.used_percent
                            : 0;
                    const resetSecs =
                        typeof rl.secondary_window.reset_after_seconds === "number"
                            ? rl.secondary_window.reset_after_seconds
                            : 0;
                    result.sevenDay = {
                        used: `${usedPct}%`,
                        remaining: `${100 - usedPct}%`,
                        resetsIn: formatDurationSeconds(resetSecs),
                        resetsAtMs: Date.now() + resetSecs * 1000,
                        usedPercent: usedPct,
                    };
                }
            }

            return result;
        }
    }

    if (creds.apiKey) {
        const [status] = await httpGet("https://api.openai.com/v1/models", {
            Authorization: `Bearer ${creds.apiKey}`,
            "Content-Type": "application/json",
        });

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

async function getZaiUsage() {
    const creds = getZaiCredentials();
    if (!creds) {
        const zaiPaths = [
            join(HOME, ".zai", "config.json"),
            join(HOME, ".config", "zai", "config.json"),
        ];
        return {
            service: "zai",
            status: "no_credentials",
            error: "No credentials found",
            hint: "Add ZAI_API_KEY in plugin settings/.env or ~/.zai/config.json",
        };
    }

    const [status, data] = await httpGet("https://api.z.ai/api/monitor/usage/quota/limit", {
        Authorization: creds.apiKey,
        "Content-Type": "application/json",
    });

    if (status === 200 && typeof data === "object" && data?.success && data?.data) {
        const result = { service: "zai", status: "ok", source: creds.source };
        const limits = Array.isArray(data.data.limits) ? data.data.limits : [];

        for (const limit of limits) {
            if (!limit || typeof limit !== "object") continue;
            if (limit.type !== "TOKENS_LIMIT") continue;

            const pct = typeof limit.percentage === "number" ? limit.percentage : 0;
            const resetTs = typeof limit.nextResetTime === "number" ? limit.nextResetTime : 0;
            const deltaSeconds = Math.floor((resetTs - Date.now()) / 1000);

            result.fiveHour = {
                used: `${pct}%`,
                remaining: `${100 - pct}%`,
                resetsIn: formatDurationSeconds(deltaSeconds),
                resetsAtMs: resetTs,
                usedPercent: pct,
            };
        }

        return result;
    }

    return {
        service: "zai",
        status: "error",
        error: `HTTP ${status}`,
        hint: "Check https://z.ai/manage-apikey/billing",
        source: creds.source,
    };
}

async function getOpenRouterUsage() {
    const creds = getOpenRouterCredentials();
    if (!creds) {
        const openRouterPaths = [
            join(HOME, ".config", "openrouter", "config.json"),
            join(HOME, ".openrouter", "config.json"),
        ];
        return {
            service: "openrouter",
            status: "no_credentials",
            error: "No credentials found",
            hint: "Add OPENROUTER_API_KEY in plugin settings/.env",
        };
    }

    const [status, data] = await httpGet("https://openrouter.ai/api/v1/credits", {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
    });

    if (status === 200 && typeof data === "object" && data?.data) {
        const totalCredits =
            typeof data.data.total_credits === "number" ? data.data.total_credits : 0;
        const totalUsage = typeof data.data.total_usage === "number" ? data.data.total_usage : 0;
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

    return {
        service: "openrouter",
        status: "error",
        error: `HTTP ${status}`,
        hint: "Check https://openrouter.ai/keys",
        source: creds.source,
    };
}

async function getOpencodeZenUsage() {
    const creds = getOpencodeZenCredentials();
    if (!creds) {
        const opencodePaths = [
            join(HOME, ".config", "opencode", "config.json"),
            join(HOME, ".opencode", "config.json"),
        ];
        return {
            service: "opencode-zen",
            status: "no_credentials",
            error: "No credentials found",
            hint: "Add OPENCODE_API_KEY in plugin settings/.env",
        };
    }

    const [status, data] = await httpGet("https://opencode.ai/zen/v1/balance", {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
    });

    if (status === 200 && typeof data === "object" && data) {
        const balance = typeof data.balance === "number" ? data.balance : 0;
        const currency = typeof data.currency === "string" ? data.currency : "USD";

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

async function getAllUsage() {
    return Promise.all([
        getClaudeUsage(),
        getCodexUsage(),
        getZaiUsage(),
        getOpenRouterUsage(),
        getOpencodeZenUsage(),
    ]);
}

const CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(HOME, ".cache"), "agent-quota");
const CACHE_PATH = join(CACHE_DIR, "usage-cache.json");

async function main() {
    // --read-cache: output cached data and exit
    if (process.argv.includes("--read-cache")) {
        try {
            if (existsSync(CACHE_PATH)) {
                const raw = readFileSync(CACHE_PATH, "utf-8");
                try {
                    const parsed = JSON.parse(raw);
                    if (
                        parsed &&
                        typeof parsed === "object" &&
                        parsed.ok &&
                        Array.isArray(parsed.data)
                    ) {
                        if (typeof parsed.fetchedAtMs !== "number" || parsed.fetchedAtMs <= 0) {
                            parsed.fetchedAtMs = Math.floor(statSync(CACHE_PATH).mtimeMs);
                        }
                        process.stdout.write(`${JSON.stringify(parsed)}\n`);
                        return;
                    }
                } catch {}
                process.stdout.write(raw);
            }
        } catch {}
        return;
    }

    try {
        const data = await getAllUsage();
        const output = JSON.stringify({ ok: true, fetchedAtMs: Date.now(), data });
        process.stdout.write(`${output}\n`);

        // Write cache
        try {
            mkdirSync(CACHE_DIR, { recursive: true });
            writeFileSync(CACHE_PATH, output + "\n");
        } catch {}
    } catch (e) {
        process.stdout.write(`${JSON.stringify({ ok: false, error: String(e) })}\n`);
    }
}

await main();
