# AGENTS.md

Guidance for AI coding agents working in this repository.

**Ledgr** — a self-hostable, open-source personal finance app (AGPLv3).
`README.md` covers the stack, features, and setup; this file is what's
expensive to rediscover on top of that.

Self-hosting is the only deployment model. There is no hosted product, so there
is one audience and one setup path; `docs/superpowers/specs/2026-07-07-ledgr-hosted-beta-design.md`
describes a direction that was abandoned.

Design docs live in `docs/superpowers/specs/` (design) and
`docs/superpowers/plans/` (execution). They are point-in-time records, not a
maintained spec — when a doc and the code disagree, the code wins.

The UI primitives are **Base UI**, not Radix. APIs differ — `ToggleGroup`
takes `value: string[]` and hands back an empty array when the active item is
clicked again, `PopoverTrigger` takes a `render` prop, and so on. Read the
component in `src/components/ui/` before assuming a Radix signature.

> **Product decisions:** [`docs/product-decisions.md`](docs/product-decisions.md) is the
> single current-state register of deliberate product/behaviour calls, with the why and a
> link to each source. **Read it before changing any user-facing behaviour** — if the
> behaviour is listed, it was chosen on purpose; raise it instead of "fixing" it. When a
> product call gets made in a session, record it there (edit in place, mark the old rule
> superseded). Bootstrap, audit or re-sweep with the `product-decisions` skill
> (`init` / `review` / `sync`).

## Key Conventions

- **All monetary amounts are INTEGER (cents).** $12.50 → 1250. Never use floats
  for money. Convert to display format at the UI layer via `lib/money.ts`.
- **Plaid amount convention:** Positive = debit/expense, negative = credit/income.
  `normalized_amount` flips sign for human display.
- **Ownership enforcement:** Use `scopedQuery(householdId)` to auto-inject
  `household_id` filtering. Never write manual WHERE clauses for tenant
  isolation. It takes an optional second `db` argument for tests.
- **Encryption:** Plaid/SimpleFIN tokens and AI API keys are encrypted at the app
  layer (aes-256-gcm). Keys are **versioned** — `ENCRYPTION_KEY` is v1,
  `ENCRYPTION_KEY_V2` and up are later versions, so rotation can re-wrap
  ciphertext without downtime (`pnpm rotate-keys`).
- **Timestamps:** Use `new Date()` for Postgres `timestamp` columns. Use
  `nowISO()` from `@/lib/date-utils` only for text date columns. Never
  `new Date().toISOString()` for timestamp columns — Drizzle handles the
  Date→Postgres conversion.
- **Transfers are excluded from spend.** Rows with `isTransfer` are left out of
  reports, budgets and spending totals. Investment-account activity is tagged
  `isTransfer: true` with `transferSource: "investment_account"` at sync time,
  which is what keeps brokerage fills out of the Transactions tab.
- **Deployment target:** Docker, self-hosted. `docker compose up` starts Postgres
  and the app; migrations run on container startup via
  `scripts/docker-entrypoint.sh`.

## Commands

`README.md`'s Development section has the day-to-day commands (`pnpm dev`,
`pnpm test`, `pnpm lint`, `pnpm db:studio`, …). Operator/maintenance scripts
that aren't there:

```bash
pnpm reset-password --check|--set <email>   # Operator password check/reset
pnpm rotate-keys                            # Re-wrap encrypted columns to a new key version
pnpm backfill-clean-names                   # Backfill merchant-cleaned names
pnpm backfill-transfers                     # Backfill transfer pairing
pnpm backfill-investment-activity           # Tag existing investment rows as transfers
pnpm backfill-balances                      # Backfill balance history
pnpm build:mcp-widgets                      # Build the MCP app widgets
```

## Project Structure

```
src/
├── app/
│   ├── (auth)/                 # Login, signup
│   ├── (dashboard)/            # accounts, transactions, budgets, bills,
│   │                           # investments, reports, rules, import, settings
│   ├── api/                    # ai/chat, auth, dashboard, export, health,
│   │                           # import, mcp/oauth, plaid/{webhook,oauth-return}, search
│   ├── mcp/authorize/          # OAuth consent screen for MCP clients
│   └── .well-known/            # OAuth authorization-server + protected-resource metadata
├── components/
│   ├── atoms/ molecules/ organisms/   # Atomic-design layering
│   └── ui/                     # shadcn components — see "UI conventions"
├── db/schema/                  # Drizzle schema, one file per domain (30 tables)
├── lib/
│   ├── plaid/                  # Plaid client + sync
│   ├── simplefin/              # SimpleFIN client, schemas, sync, queries, recurring
│   ├── categorization/         # engine.ts, pfc-map.ts, rule-pattern.ts
│   ├── ai/                     # categorize, resolve-merchants, provider, chat
│   ├── mcp/                    # MCP server: tools/, auth/, apps/ (widgets)
│   ├── scheduler/              # cron config + runner + tasks
│   ├── jobs/                   # snapshot-balances, backfill-*, rotate-encryption-keys
│   ├── auth/ import/           # Better Auth config; CSV/OFX parsers
│   ├── scoped-query.ts encryption.ts money.ts date-utils.ts
├── actions/                    # Server Actions (mutations)
└── queries/                    # Server-side data fetching
tests/integration/              # DB-backed tests + testcontainers setup
e2e/                            # Playwright
```

