# Agent Quota — rearchitecture plan

Extend this doc as work proceeds. Keep steps coarse; add detail under a step when you start it.

## Decisions (locked)

| # | Choice |
|---|---|
| Server | **Rust from day one** — no always-on Bun on the agent box |
| Electron | **Delete** (for now) |
| Providers v1 | **Codex, Claude, Cursor, OpenCode** (multi-source / CodexBar-shaped) |
| Layout | **Greenfield `packages/`** (git-glance shape); old Bun tree removed in step 6 |
| Noctalia | Retired; no shell plugin is maintained |

VPN-only access is enough auth for now. Credentials live on the agent box.

## Target shape

```text
packages/server   — Rust: providers + /api + serves static UI
packages/web      — Solid/Vite UI, build output consumed by server
```

One process in prod. Clients only speak HTTP.

## Steps

### 1. Scaffold git-glance-shaped monorepo — done
- `packages/server` (Rust/axum) + `packages/web` (Solid/Vite, UI migrated from the old Bun tree).
- Server serves built static assets + `/health` + stub `/api/usage`.
- Scripts: `pnpm build` → `pnpm start` (binary + `--static packages/web/dist`); `pnpm dev` runs cargo + Vite.
- Bun is not the production runtime.

### 2. Delete Electron — done
- Removed the Electron desktop shell.
- UI is browser-only against `/api/usage` (no `electronAPI` / IPC).

### 3. Stabilize the HTTP contract — done
Goal: one JSON shape the web UI can rely on, before providers are real.

#### Routes
| Method | Path | Response |
|--------|------|----------|
| `GET` | `/health` | `{ "status": "ok" }` |
| `GET` | `/api/usage` | `ServiceUsage[]` — all v1 providers, always present |
| `GET` | `/api/usage/:service` | single `ServiceUsage` or 404 |

`?refresh=1` bypasses TTL (step 5); Claude cooldown still applies.

#### `ServiceUsage` (locked for v1)

```ts
type ServiceStatus = "ok" | "error" | "no_credentials" | "throttled";

interface UsageWindow {
  used: string;          // display string ("12%" or "$1.20")
  remaining: string;
  resetsIn: string;      // human ("2h 15m")
  resetsAtMs: number;    // epoch ms; 0 if unknown
  usedPercent: number;   // 0–100+; primary for bars
  label?: string;        // override ("5h", "session", "balance")
}

interface ServiceUsage {
  service: string;       // "codex" | "claude" | "cursor" | "opencode"
  status: ServiceStatus;
  error?: string;        // short machine/human message when not ok
  hint?: string;         // how to fix (path, env var name) — never secrets
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  monthly?: UsageWindow;
  plan?: string;
  source?: string;       // which credential/source won (e.g. "env:CLAUDE_COOKIE", "~/.codex/auth.json")
}
```

Notes:
- **Array always includes all four v1 services** so the UI can render slots without hardcoding fetchers. Missing creds → `no_credentials`, not omitted.
- **`source` is required on `ok`** (and nice-to-have on errors that got past auth). This is the “source that won” field from CodexBar-style fallbacks.
- **Windows are optional** — a provider may only fill `fiveHour`, or only `monthly`. UI already handles that.
- **Credits-style providers** (OpenRouter, etc.) are out of v1; if they return later they can reuse the same shape (put balance in `fiveHour.remaining` / `used` as today).
- **No nested `sources[]` in v1** — only the winner. Failed attempts stay in server logs / optional `hint`.
- **Throttled**: server may return `status: "throttled"` with no windows; client keeps last good snapshot (current UI behavior).

#### Client work in this step — done
- `packages/web/src/lib/types.ts` mirrors Rust `types.rs` (`V1_SERVICES`, statuses, windows).
- UI polls `/api/usage` only; section filters use `V1_SERVICES`.

#### Server work in this step — done
- Typed Rust structs in `packages/server/src/types.rs` (`Serialize` / `Deserialize`, camelCase JSON).
- Stub `/api/usage` returns all four v1 services with `status: "error"`.
- Provider HTTP calls deferred to step 4.

