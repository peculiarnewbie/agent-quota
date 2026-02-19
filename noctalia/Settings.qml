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

    property string editOpenRouterKey: pluginApi?.pluginSettings?.OPENROUTER_API_KEY || defaults.OPENROUTER_API_KEY || ""
    property string editOpencodeKey: pluginApi?.pluginSettings?.OPENCODE_API_KEY || defaults.OPENCODE_API_KEY || ""
    property string editZaiKey: pluginApi?.pluginSettings?.ZAI_API_KEY || defaults.ZAI_API_KEY || ""
    property string editOpenAiKey: pluginApi?.pluginSettings?.OPENAI_API_KEY || defaults.OPENAI_API_KEY || ""
    property string editClaudeToken: pluginApi?.pluginSettings?.CLAUDE_ACCESS_TOKEN || defaults.CLAUDE_ACCESS_TOKEN || ""

    spacing: Style.marginM

    NLabel {
        label: "Refresh"
        description: "How often usage is fetched"
    }

    NSpinBox {
        from: 1
        to: 60
        value: root.editRefreshMinutes
        onValueChanged: root.editRefreshMinutes = value
    }

    NToggle {
        Layout.fillWidth: true
        label: "Show percentage in bar"
        description: "Display max usage percentage next to the icon"
        checked: root.editShowPercentInBar
        onCheckedChanged: root.editShowPercentInBar = checked
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

    NTextInput {
        Layout.fillWidth: true
        label: "OpenAI API Key (Codex fallback)"
        placeholderText: "sk-..."
        text: root.editOpenAiKey
        onTextChanged: root.editOpenAiKey = text
    }

    NTextInput {
        Layout.fillWidth: true
        label: "Claude Access Token"
        placeholderText: "Optional token override"
        text: root.editClaudeToken
        onTextChanged: root.editClaudeToken = text
    }

    NLabel {
        label: "Tip"
        description: "You can also put these keys in ~/.config/noctalia/plugins/agent-quota/.env"
    }

    function saveSettings() {
        if (!pluginApi) return;

        pluginApi.pluginSettings.refreshInterval = root.editRefreshMinutes * 60000;
        pluginApi.pluginSettings.showPercentInBar = root.editShowPercentInBar;

        pluginApi.pluginSettings.OPENROUTER_API_KEY = root.editOpenRouterKey.trim();
        pluginApi.pluginSettings.OPENCODE_API_KEY = root.editOpencodeKey.trim();
        pluginApi.pluginSettings.ZAI_API_KEY = root.editZaiKey.trim();
        pluginApi.pluginSettings.OPENAI_API_KEY = root.editOpenAiKey.trim();
        pluginApi.pluginSettings.CLAUDE_ACCESS_TOKEN = root.editClaudeToken.trim();

        pluginApi.saveSettings();
        Logger.i("AgentQuota", "Settings saved");
    }
}
