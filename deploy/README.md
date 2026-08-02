# Agent-box deploy

User systemd unit that runs the built binary from this git checkout (so `~/.codex`, `~/.claude`, `~/.config/cursor`, etc. resolve as the logged-in user).

## Build

```bash
cd ~/git/other/agent-quota   # or your checkout
pnpm install
pnpm build
```

Binary: `dist/agent-quota`. UI: `packages/web/dist`.

## Install (user unit)

1. Edit `WorkingDirectory` / `ExecStart` in `agent-quota.service` if the repo is not at `~/git/other/agent-quota`.
2. Install and start:

```bash
mkdir -p ~/.config/systemd/user
cp deploy/agent-quota.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now agent-quota
systemctl --user status agent-quota
```

3. Keep it running after logout:

```bash
loginctl enable-linger "$USER"
```

## Reachability (VPN)

From another host on the VPN:

```bash
curl -s http://<agent-box>:6767/health
curl -s http://<agent-box>:6767/api/usage | jq .
```

No auth — rely on VPN. Bind is `0.0.0.0:6767`.

## Cache / refresh

| Env | Default | Role |
|-----|---------|------|
| `USAGE_CACHE_TTL_MS` | `900000` | Shared snapshot TTL |
| `CLAUDE_FETCH_COOLDOWN_MS` | `1200000` | Claude live-fetch cooldown |
| `USAGE_HTTP_TIMEOUT_MS` | `8000` | Provider HTTP timeout |
| `USAGE_HISTORY_INTERVAL_MS` | `900000` | Background history sampling interval |
| `USAGE_HISTORY_RETENTION_DAYS` | `90` | History retention period |
| `USAGE_HISTORY_DB` | `~/.config/agent-quota/usage-history.sqlite3` | Optional SQLite path override |

`GET /api/usage?refresh=1` bypasses TTL; Claude cooldown still applies.
History is persisted in SQLite and is available at
`GET /api/usage/:service/history?days=30` (up to 365 days).
The same sampling interval choices are available in the web Settings panel.

## Config

`~/.config/agent-quota/config.json` (mode `0600`):

- OpenCode Go workspace + cookie (also editable in the web Settings UI)
- Optional extra Codex accounts via Settings (`authJson` path) or `codexAccounts` in the file
- Labels editable in the same Settings section

Env `OPENCODE_GO_*` still overrides the file when set.

## Update

```bash
cd ~/git/other/agent-quota
git pull
pnpm build
systemctl --user restart agent-quota
```
