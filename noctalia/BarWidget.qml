import QtQuick
import QtQuick.Layouts
import Quickshell
import qs.Commons
import qs.Widgets
import qs.Services.UI

Item {
    id: root

    property var pluginApi: null
    property ShellScreen screen
    property string widgetId: ""
    property string section: ""

    readonly property string screenName: screen?.name ?? ""
    readonly property string barPosition: Settings.getBarPositionForScreen(screenName)
    readonly property bool isBarVertical: barPosition === "left" || barPosition === "right"
    readonly property real capsuleHeight: Style.getCapsuleHeightForScreen(screenName)
    readonly property real barFontSize: Style.getBarFontSizeForScreen(screenName)

    property var usageData: []
    property bool loading: false
    property string lastError: ""
    property var lastUpdated: null
    readonly property var defaultBarDisplayItems: ["claude-5h", "codex-5h", "cursor"]
    readonly property var barDisplayItems: pluginApi?.mainInstance?.barDisplayItems ?? root.normalizedBarDisplayItems(pluginApi?.pluginSettings?.barDisplayItems)

    readonly property real contentWidth: row.implicitWidth + Style.marginM * 2
    readonly property real contentHeight: capsuleHeight

    implicitWidth: contentWidth
    implicitHeight: contentHeight

    function isCodexService(service) {
        return service === "codex" || String(service || "").indexOf("codex-") === 0;
    }

    function isOpencodeService(service) {
        return service === "opencode" || String(service || "").indexOf("opencode-") === 0;
    }

    function isUsageTrackingService(service) {
        return service === "claude"
            || service === "cursor"
            || isCodexService(service)
            || isOpencodeService(service);
    }

    function isValidBarDisplayItem(item) {
        return ["max", "claude-5h", "claude-7d", "codex-5h", "codex-7d", "cursor", "opencode"].indexOf(item) !== -1;
    }

    function normalizedBarDisplayItems(rawItems) {
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
            var showLegacy = pluginApi?.pluginSettings?.showPercentInBar;
            if (showLegacy === undefined || showLegacy === null) showLegacy = true;
            items = showLegacy ? defaultBarDisplayItems.slice() : [];
        }

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

    function usageByService(service) {
        for (var i = 0; i < usageData.length; i++) {
            var item = usageData[i];
            if (item && item.service === service && item.status === "ok") {
                return item;
            }
        }
        return null;
    }

    function maxPercentForMatcher(matcher, windowKey) {
        var max = null;
        for (var i = 0; i < usageData.length; i++) {
            var item = usageData[i];
            if (!item || item.status !== "ok" || !matcher(item.service)) continue;
            var win = item[windowKey];
            if (typeof win?.usedPercent === "number") {
                if (max === null || win.usedPercent > max) max = win.usedPercent;
            }
        }
        return max;
    }

    function percentForItem(itemId) {
        var usage;
        if (itemId === "max") return getMaxUsage();
        if (itemId === "claude-5h") {
            usage = usageByService("claude");
            return typeof usage?.fiveHour?.usedPercent === "number" ? usage.fiveHour.usedPercent : null;
        }
        if (itemId === "claude-7d") {
            usage = usageByService("claude");
            return typeof usage?.sevenDay?.usedPercent === "number" ? usage.sevenDay.usedPercent : null;
        }
        if (itemId === "codex-5h") {
            // Prefer primary "codex"; fall back to max across all Codex accounts.
            usage = usageByService("codex");
            if (typeof usage?.fiveHour?.usedPercent === "number") return usage.fiveHour.usedPercent;
            return maxPercentForMatcher(isCodexService, "fiveHour");
        }
        if (itemId === "codex-7d") {
            usage = usageByService("codex");
            if (typeof usage?.sevenDay?.usedPercent === "number") return usage.sevenDay.usedPercent;
            return maxPercentForMatcher(isCodexService, "sevenDay");
        }
        if (itemId === "cursor") {
            usage = usageByService("cursor");
            if (typeof usage?.fiveHour?.usedPercent === "number") return usage.fiveHour.usedPercent;
            if (typeof usage?.sevenDay?.usedPercent === "number") return usage.sevenDay.usedPercent;
            return typeof usage?.monthly?.usedPercent === "number" ? usage.monthly.usedPercent : null;
        }
        if (itemId === "opencode") {
            usage = usageByService("opencode");
            if (typeof usage?.fiveHour?.usedPercent === "number") return usage.fiveHour.usedPercent;
            if (typeof usage?.monthly?.usedPercent === "number") return usage.monthly.usedPercent;
            var rolling = maxPercentForMatcher(isOpencodeService, "fiveHour");
            if (rolling !== null) return rolling;
            return maxPercentForMatcher(isOpencodeService, "monthly");
        }
        return null;
    }

    function barSegments() {
        var segments = [];
        for (var i = 0; i < barDisplayItems.length; i++) {
            var itemId = barDisplayItems[i];
            var pct = percentForItem(itemId);
            if (typeof pct !== "number") continue;
            segments.push({
                id: itemId,
                percent: pct
            });
        }
        return segments;
    }

    function visibleBarMaxUsage() {
        var segments = barSegments();
        var max = 0;
        for (var i = 0; i < segments.length; i++) {
            if (segments[i].percent > max) max = segments[i].percent;
        }
        return max;
    }

    function getMaxUsage() {
        var max = 0;
        for (var i = 0; i < usageData.length; i++) {
            var u = usageData[i];
            if (u.status === "ok" && isUsageTrackingService(u.service)) {
                var fiveHourPct = typeof u.fiveHour?.usedPercent === "number" ? u.fiveHour.usedPercent : 0;
                var sevenDayPct = typeof u.sevenDay?.usedPercent === "number" ? u.sevenDay.usedPercent : 0;
                var monthlyPct = (isOpencodeService(u.service) && typeof u.monthly?.usedPercent === "number") ? u.monthly.usedPercent : 0;
                if (fiveHourPct > max) max = fiveHourPct;
                if (sevenDayPct > max) max = sevenDayPct;
                if (monthlyPct > max) max = monthlyPct;
            }
        }
        return max;
    }

    function getUsageColor(pct) {
        if (pct >= 100) return "#ef4444";
        if (pct >= 90) return "#f97316";
        if (pct >= 70) return "#eab308";
        return "#22c55e";
    }

    function refresh() {
        if (pluginApi?.mainInstance) {
            pluginApi.mainInstance.refreshUsage(true);
        }
    }

    Connections {
        target: pluginApi?.mainInstance ?? null
        function onUsageUpdated(data) {
            root.usageData = data;
            root.loading = false;
            root.lastUpdated = new Date();
        }
        function onUsageError(err) {
            root.lastError = err;
            root.loading = false;
        }
    }

    Rectangle {
        id: visualCapsule
        x: Style.pixelAlignCenter(parent.width, width)
        y: Style.pixelAlignCenter(parent.height, height)
        width: root.contentWidth
        height: root.contentHeight
        color: mouseArea.containsMouse ? Color.mHover : Style.capsuleColor
        radius: Style.radiusL
        border.color: Style.capsuleBorderColor
        border.width: Style.capsuleBorderWidth

        RowLayout {
            id: row
            anchors.centerIn: parent
            spacing: Style.marginS

            NIcon {
                icon: "brain"
                color: root.loading ? Color.mOnSurfaceVariant : getUsageColor(visibleBarMaxUsage())
                pointSize: barFontSize
            }

            Repeater {
                model: root.barSegments()

                RowLayout {
                    spacing: Style.marginXS

                    NText {
                        visible: index > 0
                        text: "·"
                        color: Color.mOnSurfaceVariant
                        pointSize: barFontSize
                        font.weight: Font.Medium
                    }

                    NText {
                        text: modelData.percent.toFixed(0) + "%"
                        color: getUsageColor(modelData.percent)
                        pointSize: barFontSize
                        font.weight: Font.Bold
                    }
                }
            }
        }
    }

    MouseArea {
        id: mouseArea
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        acceptedButtons: Qt.LeftButton | Qt.RightButton

        onEntered: {
            var tooltip = "API Usage";
            var max = visibleBarMaxUsage();
            if (max > 0) {
                tooltip += " - Max: " + max.toFixed(0) + "%";
            }
            if (root.loading) {
                tooltip += " (refreshing...)";
            }
            TooltipService.show(root, tooltip, BarService.getTooltipDirection());
        }

        onExited: {
            TooltipService.hide();
        }

        onClicked: function(mouse) {
            if (mouse.button === Qt.LeftButton) {
                pluginApi?.openPanel(root.screen, root);
            }
        }
    }

    Component.onCompleted: {
        if (pluginApi?.mainInstance) {
            root.usageData = pluginApi.mainInstance.usageData;
            root.loading = pluginApi.mainInstance.loading;
        }
    }
}
