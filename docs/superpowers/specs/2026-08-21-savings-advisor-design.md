# Savings Advisor — Design Spec

**Date:** 2026-08-21
**Status:** Implemented (all three phases)
**Scope:** An on-demand AI feature that mines a household's real transaction history for specific, dollar-quantified ways to spend less, plus an opt-in "deals finder" that lets the household's own AI provider search the web for current deals. Surfaced in the dashboard UI, on transaction/category detail, in the in-app AI chat, and over MCP.

---

## Problem

Ledgr already computes everything needed to answer "where could I actually save money" — per-merchant visit frequency and averages, category totals and budget overage, active recurring charges — but nothing in the product turns that into an actionable suggestion. The closest things today are:

- The Reports "Spending" tab, which shows *what* was spent, not what to *do* about it.
- The AI chat, which can answer ad-hoc questions but has no tool that reasons about savings opportunities specifically.

The ask (docs/planning/gaps.md-style, from a live product review) was for something closer to a real advisor: *"you go out to eat regularly — cooking at home twice a month instead would save about $9 a visit."* Specific, evidence-based, dollar-quantified — not "spend less on dining out."

A secondary ask was a **deals finder**: search for current sales/coupons near the household for merchants and staples they actually buy. This is architecturally distinct — it requires the open web and (optionally) a location — so it's treated as an opt-in extension of the core advisor, not a separate feature.

**Constraints from the outset:**
- Never runs automatically. Only when a user clicks a button, asks in chat, or an MCP client calls a tool.
- No background job, no cron, no digest email.
- The AI never invents numbers. Every suggestion must be grounded in the household's real data.

## Architecture

```
UI button ─┐
chat tool ─┼─▶ getSavingsSuggestions(householdId, userId, scope, opts)   lib/ai/savings/advisor.ts
MCP tool  ─┘        │
                    ├─ 1. buildSpendingProfile(scope)    pure SQL/Drizzle, no AI    lib/ai/savings/profile.ts
                    ├─ 2. buildSavingsPrompt(profile)     deterministic, unit-tested lib/ai/savings/prompt.ts
                    ├─ 3. generateText + zod schema        household's BYOK model
                    ├─ 3b. (optional) generateText + hosted web-search tool         lib/ai/savings/deals via provider.ts
                    ├─ 4. validateSuggestions(...)        clamp/reject invented data lib/ai/savings/validate.ts
                    └─ 5. persist + return                savings_suggestions table
```

The single most important design decision, carried over from the existing AI-categorization pipeline (`lib/ai/categorize.ts`): **the app does the arithmetic; the model only proposes actions against facts it's handed.** `buildSpendingProfile()` is pure, deterministic, and has zero AI involvement — it's where the unit and property tests live. The model's job is creative substitution reasoning ("cooking a smash burger takes about 35 minutes and costs about $4.50 in ingredients") layered on top of facts it cannot alter.

### 1. The spending profile (`lib/ai/savings/profile.ts`)

`buildSpendingProfile(householdId, scope, db, windowDays = 90)` resolves a scope to concrete evidence:

