import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Widgets
import qs.Services.UI

Item {
    id: root

    property var pluginApi: null

    readonly property var geometryPlaceholder: panelContainer
    readonly property bool allowAttach: true

    property real contentPreferredWidth: 420 * Style.uiScaleRatio
    property real contentPreferredHeight: 580 * Style.uiScaleRatio

    anchors.fill: parent

    property var usageData: []
    property bool loading: false
    property var lastUpdated: null

    function getUsageColor(pct) {
        if (pct >= 100) return "#ef4444";
        if (pct >= 90) return "#f97316";
        if (pct >= 70) return "#eab308";
        return "#22c55e";
    }

    function formatTimeOfDay(ms) {
        if (!ms) return "--";
        var d = new Date(ms);
        return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }

    function formatDateTime(ms) {
        if (!ms) return "--";
        var d = new Date(ms);
        return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
            ", " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }

    function refresh() {
        if (pluginApi?.mainInstance) {
            root.loading = true;
            pluginApi.mainInstance.refreshUsage(true);
        }
    }

    function syncFromMain() {
        if (!pluginApi?.mainInstance) return;
        root.usageData = pluginApi.mainInstance.usageData || [];
        root.loading = !!pluginApi.mainInstance.loading;
        root.lastUpdated = pluginApi.mainInstance.lastUpdated || null;
    }

    function syncOnPanelOpen() {
        if (!pluginApi?.mainInstance) return;
        var main = pluginApi.mainInstance;

        root.syncFromMain();

        if (root.usageData.length === 0) {
            if (!main.loading) {
                main.loadCache();
                root.loading = true;
            }
            return;
        }

        main.refreshUsage(true);
        root.loading = !!main.loading;
    }

    function formatLastRefresh(lastUpdated) {
        if (!lastUpdated) return "";
        var dt = new Date(lastUpdated);
        if (isNaN(dt.getTime())) return "";
        return dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

    function usageServices() {
        var result = [];
        for (var i = 0; i < root.usageData.length; i++) {
            var item = root.usageData[i];
            if (isUsageService(item.service)) {
                result.push(item);
            }
        }
        return result;
    }

    function displayServiceName(item) {
        if (item && item.displayName && String(item.displayName).trim()) {
            return String(item.displayName).trim();
        }
        return String(item?.service || "").replace(/-/g, " ");
    }

    function hasVisibleCards() {
        return root.usageData.length > 0;
    }

    function usageCards() {
        var result = [];
        var services = usageServices();
        for (var i = 0; i < services.length; i++) {
            if (services[i].status !== "no_credentials") {
                result.push(services[i]);
            }
        }
        return result;
    }

    function usageNoCreds() {
        var result = [];
        var services = usageServices();
        for (var i = 0; i < services.length; i++) {
            if (services[i].status === "no_credentials") {
                result.push(services[i]);
            }
        }
        return result;
    }

    function showMonthly(item) {
        if (!item || !isOpencodeService(item.service)) return false;
        var m = item.monthly;
        return m !== undefined && m !== null && typeof m === "object";
    }

    function maxWindowPercent(item) {
        return Math.max(
            item.fiveHour?.usedPercent || 0,
            item.sevenDay?.usedPercent || 0,
            (isOpencodeService(item.service) ? item.monthly?.usedPercent : 0) || 0
        );
    }

    Connections {
        target: pluginApi?.mainInstance ?? null
        function onUsageUpdated(data) {
            root.usageData = data;
            root.loading = false;
            root.lastUpdated = pluginApi?.mainInstance?.lastUpdated || new Date();
        }
        function onUsageError(err) {
            root.loading = false;
        }
    }

    Component.onCompleted: {
        root.syncOnPanelOpen();
    }

    onPluginApiChanged: {
        root.syncOnPanelOpen();
    }

    onVisibleChanged: {
        if (visible) {
            root.syncOnPanelOpen();
        }
    }

    Rectangle {
        id: panelContainer
        anchors.fill: parent
        color: "transparent"

        ColumnLayout {
            anchors {
                fill: parent
                margins: Style.marginM
            }
            spacing: Style.marginS

            RowLayout {
                Layout.fillWidth: true
                spacing: Style.marginS

                NIcon {
                    icon: "brain"
                    color: Color.mPrimary
                    pointSize: Style.fontSizeM
                }

                NText {
                    text: "Agent Quota"
                    pointSize: Style.fontSizeM
                    font.weight: Font.Bold
                    color: Color.mOnSurface
                    Layout.fillWidth: true
                }

                NText {
                    text: root.loading ? "syncing..." : ""
                    color: Color.mOnSurfaceVariant
                    pointSize: Style.fontSizeXS
                    visible: root.loading
                }

                NText {
                    text: root.lastUpdated ? ("last refresh " + root.formatLastRefresh(root.lastUpdated)) : ""
                    color: Color.mOnSurfaceVariant
                    pointSize: Style.fontSizeXS
                    visible: !root.loading && !!root.lastUpdated
                }

                NIconButton {
                    icon: "refresh"
                    onClicked: root.refresh()
                    enabled: !root.loading
                }

                NIconButton {
                    icon: "x"
                    onClicked: {
                        pluginApi?.closePanel(pluginApi.panelOpenScreen);
                    }
                }
            }

            NText {
                visible: !root.loading && root.usageData.length === 0 && (pluginApi?.mainInstance?.lastError || "") !== ""
                text: pluginApi?.mainInstance?.lastError || ""
                pointSize: Style.fontSizeXS
                color: "#ef4444"
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
            }

            NScrollView {
                id: usageScroll
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true

                ColumnLayout {
                    width: usageScroll.availableWidth
                    spacing: Style.marginS

                    NText {
                        text: "Coding Assistants"
                        pointSize: Style.fontSizeXS
                        color: Color.mOnSurfaceVariant
                        visible: root.usageServices().length > 0
                        Layout.topMargin: Style.marginXS
                    }

                    Repeater {
                        model: root.usageCards()

                        Rectangle {
                            Layout.fillWidth: true
                            implicitHeight: usageCol.implicitHeight + Style.marginM * 2
                            color: Color.mSurface
                            radius: Style.radiusM

                            ColumnLayout {
                                id: usageCol
                                anchors {
                                    fill: parent
                                    margins: Style.marginM
                                }
                                spacing: Style.marginXS

                                RowLayout {
                                    Layout.fillWidth: true
                                    spacing: Style.marginS

                                    Rectangle {
                                        width: 6
                                        height: 6
                                        radius: 3
                                        color: modelData.status === "ok" ?
                                            getUsageColor(maxWindowPercent(modelData)) : "#52525b"
                                    }

                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        spacing: 0

                                        NText {
                                            text: displayServiceName(modelData)
                                            pointSize: Style.fontSizeS
                                            font.weight: Font.Medium
                                            color: Color.mOnSurface
                                            Layout.fillWidth: true
                                        }

                                        NText {
                                            visible: !!(modelData.accountEmail)
                                            text: modelData.accountEmail || ""
                                            pointSize: Style.fontSizeXS
                                            color: Color.mOnSurfaceVariant
                                            Layout.fillWidth: true
                                        }
                                    }

                                    NText {
                                        visible: !!modelData.plan
                                        text: modelData.plan || ""
                                        pointSize: Style.fontSizeXS
                                        color: Color.mOnSurfaceVariant
                                    }
                                }

                                ColumnLayout {
                                    visible: modelData.status === "ok"
                                    Layout.fillWidth: true
                                    spacing: Style.marginXS

                                    RowLayout {
                                        visible: modelData.fiveHour
                                        Layout.fillWidth: true
                                        spacing: Style.marginS

                                        NText {
                                            text: modelData.fiveHour?.label || "5h"
                                            pointSize: Style.fontSizeXS
                                            color: Color.mOnSurfaceVariant
                                            Layout.preferredWidth: 52
                                        }

                                        Rectangle {
                                            Layout.fillWidth: true
                                            Layout.preferredHeight: 4
                                            color: Color.mSurfaceVariant
                                            radius: 2

                                            Rectangle {
                                                width: parent.width * Math.min((modelData.fiveHour?.usedPercent || 0) / 100, 1)
                                                height: parent.height
                                                radius: parent.radius
                                                color: getUsageColor(modelData.fiveHour?.usedPercent || 0)
                                            }
                                        }

                                        NText {
                                            text: modelData.fiveHour?.used || "--"
                                            pointSize: Style.fontSizeXS
                                            color: getUsageColor(modelData.fiveHour?.usedPercent || 0)
                                            font.weight: Font.Bold
                                            Layout.preferredWidth: 40
                                            horizontalAlignment: Text.AlignRight
                                        }
                                    }

                                    RowLayout {
                                        visible: !!(modelData.fiveHour?.resetsIn && modelData.fiveHour.resetsIn !== "--")
                                        Layout.fillWidth: true
                                        spacing: Style.marginS

                                        NText {
                                            text: "reset " + (modelData.fiveHour?.resetsIn || "--")
                                            pointSize: Style.fontSizeXS
                                            color: Color.mOnSurfaceVariant
                                            opacity: 0.7
                                            Layout.fillWidth: true
                                        }

                                        NText {
                                            text: formatTimeOfDay(modelData.fiveHour?.resetsAtMs || 0)
                                            pointSize: Style.fontSizeXS
                                            color: Color.mOnSurfaceVariant
                                            opacity: 0.7
                                            horizontalAlignment: Text.AlignRight
                                        }
                                    }

                                    RowLayout {
                                        visible: modelData.sevenDay
                                        Layout.fillWidth: true
                                        spacing: Style.marginS

                                        NText {
                                            text: modelData.sevenDay?.label || "7d"
                                            pointSize: Style.fontSizeXS
                                            color: Color.mOnSurfaceVariant
                                            Layout.preferredWidth: 52
                                        }

                                        Rectangle {
                                            Layout.fillWidth: true
                                            Layout.preferredHeight: 4
                                            color: Color.mSurfaceVariant
                                            radius: 2

                                            Rectangle {
                                                width: parent.width * Math.min((modelData.sevenDay?.usedPercent || 0) / 100, 1)
                                                height: parent.height
                                                radius: parent.radius
                                                color: getUsageColor(modelData.sevenDay?.usedPercent || 0)
                                            }
                                        }

                                        NText {
                                            text: modelData.sevenDay?.used || "--"
                                            pointSize: Style.fontSizeXS
                                            color: getUsageColor(modelData.sevenDay?.usedPercent || 0)
                                            font.weight: Font.Bold
                                            Layout.preferredWidth: 40
                                            horizontalAlignment: Text.AlignRight
                                        }
                                    }

                                    RowLayout {
                                        visible: !!(modelData.sevenDay?.resetsIn && modelData.sevenDay.resetsIn !== "--")
                                        Layout.fillWidth: true
                                        spacing: Style.marginS

                                        NText {
                                            text: "reset " + (modelData.sevenDay?.resetsIn || "--")
                                            pointSize: Style.fontSizeXS
                                            color: Color.mOnSurfaceVariant
                                            opacity: 0.7
                                            Layout.fillWidth: true
                                        }

                                        NText {
                                            text: formatDateTime(modelData.sevenDay?.resetsAtMs || 0)
                                            pointSize: Style.fontSizeXS
                                            color: Color.mOnSurfaceVariant
                                            opacity: 0.7
                                            horizontalAlignment: Text.AlignRight
                                        }
                                    }

                                    RowLayout {
                                        visible: showMonthly(modelData)
                                        Layout.fillWidth: true
                                        spacing: Style.marginS

                                        NText {
                                            text: modelData.monthly?.label || "monthly"
                                            pointSize: Style.fontSizeXS
                                            color: Color.mOnSurfaceVariant
                                            Layout.preferredWidth: 52
                                        }

                                        Rectangle {
                                            Layout.fillWidth: true
                                            Layout.preferredHeight: 4
                                            color: Color.mSurfaceVariant
                                            radius: 2

                                            Rectangle {
                                                width: parent.width * Math.min((modelData.monthly?.usedPercent || 0) / 100, 1)
                                                height: parent.height
                                                radius: parent.radius
                                                color: getUsageColor(modelData.monthly?.usedPercent || 0)
                                            }
                                        }

                                        NText {
                                            text: modelData.monthly?.used || "--"
                                            pointSize: Style.fontSizeXS
                                            color: getUsageColor(modelData.monthly?.usedPercent || 0)
                                            font.weight: Font.Bold
                                            Layout.preferredWidth: 40
                                            horizontalAlignment: Text.AlignRight
                                        }
                                    }

                                    RowLayout {
                                        visible: {
                                            if (!showMonthly(modelData)) return false;
                                            var ri = modelData.monthly?.resetsIn;
                                            return ri !== undefined && ri !== null && ri !== "" && ri !== "--";
                                        }
                                        Layout.fillWidth: true
                                        spacing: Style.marginS

                                        NText {
                                            text: "reset " + (modelData.monthly?.resetsIn || "--")
                                            pointSize: Style.fontSizeXS
                                            color: Color.mOnSurfaceVariant
                                            opacity: 0.7
                                            Layout.fillWidth: true
                                        }

                                        NText {
                                            text: formatDateTime(modelData.monthly?.resetsAtMs || 0)
                                            pointSize: Style.fontSizeXS
                                            color: Color.mOnSurfaceVariant
                                            opacity: 0.7
                                            horizontalAlignment: Text.AlignRight
                                        }
                                    }
                                }

                                ColumnLayout {
                                    visible: modelData.status !== "ok"
                                    Layout.fillWidth: true
                                    spacing: 2

                                    NText {
                                        text: modelData.error || "Unknown error"
                                        pointSize: Style.fontSizeXS
                                        color: "#ef4444"
                                        Layout.fillWidth: true
                                        wrapMode: Text.WordWrap
                                    }

                                    NText {
                                        visible: modelData.hint
                                        text: modelData.hint || ""
                                        pointSize: Style.fontSizeXS
                                        color: Color.mOnSurfaceVariant
                                        Layout.fillWidth: true
                                        wrapMode: Text.WordWrap
                                    }
                                }

                                NText {
                                    visible: !!(modelData.hint && modelData.status === "ok")
                                    text: modelData.hint || ""
                                    pointSize: Style.fontSizeXS
                                    color: Color.mOnSurfaceVariant
                                    font.italic: true
                                    Layout.fillWidth: true
                                    wrapMode: Text.WordWrap
                                }
                            }
                        }
                    }

                    Repeater {
                        model: root.usageNoCreds()

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2

                            RowLayout {
                                spacing: Style.marginS

                                NText {
                                    text: displayServiceName(modelData)
                                    pointSize: Style.fontSizeXS
                                    color: Color.mOnSurfaceVariant
                                    opacity: 0.6
                                }

                                NText {
                                    text: modelData.error || "no credentials"
                                    pointSize: Style.fontSizeXS
                                    color: Color.mOnSurfaceVariant
                                    opacity: 0.45
                                    font.italic: true
                                }
                            }

                            NText {
                                visible: (modelData.hint || "") !== ""
                                text: modelData.hint || ""
                                pointSize: Style.fontSizeXS
                                color: Color.mOnSurfaceVariant
                                opacity: 0.35
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                            }
                        }
                    }

                    NText {
                        visible: !root.loading && !root.hasVisibleCards()
                        text: "No usage data yet. Check the server URL in Agent Quota settings."
                        pointSize: Style.fontSizeXS
                        color: Color.mOnSurfaceVariant
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                    }
                }
            }

            NText {
                text: "From " + (pluginApi?.mainInstance?.serverBaseUrl || "agent-quota")
                pointSize: Style.fontSizeXS
                color: Color.mOnSurfaceVariant
                opacity: 0.5
                Layout.fillWidth: true
            }
        }
    }
}
