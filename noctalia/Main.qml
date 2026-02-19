import QtQuick
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
    readonly property string runnerPath: pluginApi?.pluginDir ? pluginApi.pluginDir + "/usage-fetcher.mjs" : ""

    property string stdoutBuffer: ""
    property string stderrBuffer: ""
    property string cacheStdoutBuffer: ""
    property string cacheStderrBuffer: ""

    function normalizeError(err) {
        if (!err || err.trim() === "") return "Usage fetch failed";
        if (err.indexOf("bun: command not found") !== -1) return "Bun is not installed";
        if (err.indexOf("Cannot find module") !== -1) return "Usage runner missing";
        return err.trim();
    }

    function parseOutput(text) {
        if (!text || text.trim() === "") return null;

        var lines = text.trim().split("\n");
        for (var i = lines.length - 1; i >= 0; i--) {
            try {
                return JSON.parse(lines[i]);
            } catch (e) {
            }
        }

        try {
            return JSON.parse(text);
        } catch (e2) {
            return null;
        }
    }

    function fail(message) {
        var msg = normalizeError(message);
        root.lastError = msg;
        root.loading = false;
        root.usageError(msg);
        Logger.w("ClankerQuota", msg);
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
            root.usageData = payload.data;
            root.lastUpdated = new Date(root.payloadFetchedAtMs(payload));
            root.lastError = "";
            root.loading = false;
            root.usageUpdated(payload.data);
            return;
        }

        fail(payload?.error || "Usage fetch failed");
    }

    function loadCache() {
        if (!root.runnerPath) {
            Logger.w("ClankerQuota", "Cannot load cache: runner path unavailable");
            return false;
        }

        root.cacheStdoutBuffer = "";
        root.cacheStderrBuffer = "";
        cacheReadProcess.command = ["bun", root.runnerPath, "--read-cache"];
        cacheReadProcess.running = true;
        return true;
    }

    function refreshUsage(force) {
        if (root.loading && !force) return;
        if (!root.runnerPath) {
            fail("Plugin directory not available");
            return;
        }

        root.loading = true;
        root.stdoutBuffer = "";
        root.stderrBuffer = "";

        usageProcess.command = ["bun", root.runnerPath];
        usageProcess.running = true;
    }

    Process {
        id: usageProcess
        command: ["true"]

        stdout: StdioCollector {
            onStreamFinished: {
                root.stdoutBuffer = this.text;
            }
        }

        stderr: StdioCollector {
            onStreamFinished: {
                root.stderrBuffer = this.text;
            }
        }

        onExited: function(exitCode, exitStatus) {
            var payload = root.parseOutput(root.stdoutBuffer);

            if (payload) {
                root.applyPayload(payload);
                return;
            }

            if (exitCode === 0) {
                root.fail("Usage runner returned invalid output");
                return;
            }

            root.fail(root.stderrBuffer || root.stdoutBuffer || ("Usage runner exited with code " + exitCode));
        }
    }

    Process {
        id: cacheReadProcess
        command: ["true"]

        stdout: StdioCollector {
            onStreamFinished: {
                root.cacheStdoutBuffer = this.text;
            }
        }

        stderr: StdioCollector {
            onStreamFinished: {
                root.cacheStderrBuffer = this.text;
            }
        }

        onExited: function(exitCode, exitStatus) {
            var payload = root.parseOutput(root.cacheStdoutBuffer);
            var shouldRefresh = true;
            if (payload && payload.ok && Array.isArray(payload.data)) {
                root.applyPayload(payload);
                shouldRefresh = root.shouldRefreshFromCache(payload);
                Logger.i("ClankerQuota", "Loaded cached usage data");
            } else if (exitCode !== 0 || (root.cacheStderrBuffer || "").trim() !== "") {
                Logger.w("ClankerQuota", "Cache read failed: " + (root.cacheStderrBuffer || ("exit code " + exitCode)));
            }

            if (shouldRefresh && !root.loading) {
                root.refreshUsage(true);
            }
        }
    }

    Timer {
        id: refreshTimer
        interval: root.refreshInterval
        running: !!pluginApi
        repeat: true
        onTriggered: root.refreshUsage(false)
    }

    IpcHandler {
        target: "plugin:clanker-quota"

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
        Logger.i("ClankerQuota", "Plugin main loaded");
        root.loadCache();
    }

    onPluginApiChanged: {
        if (pluginApi && root.usageData.length === 0 && !root.loading) {
            root.loadCache();
        }
    }

    onRunnerPathChanged: {
        if (root.runnerPath && root.usageData.length === 0 && !root.loading) {
            root.loadCache();
        }
    }
}
