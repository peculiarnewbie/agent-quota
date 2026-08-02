# Agent Quota — Noctalia plugin

Dumb HTTP client for [Noctalia](https://github.com/noctalia-dev/noctalia-shell). Polls the agent-quota Rust server over VPN and renders usage bars. **No local credential fetch.**

v1 services (from `GET /api/usage`): Codex (multi-account), Claude, Cursor, OpenCode (multi-account).

## Requirements

- agent-quota running on the agent box (see [`deploy/README.md`](../deploy/README.md))
- VPN (or localhost) reachability to that server’s `--bind` / `--port`

`bun` is **not** required.

## Installation

```bash
ln -s $(pwd)/noctalia ~/.config/noctalia/plugins/agent-quota
```

Or copy the directory. Restart Noctalia / Quickshell (on this setup: `qs kill -c noctalia-shell` then `qs -d -c noctalia-shell`), enable the plugin, add the bar widget.

## Settings

| Key | Default | Purpose |
|-----|---------|---------|
| `serverBaseUrl` | `http://127.0.0.1:6767` | Agent-quota base URL (no trailing slash). Use the VPN IP/hostname when not local. |
| `refreshInterval` | `300000` | Auto-poll interval in ms (`0` = off) |
| `barDisplayItems` | `claude-5h`, `codex-7d`, `cursor` | Ordered bar percentages; Codex uses its weekly quota |
| `trackClaude` / `trackCodex` / `trackCursor` / `trackOpencode` | `true` | Client-side filters for which `/api/usage` rows to show |

Credentials and OpenCode/Codex account lists are configured on the **server** (web Settings or `~/.config/agent-quota/config.json`), not in this plugin.

## Usage

1. Set **Server → Base URL** to the agent box (e.g. `http://10.x.x.x:6767`)
2. Click the bar widget for the panel (all multi-Codex / OpenCode rows)
3. Colors: green &lt;70%, yellow 70–90%, orange 90–100%, red 100%+

Manual refresh: panel refresh button, or IPC `plugin:agent-quota` → `refresh`.

## License

MIT
