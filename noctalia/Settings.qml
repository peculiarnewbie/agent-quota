import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Widgets

ColumnLayout {
    id: root

    property var pluginApi: null
    property var defaults: pluginApi?.manifest?.metadata?.defaultSettings || ({})

    property int editRefreshMinutes: {
        var ms = pluginApi?.pluginSettings?.refreshInterval || defaults.refreshInterval || 300000;
        return Math.max(1, Math.round(ms / 60000));
    }
    property bool editShowPercentInBar: pluginApi?.pluginSettings?.showPercentInBar ?? defaults.showPercentInBar ?? true
    property bool editTrackClaude: pluginApi?.pluginSettings?.trackClaude ?? defaults.trackClaude ?? true
    property bool editTrackCodex: pluginApi?.pluginSettings?.trackCodex ?? defaults.trackCodex ?? true
    property bool editTrackZai: pluginApi?.pluginSettings?.trackZai ?? defaults.trackZai ?? true
    property bool editTrackOpenRouter: pluginApi?.pluginSettings?.trackOpenRouter ?? defaults.trackOpenRouter ?? true
    property bool editTrackOpencodeZen: pluginApi?.pluginSettings?.trackOpencodeZen ?? defaults.trackOpencodeZen ?? true

    property string editOpenRouterKey: pluginApi?.pluginSettings?.OPENROUTER_API_KEY || defaults.OPENROUTER_API_KEY || ""
    property string editOpencodeKey: pluginApi?.pluginSettings?.OPENCODE_API_KEY || defaults.OPENCODE_API_KEY || ""
    property string editZaiKey: pluginApi?.pluginSettings?.ZAI_API_KEY || defaults.ZAI_API_KEY || ""

    spacing: Style.marginM

    NLabel {
        label: "Refresh"
        description: "How often usage is fetched"
    }

    NSpinBox {
        from: 1
        to: 60
        value: root.editRefreshMinutes
        suffix: " min"
        onValueChanged: root.editRefreshMinutes = value
    }

    NToggle {
        Layout.fillWidth: true
        label: "Show percentage in bar"
        description: "Display max usage percentage next to the icon"
        checked: root.editShowPercentInBar
        onToggled: checked => root.editShowPercentInBar = checked
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
        pluginApi.pluginSettings.showPercentInBar = root.editShowPercentInBar;
        if (pluginApi.mainInstance) pluginApi.mainInstance.showPercentInBar = root.editShowPercentInBar;

        pluginApi.pluginSettings.trackClaude = root.editTrackClaude;
        pluginApi.pluginSettings.trackCodex = root.editTrackCodex;
        pluginApi.pluginSettings.trackZai = root.editTrackZai;
        pluginApi.pluginSettings.trackOpenRouter = root.editTrackOpenRouter;
        pluginApi.pluginSettings.trackOpencodeZen = root.editTrackOpencodeZen;

        pluginApi.pluginSettings.OPENROUTER_API_KEY = root.editOpenRouterKey.trim();
        pluginApi.pluginSettings.OPENCODE_API_KEY = root.editOpencodeKey.trim();
        pluginApi.pluginSettings.ZAI_API_KEY = root.editZaiKey.trim();

        pluginApi.saveSettings();
        if (pluginApi.mainInstance) pluginApi.mainInstance.refreshUsage(true);
        Logger.i("AgentQuota", "Settings saved");
    }
}
