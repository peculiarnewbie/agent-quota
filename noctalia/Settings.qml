import QtQuick
import QtQuick.Layouts
import QtQml.Models
import qs.Commons
import qs.Widgets

ColumnLayout {
    id: root

    property var pluginApi: null
    property var defaults: pluginApi?.manifest?.metadata?.defaultSettings || ({})
    property var barDisplayOptions: [
        { key: "max", label: "Max usage", description: "Highest percentage across tracked windows" },
        { key: "claude-5h", label: "Claude 5h", description: "Claude 5-hour window" },
        { key: "claude-7d", label: "Claude 7d", description: "Claude 7-day window" },
        { key: "codex-5h", label: "Codex 5h", description: "Primary Codex 5-hour window" },
        { key: "codex-7d", label: "Codex 7d", description: "Primary Codex 7-day window" },
        { key: "cursor", label: "Cursor", description: "Cursor usage window" },
        { key: "opencode", label: "OpenCode", description: "OpenCode Go rolling / monthly" }
    ]

    property int editRefreshMinutes: {
        var ms = pluginApi?.pluginSettings?.refreshInterval ?? defaults.refreshInterval ?? 300000;
        return Math.max(0, Math.round(ms / 60000));
    }
    property var editBarDisplayItems: []
    property string editServerBaseUrl: pluginApi?.pluginSettings?.serverBaseUrl || defaults.serverBaseUrl || "http://127.0.0.1:6767"
    property bool editTrackClaude: pluginApi?.pluginSettings?.trackClaude ?? defaults.trackClaude ?? true
    property bool editTrackCodex: pluginApi?.pluginSettings?.trackCodex ?? defaults.trackCodex ?? true
    property bool editTrackCursor: pluginApi?.pluginSettings?.trackCursor ?? defaults.trackCursor ?? true
    property bool editTrackOpencode: pluginApi?.pluginSettings?.trackOpencode ?? defaults.trackOpencode ?? true

    ListModel {
        id: barDisplayModel
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
            if (showLegacy === undefined || showLegacy === null) showLegacy = defaults.showPercentInBar;
            if (showLegacy === undefined || showLegacy === null) showLegacy = true;
            items = showLegacy ? ((defaults.barDisplayItems && defaults.barDisplayItems.slice) ? defaults.barDisplayItems.slice() : ["claude-5h", "codex-5h", "cursor"]) : [];
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

    function loadBarDisplayModel() {
        var selectedItems = normalizedBarDisplayItems(pluginApi?.pluginSettings?.barDisplayItems);
        var selectedMap = {};
        for (var i = 0; i < selectedItems.length; i++) selectedMap[selectedItems[i]] = true;

        barDisplayModel.clear();
        for (var j = 0; j < barDisplayOptions.length; j++) {
            var option = barDisplayOptions[j];
            barDisplayModel.append({
                key: option.key,
                label: option.label,
                description: option.description,
                selected: !!selectedMap[option.key]
            });
        }

        for (var k = 0; k < selectedItems.length; k++) {
            var selectedKey = selectedItems[k];
            for (var m = 0; m < barDisplayModel.count; m++) {
                if (barDisplayModel.get(m).key === selectedKey) {
                    barDisplayModel.move(m, k, 1);
                    break;
                }
            }
        }

        syncBarDisplayItems();
    }

    function syncBarDisplayItems() {
        var items = [];
        for (var i = 0; i < barDisplayModel.count; i++) {
            var row = barDisplayModel.get(i);
            if (row.selected) items.push(row.key);
        }
        editBarDisplayItems = items;
    }

    spacing: Style.marginM

    Component.onCompleted: loadBarDisplayModel()

    onPluginApiChanged: loadBarDisplayModel()

    NLabel {
        label: "Server"
        description: "agent-quota base URL (VPN host on the agent box, no trailing slash)"
    }

    NTextInput {
        Layout.fillWidth: true
        label: "Base URL"
        placeholderText: "http://127.0.0.1:6767"
        text: root.editServerBaseUrl
        onTextChanged: root.editServerBaseUrl = text
    }

    NLabel {
        label: "Refresh"
        description: "How often usage is polled; set to 0 to disable auto refresh"
    }

    NSpinBox {
        from: 0
        to: 60
        value: root.editRefreshMinutes
        suffix: " min"
        onValueChanged: root.editRefreshMinutes = value
    }

    NLabel {
        Layout.fillWidth: true
        label: "Bar values"
    }

    Rectangle {
        Layout.fillWidth: true
        Layout.preferredHeight: Math.min(Math.max(48, barDisplayModel.count * 44), 240)
        color: Style.capsuleColor
        radius: Style.radiusM
        border.color: Style.capsuleBorderColor
        border.width: Style.capsuleBorderWidth

        ListView {
            id: barDisplayList
            anchors.fill: parent
            anchors.margins: Style.marginS
            model: DelegateModel {
                id: visualModel
                model: barDisplayModel

                delegate: DropArea {
                    id: delegateRoot
                    width: barDisplayList.width
                    height: barRow.height + Style.marginXS

                    onEntered: function(drag) {
                        var from = drag.source.DelegateModel.itemsIndex;
                        var to = delegateRoot.DelegateModel.itemsIndex;
                        if (from === to) return;
                        barDisplayModel.move(from, to, 1);
                        root.syncBarDisplayItems();
                    }

                    Rectangle {
                        id: barRow
                        width: delegateRoot.width
                        height: 38
                        radius: Style.radiusM
                        color: dragMouseArea.drag.active ? Color.mHover : Style.capsuleColor
                        border.color: Style.capsuleBorderColor
                        border.width: Style.capsuleBorderWidth
                        anchors.verticalCenter: parent.verticalCenter

                        Drag.active: dragMouseArea.drag.active
                        Drag.source: delegateRoot
                        Drag.hotSpot.x: width / 2
                        Drag.hotSpot.y: height / 2

                        states: State {
                            when: dragMouseArea.drag.active
                            ParentChange {
                                target: barRow
                                parent: barDisplayList.contentItem
                            }
                            AnchorChanges {
                                target: barRow
                                anchors.verticalCenter: undefined
                            }
                        }

                        RowLayout {
                            anchors.fill: parent
                            anchors.leftMargin: Style.marginM
                            anchors.rightMargin: Style.marginS
                            spacing: Style.marginS

                            NToggle {
                                Layout.fillWidth: true
                                label: model.label
                                checked: model.selected
                                onToggled: checked => {
                                    barDisplayModel.setProperty(delegateRoot.DelegateModel.itemsIndex, "selected", checked);
                                    root.syncBarDisplayItems();
                                }
                            }

                            Rectangle {
                                Layout.preferredWidth: 36
                                Layout.preferredHeight: 36
                                radius: Style.radiusS
                                color: dragMouseArea.containsMouse || dragMouseArea.drag.active ? Color.mHover : "transparent"

                                NText {
                                    anchors.centerIn: parent
                                    text: "::"
                                    color: Color.mOnSurfaceVariant
                                    pointSize: Style.fontSizeXS
                                    font.weight: Font.Medium
                                }

                                MouseArea {
                                    id: dragMouseArea
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: Qt.OpenHandCursor
                                    drag.target: barRow
                                    drag.axis: Drag.YAxis
                                    onReleased: {
                                        cursorShape = Qt.OpenHandCursor;
                                        root.syncBarDisplayItems();
                                    }
                                    onPressed: cursorShape = Qt.ClosedHandCursor
                                }
                            }
                        }
                    }
                }
            }
            spacing: Style.marginXS
            interactive: contentHeight > height
            clip: true
        }
    }

    NDivider {
        Layout.fillWidth: true
    }

    NLabel {
        label: "Shown services"
        description: "Filter which rows from /api/usage appear in the panel and bar"
    }

    NToggle {
        Layout.fillWidth: true
        label: "Claude"
        checked: root.editTrackClaude
        onToggled: checked => root.editTrackClaude = checked
    }

    NToggle {
        Layout.fillWidth: true
        label: "Codex (all accounts)"
        checked: root.editTrackCodex
        onToggled: checked => root.editTrackCodex = checked
    }

    NToggle {
        Layout.fillWidth: true
        label: "Cursor"
        checked: root.editTrackCursor
        onToggled: checked => root.editTrackCursor = checked
    }

    NToggle {
        Layout.fillWidth: true
        label: "OpenCode (all accounts)"
        checked: root.editTrackOpencode
        onToggled: checked => root.editTrackOpencode = checked
    }

    NLabel {
        label: "Tip"
        description: "Credentials live on the agent box (server Settings / config.json). This plugin only polls HTTP."
    }

    function saveSettings() {
        if (!pluginApi) return;

        var url = String(root.editServerBaseUrl || "").trim();
        while (url.length > 0 && url.charAt(url.length - 1) === "/") {
            url = url.slice(0, -1);
        }
        if (!url) url = "http://127.0.0.1:6767";

        pluginApi.pluginSettings.serverBaseUrl = url;
        pluginApi.pluginSettings.refreshInterval = root.editRefreshMinutes * 60000;
        pluginApi.pluginSettings.barDisplayItems = root.editBarDisplayItems.slice();

        pluginApi.pluginSettings.trackClaude = root.editTrackClaude;
        pluginApi.pluginSettings.trackCodex = root.editTrackCodex;
        pluginApi.pluginSettings.trackCursor = root.editTrackCursor;
        pluginApi.pluginSettings.trackOpencode = root.editTrackOpencode;

        pluginApi.saveSettings();
        if (pluginApi.mainInstance && root.editRefreshMinutes > 0) pluginApi.mainInstance.refreshUsage(true);
        Logger.i("AgentQuota", "Settings saved");
    }
}
