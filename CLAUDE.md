# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Agent Quota is an AI coding assistant usage dashboard that monitors subscription quotas for Claude, Codex, Zai, OpenRouter, and Opencode Zen. It has two frontends:

- **`vite+bun/`** — Web dashboard (SolidJS + Tailwind + Bun API server)
- **`noctalia/`** — Noctalia desktop shell plugin (QML + standalone JS fetcher)

## Development Commands

All commands run from `vite+bun/`:

```bash
cd vite+bun
bun install              # install dependencies
bun run dev              # start both API server (port 6767) and Vite dev server (port 6769)
bun run dev:api          # API server only (bun --hot api.ts)
bun run dev:frontend     # Vite dev server only
bun run start            # production API server (bun api.ts)
```

No test suite or linter is configured.

## Architecture

### Web Dashboard (`vite+bun/`)

Two-process architecture: a Bun HTTP API server + a Vite SolidJS frontend.

- **`api.ts`** — Bun.serve routes at `/api/usage` (all services) and `/api/usage/<service>`. Delegates to `src/lib/usage.ts`.
- **`src/lib/credentials.ts`** — Server-side credential resolution. Reads from environment variables and tool-specific auth files (`~/.claude/`, `~/.codex/`, `~/.zai/`, etc.).
- **`src/lib/usage.ts`** — Fetches quota data from each service's API. Exports per-service functions (`getClaudeUsage`, `getCodexUsage`, etc.) and `getAllUsage`. Returns normalized `ServiceUsage` objects with `fiveHour`/`sevenDay` usage windows.
- **`src/App.tsx`** — SolidJS UI. Polls `/api/usage` every 5 minutes. Splits services into "Usage Tracking" (Claude, Codex, Zai) and "Credits & Balance" (OpenRouter, Opencode Zen).
- Vite proxies `/api` requests to the Bun server in dev mode.

### Noctalia Plugin (`noctalia/`)

Self-contained plugin for the Noctalia desktop shell. Uses QML for UI and a standalone `usage-fetcher.mjs` script (run via `bun`) that duplicates the credential resolution and API fetching logic. The fetcher writes JSON to stdout and is invoked as a subprocess by the QML code.

Key difference: the Noctalia version has its own credential lookup chain that includes Noctalia plugin settings and a plugin-local `.env` file.

## Credentials

API keys are never stored in the repo. Both frontends resolve credentials from local auth files and environment variables. See `noctalia/README.md` for the full credential resolution order. A `.env` file in either subdirectory is gitignored.

## Adding a New Service

1. Add credential resolver in `vite+bun/src/lib/credentials.ts`
2. Add usage fetcher in `vite+bun/src/lib/usage.ts` following the `ServiceUsage` interface
3. Register the route in `vite+bun/api.ts`
4. Add to the `fetchers` array in `getAllUsage()`
5. Classify as usage-tracking or credit-based in `App.tsx` (`usageServices`/`creditServices`)
6. Mirror changes in `noctalia/usage-fetcher.mjs` for the Noctalia plugin
