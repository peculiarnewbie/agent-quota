# Agent Quota

AI coding assistant usage dashboard for **Codex**, **Claude**, **Cursor**, and **OpenCode**. One Rust server on the agent box fetches quotas (local creds) and serves the Solid UI over HTTP — VPN reachability is enough auth for now.

## Quick start

```bash
pnpm install
pnpm build
pnpm start
```

Then open `http://127.0.0.1:6767`. For systemd on the agent box, see [`deploy/README.md`](deploy/README.md).

Dev (API + Vite HMR): `pnpm dev` — API on `:6767`, UI on `:6769`.

## Config

Settings live in `~/.config/agent-quota/config.json` (created mode `0600`):

- **OpenCode Go** — one or more accounts (workspace id + auth cookie) via Settings → **+ add account**
- **Extra Codex accounts** — Settings → **+ add auth.json** (path to another Codex `auth.json`). Labels optional.

## Layout

| Path | Role |
|------|------|
| `packages/server` | Rust/axum API + static file server |
| `packages/web` | Solid/Vite UI |
| `deploy/` | User systemd unit |

![Web dashboard](screenshot-vite.webp)

Inspired by [openusage](https://www.openusage.ai/) and [cclimits](https://github.com/cruzanstx/cclimits).
