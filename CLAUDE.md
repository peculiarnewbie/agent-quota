# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Agent Quota is an AI coding assistant usage dashboard that monitors subscription quotas for Claude, Codex, Zai, OpenRouter, and Opencode Zen. It has three frontends:

- **`vite+bun/`** — Web dashboard (SolidJS + Tailwind + Bun API server)
- **`electron/`** — Electron desktop shell (thin wrapper around the `vite+bun` frontend)
- **`noctalia/`** — Noctalia desktop shell plugin (QML + standalone JS fetcher)

## Development Commands

### Web dashboard (`vite+bun/`)

```bash
cd vite+bun
bun install              # install dependencies
bun run dev              # start both API server (port 6767) and Vite dev server (port 6769)
bun run dev:api          # API server only (bun --hot api.ts)
bun run dev:frontend     # Vite dev server only
bun run start            # production API server (bun api.ts)
```

### Electron shell (`electron/`)

```bash
cd electron
bun install              # install dependencies
bun run dev              # start Vite dev server (port 6769) and Electron
```

To build the Electron app for production, first build the frontend in `vite+bun/`, then package Electron:

```bash
cd vite+bun && vite build   # build the shared frontend
cd ../electron && bun run dist
```

No test suite or linter is configured.

## Build Commands

### Electron Desktop App (`electron/`)

```bash
cd electron
bun install              # install dependencies
bun run dev              # start Vite dev server + Electron (HMR)
bun run build            # clean + build Vite renderer
bun run pack             # build portable .exe only
bun run dist             # build NSIS installer + portable .exe
```

Output goes to `electron/release/`:
- `AgentQuota-Setup-1.0.0.exe` — NSIS installer (assisted, custom install dir, shortcuts)
- `AgentQuota-Portable-1.0.0.exe` — standalone portable executable
- `win-unpacked/` — unpacked app directory

Icon notes: NSIS requires `.ico` format. The file `assets/app-icon.ico` is generated from `assets/app-icon.png`.

## Architecture

### Web Dashboard (`vite+bun/`)

Two-process architecture: a Bun HTTP API server + a Vite SolidJS frontend.

- **`api.ts`** — Bun.serve routes at `/api/usage` (all services) and `/api/usage/<service>`. Delegates to `src/lib/usage.ts`.
- **`src/lib/credentials.ts`** — Server-side credential resolution. Reads from environment variables and tool-specific auth files (`~/.claude/`, `~/.codex/`, `~/.zai/`, etc.).
- **`src/lib/usage.ts`** — Fetches quota data from each service's API. Exports per-service functions (`getClaudeUsage`, `getCodexUsage`, etc.) and `getAllUsage`. Returns normalized `ServiceUsage` objects with `fiveHour`/`sevenDay` usage windows.
- **`src/App.tsx`** — Universal SolidJS UI. Works both in a browser (polling `/api/usage`) and inside Electron (receiving data via IPC). Splits services into "Usage Tracking" (Claude, Codex, Zai, Opencode Go) and "Credits & Balance" (OpenRouter, Opencode Zen).
- Vite proxies `/api` requests to the Bun server in dev mode.

### Electron Shell (`electron/`)

Thin wrapper with no frontend code of its own. It loads the `vite+bun` frontend:

- **In development** — loads `http://localhost:6769` (Vite dev server from `vite+bun/`)
- **In production** — loads `../vite+bun/dist/index.html` (built files from `vite+bun/`)

The main process (`main.js`) imports `getAllUsage` from `src/lib/usage.js` and runs the usage-fetching logic directly (no Bun child process). Data is pushed to the renderer via IPC (`usage-update`). The renderer detects Electron via `window.electronAPI` and uses IPC channels (`requestUsage`, `refreshUsage`, `quitApp`) instead of HTTP fetches.

Files in `electron/src/lib/` are plain-JS copies of the TypeScript source in `vite+bun/src/lib/`. They are kept as `.js` so the Electron main process can import them without a transpiler.

### Noctalia Plugin (`noctalia/`)

Self-contained plugin for the Noctalia desktop shell. Uses QML for UI and a standalone `usage-fetcher.mjs` script (run via `bun`) that duplicates the credential resolution and API fetching logic. The fetcher writes JSON to stdout and is invoked as a subprocess by the QML code.

Key difference: the Noctalia version has its own credential lookup chain that includes Noctalia plugin settings and a plugin-local `.env` file.

## Credentials

API keys are never stored in the repo. All frontends resolve credentials from local auth files and environment variables. See `noctalia/README.md` for the full credential resolution order. A `.env` file in either subdirectory is gitignored.

## Adding a New Service

1. Add credential resolver in `vite+bun/src/lib/credentials.ts`
2. Add usage fetcher in `vite+bun/src/lib/usage.ts` following the `ServiceUsage` interface
3. Register the route in `vite+bun/api.ts`
4. Add to the `fetchers` array in `getAllUsage()`
5. Classify as usage-tracking or credit-based in `App.tsx` (`usageServices`/`creditServices`)
6. Mirror changes in `electron/src/lib/usage.js` and `electron/src/lib/credentials.js` for the Electron shell
7. Mirror changes in `noctalia/usage-fetcher.mjs` for the Noctalia plugin
