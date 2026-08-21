---
id: ISSUE-005
title: dev:setup readiness check polls wrong Postgres port
status: resolved
created: 2026-08-20
resolved: 2026-08-20
---

## Summary

`pnpm dev:setup` hangs indefinitely on a fresh checkout. Its readiness loop
runs `pg_isready -h localhost -p 5432`, but `docker-compose.yml` maps
Postgres to `${DB_PORT:-5433}` on the host, so nothing is listening on 5432
and the `until` loop never exits.

## Details

- Affected script: `dev:setup` in `package.json`.
- Postgres container (`db` service) is healthy and accepting connections on
  its mapped host port (5433 by default, or `DB_PORT` from `.env`) well
  before the hang — the container itself starts fine.
- Repro: `pnpm dev:setup` on a checkout with the default/`.env`-configured
  `DB_PORT=5433`.

## Resolution

- **2026-08-20:** Fixed on branch `fix/dev-setup-db-port` (commit `be148b1`)
  by changing the readiness check to `pg_isready -h localhost -p
  ${DB_PORT:-5433}`. Merged into `main` via merge commit `9784307`. Also
  open as upstream PR #48 (`KenTaniguchi-R/ledgr`, still unmerged upstream
  as of this writing).