## Auto-Categorization Pipeline

Tiers, in order. Each sets `categorySource` on the transaction to record
provenance:

1. **`rule`** — user pattern rules on transaction name or merchant, by priority
2. **`merchant_default`** — `merchant.categoryId`, when the user has set one
3. **`pfc`** — Plaid `personal_finance_category.detailed`, mapped in `pfc-map.ts`
4. **`ai`** — batch the remainder to the user's AI provider, confidence-gated
5. Uncategorized — flagged for manual review

`manual` is set by user edits and is never overwritten by a lower tier.

## UI conventions

- **Reach for `src/components/ui/` before hand-rolling.** Most of the library is
  already installed and wired. Install what is missing rather than rebuilding it.
- **`shadcn add` has two known hazards in this repo.** It emits
  `import { cn } from "cn"` and tries to install an npm package by that name, and
  it rewrites `package.json` dependency versions it should leave alone (it has
  downgraded `recharts` on every run). Check `git diff package.json` after any
  `add`, and answer **no** to overwrite prompts — `card.tsx` is customized.
- **`components/ui/chart.tsx` carries two deliberate local edits**, both commented
  in the file: `cn` is imported from `@/lib/utils`, and `ChartTooltipContent`
  takes a `valueFormatter` prop because every value this app charts is an integer
  cent count and upstream renders values with `toLocaleString()`. Do not let a
  regenerate clobber them.
- **Charts must go through `ChartContainer`.** Recharts' bare `<Tooltip>` paints a
  hardcoded white box that is unreadable in dark mode. Series labels come from
  `ChartConfig`, not per-series `name` props. Callers size charts with an
  explicit-height parent, so pass `className="aspect-auto h-full w-full"`.
- **Category names are user data** (`Groceries & Dining`) and cannot be emitted as
  `--color-<key>` custom properties. Charts keyed by category keep inline colors.
- **Not every raw element is a bug.** Clickable table rows, category pills and
  editable text are legitimately custom; `Button` is the wrong base for a `<tr>`.
  The hand-rolled `rounded-lg border` shells are also *visually distinct* from
  this repo's `Card` (`rounded-xl bg-card ring-1 ring-foreground/10`, no border) —
  converting them is a redesign, not a refactor.

## Testing Architecture

| Layer | Tool | What it tests |
|-------|------|--------------|
| Unit + Property | Vitest + fast-check | Pure logic (money, encryption, categorization) |
| Integration | Vitest + Postgres (testcontainers) | Drizzle queries, scoped-query isolation, actions |
| Mutation | Stryker (diff on PRs) | Whether tests actually catch bugs |
| E2E | Playwright | Critical user journeys |
| Contract | MSW + Zod | Plaid/SimpleFIN response shapes |
| Static | TypeScript strict + ESLint | Type safety |

- **Colocate unit tests** with source (`money.test.ts` next to `money.ts`).
  DB-backed tests go in `tests/integration/`, Playwright in `e2e/`.
- **Vitest defaults to `environment: "node"`.** It matches `*.test.ts` and
  `src/**/*.test.tsx`; a `.tsx` component test opts into jsdom with a
  `@vitest-environment jsdom` docblock (see `src/components/ui/toggle-group.test.tsx`).
  The global setup starts a Postgres testcontainer for every run, unit tests
  included, so Docker must be reachable even for `src/` tests.
- **Test DB factory:** `createTestDb()` from `tests/integration/setup.ts` — async,
  one Postgres schema per test file. Use
  `beforeAll(async () => { ({ db, close } = await createTestDb()); })`.
- **Property tests** use `@fast-check/vitest`: `test.prop([arb])("name", fn)`.
- **No tests for declarative code** (schemas, configs, type definitions).
- **Time in tests:** never hardcode absolute dates that must land in a "recent"
  window — queries compute windows from `new Date()`, so fixed dates rot as the
  calendar moves. Derive fixture dates relative to now.
- **JavaScript `-0` gotcha:** `normalizeAmount(0)` returns `-0`. Use `Math.abs()`
  when comparing to zero.

**Budget per work type:** feature → 3-5 behavioral tests, plus property tests if
it touches financial math. Bug fix → 2-3 regression tests proving the fix.
Refactor → 0 new tests; the existing ones must pass.

### TDD workflow

Red (`pnpm test:changed` or `test:watch`) → green → refactor → commit. The
pre-commit hook runs `eslint --fix` only; it does not run tests, because
integration tests need Docker. The real gate is CI.

**CI:** typecheck → lint → vitest → Stryker (`mutation (diff)`, PR-only and
non-blocking). Runs on `.github/workflows/ci.yml`, on self-hosted runners.
Playwright is not yet in the blocking job.

