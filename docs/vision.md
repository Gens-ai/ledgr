# Ledgr — vision & architecture (as understood, evaluation notes)

Local clone: `~/Dev/ledgr`, commit `7ee62177eed892022490518382007c680565aa9b` (2026-07-25), tag `v0.2.0`, `main` branch. Upstream: https://github.com/KenTaniguchi-R/ledgr

## What it is

Self-hostable personal finance app — bank sync via Plaid, categorization, budgets, investment tracking, bill detection, reports, and (its distinguishing feature) a built-in MCP server so AI agents can query and act on the data through natural conversation. AGPL-3.0, Docker Compose deploy, PostgreSQL-backed.

Pitch, verbatim from the README: *"Ledgr connects to your bank accounts through Plaid, automatically syncs and categorizes transactions, and gives you budgets, investment tracking, bill detection, and financial reports — all running on your own server with your own data. It also exposes an MCP server, so AI assistants like Claude can query your finances through natural conversation."*

## Feature set (README)

- Automatic bank sync (12,000+ banks via Plaid; real-time webhook or scheduled polling)
- "Smart" categorization — advertised as a four-tier pipeline (see Categorization below)
- Budgets by category, monthly, real-time progress
- Investment tracking — holdings, performance, allocation
- Recurring bill detection
- Reports — spending, income, net worth, category trends
- MCP agent interface (Claude Code, Claude Desktop, Cursor, any MCP client)
- In-app AI chat
- BYOK AI (OpenAI, Anthropic, Google, or custom/local) for chat + categorization fallback
- CSV/OFX/QFX import, CSV export
- Self-hosted, Docker Compose, Postgres — "your data never leaves your server"

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| UI | shadcn/ui + Tailwind CSS 4 |
| Charts | Recharts 3 |
| Database | PostgreSQL 18 via Drizzle ORM |
| Auth | Better Auth (passkey/WebAuthn support added, per PR #7) |
| Bank sync | Plaid Node SDK |
| AI | Vercel AI SDK (BYOK) |
| MCP | `@modelcontextprotocol/sdk` |
| Testing | Vitest + Playwright + Stryker (mutation testing — see `stryker.config.json`, open issue #34 tracks raising coverage) |

## Data model / architecture notes

- Everything is scoped by `householdId` (multi-user households, not a single global user) — every table and query is household-scoped via a `scopedQuery()` helper (`src/lib/scoped-query.ts`).
- Plaid access tokens and other secrets are encrypted at rest with a key auto-generated on first boot and persisted in the app's Docker volume (`ENCRYPTION_KEY`, override-able). Losing that key loses access to encrypted data — it's the single most important thing to back up if this is ever deployed for real.
- Auth secret (`BETTER_AUTH_SECRET`) is the same story — auto-generated, persisted, override-able.

## AI agent interface — intended shape

Not just "point an MCP client at a URL" — a fuller integration than that:

- MCP server at `/api/mcp` (`src/app/api/mcp/route.ts`, `src/lib/mcp/server.ts`), gated by `MCP_ENABLED=true` in `.env` and a per-account MCP toggle (`assertMcpEnabled`, `src/lib/mcp/auth/guard.ts`).
- **Own OAuth 2.0 authorization server** implementing the MCP OAuth flow end to end — `register`/`authorize`/`token`/`revoke` endpoints under `src/lib/mcp/auth/` and `src/app/api/mcp/oauth/*`, plus `.well-known/oauth-protected-resource` discovery. First connection redirects through a real consent screen.
- **Scoped permissions**, granted at authorization time, not all-or-nothing: `ledgr:read`, `ledgr:write`, `ledgr:sync`.
- **Ships as an installable plugin**, not just a manual MCP config: `.claude-plugin/marketplace.json` for Claude Code (`/plugin marketplace add KenTaniguchi-R/ledgr`), plus documented one-liners for Codex CLI, OpenCode, OpenClaw, and **Hermes** (`hermes plugins install KenTaniguchi-R/ledgr`) — notably, Hermes is explicitly a first-class target client in their README, same agent stack used elsewhere in this fleet.
- **16 MCP tools**: 13 read (`list_accounts`, `get_account_summary`, `get_transactions`, `get_budget`, `list_categories`, `get_spending_report`, `get_income_vs_expense`, `get_net_worth_history`, `get_holdings`, `get_portfolio_summary`, `get_upcoming_bills`, `get_dashboard_summary`, `show_financial_dashboard`), 2 write (`update_transaction_category`, `set_budget_category`), 1 sync (`sync_accounts`, rate-limited to once/minute/institution, the only tool that talks to Plaid directly rather than reading the local DB — see `src/lib/mcp/tools/sync.ts`).
- **Interactive MCP "apps"** (`src/lib/mcp/apps/register.ts`) — `show_financial_dashboard` returns `structuredContent: {type: "app", html, data}` backing real rendered widgets (spending pie chart, transaction table, budget progress, net-worth trend area chart) in a client that supports the MCP apps/UI extension, not just JSON text. Registers `ui://ledgr/{widget}` resources serving pre-built widget HTML.
- Active development toward MCP protocol v2 (unmerged branch `feat/mcp-v2-readiness`, PR #42, "Prepare MCP server for protocol v2") — the maintainer is tracking the evolving spec, not treating MCP support as a one-time checkbox.
- Separately, there's non-MCP in-app AI chat and AI categorization fallback (BYOK), which is a distinct surface from the agent/MCP interface — don't conflate the two "AI" features.

## Categorization — intended design (as designed, not as fully implemented — see `docs/planning/gaps.md`)

Advertised four-tier pipeline: **your rules > merchant defaults > Plaid categories > AI fallback**. As designed in `src/lib/categorization/engine.ts` (`categorizeTransactions()`), triggered automatically after every Plaid sync (`src/lib/plaid/sync.ts:636-649`), in priority order per transaction:

1. **`rule`** — user-defined rules (`category_rules` table: `matchField` "name"|"merchant", `matchPattern`, `priority`), highest priority first, case-insensitive substring match.
2. **`merchant_default`** — the Plaid-identified merchant (`merchants` table) has a `categoryId` already assigned.
3. **`pfc`** — Plaid's own "Personal Finance Category" (detailed) taxonomy, mapped through a static table (`src/lib/categorization/pfc-map.ts`, `PFC_DETAILED_TO_CATEGORY`) from Plaid's PFC code to a category *name* string.
4. **`ai`** — separate pass (`src/lib/ai/categorize.ts`, `categorizeWithAi`), only if BYOK AI is configured, only over transactions still uncategorized after 1–3, attempted once per transaction ever, batched, structured-output, validated against real category/transaction IDs, gated by a confidence threshold.

The category taxonomy itself is a **fixed, hardcoded seed list** (`src/db/seed/categories.ts`, `DEFAULT_CATEGORIES`) — 8 groups / ~34 categories (Income, Housing, Food & Dining, Transportation, Utilities, Shopping, Health, Personal), inserted once per household at creation, marked `isSystem: true`.

Every categorization assignment is stamped with its `categorySource` (`rule` | `merchant_default` | `pfc` | `ai`) — so in principle you can always see *why* something was categorized the way it was, which is a real, well-designed transparency feature (assuming the sources are all actually reachable — see `docs/planning/gaps.md`).

## Comparison to alternatives (from README)

| | Ledgr | Actual Budget | Firefly III | Maybe Finance |
|---|:---:|:---:|:---:|:---:|
| Automatic bank sync | Plaid (12,000+ banks) | GoCardless (EU) | Spectre/GoCardless | -- |
| AI agent (MCP) | Yes | -- | -- | -- |
| AI categorization | Yes (BYOK) | -- | -- | -- |
| Investment tracking | Yes | -- | -- | Yes |
| Self-hostable | Yes | Yes | Yes | Yes |
| Database | PostgreSQL | SQLite | MySQL/Postgres | Postgres |
| License | AGPL-3.0 | MIT | AGPL-3.0 | AGPL-3.0 |

## Roadmap (README, as of clone date)

Done: Plaid webhook support, in-app AI chat, OFX/QFX import.
Not done: mobile-responsive UI, multi-currency support, custom report builder, automatic transfer detection between accounts, goal tracking (savings/debt payoff), recurring budget templates.

Notably **not on the public roadmap**: making the category-rules tier of the categorization pipeline actually reachable from the product. (Category CRUD, also missing at the time of the original evaluation, has since shipped.) See `docs/planning/gaps.md`.

## Project maturity / provenance

- Created 2026-05-11 (~3 months old at clone time), latest release `v0.2.0` — pre-1.0.
- Effectively a single maintainer: GitHub owner `KenTaniguchi-R` (616 contributions per the contributors API), but commit authorship on `main` shows as `RyuseiTaniguchi` — same person, different git config name vs. GitHub login, not two contributors. `dependabot[bot]` is the only other contributor (5 commits, all dependency bumps).
- 9 stars, 5 "open issues" per repo metadata, but only 1 is an actual issue (#34, raising mutation-test coverage) — the rest of that count is open dependency-bump PRs plus PR #42 (in-progress MCP v2 prep) and #44 (Node base image bump).
- Actively maintained: real security-hardening history visible in commit log (log-injection fix, CodeQL findings fixed, SAST/dependency scanning added per PR #5), TDD workflow + CI enforcement from the start (PR #1), mutation testing (Stryker) as a real quality gate.
