# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Ledgr** — a self-hostable, open-source personal finance app (AGPLv3) with automatic bank sync via Plaid and a built-in MCP server that exposes the data to AI agents (Claude, Cursor, etc.) over OAuth-gated tools.

**Docs:**
- `docs/superpowers/specs/` — per-feature design specs. There is no single top-level architecture spec; each doc covers one feature (demo mode, the SQLite→Postgres migration, AI-settings env migration, mobile responsiveness, Plaid relink/account resurrection).
- `docs/vision.md` and `docs/gaps.md` — an outside-in evaluation of the shipped code against the README/vision, listing where a feature is only partially wired up (e.g. the rule-based categorization tier is fully implemented in the matching engine but nothing in the app ever writes a `category_rules` row, so it never fires). Check `gaps.md` before assuming a README-advertised feature is completely implemented.
- `docs/issues/` — open issues tracked as one markdown file per issue (`ISSUE-NNN-slug.md`); several mirror `gaps.md` findings.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| UI | shadcn/ui v4 + Tailwind v4 |
| Charts | Recharts v3 (via shadcn Chart) |
| ORM | Drizzle ORM 0.45 |
| Database | PostgreSQL 18 (via node-postgres Pool) |
| Auth | Better Auth (email/password + passkeys via `@better-auth/passkey`) |
| Bank Sync | Plaid Node SDK (optional — CSV/OFX/QFX import is first-class) |
| AI | Vercel AI SDK (BYOK — user brings own API key: Anthropic/OpenAI/Google/OpenAI-compatible) |
| MCP Server | `@modelcontextprotocol/sdk` with its own OAuth 2.1 authorization server (`src/lib/mcp/auth`) — separate from the Better Auth web session |
| Background Jobs | Standalone job functions (snapshot-balances, backfill-balances) run on a `node-cron` schedule (`src/lib/scheduler`), started from `src/instrumentation.ts` |
| Testing | Vitest + fast-check + Playwright + Stryker + MSW |

## Key Conventions

- **All monetary amounts are INTEGER (cents).** $12.50 → 1250. Never use floats for money. Convert to display format at the UI layer via `lib/money.ts`.
- **Plaid amount convention:** Positive = debit/expense, negative = credit/income. `normalized_amount` column flips sign for human display.
- **Ownership enforcement:** Use `scopedQuery(householdId)` wrapper to auto-inject `household_id` filtering on all queries. Never write manual WHERE clauses for tenant isolation.
- **Encryption:** Plaid access tokens and AI API keys encrypted at app layer (aes-256-gcm, key from `ENCRYPTION_KEY` env var). Rotate with `pnpm rotate-keys`.
- **Plaid is the primary feature.** Bank sync via Plaid is the core experience. CSV/OFX import is available as a supplementary option for accounts not supported by Plaid.
- **Timestamps:** Use `new Date()` for all Postgres `timestamp` columns. Use `nowISO()` from `@/lib/date-utils` only for text date columns. Never use `new Date().toISOString()` for timestamp columns — Drizzle handles Date→Postgres conversion.
- **Household/category provisioning is automatic, not scripted.** There is no `db:seed` command — a Better Auth `databaseHooks.user.create.after` hook calls `provisionHousehold()` (`src/lib/auth/provision.ts`) to create the household and default categories the moment a user signs up. The public demo household is separately self-seeded on first dashboard render (`seedDemoHousehold()` in `src/app/(dashboard)/layout.tsx`).
- **Demo mode:** `isDemoMode()` / `guardDemoMode()` (`lib/demo-mode.ts`) gate a handful of write paths (AI chat, CSV import, MCP OAuth authorize) for the shared demo account (`DEMO_HOUSEHOLD_ID`). It is not wired into every server action — don't assume a given mutation is demo-safe without checking.
- **Deployment target:** Docker, self-hosted. `docker compose up` starts both Postgres and the app. Migrations run automatically on container startup via `scripts/docker-entrypoint.sh`.

## Commands

