# Agent Quota — rearchitecture plan

Extend this doc as work proceeds. Keep steps coarse; add detail under a step when you start it.

## Decisions (locked)

| # | Choice |
|---|---|
| Server | **Rust from day one** — no always-on Bun on the agent box |
| Electron | **Delete** (for now) |
| Providers v1 | **Codex, Claude, Cursor, OpenCode** (multi-source / CodexBar-shaped) |
| Layout | **Greenfield `packages/`** (git-glance shape); migrate UI out of `vite+bun`, then remove old trees |
| Noctalia | **Last** — only after it can be a dumb HTTP renderer |

VPN-only access is enough auth for now. Credentials live on the agent box.

## Target shape

```text
packages/server   — Rust: providers + /api + serves static UI
packages/web      — Solid/Vite UI (from vite+bun), build output consumed by server
(noctalia later)  — poll server over VPN; no local fetcher
```

One process in prod. Clients only speak HTTP.

## Steps

### 1. Scaffold git-glance-shaped monorepo — done
- `packages/server` (Rust/axum) + `packages/web` (Solid/Vite, UI copied from `vite+bun`).
- Server serves built static assets + `/health` + stub `/api/usage`.
- Scripts: `pnpm build` → `pnpm start` (binary + `--static packages/web/dist`); `pnpm dev` runs cargo + Vite.
- Bun is not the production runtime.

### 2. Delete Electron — done
- Removed `electron/`.
- UI is browser-only against `/api/usage` (no `electronAPI` / IPC).

### 3. Stabilize the HTTP contract — done
Goal: one JSON shape the web UI (and later Noctalia) can rely on, before providers are real.

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

### 6. Retire old trees
- Remove `vite+bun` Bun API path, duplicated JS fetchers, and dead docs once `packages/*` is the source of truth.
- Update root README / CLAUDE.md to match.

### 7. Noctalia as dumb client (only when 1–6 are done)
- Settings: server base URL.
- Poll `/api/usage`, render bars.
- Delete `usage-fetcher.mjs` and local credential resolution from the plugin.

## Out of scope until someone extends this plan

- Porting remaining providers
- Bringing Electron back as a thin shell
- Non-VPN auth
- WebSocket/SSE push
- Browser cookie-DB importers beyond what v1 needs
- Perfect parity with CodexBar’s full catalog

## Progress

- [x] 1 Scaffold
- [x] 2 Delete Electron
- [x] 3 HTTP contract + web on API
- [x] 4 Providers v1 (Codex, Claude, Cursor, OpenCode)
- [x] 5 Agent-box deploy
- [ ] 6 Retire old trees / docs
- [ ] 7 Noctalia dumb client
