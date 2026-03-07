# Agent Quota - Noctalia Plugin

AI API usage tracking for Noctalia shell. Displays usage limits for Claude, Codex, Zai, OpenRouter, and Opencode Zen.

## Features

- **Bar Widget**: Quick glance at your highest usage-window percentage (Claude/Codex/Zai)
- **Panel**: Detailed view of all service usage with progress bars and reset times
- **Settings page**: Configure refresh, active tracked sources, and API keys directly in Noctalia

## Requirements

- `bun` must be installed and available on your PATH

## Installation

```bash
ln -s $(pwd)/noctalia ~/.config/noctalia/plugins/agent-quota
```

### Manual Installation

1. Copy the plugin directory to your Noctalia plugins folder:

```bash
cp -r noctalia ~/.config/noctalia/plugins/agent-quota
```

2. Restart Noctalia or run with debug mode:

```bash
systemctl --user restart noctalia
```

3. Enable the plugin in Noctalia Settings > Plugins

4. Add the widget to your bar in Settings > Bar


## Credentials

The plugin checks credentials in this order:

1. Environment variables inherited by Noctalia
2. Plugin settings (Noctalia Settings > Plugins > Agent Quota > Configure)
3. Plugin `.env` file: `~/.config/noctalia/plugins/agent-quota/.env`
4. Tool-specific auth files

### Quick fix if you see "No credentials found"

- Open plugin settings and paste keys there, or
- Create `~/.config/noctalia/plugins/agent-quota/.env` with your keys

Example `.env`:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
OPENCODE_API_KEY=sk-...
```

### Tool-specific auth files

### Claude
- `~/.claude/.credentials.json`
- `~/.claude/credentials.json`
- `~/.config/claude/credentials.json`

### Codex (OpenAI)
- `~/.codex/auth.json`
- `~/.config/codex/auth.json`

### Zai
- `~/.zai/config.json`
- `~/.config/zai/config.json`
- Environment variables: `ZAI_API_KEY`, `ZAI_KEY`, `ZHIPU_API_KEY`, `ZHIPUAI_API_KEY`

### OpenRouter
- `OPENROUTER_API_KEY` environment variable

### Opencode Zen
- `OPENCODE_API_KEY` environment variable

## Settings

- `refreshInterval`: How often to refresh usage data (default: 300000ms / 5 minutes)
- `showPercentInBar`: Show percentage in bar widget (default: true)
- `trackClaude`, `trackCodex`, `trackZai`, `trackOpenRouter`, `trackOpencodeZen`: Toggle polling per service
- `OPENROUTER_API_KEY`, `OPENCODE_API_KEY`, `ZAI_API_KEY`

## Usage

1. Click the bar widget to open the detailed panel
2. The bar widget shows the highest usage percentage across Claude/Codex/Zai windows
3. Color coding:
   - Green: < 70% usage
   - Yellow: 70-90% usage
   - Orange: 90-100% usage
   - Red: 100%+ usage

## Supported Services

| Service | Quota Type | Metrics |
|---------|------------|---------|
| Claude | 5h / 7d windows | Utilization percentage |
| Codex | 5h / 7d windows | Utilization percentage |
| Zai | 5h / 7d windows | Utilization percentage |
| OpenRouter | Credits | Used/remaining balance |
| Opencode Zen | Credits | Used/remaining balance |

## License

MIT