```bash
# Development
pnpm install                     # Install dependencies
pnpm dev:db                      # Start Postgres (Docker)
pnpm dev:setup                   # Start Postgres + migrate + dev server
pnpm dev                         # Next.js dev server on :4200 (requires running Postgres)
pnpm db:generate                 # Generate Drizzle migrations
pnpm db:migrate                  # Run migrations
pnpm db:studio                   # Starts a local proxy on :4983; open https://local.drizzle.studio in a browser to use it
pnpm build:mcp-widgets           # Build the MCP interactive dashboard widgets (src/lib/mcp/apps)

# Testing
pnpm test                        # Vitest unit + integration tests
pnpm test:changed                # Vitest, only tests related to files changed vs HEAD (fast loop)
pnpm test:watch                  # Vitest in watch mode
pnpm test:coverage               # Vitest with v8 coverage report
pnpm test:e2e                    # Playwright e2e tests
pnpm test:e2e:ui                 # Playwright with interactive UI
pnpm test:mutate                 # Stryker mutation testing (full)
pnpm test:mutate:incremental     # Stryker mutation testing (Stryker's own incremental cache)
pnpm test:mutate:diff            # Stryker scoped to files changed in a git diff range (what CI's PR job runs)
pnpm lint                        # ESLint
pnpm typecheck                   # TypeScript type checking

# Maintenance scripts (tsx, load .env)
pnpm rotate-keys                 # Rotate ENCRYPTION_KEY and re-encrypt stored secrets
pnpm backfill-clean-names        # Backfill cleaned merchant names for existing transactions

# Docker
docker compose up                # Run the full app
docker compose up --build        # Rebuild and run
```

To run a single test file: `pnpm vitest run path/to/file.test.ts` (or `pnpm vitest path/to/file.test.ts` to watch).

## Architecture

```
Browser ──▶ Next.js App Router
              ├── Server Components ── read-only data (transactions, reports)
              ├── Server Actions ──── mutations (sync, categorize, budget CRUD)
              ├── API Routes ──────── Plaid webhooks, AI streaming, CSV import
              └── Client Components ── interactive UI (charts, forms)
                    │
              Drizzle ORM ──▶ PostgreSQL (via node-postgres Pool)
              Plaid Node SDK ──▶ Plaid API (sandbox/production via PLAID_ENV)
              Vercel AI SDK ──▶ User's LLM provider (Claude/OpenAI/Gemini)
              node-cron ──▶ Scheduled jobs (nightly snapshot, safety sync — src/lib/scheduler)

MCP Client ──▶ MCP OAuth server (src/app/api/mcp/oauth) ──▶ MCP tools (src/lib/mcp/tools) ──▶ same Drizzle/PostgreSQL
 (Claude, Cursor, …)         scope- and per-user mcp_settings-gated (src/lib/mcp/auth/guard.ts)
```

## Project Structure

```
ledgr/
├── src/
│   ├── app/                     # Next.js App Router pages
│   │   ├── (auth)/              # Login, signup, onboarding
│   │   ├── (dashboard)/         # Main app (accounts, transactions, budgets, etc.)
│   │   ├── mcp/                 # MCP OAuth consent/authorize UI
│   │   └── api/                 # Plaid webhooks, AI chat, CSV import, health, MCP OAuth endpoints
│   ├── components/              # UI components (shadcn/ui, charts, dashboard widgets)
│   ├── db/
│   │   ├── schema/               # Drizzle schema files (one per domain)
│   │   ├── seed/                 # Default categories (auto-run on signup) + demo household data
│   │   └── index.ts              # Drizzle client + node-postgres Pool
│   ├── lib/
│   │   ├── plaid/                # Plaid client, sync logic
│   │   ├── categorization/       # Rule engine, PFC mapping, orchestrator
│   │   ├── ai/                   # AI categorization, chat
│   │   ├── auth/                 # Better Auth config + adapter, household provisioning
│   │   ├── import/               # CSV/OFX parsers
│   │   ├── jobs/                 # Background job functions (snapshots, backfill, key rotation)
│   │   ├── scheduler/            # node-cron wiring around the jobs above
│   │   ├── mcp/                  # MCP server: OAuth server, tools/, interactive widgets (apps/)
│   │   ├── scoped-query.ts       # Household-scoped query wrapper
│   │   ├── encryption.ts         # AES encrypt/decrypt
│   │   ├── demo-mode.ts          # Read-only guard + shared household for the public demo account
│   │   ├── date-utils.ts         # Timestamp and date helpers (nowISO, todayDateString)
│   │   └── money.ts              # Cents ↔ display helpers
│   ├── actions/                 # Server Actions
│   └── queries/                 # Server-side data fetching
├── tests/
│   ├── integration/              # DB-backed tests, one file per feature area; setup.ts is the test-DB factory
│   ├── global-setup.ts           # Testcontainers Postgres lifecycle
│   └── mocks/                    # MSW handlers for the Plaid API
├── e2e/                          # Playwright specs (auth, passkeys, accounts, health)
├── ledgr-plugin/                 # Claude Code plugin distribution (MCP config + financial-workflow skills)
├── scripts/
│   ├── docker-entrypoint.sh      # Container startup (migrate + serve)
│   ├── migrate.mjs               # Standalone Drizzle migration runner
│   ├── rotate-keys.ts            # ENCRYPTION_KEY rotation
│   └── install-migrate-deps.mjs  # Installs migration deps from package.json versions
├── docs/
│   ├── superpowers/specs/        # Per-feature design specs
│   ├── vision.md, gaps.md        # Evaluation notes: what's fully wired up vs. README-only
│   └── issues/                   # Open issues, one file per issue
├── docker-compose.yml            # Postgres 18 + app services
├── Dockerfile                    # Multi-stage production build (Node 24 LTS)
├── vitest.config.ts
├── playwright.config.ts
├── stryker.config.json
└── .env.example
```