CI reds on these runners are not always your code — contention between
container-heavy jobs, a shared pnpm store racing itself, and legacy mutation debt
on DB files all produce reds that look like breakage. Check which step failed and
re-run before assuming the diff is at fault.

## Database

Migrations are generated with `pnpm db:generate` and must be reviewed before
committing:

- **Generated `NOT NULL` column adds have no backfill** and will break a populated
  database. Rewrite the migration to add the column nullable, backfill, then set
  the constraint.
- **Never hand-edit a migration's `when` timestamp in the journal.** Older Docker
  images replay it and crash-loop.

## Fork notes (Gens-ai/ledgr)

This checkout is a fork of `KenTaniguchi-R/ledgr` (remote `upstream`). Facts
below are specific to the fork; everything above is shared with upstream.

- **Evaluation docs and issues.** `docs/vision.md` and `docs/gaps.md` are an
  outside-in evaluation of the shipped code against the README. `docs/issues/`
  tracks issues as one markdown file per issue (`ISSUE-NNN-slug.md`). Both
  predate the upstream merge of 2026-11, so check an item against the code
  before relying on it (e.g. category rules now have a UI and action).
- **Savings Advisor (fork-only).** An on-demand (never automatic) AI feature
  that mines a household's transaction history for dollar-quantified savings
  suggestions: `src/lib/ai/savings/` (profile → prompt → model → validate →
  persist), stored in `savings_suggestions`. It is reachable from the dashboard,
  the budget table, transaction/category detail, AI chat (`getSavingsSuggestions`)
  and MCP (`get_savings_suggestions`, `get_spending_profile`). An opt-in deals
  finder lets the configured AI provider search the web (Settings → Savings
  Advisor; `user_settings.deals_*`). Design:
  `docs/superpowers/specs/2026-08-21-savings-advisor-design.md`.
- **Category editing (fork, on upstream's `/categories` manager).** System
  categories and groups can be renamed, re-iconed, moved between groups, and
  switched income/non-income; empty groups (system included) can be deleted.
  Deleting an in-use category requires a replacement: transactions, splits,
  recurring items, merchant defaults, rules and budget lines move to it in one
  `withHousehold` transaction (`deleteCategoryScoped`). Without a replacement an
  in-use delete is refused, as upstream does.
- **System categories are deletable with reassignment** (fork behaviour,
  confirmed by Joe 2026-11-12) — the `deleteCategoryScoped` path above applies
  to system categories too.
- **Income totals use the sign rule everywhere** (decided 2026-11-12, after
  ISSUE-010; the category rule was rejected because only ~9% of real income
  lands in an income category). Every income/expense total — dashboard tiles,
  Cash Flow chart, Reports' Total Income/Expenses tiles, Safe to Spend, MCP
  `get_dashboard_summary` / `get_income_vs_expense`, AI chat
  `getMonthlyTrends` — goes through `incomeTotalsRule()` in
  `src/queries/shared-conditions.ts`: credits are income; expenses are debits
  outside income categories (`notIncome`), matching the Spending tab; transfers
  excluded via `includedInSpending`. Refunds counting as income is
  accepted. Per-category views (`notIncome`/`aggregateSpending`, the Income vs
  Expense category table, the Sankey) stay on category classification by
  design. Upstream's report-queries test "table income rows sum to the Total
  Income tile…" was rewritten for this; keep the fork version on merges.
- **PFC mapping keys off `categories.pfc_seed_key`, never the name.** It holds
  the category's original seed name, set at seed time and never edited
  (migration 0014 backfilled it). `pfc-map.ts` values are seed keys. Anything
  else that needs "the seeded Groceries category" must look it up by key too.
- **Provisioning is automatic, not scripted.** There is no `db:seed` command. A
  Better Auth `databaseHooks.user.create.after` hook calls `provisionHousehold()`
  (`src/lib/auth/provision.ts`) to create the household and default categories
  at sign-up. The demo household is self-seeded by `seedDemoHousehold()` from
  `src/app/(dashboard)/layout.tsx`.
- **Demo mode** (`lib/demo-mode.ts`) gates only some write paths. Don't assume
  a mutation is demo-safe without checking.
- **`pnpm dev:setup`** waits for Postgres with `docker compose exec db pg_isready`,
  so it doesn't need a host `pg_isready` (ISSUE-008).
- **Playwright runs Chromium with its OS sandbox on**
  (`use.launchOptions.chromiumSandbox: true` in `playwright.config.ts`). Never
  disable it or fall back to `--no-sandbox`. If the sandbox cannot start,
  stop and report it.
- **Fork migrations come after upstream's.** Upstream's migrations keep their
  numbers and content. Fork-only schema changes are generated on top of
  upstream's chain; when merging upstream again, drop the fork's
  migration/snapshot/journal entries, take upstream's, then re-run
  `pnpm db:generate` for the fork delta.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **ledgr** (4748 symbols, 9572 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
