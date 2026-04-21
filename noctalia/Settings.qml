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
        { key: "max", label: "Max usage", description: "Highest percentage across all tracked windows" },
        { key: "claude-5h", label: "Claude 5h", description: "Claude 5-hour window" },
        { key: "claude-7d", label: "Claude 7d", description: "Claude 7-day window" },
        { key: "codex-5h", label: "Codex 5h", description: "Codex primary window" },
        { key: "codex-7d", label: "Codex 7d", description: "Codex secondary window" },
        { key: "zai", label: "Zai", description: "Zai usage window" },
        { key: "opencode-go", label: "OpenCode Go", description: "OpenCode Go rolling usage" },
        { key: "openrouter", label: "OpenRouter", description: "OpenRouter credit usage percent" }
    ]

    property int editRefreshMinutes: {
        var ms = pluginApi?.pluginSettings?.refreshInterval ?? defaults.refreshInterval ?? 300000;
        return Math.max(0, Math.round(ms / 60000));
    }
    property var editBarDisplayItems: []
    property bool editTrackClaude: pluginApi?.pluginSettings?.trackClaude ?? defaults.trackClaude ?? true
    property bool editTrackCodex: pluginApi?.pluginSettings?.trackCodex ?? defaults.trackCodex ?? true
    property bool editTrackZai: pluginApi?.pluginSettings?.trackZai ?? defaults.trackZai ?? true
    property bool editTrackOpencodeGo: pluginApi?.pluginSettings?.trackOpencodeGo ?? defaults.trackOpencodeGo ?? true
    property bool editTrackOpenRouter: pluginApi?.pluginSettings?.trackOpenRouter ?? defaults.trackOpenRouter ?? true
    property bool editTrackOpencodeZen: pluginApi?.pluginSettings?.trackOpencodeZen ?? defaults.trackOpencodeZen ?? true

    property string editOpenRouterKey: pluginApi?.pluginSettings?.OPENROUTER_API_KEY || defaults.OPENROUTER_API_KEY || ""
    property string editOpencodeKey: pluginApi?.pluginSettings?.OPENCODE_API_KEY || defaults.OPENCODE_API_KEY || ""
    property string editOpencodeGoWorkspaceId: pluginApi?.pluginSettings?.OPENCODE_GO_WORKSPACE_ID || defaults.OPENCODE_GO_WORKSPACE_ID || ""
    property string editOpencodeGoAuthCookie: pluginApi?.pluginSettings?.OPENCODE_GO_AUTH_COOKIE || defaults.OPENCODE_GO_AUTH_COOKIE || ""
    property string editZaiKey: pluginApi?.pluginSettings?.ZAI_API_KEY || defaults.ZAI_API_KEY || ""

    ListModel {
        id: barDisplayModel
    }

    function isValidBarDisplayItem(item) {
        return ["max", "claude-5h", "claude-7d", "codex-5h", "codex-7d", "zai", "opencode-go", "openrouter"].indexOf(item) !== -1;
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
            items = showLegacy ? ((defaults.barDisplayItems && defaults.barDisplayItems.slice) ? defaults.barDisplayItems.slice() : ["claude-5h", "codex-5h", "zai"]) : [];
        }

        var seen = {};
        var normalized = [];
        for (var i = 0; i < items.length; i++) {
            var item = String(items[i] || "");
            if (!isValidBarDisplayItem(item) || seen[item]) continue;
            seen[item] = true;
            normalized.push(item);
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
        label: "Refresh"
        description: "How often usage is fetched automatically; set to 0 to disable auto refresh"
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
            interactive: false
            clip: true
        }
    }

    NDivider {
        Layout.fillWidth: true
    }

    NLabel {
        label: "Tracked Sources"
        description: "Choose which services are shown in the plugin"
    }

    NToggle {
        Layout.fillWidth: true
        label: "Claude"
        checked: root.editTrackClaude
        onToggled: checked => root.editTrackClaude = checked
    }

    NToggle {
        Layout.fillWidth: true
        label: "Codex"
        checked: root.editTrackCodex
        onToggled: checked => root.editTrackCodex = checked
    }

    NToggle {
        Layout.fillWidth: true
        label: "Zai"
        checked: root.editTrackZai
        onToggled: checked => root.editTrackZai = checked
    }

    NToggle {
        Layout.fillWidth: true
        label: "OpenCode Go"
        checked: root.editTrackOpencodeGo
        onToggled: checked => root.editTrackOpencodeGo = checked
    }

    NToggle {
        Layout.fillWidth: true
        label: "OpenRouter"
        checked: root.editTrackOpenRouter
        onToggled: checked => root.editTrackOpenRouter = checked
    }

    NToggle {
        Layout.fillWidth: true
        label: "Opencode Zen"
        checked: root.editTrackOpencodeZen
        onToggled: checked => root.editTrackOpencodeZen = checked
    }

    NDivider {
        Layout.fillWidth: true
    }

    NLabel {
        label: "API Keys"
        description: "Optional: only needed if CLI credentials are not found"
    }

    NTextInput {
        Layout.fillWidth: true
        label: "OpenRouter API Key"
        placeholderText: "sk-or-v1-..."
        text: root.editOpenRouterKey
        onTextChanged: root.editOpenRouterKey = text
    }

    NTextInput {
        Layout.fillWidth: true
        label: "Opencode API Key"
        placeholderText: "sk-..."
        text: root.editOpencodeKey
        onTextChanged: root.editOpencodeKey = text
    }

    NTextInput {
        Layout.fillWidth: true
        label: "OpenCode Go Workspace ID"
        placeholderText: "workspace-id"
        text: root.editOpencodeGoWorkspaceId
        onTextChanged: root.editOpencodeGoWorkspaceId = text
    }

    NTextInput {
        Layout.fillWidth: true
        label: "OpenCode Go Auth Cookie"
        placeholderText: "auth cookie"
        text: root.editOpencodeGoAuthCookie
        onTextChanged: root.editOpencodeGoAuthCookie = text
    }

    NTextInput {
        Layout.fillWidth: true
        label: "ZAI API Key"
        placeholderText: "zai-..."
        text: root.editZaiKey
        onTextChanged: root.editZaiKey = text
    }

    NLabel {
        label: "Tip"
        description: "You can also put these keys in ~/.config/noctalia/plugins/agent-quota/.env"
    }

    function saveSettings() {
        if (!pluginApi) return;

        pluginApi.pluginSettings.refreshInterval = root.editRefreshMinutes * 60000;
        pluginApi.pluginSettings.barDisplayItems = root.editBarDisplayItems.slice();

        pluginApi.pluginSettings.trackClaude = root.editTrackClaude;
        pluginApi.pluginSettings.trackCodex = root.editTrackCodex;
        pluginApi.pluginSettings.trackZai = root.editTrackZai;
        pluginApi.pluginSettings.trackOpencodeGo = root.editTrackOpencodeGo;
        pluginApi.pluginSettings.trackOpenRouter = root.editTrackOpenRouter;
        pluginApi.pluginSettings.trackOpencodeZen = root.editTrackOpencodeZen;

        pluginApi.pluginSettings.OPENROUTER_API_KEY = root.editOpenRouterKey.trim();
        pluginApi.pluginSettings.OPENCODE_API_KEY = root.editOpencodeKey.trim();
        pluginApi.pluginSettings.OPENCODE_GO_WORKSPACE_ID = root.editOpencodeGoWorkspaceId.trim();
        pluginApi.pluginSettings.OPENCODE_GO_AUTH_COOKIE = root.editOpencodeGoAuthCookie.trim();
        pluginApi.pluginSettings.ZAI_API_KEY = root.editZaiKey.trim();

        pluginApi.saveSettings();
        if (pluginApi.mainInstance && root.editRefreshMinutes > 0) pluginApi.mainInstance.refreshUsage(true);
        Logger.i("AgentQuota", "Settings saved");
    }
}
