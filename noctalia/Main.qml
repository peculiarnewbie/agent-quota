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

    readonly property int refreshInterval: pluginApi?.pluginSettings?.refreshInterval ?? 300000
    readonly property bool autoRefreshEnabled: root.refreshInterval > 0
    readonly property int staleCacheMs: 180000
    readonly property var defaultBarDisplayItems: ["claude-5h", "codex-5h", "cursor"]
    readonly property var barDisplayItems: normalizedBarDisplayItems(
        pluginApi?.pluginSettings?.barDisplayItems,
        pluginApi?.pluginSettings?.showPercentInBar
    )
    readonly property string serverBaseUrl: normalizeBaseUrl(
        pluginApi?.pluginSettings?.serverBaseUrl
            || pluginApi?.manifest?.metadata?.defaultSettings?.serverBaseUrl
            || "http://127.0.0.1:6767"
    )
    readonly property var serviceSettings: ({
        "claude": pluginApi?.pluginSettings?.trackClaude ?? true,
        "codex": pluginApi?.pluginSettings?.trackCodex ?? true,
        "cursor": pluginApi?.pluginSettings?.trackCursor ?? true,
        "opencode": pluginApi?.pluginSettings?.trackOpencode ?? true
    })

    readonly property string pluginConfigDir: {
        var home = Quickshell.env("HOME") || "/tmp";
        return home + "/.config/noctalia/plugins/agent-quota";
    }
    readonly property string cachePath: pluginConfigDir + "/usage-cache.json"

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

    function normalizeBaseUrl(raw) {
        var url = String(raw || "").trim();
        if (!url) url = "http://127.0.0.1:6767";
        while (url.length > 0 && url.charAt(url.length - 1) === "/") {
            url = url.slice(0, -1);
        }
        return url;
    }

    function readFileText(path) {
        fileReader.path = "";
        fileReader.path = path;
        var t = fileReader.text();
        fileReader.path = "";
        return (t && t.length > 0) ? t : null;
    }

    function isCodexService(service) {
        return service === "codex" || String(service || "").indexOf("codex-") === 0;
    }

    function isOpencodeService(service) {
        return service === "opencode" || String(service || "").indexOf("opencode-") === 0;
    }

    function isUsageService(service) {
        return service === "claude"
            || service === "cursor"
            || isCodexService(service)
            || isOpencodeService(service);
    }

    function trackKeyForService(service) {
        if (service === "claude") return "claude";
        if (service === "cursor") return "cursor";
        if (isCodexService(service)) return "codex";
        if (isOpencodeService(service)) return "opencode";
        return "";
    }

    function isServiceEnabled(service) {
        var key = trackKeyForService(service);
        if (!key) return false;
        return serviceSettings[key] !== false;
    }

    function isValidBarDisplayItem(item) {
        return [
            "max",
            "claude-5h", "claude-7d",
            "codex-5h", "codex-7d",
            "cursor",
            "opencode"
        ].indexOf(item) !== -1;
    }

    function normalizedBarDisplayItems(rawItems, legacyVisible) {
        var items = [];
        if (Array.isArray(rawItems)) {
            items = rawItems.slice();
        } else if (typeof rawItems === "string" && rawItems.length > 0) {
            try {
                var parsed = JSON.parse(rawItems);
                if (Array.isArray(parsed)) items = parsed;
            } catch (e) {
            }
        } else {
            var showLegacy = legacyVisible;
            if (showLegacy === undefined || showLegacy === null) showLegacy = true;
            items = showLegacy ? defaultBarDisplayItems.slice() : [];
        }

        // Migrate removed v1 keys from older plugin settings.
        var migrated = [];
        for (var i = 0; i < items.length; i++) {
            var item = String(items[i] || "");
            if (item === "opencode-go") item = "opencode";
            if (item === "zai" || item === "openrouter") continue;
            migrated.push(item);
        }

        var seen = {};
        var normalized = [];
        for (var j = 0; j < migrated.length; j++) {
            var key = migrated[j];
            if (!isValidBarDisplayItem(key) || seen[key]) continue;
            seen[key] = true;
            normalized.push(key);
        }
        return normalized;
    }

    function filterEnabledServices(data) {
        var result = [];
        if (!Array.isArray(data)) return result;
        for (var i = 0; i < data.length; i++) {
            var item = data[i];
            if (!item || !item.service) continue;
            if (!isUsageService(item.service)) continue;
            if (!isServiceEnabled(item.service)) continue;
            result.push(item);
        }
        return result;
    }

    function httpGet(url, callback) {
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE) return;
            var status = xhr.status;
            var body = xhr.responseText || "";
            var parsed = null;
            try {
                parsed = JSON.parse(body);
            } catch (e) {
                parsed = body;
            }
            callback(status, parsed, body);
        };
        xhr.onerror = function() {
            callback(0, null, "");
        };
        xhr.open("GET", url);
        xhr.send();
    }

    function refreshUsage(force) {
        if (root.loading && !force) return;

        var base = root.serverBaseUrl;
        if (!base) {
            root.lastError = "Set serverBaseUrl in plugin settings";
            root.loading = false;
            root.usageError(root.lastError);
            return;
        }

        root.loading = true;
        var url = base + "/api/usage" + (force ? "?refresh=1" : "");

        httpGet(url, function(status, data, raw) {
            if (status === 200 && Array.isArray(data)) {
                var payload = { ok: true, fetchedAtMs: Date.now(), data: data };
                root.applyPayload(payload);
                root.writeCache(payload);
                return;
            }

            var msg;
            if (status === 0) {
                msg = "Could not reach " + base + " (is agent-quota running over VPN?)";
            } else if (typeof data === "object" && data && data.error) {
                msg = String(data.error);
            } else {
                msg = "HTTP " + status + " from " + url;
            }

            // Keep last good snapshot on soft failures when we already have data.
            if (root.usageData.length > 0) {
                root.lastError = msg;
                root.loading = false;
                root.usageError(msg);
                Logger.w("AgentQuota", msg);
                return;
            }

            root.applyPayload({ ok: false, error: msg });
        });
    }

    function loadCache() {
        var text = readFileText(cachePath);
        if (!text) {
            if (root.autoRefreshEnabled) {
                root.refreshUsage(true);
            }
            return;
        }

        try {
            var parsed = JSON.parse(text);
            if (parsed && parsed.ok && Array.isArray(parsed.data)) {
                parsed.data = root.filterEnabledServices(parsed.data);
                root.applyPayload(parsed);
                Logger.i("AgentQuota", "Loaded cached usage data");
                if (root.autoRefreshEnabled && root.shouldRefreshFromCache(parsed)) {
                    root.refreshUsage(true);
                }
                return;
            }
        } catch (e) {
            Logger.w("AgentQuota", "Cache parse error: " + e);
        }

        if (root.autoRefreshEnabled) {
            root.refreshUsage(true);
        }
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
            root.usageData = root.filterEnabledServices(payload.data);
            root.lastUpdated = new Date(root.payloadFetchedAtMs(payload));
            root.lastError = "";
            root.loading = false;
            root.usageUpdated(root.usageData);
            return;
        }

        var msg = payload?.error || "Usage fetch failed";
        root.lastError = msg;
        root.loading = false;
        root.usageError(msg);
        Logger.w("AgentQuota", msg);
    }

    Timer {
        id: refreshTimer
        interval: Math.max(1, root.refreshInterval)
        running: !!pluginApi && root.autoRefreshEnabled
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

    onServiceSettingsChanged: {
        if (!pluginApi) return;
        root.usageData = root.filterEnabledServices(root.usageData);
        root.usageUpdated(root.usageData);
    }

    onServerBaseUrlChanged: {
        if (!pluginApi || root.loading) return;
        root.refreshUsage(true);
    }

    Component.onCompleted: {
        Logger.i("AgentQuota", "Plugin main loaded (HTTP client → " + root.serverBaseUrl + ")");
        root.loadCache();
    }

    onPluginApiChanged: {
        if (pluginApi && root.usageData.length === 0 && !root.loading) {
            root.loadCache();
        }
    }
}