### 4. Provider engine (v1 set only) — done
- CodexBar-inspired pipeline in `packages/server/src/providers/`.
- **Codex:** oauth (`~/.codex/auth.json`) → api key probe.
- **Claude:** oauth credentials / `CLAUDE_ACCESS_TOKEN`.
- **Cursor:** env/`cursor.json` → Linux `state.vscdb` → Connect RPC.
- **OpenCode:** Go dashboard via env/manual cookie + workspace id.
- Skipped for v1: browser cookie-DB importers, CLI RPC/PTY, Claude web cookies, CodexBar `_server` RPC.
- Other old providers (Zai, OpenRouter, etc.): not ported.

### 5. Agent-box deploy — done
- **systemd**: user unit [`deploy/agent-quota.service`](deploy/agent-quota.service); `WorkingDirectory` = git checkout; `ExecStart` = `dist/agent-quota --static packages/web/dist --bind 0.0.0.0 --port 6767`. See [`deploy/README.md`](deploy/README.md).
- **Cache** ([`packages/server/src/cache.rs`](packages/server/src/cache.rs)): in-memory TTL (default 60s, `USAGE_CACHE_TTL_MS`) + Claude cooldown (default 20m, `CLAUDE_FETCH_COOLDOWN_MS`). Concurrent refreshes singleflight under one mutex. `?refresh=1` bypasses TTL; Claude cooldown still applies (reuse last ok, else `throttled`).
- **Cursor creds**: also reads `~/.config/cursor/auth.json` (Linux agent/CLI).
- VPN reachability: bind `0.0.0.0`; no app auth (VPN-only).

### 6. Retire old trees / docs — done
- Deleted the obsolete Bun API + old Solid UI tree; source of truth is `packages/web` + `packages/server`.
- Noctalia was later retired as an unused client.
- Dropped ephemeral junk (`step-5-*.md`, `nohup.out`); gitignore `*.out` / `nohup.out`.
- Rewrote root `README.md` and `CLAUDE.md` / `AGENTS.md` for the monorepo (no Electron / Bun command blocks).
- Workspace (`package.json`, `pnpm-workspace.yaml`, `scripts/`) already pointed at `packages/*` only.

### 7. Multi Codex slots + OpenCode Go settings — done
- Config file: `~/.config/agent-quota/config.json` (mode `0600`) via [`packages/server/src/config.rs`](packages/server/src/config.rs).
- Multi-Codex: extra `ServiceUsage` rows (`codex-<slug>`) from `codexAccounts`; local `~/.codex` still auto for `"codex"`. Optional `displayName` on cards.
- Settings API: `GET /api/settings`, `PUT /api/settings/opencode`, `PUT /api/settings/codex` (cookie masked on GET; blank cookie leaves previous; Codex accounts via `authJson` paths).
- OpenCode creds: env → config `opencodeGo` → legacy opencode-quota JSON.
- Web Settings panel: OpenCode paste + Codex account list (add/remove `authJson` paths, labels).
- Cache bust after settings writes.

### 8. Noctalia as dumb client — done
- Settings: `serverBaseUrl` (default `http://127.0.0.1:6767`); refresh + bar display + track filters for Claude / Codex / Cursor / OpenCode.
- `Main.qml` polls `GET /api/usage` (`?refresh=1` on force); local disk cache only; no credential/file/env fetchers, no curl Process for OpenCode.
- Panel/bar render multi-Codex and multi-OpenCode rows (`displayName`, `accountEmail`); monthly windows for OpenCode.
- README documents VPN URL + that creds live on the server.

### 9. Retire Noctalia plugin — done
- Removed the unused `noctalia/` shell plugin and its client-specific documentation.

## Out of scope until someone extends this plan

- Porting remaining providers
- Bringing Electron back as a thin shell
- Non-VPN auth
- WebSocket/SSE push
- Browser cookie-DB importers beyond what v1 needs
- Perfect parity with CodexBar’s full catalog
- Codex / Claude / Cursor credential paste UI

## Progress

- [x] 1 Scaffold
- [x] 2 Delete Electron
- [x] 3 HTTP contract + web on API
- [x] 4 Providers v1 (Codex, Claude, Cursor, OpenCode)
- [x] 5 Agent-box deploy
- [x] 6 Retire old trees / docs
- [x] 7 Multi Codex + OpenCode settings
- [x] 8 Noctalia dumb client
- [x] 9 Retire Noctalia plugin
