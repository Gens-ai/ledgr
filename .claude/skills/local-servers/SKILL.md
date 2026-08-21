---
name: local-servers
description: "Start, stop, or check Ledgr's local dev environment (Postgres + Next.js dev server) and open Drizzle Studio. Use when the user asks to start/stop local servers, boot up the app, or open Drizzle Studio/the DB browser."
---

# Ledgr local dev servers

Project-specific startup for Ledgr. This overrides the generic `dev-servers`
skill's stack-detection steps — follow this file exclusively once loaded.

## Starting

```bash
pnpm dev:setup
```

This runs `pnpm dev:db` (starts the `db` Postgres container via `docker
compose up db -d`), waits for readiness with `pg_isready -h localhost -p
${DB_PORT:-5433}`, runs `pnpm db:migrate`, then starts `pnpm dev`.

**Port note:** Postgres is published to the host on `DB_PORT` (default
**5433**, set in `.env`), not the Postgres-standard 5432 — the container's
internal port is still 5432. `dev:setup`'s readiness check already accounts
for this (fixed in `ISSUE-005`); don't hardcode 5432 in any replacement
command.

If you only need the DB (e.g. running tests or scripts against it without
the dev server), use `pnpm dev:db` alone.

The dev server is Next.js with Turbopack, and normally comes up in well
under a second once Postgres is ready:

```
▲ Next.js 16.2.10 (Turbopack)
- Local:         http://localhost:4200
✓ Ready in ~500ms
[scheduler] started: snapshot=..., safety-sync=...
```

- **App**: http://localhost:4200 (or `PORT` from `.env` if overridden)
- **Postgres**: `localhost:${DB_PORT:-5433}` (container name `ledgr-db-1`)

Run `pnpm dev:setup` in the background (it never exits — the dev server
keeps running) and poll its output for `Ready in` / `EADDRINUSE` / `Error`
rather than waiting synchronously.

## Drizzle Studio (DB browser)

```bash
pnpm db:studio
```

This **only starts a local proxy on :4983** — it is not itself the UI.
Open **https://local.drizzle.studio** in a browser to actually use it; that
hosted page connects back to your local proxy. Opening the hosted URL
before the proxy is running (or after it's stopped) shows a connection
error, which is easy to mistake for a real problem.

## Stopping

```bash
bash ~/.claude/skills/dev-servers/scripts/stop-dev
```

Stops all running Docker containers (including `ledgr-db-1`) and kills Vite
dev servers. This is the same generic teardown the `dev-servers` skill
uses — no Ledgr-specific stop step is needed. Note it does not kill a
`pnpm db:studio` proxy process; kill that separately if it's running.

## Other useful scripts

```bash
pnpm db:generate      # Generate a new Drizzle migration from schema changes
pnpm test:changed     # Vitest, only tests touching files changed vs HEAD
pnpm typecheck        # tsc --noEmit
pnpm lint             # ESLint
```

See `CLAUDE.md` at the repo root for the full command reference.
