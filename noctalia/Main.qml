import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Services.UI

Item {
    id: root

    property var pluginApi: null

    property var usageData: []
    property bool loading: false
    property string lastError: ""
    property var lastUpdated: null

    signal usageUpdated(var data)
    signal usageError(string error)

    readonly property int refreshInterval: pluginApi?.pluginSettings?.refreshInterval || 300000
    readonly property int staleCacheMs: 180000

    readonly property string pluginConfigDir: {
        var home = Quickshell.env("HOME") || "/tmp";
        return home + "/.config/noctalia/plugins/agent-quota";
    }
    readonly property string cachePath: pluginConfigDir + "/usage-cache.json"
    readonly property string pluginEnvPath: pluginConfigDir + "/.env"

    property var pluginEnvVars: ({})

    // ── FileView for reading credential/config files ──

    FileView {
        id: fileReader
        blockLoading: true
        printErrors: false
    }

    FileView {
        id: cacheFile
        blockLoading: true
        printErrors: false
    }

    // ── File I/O helpers ──

    function readFileText(path) {
        fileReader.path = "";
        fileReader.path = path;
        var t = fileReader.text();
        fileReader.path = "";
        return (t && t.length > 0) ? t : null;
    }

    function readJsonFile(path) {
        var text = readFileText(path);
        if (!text) return null;
        try {
            var parsed = JSON.parse(text);
            return (parsed && typeof parsed === "object") ? parsed : null;
        } catch (e) {
            return null;
        }
    }

    // ── .env parser ──

    function parseDotEnv(content) {
        var env = {};
        var lines = content.split("\n");
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line.charAt(0) === "#") continue;
            var idx = line.indexOf("=");
            if (idx <= 0) continue;
            var key = line.slice(0, idx).trim();
            var value = line.slice(idx + 1).trim();
            if ((value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') ||
                (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")) {
                value = value.slice(1, -1);
            }
            env[key] = value;
        }
        return env;
    }

    function loadPluginEnv() {
        var content = readFileText(pluginEnvPath);
        if (!content) {
            pluginEnvVars = {};
            return;
        }
        pluginEnvVars = parseDotEnv(content);
    }

    // ── Environment / settings resolution ──

    function getEnvValue(name) {
        var v = Quickshell.env(name);
        if (v && v !== "") return v;
        if (pluginEnvVars[name]) return pluginEnvVars[name];
        if (pluginApi?.pluginSettings && pluginApi.pluginSettings[name])
            return pluginApi.pluginSettings[name];
        return "";
    }

    // ── Time formatting ──

    function formatDurationSeconds(totalSeconds) {
        if (totalSeconds <= 0) return "Now";
        var days = Math.floor(totalSeconds / 86400);
        var hours = Math.floor((totalSeconds % 86400) / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        if (days > 0) return days + "d " + hours + "h " + minutes + "m";
        if (hours > 0) return hours + "h " + minutes + "m";
        return minutes + "m";
    }

    function formatResetTime(isoTime) {
        if (!isoTime) return "N/A";
        try {
            var resetDt = new Date(isoTime);
            var deltaMs = resetDt.getTime() - Date.now();
            return formatDurationSeconds(Math.floor(deltaMs / 1000));
        } catch (e) {
            return String(isoTime).slice(0, 19);
        }
    }

    // ── HTTP helper ──

    function httpGet(url, headers, callback) {
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE) return;
            var status = xhr.status;
            var body = null;
            try {
                body = JSON.parse(xhr.responseText);
            } catch (e) {
                body = xhr.responseText;
            }
            callback(status, body);
        };
        xhr.open("GET", url);
        var keys = Object.keys(headers);
        for (var i = 0; i < keys.length; i++) {
            xhr.setRequestHeader(keys[i], headers[keys[i]]);
        }
        xhr.send();
    }

    // ── Credential resolvers ──

    function getClaudeCredentials() {
        var fromSettings = getEnvValue("CLAUDE_ACCESS_TOKEN");
        if (!fromSettings && pluginApi?.pluginSettings?.claudeAccessToken)
            fromSettings = pluginApi.pluginSettings.claudeAccessToken;
        if (fromSettings) return { accessToken: fromSettings, source: "settings/env" };

        var home = Quickshell.env("HOME") || "/tmp";
        var credPaths = [
            home + "/.claude/.credentials.json",
            home + "/.claude/credentials.json",
            home + "/.config/claude/credentials.json"
        ];
        for (var i = 0; i < credPaths.length; i++) {
            var creds = readJsonFile(credPaths[i]);
            if (!creds) continue;
            var token = null;
            if (creds.claudeAiOauth && creds.claudeAiOauth.accessToken)
                token = creds.claudeAiOauth.accessToken;
            else if (creds.accessToken)
                token = creds.accessToken;
            if (token) return { accessToken: token, source: credPaths[i] };
        }
        return null;
    }

    function getCodexCredentials() {
        var result = { source: "" };
        var envKey = getEnvValue("OPENAI_API_KEY");
        if (!envKey && pluginApi?.pluginSettings?.openAiApiKey)
            envKey = pluginApi.pluginSettings.openAiApiKey;
        if (envKey) {
            result.apiKey = envKey;
            result.source = "settings/env";
        }

        var home = Quickshell.env("HOME") || "/tmp";
        var authPaths = [
            home + "/.codex/auth.json",
            home + "/.config/codex/auth.json"
        ];
        for (var i = 0; i < authPaths.length; i++) {
            var auth = readJsonFile(authPaths[i]);
            if (!auth) continue;
            if (!result.apiKey && auth.OPENAI_API_KEY) result.apiKey = auth.OPENAI_API_KEY;
            if (auth.tokens && auth.tokens.access_token) result.accessToken = auth.tokens.access_token;
            if (auth.tokens && auth.tokens.account_id) result.accountId = auth.tokens.account_id;
            if (result.accessToken || result.apiKey) {
                result.source = authPaths[i];
                return result;
            }
        }

        var hasKeys = false;
        var rkeys = Object.keys(result);
        for (var j = 0; j < rkeys.length; j++) {
            if (rkeys[j] !== "source" && result[rkeys[j]]) hasKeys = true;
        }
        return hasKeys ? result : null;
    }

    function getZaiCredentials() {
        var fromSettings = getEnvValue("ZAI_API_KEY");
        if (!fromSettings && pluginApi?.pluginSettings?.zaiApiKey)
            fromSettings = pluginApi.pluginSettings.zaiApiKey;
        if (!fromSettings) fromSettings = getEnvValue("ZAI_KEY");
        if (!fromSettings) fromSettings = getEnvValue("ZHIPU_API_KEY");
        if (!fromSettings) fromSettings = getEnvValue("ZHIPUAI_API_KEY");
        if (fromSettings) return { apiKey: fromSettings, source: "settings/env" };

        var home = Quickshell.env("HOME") || "/tmp";
        var configPaths = [
            home + "/.zai/config.json",
            home + "/.config/zai/config.json"
        ];
        for (var i = 0; i < configPaths.length; i++) {
            var config = readJsonFile(configPaths[i]);
            if (!config) continue;
            if (config.apiKey || config.api_key) {
                return { apiKey: config.apiKey || config.api_key, source: configPaths[i] };
            }
        }
        return null;
    }

    function getOpenRouterCredentials() {
        var key = getEnvValue("OPENROUTER_API_KEY");
        if (!key && pluginApi?.pluginSettings?.openRouterApiKey)
            key = pluginApi.pluginSettings.openRouterApiKey;
        if (key) return { apiKey: key, source: "settings/env" };

        var home = Quickshell.env("HOME") || "/tmp";
        var configPaths = [
            home + "/.config/openrouter/config.json",
            home + "/.openrouter/config.json"
        ];
        for (var i = 0; i < configPaths.length; i++) {
            var config = readJsonFile(configPaths[i]);
            if (!config) continue;
            if (config.OPENROUTER_API_KEY || config.apiKey || config.api_key) {
                return {
                    apiKey: config.OPENROUTER_API_KEY || config.apiKey || config.api_key,
                    source: configPaths[i]
                };
            }
        }
        return null;
    }

    function getOpencodeZenCredentials() {
        var envKey = getEnvValue("OPENCODE_API_KEY");
        if (!envKey && pluginApi?.pluginSettings?.opencodeApiKey)
            envKey = pluginApi.pluginSettings.opencodeApiKey;
        if (envKey) return { apiKey: envKey, source: "settings/env" };

        var home = Quickshell.env("HOME") || "/tmp";
        var configPaths = [
            home + "/.config/opencode/config.json",
            home + "/.opencode/config.json"
        ];
        for (var i = 0; i < configPaths.length; i++) {
            var config = readJsonFile(configPaths[i]);
            if (!config) continue;
            if (config.OPENCODE_API_KEY || config.apiKey || config.api_key) {
                return {
                    apiKey: config.OPENCODE_API_KEY || config.apiKey || config.api_key,
                    source: configPaths[i]
                };
            }
        }
        return null;
    }

    // ── Usage fetchers ──

    function fetchClaudeUsage(callback) {
        var creds = getClaudeCredentials();
        if (!creds) {
            callback({
                service: "claude", status: "no_credentials",
                error: "No credentials found",
                hint: "Run 'claude' or add CLAUDE_ACCESS_TOKEN in plugin settings/.env"
            });
            return;
        }

        httpGet("https://api.anthropic.com/api/oauth/usage", {
            "Authorization": "Bearer " + creds.accessToken,
            "anthropic-beta": "oauth-2025-04-20",
            "Content-Type": "application/json"
        }, function(status, data) {
            if (status === 200 && typeof data === "object" && data) {
                var result = { service: "claude", status: "ok", source: creds.source };

                if (data.five_hour && typeof data.five_hour === "object") {
                    var util5 = typeof data.five_hour.utilization === "number" ? data.five_hour.utilization : 0;
                    var resets5 = data.five_hour.resets_at ? new Date(data.five_hour.resets_at).getTime() : 0;
                    result.fiveHour = {
                        used: util5.toFixed(1) + "%",
                        remaining: (100 - util5).toFixed(1) + "%",
                        resetsIn: formatResetTime(data.five_hour.resets_at),
                        resetsAtMs: resets5,
                        usedPercent: util5
                    };
                }

                if (data.seven_day && typeof data.seven_day === "object") {
                    var util7 = typeof data.seven_day.utilization === "number" ? data.seven_day.utilization : 0;
                    var resets7 = data.seven_day.resets_at ? new Date(data.seven_day.resets_at).getTime() : 0;
                    result.sevenDay = {
                        used: util7.toFixed(1) + "%",
                        remaining: (100 - util7).toFixed(1) + "%",
                        resetsIn: formatResetTime(data.seven_day.resets_at),
                        resetsAtMs: resets7,
                        usedPercent: util7
                    };
                }

                callback(result);
                return;
            }

            if (status === 401) {
                callback({
                    service: "claude", status: "error",
                    error: "Token expired",
                    hint: "Run 'claude' to re-authenticate",
                    source: creds.source
                });
                return;
            }

            callback({
                service: "claude", status: "error",
                error: "HTTP " + status,
                hint: String(data).slice(0, 200),
                source: creds.source
            });
        });
    }

    function fetchCodexUsage(callback) {
        var creds = getCodexCredentials();
        if (!creds || (!creds.accessToken && !creds.apiKey)) {
            callback({
                service: "codex", status: "no_credentials",
                error: "No credentials found",
                hint: "Run 'codex login' or add OPENAI_API_KEY in plugin settings/.env"
            });
            return;
        }

        if (creds.accessToken && creds.accountId) {
            httpGet("https://chatgpt.com/backend-api/wham/usage", {
                "Authorization": "Bearer " + creds.accessToken,
                "chatgpt-account-id": creds.accountId,
                "User-Agent": "codex-cli",
                "Content-Type": "application/json"
            }, function(status, data) {
                if (status === 200 && typeof data === "object" && data) {
                    var result = { service: "codex", status: "ok", source: creds.source };
                    if (data.plan_type) result.plan = String(data.plan_type);

                    if (data.rate_limit && typeof data.rate_limit === "object") {
                        var rl = data.rate_limit;
                        if (rl.primary_window && typeof rl.primary_window === "object") {
                            var usedPct = typeof rl.primary_window.used_percent === "number" ? rl.primary_window.used_percent : 0;
                            var resetSecs = typeof rl.primary_window.reset_after_seconds === "number" ? rl.primary_window.reset_after_seconds : 0;
                            result.fiveHour = {
                                used: usedPct + "%",
                                remaining: (100 - usedPct) + "%",
                                resetsIn: formatDurationSeconds(resetSecs),
                                resetsAtMs: Date.now() + resetSecs * 1000,
                                usedPercent: usedPct
                            };
                        }
                        if (rl.secondary_window && typeof rl.secondary_window === "object") {
                            var usedPct2 = typeof rl.secondary_window.used_percent === "number" ? rl.secondary_window.used_percent : 0;
                            var resetSecs2 = typeof rl.secondary_window.reset_after_seconds === "number" ? rl.secondary_window.reset_after_seconds : 0;
                            result.sevenDay = {
                                used: usedPct2 + "%",
                                remaining: (100 - usedPct2) + "%",
                                resetsIn: formatDurationSeconds(resetSecs2),
                                resetsAtMs: Date.now() + resetSecs2 * 1000,
                                usedPercent: usedPct2
                            };
                        }
                    }

                    callback(result);
                    return;
                }

                // OAuth failed, try API key fallback
                if (creds.apiKey) {
                    fetchCodexApiKeyFallback(creds, callback);
                    return;
                }

                callback({
                    service: "codex", status: "error",
                    error: "Authentication failed",
                    hint: "Run 'codex login' to re-authenticate",
                    source: creds.source
                });
            });
            return;
        }

        if (creds.apiKey) {
            fetchCodexApiKeyFallback(creds, callback);
            return;
        }

        callback({
            service: "codex", status: "error",
            error: "Authentication failed",
            hint: "Run 'codex login' to re-authenticate",
            source: creds.source
        });
    }

    function fetchCodexApiKeyFallback(creds, callback) {
        httpGet("https://api.openai.com/v1/models", {
            "Authorization": "Bearer " + creds.apiKey,
            "Content-Type": "application/json"
        }, function(status) {
            if (status === 200) {
                callback({
                    service: "codex", status: "ok",
                    source: creds.source,
                    hint: "API key valid - subscription quota requires OAuth login"
                });
                return;
            }
            callback({
                service: "codex", status: "error",
                error: "Authentication failed",
                hint: "Run 'codex login' to re-authenticate",
                source: creds.source
            });
        });
    }

    function fetchZaiUsage(callback) {
        var creds = getZaiCredentials();
        if (!creds) {
            callback({
                service: "zai", status: "no_credentials",
                error: "No credentials found",
                hint: "Add ZAI_API_KEY in plugin settings/.env or ~/.zai/config.json"
            });
            return;
        }

        httpGet("https://api.z.ai/api/monitor/usage/quota/limit", {
            "Authorization": creds.apiKey,
            "Content-Type": "application/json"
        }, function(status, data) {
            if (status === 200 && typeof data === "object" && data && data.success && data.data) {
                var result = { service: "zai", status: "ok", source: creds.source };
                var limits = Array.isArray(data.data.limits) ? data.data.limits : [];

                for (var i = 0; i < limits.length; i++) {
                    var limit = limits[i];
                    if (!limit || typeof limit !== "object") continue;
                    if (limit.type !== "TOKENS_LIMIT") continue;

                    var pct = typeof limit.percentage === "number" ? limit.percentage : 0;
                    var resetTs = typeof limit.nextResetTime === "number" ? limit.nextResetTime : 0;
                    var deltaSeconds = Math.floor((resetTs - Date.now()) / 1000);

                    result.fiveHour = {
                        used: pct + "%",
                        remaining: (100 - pct) + "%",
                        resetsIn: formatDurationSeconds(deltaSeconds),
                        resetsAtMs: resetTs,
                        usedPercent: pct
                    };
                }

                callback(result);
                return;
            }

            callback({
                service: "zai", status: "error",
                error: "HTTP " + status,
                hint: "Check https://z.ai/manage-apikey/billing",
                source: creds.source
            });
        });
    }

    function fetchOpenRouterUsage(callback) {
        var creds = getOpenRouterCredentials();
        if (!creds) {
            callback({
                service: "openrouter", status: "no_credentials",
                error: "No credentials found",
                hint: "Add OPENROUTER_API_KEY in plugin settings/.env"
            });
            return;
        }

        httpGet("https://openrouter.ai/api/v1/credits", {
            "Authorization": "Bearer " + creds.apiKey,
            "Content-Type": "application/json"
        }, function(status, data) {
            if (status === 200 && typeof data === "object" && data && data.data) {
                var totalCredits = typeof data.data.total_credits === "number" ? data.data.total_credits : 0;
                var totalUsage = typeof data.data.total_usage === "number" ? data.data.total_usage : 0;
                var remaining = totalCredits - totalUsage;
                var usedPercent = totalCredits > 0 ? (totalUsage / totalCredits) * 100 : 0;

                callback({
                    service: "openrouter", status: "ok",
                    source: creds.source,
                    fiveHour: {
                        used: "$" + totalUsage.toFixed(2),
                        remaining: "$" + remaining.toFixed(2),
                        resetsIn: "--",
                        resetsAtMs: 0,
                        usedPercent: usedPercent
                    }
                });
                return;
            }

            callback({
                service: "openrouter", status: "error",
                error: "HTTP " + status,
                hint: "Check https://openrouter.ai/keys",
                source: creds.source
            });
        });
    }

    function fetchOpencodeZenUsage(callback) {
        var creds = getOpencodeZenCredentials();
        if (!creds) {
            callback({
                service: "opencode-zen", status: "no_credentials",
                error: "No credentials found",
                hint: "Add OPENCODE_API_KEY in plugin settings/.env"
            });
            return;
        }

        httpGet("https://opencode.ai/zen/v1/balance", {
            "Authorization": "Bearer " + creds.apiKey,
            "Content-Type": "application/json"
        }, function(status, data) {
            if (status === 200 && typeof data === "object" && data) {
                var balance = typeof data.balance === "number" ? data.balance : 0;
                var currency = typeof data.currency === "string" ? data.currency : "USD";

                callback({
                    service: "opencode-zen", status: "ok",
                    source: creds.source,
                    fiveHour: {
                        used: "--",
                        remaining: currency + " " + balance.toFixed(2),
                        resetsIn: "--",
                        resetsAtMs: 0,
                        usedPercent: 0
                    }
                });
                return;
            }

            if (status === 404) {
                callback({
                    service: "opencode-zen", status: "error",
                    error: "Balance endpoint not available",
                    hint: "API may not support balance queries yet",
                    source: creds.source
                });
                return;
            }

            callback({
                service: "opencode-zen", status: "error",
                error: "HTTP " + status,
                hint: "Check https://opencode.ai/zen",
                source: creds.source
            });
        });
    }

    // ── Orchestration ──

    property int _pendingCount: 0
    property var _pendingResults: []

    function refreshUsage(force) {
        if (root.loading && !force) return;

        root.loading = true;
        root.loadPluginEnv();

        root._pendingResults = [];
        root._pendingCount = 5;

        var collect = function(result) {
            root._pendingResults.push(result);
            root._pendingCount--;
            if (root._pendingCount <= 0) {
                root.finishRefresh();
            }
        };

        fetchClaudeUsage(collect);
        fetchCodexUsage(collect);
        fetchZaiUsage(collect);
        fetchOpenRouterUsage(collect);
        fetchOpencodeZenUsage(collect);
    }

    function finishRefresh() {
        var data = root._pendingResults;

        // Sort by service name for consistent ordering
        data.sort(function(a, b) {
            if (a.service < b.service) return -1;
            if (a.service > b.service) return 1;
            return 0;
        });

        var payload = { ok: true, fetchedAtMs: Date.now(), data: data };
        root.applyPayload(payload);
        root.writeCache(payload);
    }

    // ── Cache ──

    function loadCache() {
        var text = readFileText(cachePath);
        if (!text) {
            root.refreshUsage(true);
            return;
        }

        try {
            var parsed = JSON.parse(text);
            if (parsed && parsed.ok && Array.isArray(parsed.data)) {
                root.applyPayload(parsed);
                Logger.i("AgentQuota", "Loaded cached usage data");
                if (root.shouldRefreshFromCache(parsed)) {
                    root.refreshUsage(true);
                }
                return;
            }
        } catch (e) {
            Logger.w("AgentQuota", "Cache parse error: " + e);
        }

        root.refreshUsage(true);
    }

    function writeCache(payload) {
        try {
            cacheFile.path = "";
            cacheFile.path = cachePath;
            cacheFile.setText(JSON.stringify(payload));
            cacheFile.path = "";
        } catch (e) {
            Logger.w("AgentQuota", "Cache write failed: " + e);
        }
    }

    // ── Payload handling (unchanged) ──

    function payloadFetchedAtMs(payload) {
        var fetchedAtMs = Number(payload?.fetchedAtMs || 0);
        if (fetchedAtMs > 0) return fetchedAtMs;
        return Date.now();
    }

    function shouldRefreshFromCache(payload) {
        var fetchedAtMs = Number(payload?.fetchedAtMs || 0);
        if (fetchedAtMs <= 0) return true;
        return (Date.now() - fetchedAtMs) >= root.staleCacheMs;
    }

    function applyPayload(payload) {
        if (payload && payload.ok && Array.isArray(payload.data)) {
            root.usageData = payload.data;
            root.lastUpdated = new Date(root.payloadFetchedAtMs(payload));
            root.lastError = "";
            root.loading = false;
            root.usageUpdated(payload.data);
            return;
        }

        var msg = payload?.error || "Usage fetch failed";
        root.lastError = msg;
        root.loading = false;
        root.usageError(msg);
        Logger.w("AgentQuota", msg);
    }

    // ── Timer & IPC (unchanged) ──

    Timer {
        id: refreshTimer
        interval: root.refreshInterval
        running: !!pluginApi
        repeat: true
        onTriggered: root.refreshUsage(false)
    }

    IpcHandler {
        target: "plugin:agent-quota"

        function refresh() {
            root.refreshUsage(true);
            ToastService.showNotice("Refreshing API usage...");
        }

        function toggle() {
            if (!pluginApi) return;
            pluginApi.withCurrentScreen(function(screen) {
                pluginApi.togglePanel(screen);
            });
        }
    }

    onRefreshIntervalChanged: {
        refreshTimer.interval = root.refreshInterval;
    }

    Component.onCompleted: {
        Logger.i("AgentQuota", "Plugin main loaded");
        root.loadCache();
    }

    onPluginApiChanged: {
        if (pluginApi && root.usageData.length === 0 && !root.loading) {
            root.loadCache();
        }
    }
}
