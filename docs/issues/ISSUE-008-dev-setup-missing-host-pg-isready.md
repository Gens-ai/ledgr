---
id: ISSUE-008
title: dev:setup readiness check hangs when host has no pg_isready binary
status: resolved
created: 2026-08-21
resolved: 2026-08-21
---

## Summary

`pnpm dev:setup` hung indefinitely even after `ISSUE-005` fixed the port it
polled. On a host with no Postgres client tools installed, `pg_isready`
resolves to nothing, the `until` loop's condition always fails
(command-not-found → non-zero exit), and the loop retries forever with no
error output — indistinguishable from a slow-starting container.

## Details

- Affected script: `dev:setup` in `package.json`.
- The `db` service container itself was already healthy and accepting
  connections on its mapped port well before the hang — same shape as
  `ISSUE-005`, different cause.
- Repro: `pnpm dev:setup` on a host without `psql`/`pg_isready` installed
  (e.g. no `postgresql-client` package).
- The `db` service's own Docker healthcheck already runs `pg_isready -U
  ledgr` *inside* the container (`docker-compose.yml`), which is always
  present there since it ships with the `postgres:18-alpine` image — the
  host never actually needed its own copy.

## Resolution

- **2026-08-21:** Changed the readiness loop to run `pg_isready` inside the
  container via `docker compose exec -T db pg_isready -U ledgr` instead of
  a host binary, removing the host dependency entirely — commit `670da40`.
