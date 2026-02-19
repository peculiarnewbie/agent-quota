# Agent Quota - Noctalia Plugin

AI API usage tracking for Noctalia shell. Displays usage limits for Claude, Codex, Zai, OpenRouter, and Opencode Zen.

## Features

- **Bar Widget**: Quick glance at your highest API usage percentage
- **Panel**: Detailed view of all service usage with progress bars and reset times
- **Settings page**: Configure refresh + API keys directly in Noctalia
- **Auto-refresh**: Configurable refresh interval (default: 5 minutes)

## Requirements

- `bun` must be installed and available on your PATH

## Installation

### Manual Installation

1. Copy the plugin directory to your Noctalia plugins folder:

```bash
cp -r noctalia-plugin ~/.config/noctalia/plugins/agent-quota
```

2. Restart Noctalia or run with debug mode:

```bash
NOCTALIA_DEBUG=1 qs -c noctalia-shell --no-duplicate
```

3. Enable the plugin in Noctalia Settings > Plugins

4. Add the widget to your bar in Settings > Bar

### Development/Symlink

For development, symlink the plugin directory:

```bash
ln -s $(pwd)/noctalia-plugin ~/.config/noctalia/plugins/agent-quota
```

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
ZAI_API_KEY=...
OPENAI_API_KEY=sk-...
CLAUDE_ACCESS_TOKEN=...
```

### Tool-specific auth files

### Claude
- `~/.claude/.credentials.json`
- `~/.claude/credentials.json`
- `~/.config/claude/credentials.json`
- `CLAUDE_ACCESS_TOKEN` environment variable

### Codex (OpenAI)
- `~/.codex/auth.json`
- `~/.config/codex/auth.json`
- `OPENAI_API_KEY` environment variable

### Zai
- `~/.zai/config.json`
- `~/.config/zai/config.json`
- Environment variables: `ZAI_API_KEY`, `ZAI_KEY`, `ZHIPU_API_KEY`, `ZHIPUAI_API_KEY`

### OpenRouter
- `~/.config/openrouter/config.json`
- `~/.openrouter/config.json`
- `OPENROUTER_API_KEY` environment variable

### Opencode Zen
- `~/.config/opencode/config.json`
- `~/.opencode/config.json`
- `OPENCODE_API_KEY` environment variable

## Settings

- `refreshInterval`: How often to refresh usage data (default: 300000ms / 5 minutes)
- `showPercentInBar`: Show percentage in bar widget (default: true)
- `OPENROUTER_API_KEY`, `OPENCODE_API_KEY`, `ZAI_API_KEY`, `OPENAI_API_KEY`, `CLAUDE_ACCESS_TOKEN`

## Usage

1. Click the bar widget to open the detailed panel
2. The bar widget shows the highest usage percentage across all services
3. Color coding:
   - Green: < 70% usage
   - Yellow: 70-90% usage
   - Orange: 90-100% usage
   - Red: 100%+ usage

## Supported Services

| Service | Quota Type | Metrics |
|---------|------------|---------|
| Claude | 5h / 7d windows | Utilization percentage |
| Codex | Primary / Secondary windows | Rate limit percentage |
| Zai | Tokens limit | Usage percentage |
| OpenRouter | Credits | Used/remaining balance |
| Opencode Zen | Balance | Remaining credits |

## License

MIT
