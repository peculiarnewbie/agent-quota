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

    readonly property real contentWidth: row.implicitWidth + Style.marginM * 2
    readonly property real contentHeight: capsuleHeight

    implicitWidth: contentWidth
    implicitHeight: contentHeight

    function isUsageTrackingService(service) {
        return ["claude", "codex", "zai"].indexOf(service) !== -1;
    }

    function getMaxUsage() {
        var max = 0;
        for (var i = 0; i < usageData.length; i++) {
            var u = usageData[i];
            if (u.status === "ok" && isUsageTrackingService(u.service)) {
                var fiveHourPct = typeof u.fiveHour?.usedPercent === "number" ? u.fiveHour.usedPercent : 0;
                var sevenDayPct = typeof u.sevenDay?.usedPercent === "number" ? u.sevenDay.usedPercent : 0;
                if (fiveHourPct > max) max = fiveHourPct;
                if (sevenDayPct > max) max = sevenDayPct;
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
            pluginApi.mainInstance.refreshUsage();
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
                color: root.loading ? Color.mOnSurfaceVariant : getUsageColor(getMaxUsage())
                pointSize: barFontSize
            }

            NText {
                visible: pluginApi?.pluginSettings?.showPercentInBar ?? true
                text: getMaxUsage().toFixed(0) + "%"
                color: getUsageColor(getMaxUsage())
                pointSize: barFontSize
                font.weight: Font.Bold
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
            var max = getMaxUsage();
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
        // Read existing data from Main (may already have cached data)
        if (pluginApi?.mainInstance) {
            root.usageData = pluginApi.mainInstance.usageData;
            root.loading = pluginApi.mainInstance.loading;
        }
    }
}