## MCP Server (AI Agent Access)

Ledgr ships a built-in MCP server (`src/lib/mcp/`, `MCP_ENABLED=false` by default) so AI clients can query and act on a household's data. It is architecturally separate from the web app's Better Auth session:

- **Own OAuth 2.1 authorization server** — `src/lib/mcp/auth/oauth-server.ts` + `src/app/api/mcp/oauth/{authorize,register,token,revoke}`, with discovery documents at `src/app/.well-known/oauth-authorization-server` and `.well-known/oauth-protected-resource`. Dynamic client registration is supported.
- **Scopes gate tool access**: `ledgr:read`, `ledgr:write`, `ledgr:sync`, granted by the user during the consent flow (`src/app/mcp/authorize/`).
- **Per-user kill switch** — `assertMcpEnabled()` (`src/lib/mcp/auth/guard.ts`) checks the user's `mcp_settings.mcpEnabled` before any tool runs.
- **Tools** live in `src/lib/mcp/tools/`, one file per domain (accounts, transactions, budgets, categories, investments, recurring, reports, dashboard, sync, savings).
- **Interactive widgets** — tools like `show_financial_dashboard` render React components (`src/lib/mcp/apps/src/`) that are pre-built into standalone HTML (`src/lib/mcp/apps/widgets/`); rebuild with `pnpm build:mcp-widgets` after editing a widget source.
- **Rate limiting** — `src/lib/mcp/rate-limit.ts`.
- `ledgr-plugin/` at the repo root packages this as a distributable Claude Code / Codex / OpenCode plugin (marketplace `KenTaniguchi-R/ledgr`) with financial-workflow skills (`budget-check`, `monthly-review`, `net-worth-tracking`, `savings-analysis`, `subscription-audit`, `deals-finder`).

## Savings Advisor

An on-demand (never automatic) AI feature that mines a household's real transaction history for specific, dollar-quantified savings suggestions — `src/lib/ai/savings/` (profile → prompt → model → validate → persist, mirroring the AI-categorization pipeline's "app computes facts, model proposes actions" split). Reachable from the dashboard, transaction/category detail, AI chat (`getSavingsSuggestions` tool), and MCP (`get_savings_suggestions`, `get_spending_profile`). Includes an opt-in "deals finder" that lets the household's configured AI provider search the web (Settings → Savings Advisor). See `docs/superpowers/specs/2026-08-21-savings-advisor-design.md` for the full design, including the three-tier deals-finder approach and known limitations.

## Data Model Highlights

31 tables. Key entities: `households`, `accounts`, `transactions` (with `transaction_splits`, `transfer_pair_id`), `merchants`, `category_groups`/`categories`/`category_rules`, `budgets`/`budget_categories`, `recurring_transactions`, `investment_holdings`/`holdings_history`/`investment_transactions`, `plaid_items`/`sync_log`, `saved_reports`, `savings_suggestions`, `oauth_clients`/`oauth_codes`/`oauth_consents`/`oauth_refresh_tokens`.

**Schema files live in `src/db/schema/` (one file per domain, re-exported from `index.ts`)** — this is the source of truth for table/column names, types, and relations; see `docs/superpowers/specs/` for the design rationale behind individual features.

**Before writing or reasoning about any query, migration, or schema change, read the relevant file(s) in `src/db/schema/` first** rather than relying on this doc or prior context — table lists and counts here (like the "30 tables" above) drift out of date as the schema evolves, and a stale assumption about a column or table name produces broken queries.

## Testing Architecture

| Layer | Tool | What It Tests |
|-------|------|--------------|
| Unit + Property | Vitest + fast-check | Pure logic (money, encryption, categorization rules) |
| Integration | Vitest + Postgres (testcontainers) | Drizzle queries, scoped-query isolation, server actions |
| Mutation | Stryker (diff-scoped on PRs) | Whether tests actually catch bugs (not just coverage) |
| E2E | Playwright | Critical user journeys end-to-end |
| Contract | MSW + Zod | Plaid API response shapes |
| Static | TypeScript strict + ESLint | Type safety |

