# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Agent Quota is an AI coding assistant usage dashboard. Production is one Rust process that fetches quotas and serves the UI:

- **`packages/server`** — Rust (axum): providers, `/api/usage`, settings, in-memory cache, static UI
- **`packages/web`** — SolidJS + Vite dashboard (build output at `packages/web/dist`)

v1 providers: Codex (multi-account rows), Claude, Cursor, OpenCode.

## Development Commands

From the repo root:

```bash
pnpm install          # workspace deps (web)
pnpm dev              # Rust API :6767 + Vite :6769 (scripts/dev.mjs)
pnpm build            # Vite build + cargo release → dist/agent-quota (scripts/build.mjs)
pnpm start            # run dist/agent-quota --static packages/web/dist (scripts/start.mjs)
```

Useful splits:

```bash
pnpm dev:web          # Vite only
pnpm dev:server       # cargo run API only (:6767)
```

Production on the agent box: see [`deploy/README.md`](deploy/README.md) (user systemd unit).

No test suite or linter is configured.

## Architecture

### Server (`packages/server`)

Single axum binary:

- **`main.rs`** — CLI (`--bind`, `--port`, `--static`), routes `/health`, `/api/usage`, `/api/usage/:service`, `/api/settings*`, SPA fallback from `--static`
- **`config.rs`** — `~/.config/agent-quota/config.json` (mode `0600`): OpenCode Go + Codex account list
- **`types.rs`** — `ServiceUsage` / `UsageWindow` / statuses (camelCase JSON); optional `displayName`
- **`providers/`** — Codex (N rows), Claude, Cursor, OpenCode fetchers + shared HTTP/strategy helpers
- **`cache.rs`** — TTL snapshot cache + Claude cooldown; `?refresh=1` bypasses TTL; settings writes invalidate

### Web (`packages/web`)

SolidJS UI polls `GET /api/usage`. Types in `src/lib/types.ts` must stay aligned with Rust `types.rs`. Settings panel talks to `/api/settings*`. In dev, Vite proxies `/api` to the Rust server.

## Credentials

Resolved only on the agent box by the Rust server (never stored in the repo):

- Env vars and tool auth files (`~/.codex`, `~/.claude`, Cursor auth paths)
- OpenCode Go: env `OPENCODE_GO_*` → config `opencodeGo` → legacy opencode-quota JSON
- Extra Codex accounts: `codexAccounts` in config (`authJson` path only)

- Settings UI can write OpenCode Go and Codex accounts (`authJson` paths + labels)

## Config (`~/.config/agent-quota/config.json`)

```json
{
  "version": 1,
  "opencodeGoAccounts": [
    { "id": "opencode", "label": "Personal", "workspaceId": "...", "authCookie": "..." },
    { "id": "work", "label": "Work", "workspaceId": "...", "authCookie": "..." }
  ],
  "codexAccounts": [
    { "id": "codex", "label": "Personal", "local": true },
    { "id": "work", "label": "Work", "authJson": "/home/you/.codex-work/auth.json" }
  ]
}
```

Extra Codex rows appear as `service: "codex-<id>"`; OpenCode as `opencode-<id>` (id `opencode` stays `"opencode"`). `displayName` comes from `label`.

## Adding a New Service

1. Add a provider module under `packages/server/src/providers/` and wire it in `providers/mod.rs`
2. Extend `ServiceUsage` / service id handling in `packages/server/src/types.rs` as needed
3. Register the service in the all-usage aggregator so `GET /api/usage` always includes it
4. Update `isUsageService` / filters in `packages/web/src/lib/types.ts` and `App.tsx` if needed

Do not mirror fetchers into other clients; providers belong in the Rust server.
