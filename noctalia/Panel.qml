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
    property real contentPreferredHeight: 480 * Style.uiScaleRatio

    anchors.fill: parent

    property var usageData: []
    property bool loading: false

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
            pluginApi.mainInstance.refreshUsage();
        }
    }

    function syncFromMain() {
        if (!pluginApi?.mainInstance) return;
        root.usageData = pluginApi.mainInstance.usageData || [];
        root.loading = pluginApi.mainInstance.loading && root.usageData.length === 0;
        if (root.usageData.length === 0 && !root.loading) {
            pluginApi.mainInstance.loadCache();
        }
    }

    function isUsageService(service) {
        return ["claude", "codex", "zai"].indexOf(service) !== -1;
    }

    function isCreditService(service) {
        return ["openrouter", "opencode-zen"].indexOf(service) !== -1;
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

    function creditServices() {
        var result = [];
        for (var i = 0; i < root.usageData.length; i++) {
            var item = root.usageData[i];
            if (isCreditService(item.service)) {
                result.push(item);
            }
        }
        return result;
    }

    function displayServiceName(service) {
        if (service === "opencode-zen") return "opencode zen";
        return service;
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

    function creditCards() {
        var result = [];
        var services = creditServices();
        for (var i = 0; i < services.length; i++) {
            if (services[i].status === "ok") {
                result.push(services[i]);
            }
        }
        return result;
    }

    function creditNoCreds() {
        var result = [];
        var services = creditServices();
        for (var i = 0; i < services.length; i++) {
            if (services[i].status !== "ok") {
                result.push(services[i]);
            }
        }
        return result;
    }

    Connections {
        target: pluginApi?.mainInstance ?? null
        function onUsageUpdated(data) {
            root.usageData = data;
            root.loading = false;
        }
        function onUsageError(err) {
            root.loading = false;
        }
    }

    Component.onCompleted: {
        root.syncFromMain();
    }

    onPluginApiChanged: {
        root.syncFromMain();
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

            // Header
            RowLayout {
                Layout.fillWidth: true
                spacing: Style.marginS

                NIcon {
                    icon: "brain"
                    color: Color.mPrimary
                    pointSize: Style.fontSizeM
                }

                NText {
                    text: "API Usage"
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

            // Error display
            NText {
                visible: !root.loading && root.usageData.length === 0 && (pluginApi?.mainInstance?.lastError || "") !== ""
                text: pluginApi?.mainInstance?.lastError || ""
                pointSize: Style.fontSizeXS
                color: "#ef4444"
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
            }

            // Scrollable content area
            NScrollView {
                id: usageScroll
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true

                ColumnLayout {
                    width: usageScroll.availableWidth
                    spacing: Style.marginS

                    // -- Coding Assistants section --
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

                                // Service name row
                                RowLayout {
                                    Layout.fillWidth: true
                                    spacing: Style.marginS

                                    Rectangle {
                                        width: 6
                                        height: 6
                                        radius: 3
                                        color: modelData.status === "ok" ?
                                            getUsageColor(Math.max(
                                                modelData.fiveHour?.usedPercent || 0,
                                                modelData.sevenDay?.usedPercent || 0
                                            )) : "#52525b"
                                    }

                                    NText {
                                        text: displayServiceName(modelData.service)
                                        pointSize: Style.fontSizeS
                                        font.weight: Font.Medium
                                        color: Color.mOnSurface
                                        Layout.fillWidth: true
                                    }

                                    NText {
                                        visible: modelData.plan
                                        text: modelData.plan || ""
                                        pointSize: Style.fontSizeXS
                                        color: Color.mOnSurfaceVariant
                                    }
                                }

                                // Usage bars (ok status)
                                ColumnLayout {
                                    visible: modelData.status === "ok"
                                    Layout.fillWidth: true
                                    spacing: Style.marginXS

                                    // 5h window bar
                                    RowLayout {
                                        visible: modelData.fiveHour
                                        Layout.fillWidth: true
                                        spacing: Style.marginS

                                        NText {
                                            text: "5h"
                                            pointSize: Style.fontSizeXS
                                            color: Color.mOnSurfaceVariant
                                            Layout.preferredWidth: 24
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

                                    // 7d window bar
                                    RowLayout {
                                        visible: modelData.sevenDay
                                        Layout.fillWidth: true
                                        spacing: Style.marginS

                                        NText {
                                            text: "7d"
                                            pointSize: Style.fontSizeXS
                                            color: Color.mOnSurfaceVariant
                                            Layout.preferredWidth: 24
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

                                    // Reset time
                                    NText {
                                        visible: modelData.fiveHour?.resetsIn && modelData.fiveHour.resetsIn !== "--"
                                        text: "resets " + (modelData.fiveHour?.resetsIn || "--")
                                        pointSize: Style.fontSizeXS
                                        color: Color.mOnSurfaceVariant
                                        opacity: 0.7
                                    }
                                }

                                // Error state
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
                                    visible: modelData.hint && modelData.status === "ok"
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

                    // No-creds usage services
                    Repeater {
                        model: root.usageNoCreds()

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2

                            RowLayout {
                                spacing: Style.marginS

                                NText {
                                    text: displayServiceName(modelData.service)
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

                    // -- Credits & Balance section --
                    NText {
                        text: "Credits & Balance"
                        pointSize: Style.fontSizeXS
                        color: Color.mOnSurfaceVariant
                        visible: root.creditServices().length > 0
                        Layout.topMargin: Style.marginXS
                    }

                    Repeater {
                        model: root.creditCards()

                        Rectangle {
                            Layout.fillWidth: true
                            implicitHeight: creditCol.implicitHeight + Style.marginM * 2
                            color: Color.mSurface
                            radius: Style.radiusM

                            ColumnLayout {
                                id: creditCol
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
                                        color: modelData.status === "ok" ? getUsageColor(modelData.fiveHour?.usedPercent || 0) : "#52525b"
                                    }

                                    NText {
                                        text: displayServiceName(modelData.service)
                                        pointSize: Style.fontSizeS
                                        font.weight: Font.Medium
                                        color: Color.mOnSurface
                                        Layout.fillWidth: true
                                    }

                                    NText {
                                        visible: modelData.plan
                                        text: modelData.plan || ""
                                        pointSize: Style.fontSizeXS
                                        color: Color.mOnSurfaceVariant
                                    }
                                }

                                RowLayout {
                                    visible: modelData.status === "ok"
                                    Layout.fillWidth: true
                                    spacing: Style.marginM

                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        spacing: 2

                                        NText {
                                            text: "Used"
                                            pointSize: Style.fontSizeXS
                                            color: Color.mOnSurfaceVariant
                                        }

                                        NText {
                                            text: modelData.fiveHour?.used || "--"
                                            pointSize: Style.fontSizeS
                                            color: "#f59e0b"
                                            font.weight: Font.Bold
                                        }
                                    }

                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        spacing: 2

                                        NText {
                                            text: "Remaining"
                                            pointSize: Style.fontSizeXS
                                            color: Color.mOnSurfaceVariant
                                        }

                                        NText {
                                            text: modelData.fiveHour?.remaining || "--"
                                            pointSize: Style.fontSizeS
                                            color: "#22d3ee"
                                            font.weight: Font.Bold
                                        }
                                    }
                                }

                                ColumnLayout {
                                    visible: modelData.status !== "ok" && modelData.status !== "no_credentials"
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
                            }
                        }
                    }

                    // No-creds credit services
                    Repeater {
                        model: root.creditNoCreds()

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2

                            RowLayout {
                                spacing: Style.marginS

                                NText {
                                    text: displayServiceName(modelData.service)
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
                }
            }

            // Footer
            NText {
                text: "Credentials from standard config locations"
                pointSize: Style.fontSizeXS
                color: Color.mOnSurfaceVariant
                opacity: 0.5
                Layout.fillWidth: true
            }
        }
    }
}