**Key conventions:**
- **Colocate unit tests** with source files (`money.test.ts` next to `money.ts`).
- **Integration tests** (need DB) go in `tests/integration/`.
- **E2E tests** go in `e2e/`.
- **No tests for declarative code** (schemas, configs, type definitions).
- **Test DB factory:** `createTestDb()` from `tests/integration/setup.ts` — async, creates a unique Postgres schema per test file for isolation. Shared testcontainer started via `tests/global-setup.ts`. Use `beforeAll(async () => { ({ db, close } = await createTestDb()); })` pattern.
- **Property-based tests** use `@fast-check/vitest`. API: `test.prop([arb])("name", fn)` — not `fc.test()`.
- **Scoped-query** accepts optional `db` parameter for testability: `scopedQuery(householdId, testDb)`.
- **MSW mocks** for Plaid API in `tests/mocks/`. Use `server` from `tests/mocks/server.ts` in Vitest.
- **Mutation testing gate:** `stryker.config.json` thresholds break the build below 60% mutation score and warn below 80% — but the CI job that runs it (`test:mutate:diff` via `scripts/mutate-diff.sh`, PR-only) is currently `continue-on-error: true` (report-only), because Stryker only runs the unit suite and files covered mainly by integration tests would otherwise score artificially low. See the comment in `.github/workflows/ci.yml` before assuming a red mutation run blocks merge.
- **JavaScript -0 gotcha:** `normalizeAmount(0)` returns `-0`. Use `Math.abs()` when comparing zero.

**Test budget per work type:**
- Feature: 3-5 behavioral tests + property tests if financial math
- Bug fix: 2-3 regression tests proving the fix
- Refactor: 0 new tests (existing tests must pass)

### TDD Workflow (new work)

New features and bugfixes start **test-first** (superpowers `test-driven-development` skill). The red-green-refactor loop, mapped to this repo:

1. **Red** — write the smallest failing test next to the code (`*.test.ts` colocated, or `tests/integration/` if it needs the DB). Run it and watch it fail:
   - `pnpm test:changed` — runs only tests related to your changed files (fast loop)
   - or `pnpm test:watch` for continuous feedback
2. **Green** — write the minimal code to pass. Re-run until green.
3. **Refactor** — clean up with tests staying green.
4. **Commit** — the `pre-commit` hook (`simple-git-hooks` + `lint-staged`) runs `eslint --fix` on changed files (fast, no Docker). Run tests yourself before committing via `test:changed`/`test:watch`.

Enforcement layers, fast → slow: `test:changed`/watch (you, locally) → pre-commit hook (lint) → CI (full suite). The test gate lives in CI — integration tests need Docker and are too heavy for a pre-commit hook — so red blocks the merge once branch protection requires the `test` check.

**Time in tests:** never hardcode absolute dates that must fall in a "recent" window — queries compute windows from `new Date()`, so hardcoded dates silently rot as the calendar moves. Derive fixture dates relative to now (see `dashboard-queries.test.ts`).

**CI pipeline order:** typecheck → lint → vitest, then (PR-only, non-blocking) diff-scoped stryker. Wired in `.github/workflows/ci.yml` (runs on push to `main` + all PRs). Playwright is not yet in the blocking job.

## Auto-Categorization Pipeline

1. **User rules** — pattern matching on transaction name or merchant (ordered by priority)
2. **Merchant default** — if `merchant.categoryId` is set by user
3. **PFC mapping** — Plaid's `personal_finance_category.detailed` code mapped to seed categories via static map in `lib/categorization/pfc-map.ts`
4. **AI fallback** — batch uncategorized transactions → user's AI provider (confidence-gated)
5. Uncategorized — flagged for manual review

Each tier sets `categorySource` on the transaction (`"rule"` | `"merchant_default"` | `"pfc"` | `"ai"` | `"manual"`) to track provenance. Manual user edits always set `"manual"` and are never overwritten by lower tiers.

> **Known gap:** tier 1 is implemented and correctly checked first in `categorization/engine.ts`, but nothing in the app ever writes a `category_rules` row (no UI, no action) — see `docs/gaps.md` #1 and `docs/issues/ISSUE-002-*`. In practice every household only ever gets tiers 2–4. Similarly, manually recategorizing a transaction only updates that one row — it doesn't update `merchants.categoryId` or create a rule, so it doesn't generalize (`docs/gaps.md` #3, `ISSUE-004-*`).

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **ledgr** (4262 symbols, 8514 relationships, 284 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/ledgr/context` | Codebase overview, check index freshness |
| `gitnexus://repo/ledgr/clusters` | All functional areas |
| `gitnexus://repo/ledgr/processes` | All execution flows |
| `gitnexus://repo/ledgr/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