- **`resolveScope()`** turns a user-facing scope into `merchant | category | overall | transaction_only`. A `transaction` scope resolves to its merchant first, its category second, and only falls back to a single-transaction profile (just that transaction's own name/amount, no aggregation) when it has neither — e.g. an uncategorized CSV import with no merchant match.
- **Merchant evidence**: visit count, total, average ticket, first/last date, and the **prior window's total** for trend context ("up from $150 last period"), grouped via `SUM(ABS(normalized_amount))` over the same expense conditions used by `lib/spending-helpers.ts` (`notDeleted`, `normalizedAmount < 0`, `isTransfer = false`, `pending = false`, `notIncome()`).
- **Category evidence**: total, share of the household's tracked spend, and — when a budget exists for the current month — that category's limit and month-to-date spend.
- **Recurring evidence**: active, non-income `recurring_transactions` tied to the scope — the primary material for cancellation/downgrade suggestions.
- **Category-scope merchants are grouped by how transactions were actually categorized** (`transactions.categoryId = X`), not by each merchant's own (possibly stale) default category — a merchant whose default category differs from where a specific purchase was actually filed still shows up correctly. Covered by a regression test in `tests/integration/savings-profile.test.ts`.

Every evidence item carries a stable `key` (`merchant:<id>`, `category:<id>`, `recurring:<id>`) — this is the single mechanism the rest of the pipeline uses to keep the model honest.

### 2. The prompt (`lib/ai/savings/prompt.ts`)

`buildSavingsPrompt(profile, opts)` is a pure function: given a profile, it produces a deterministic prompt string. No network calls, fully unit-tested (`prompt.test.ts`). It lists every evidence item with its key, asks for up to 6 suggestions in a strict schema, and gives explicit grounding instructions:

- Every suggestion must cite at least one evidence key.
- Savings estimates must be conservative relative to the cited evidence's own spend.
- Suggestions must be concrete and specific, not generic advice.
- The model must not suggest cutting anything that looks essential (rent, insurance, loan payments) without a specific inefficiency in evidence.
- Confidence must be lowered when the estimate leans on outside knowledge not in the evidence (e.g. "cooking takes about 35 minutes" is world knowledge, not something Ledgr's data can confirm).

### 3. The model call (`lib/ai/savings/advisor.ts`)

Follows the exact pattern already used by `categorizeWithAi()`: `generateText({ model, output: Output.object({ schema }), ... })`, wrapped in try/catch, errors logged and treated as an empty result (no live-model tests — see Testing below). If the profile has **zero evidence** (a brand-new household or a scope with no history), the model call is skipped entirely — the prompt would just say "no evidence available," so there's no reason to spend an API call finding that out.

### 4. Validation (`lib/ai/savings/validate.ts`)

`validateSuggestions(raw, profile)` is the safety boundary, mirroring `validateAssignments()` in `lib/ai/categorize.ts`:

- Any `evidenceKeys` entry that doesn't match a real key in the profile is **stripped**. A suggestion left with zero valid keys is **dropped entirely** (this is the hallucination signal — a suggestion that can't point at anything real).
- `estMonthlySavingsCents` is **clamped** to the sum of the monthly-equivalent spend of its (surviving) cited evidence — a suggestion can never claim to save more than what it's actually pointing at costs per month. Merchant/category evidence converts its window total to a monthly rate (`windowDays`-scaled); recurring evidence uses its own real monthly cost directly (`lib/ai/savings/window.ts`).

This is property-tested (`validate.test.ts`): for arbitrary raw suggestions against a fixed profile, the validated output never exceeds the evidence ceiling and never contains a key that wasn't real.

### 5. Persistence

One new table, `savings_suggestions` (see Data Model below). Every advisor run is persisted — including empty results — both for history/UX and so the rate limiter has something to check against. The `payload` column stores `{ suggestions, profileSnapshot }` as JSON text (matching the existing `saved_reports.filters` convention rather than introducing `jsonb`, which nothing else in the schema uses). Storing the full profile snapshot, not just the suggestions, is what makes realized-savings comparison possible later without re-deriving "what was true at suggestion time."

## Data model

```sql
savings_suggestions
  id, household_id
  scope_type   -- "transaction" | "merchant" | "category" | "overall"
  scope_id     -- null for "overall"
  scope_label  -- denormalized display label, e.g. "Five Guys"
  window_days
  payload      -- JSON: { suggestions: SavingsSuggestion[], profileSnapshot: SpendingProfile }
  model        -- which AI model produced this run
  deals_included
  status       -- "new" | "dismissed" | "acted"
  acted_at
  created_at, updated_at
```

Status lives at the **run level**, not per individual suggestion — a household dismisses or acts on the batch from one advisor click, not on line items within it. This keeps the schema and the UI simple; see Known Limitations for the tradeoff.

`user_settings` gained two columns for the deals opt-in:
- `deals_web_search_enabled` (boolean, default false) — the actual consent gate, checked server-side.
- `deals_location` (free text, e.g. "Seattle, WA" or "98103") — passed into the prompt as a natural-language hint, not parsed into a structured `userLocation` object. This sidesteps three different provider-specific location schemas (Anthropic, OpenAI, and Google's hosted search tools each shape this differently) — the model reads the free text and works it into its own search queries.

Migration: `src/db/migrations/0006_wide_omega_sentinel.sql`.

## Entry points

All six converge on the same `getSavingsSuggestions()` call, so behavior and grounding are identical everywhere:

| Surface | Where | Scope |
|---|---|---|
| Transaction detail | `TransactionDetailPanel` header (hidden for transfers) | `transaction` |
| Category | `BudgetCategoryRow`, small icon button next to the category name | `category` |
| Dashboard | `SavingsAdvisorCard`, below the stat row | `overall` |
| AI chat | New `getSavingsSuggestions` tool in `financialTools()` | model-chosen |
| MCP | `get_savings_suggestions` tool (`ledgr:read`) | client-chosen |
| MCP (agent-side reasoning) | `get_spending_profile` tool (`ledgr:read`) | client-chosen |

There is no merchant detail page in Ledgr yet, so a dedicated merchant-scope UI trigger was out of scope for v1 — `merchant` scope is fully implemented and reachable via chat and MCP today. This is a natural extension point if/when a merchant page is built (it would also help the categorization learning-loop gap tracked separately in `docs/planning/gaps.md`).

**Rate limiting**: a 60-second cooldown per exact `(household, scopeType, scopeId)` combination, mirroring `lib/mcp/rate-limit.ts`'s sync cooldown — a different scope isn't blocked while one is cooling down.

**Demo mode**: the server action goes through `authorizeAction()`, the same demo-mode guard as every other mutating action.

## Deals finder — three tiers

Finding what's on sale requires the household's location and the open web — a deliberate exception to "your data never leaves your server," so it's opt-in, off by default, and layered:

- **Tier A — MCP-native (no new infrastructure).** `get_spending_profile` exposes the same evidence the advisor uses as plain JSON. Any MCP client that already has its own web access (Claude with web search, Claude Code, Cowork) can pull a household's spending profile and do the searching itself — Ledgr's server never makes an outbound web call in this tier. The `ledgr-plugin/` skill pack ships a `deals-finder` skill documenting this workflow.
- **Tier B — in-app, via the provider's own hosted search tool (opt-in).** `lib/ai/provider.ts` exports `createUserSearchTool()`, which returns the household's configured provider's hosted web-search tool — `anthropic.tools.webSearch_20250305`, `openai.tools.webSearch`, or `google.tools.googleSearch` — or `null` for a `custom`/local model, which has no standard equivalent. Only used by the advisor's `includeDeals` path; chat and categorization never get it. Requires **both** the request-time `includeDeals: true` flag (the UI checkbox, chat's tool argument, or the MCP tool's `includeDeals` parameter) **and** the household's stored `deals_web_search_enabled` setting — the stored setting is checked server-side inside `getSavingsSuggestions()` itself, not trusted from the caller, so a request-time flag alone can never trigger a search the household hasn't durably opted into.
- **Tier C — structured flyer data (not built).** A pluggable connector for a weekly-ad/flyer API would give the most reliable results (real prices, real dates) at the cost of a per-region integration. Left as a good community-contribution surface rather than a v1 commitment — nothing in the schema or code blocks adding it later as a fourth suggestion source alongside the base/deals model calls.

## Settings & privacy

`Settings → Savings Advisor` (`SavingsSettingsForm`) exposes exactly two controls: the web-search toggle (disabled entirely if the configured provider has no hosted search tool) and the optional shopping-area text field. The core advisor needs no new consent beyond what BYOK chat and AI categorization already require — sending transaction evidence to the household's own configured provider is the existing trade those features made; the deals toggle is the only part that adds *location* to what leaves the server, which is why it's the only part gated by an extra opt-in.

## Testing

Following the repo's TDD conventions and the existing `categorize.test.ts` precedent of never mocking or exercising the live model call:

- **Unit + property** (`src/lib/ai/savings/{window,prompt,validate}.test.ts`): the deterministic core — monthly-equivalent math, prompt construction, and (property-tested with fast-check) the invariant that a validated suggestion's savings estimate can never exceed what its real, non-hallucinated evidence actually costs per month.
- **Integration** (`tests/integration/savings-profile.test.ts`): `buildSpendingProfile` against a real Postgres fixture — merchant/category/overall/transaction-scope resolution, transfer/pending/income exclusion, household isolation, the category-scope merchant grouping fix, prior-window trend, budget context, and active-recurring evidence.
- **Integration** (`tests/integration/savings-actions.test.ts`): the action layer — AI-not-configured returns a friendly error with no DB writes; rate limiting exercised end-to-end via a zero-evidence scope (skips the model call, so it needs no live API key); dismiss/act status transitions and household-scoping refusal; realized-savings computation, both a full-realization and a reduced-by-actual-spend case; the deals-settings round trip.
- **Unit** (`src/lib/mcp/tools/savings.test.ts`): both MCP tools are called with the registrar's `householdId`/`userId`, not anything client-supplied — the same regression shape as the existing `categories.test.ts`, aimed at the class of bug `docs/issues/ISSUE-001` was about (a tool silently using the wrong scope).

## Known limitations / follow-ups

- **Status is per-run, not per-suggestion.** Dismissing or acting on a batch of up to 6 suggestions is all-or-nothing. Splitting status to individual suggestions would need a child table — reasonable v2 if households want to act on one idea from a batch and dismiss the rest.
- **No merchant detail page**, so the merchant scope has no dedicated UI entry point yet (fully wired everywhere else).
- **Realized savings compares evidence spend, not causally verified behavior change** — if a household's spending dropped for an unrelated reason, it still shows as "realized." This is stated as an estimate, not a causal claim, in the UI copy.
- **Tier C (structured flyer/deal data)** was not built — see above.
- **No interactive MCP widget** (a hypothetical `show_savings_report` alongside the existing `show_financial_dashboard` widgets) — the design called this a stretch goal ("possibly"), and `get_savings_suggestions`'s JSON result plus the in-app dialog covered the actual requirement. The widget-build pipeline (`lib/mcp/apps/`) has room for one later if a client's UI would benefit from a rendered version.
- **The deals opt-in is per-user** (`user_settings`), not per-household — in a multi-member household, each member controls their own consent for calls they trigger. This matches how the rest of Ledgr's settings work (currency, MCP toggle, demo mode are all per-user too), so it's consistent, not a shortcut.

## File manifest

```
src/db/schema/savings.ts                          savings_suggestions table + enums
src/db/schema/user-settings.ts                     + dealsLocation, dealsWebSearchEnabled
src/db/migrations/0006_wide_omega_sentinel.sql

src/lib/ai/savings/
  types.ts        scope/profile/suggestion types, zod schema
  window.ts        monthly-equivalent math
  profile.ts       buildSpendingProfile, resolveScope
  prompt.ts        buildSavingsPrompt
  validate.ts       validateSuggestions, evidenceCeilings
  advisor.ts       getSavingsSuggestions, persistSuggestions, rate limiting
  realized.ts      computeRealizedSavings

src/lib/ai/provider.ts                             + createUserSearchTool
src/lib/ai/config.ts                                + createAiSearchTool, hasWebSearchProvider
src/lib/ai/chat/tools.ts                            + getSavingsSuggestions chat tool
src/lib/ai/chat/system-prompt.ts                    + guideline mention

src/lib/mcp/tools/savings.ts                        get_savings_suggestions, get_spending_profile
src/lib/mcp/tools/index.ts                          + registerSavingsReadTools

src/queries/savings.ts                              history + deals-settings reads
src/actions/savings.ts                              server actions (all six)

src/components/molecules/savings-suggestion-card.tsx
src/components/molecules/savings-advisor-button.tsx  trigger + dialog
src/components/molecules/savings-history-list.tsx
src/components/organisms/savings-advisor-panel.tsx    dialog content / state machine
src/components/organisms/savings-advisor-card.tsx      dashboard entry point
src/components/organisms/savings-settings-form.tsx

ledgr-plugin/skills/deals-finder/                    Tier A MCP-native workflow skill
```
