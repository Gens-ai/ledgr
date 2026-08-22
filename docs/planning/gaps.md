# Ledgr — gaps found (verified against source)

All findings verified by reading actual source at commit `6913fab9d1c7fe8d3fd578267ab4bfbcca021997` (2026-08-21), not inferred from the README. See `docs/vision.md` for the intended design each of these falls short of, and `docs/planning/ideas.md` for new-feature ideas that build on this same read of the codebase.

This supersedes the previous `docs/gaps.md`, which covered only the categorization pipeline (5 findings). This pass covers the whole app. A subset — the categorization-pipeline findings that predate this doc — are filed as individual issues in `docs/issues/` and sequenced in `docs/roadmap.md`; the rest are not yet filed as issues.

**What's already solid** — worth naming so the gaps below land in context: Plaid sync with webhooks and relink, a real OAuth 2.1 MCP server with 16+ tools and interactive widgets, net-worth history with nightly snapshots (and now backfill on link, ISSUE-009), five report tabs with drill-down and saved filters, CSV/OFX import, budget flex/category modes, full category CRUD (UI + actions, ISSUE-003), sign-based income/expense classification (ISSUE-010), AI chat with read tools, and a serious test culture (property tests, testcontainers, mutation testing). Most gaps below are last-mile wiring on top of that foundation, which is what makes several of them cheap wins.

## Resolved since the original evaluation

- **Category CRUD** — was gap #8 in the original pass (no way to add/rename/delete a category). Full CRUD landed (`src/actions/categories.ts`, commit `69b9172`) — see `docs/issues/ISSUE-003-no-category-crud-ui.md` (now resolved).
- **Manual recategorization → merchant propagation** — was gap #3's merchant-default half. `updateTransactionCategoryScoped` now writes `merchants.categoryId` too — see `docs/issues/ISSUE-004-manual-recategorization-does-not-generalize.md` (now resolved). The *rule-creation* half of that gap is still open (see #2 below), and bulk recategorization still doesn't propagate (see #3 below) — this was a partial fix, not the whole gap.
- **Balance history backfill** — net worth showed a single point per account until linked; now backfilled on Plaid link. See `docs/issues/ISSUE-009-balance-history-never-backfilled.md`.
- **Income undercounting** — Cash Flow / Safe to Spend classified income by category membership, undercounting by ~91% in practice. Now sign-based. See `docs/issues/ISSUE-010-income-undercounted-by-category-classification.md`.

## Open gaps, ranked

1. **MCP `list_categories` returns `{}` instead of your categories.** `src/lib/mcp/tools/categories.ts` calls `getCategories(householdId)` without `await` — `jsonResult()` then serializes the pending Promise, which has no enumerable own properties, to `"{}"`. Every other `getCategories()` call site in the app awaits it correctly; this is isolated to the one MCP tool. Trivial one-line fix (`docs/issues/ISSUE-001`).

2. **`category_rules` tier of the categorization pipeline is still unreachable.** The README advertises "your rules > merchant defaults > Plaid categories > AI fallback." Tier 1 (`rule`) is fully implemented and checked first in `lib/categorization/engine.ts` — but nothing in the app ever writes a `category_rules` row. Categories now have full CRUD (see Resolved above), but rules don't: `deleteCategory` *reassigns* existing rules to a replacement category on delete, but no action, UI, or MCP tool *creates* one. Every household still only ever gets tiers 2–4 in practice (`docs/issues/ISSUE-002`).

3. **Bulk recategorization doesn't propagate at all.** Single-transaction recategorization now updates `merchants.categoryId` (see Resolved above), but `bulkUpdateCategory` (`src/actions/transactions.ts`) only writes to the `transactions` table — no merchant or rule write. Bulk cleanup, the flow most likely used to fix a batch of miscategorized transactions, still teaches the pipeline nothing.

4. **`transfer_pair_id` is never set — a permanently dead "jump to pair" link.** The column, its index, exclusion logic in `lib/spending-helpers.ts` and multiple report/dashboard queries, and a "jump to paired transaction" UI link (`transaction-metadata.tsx`) all exist — but the only write anywhere (`src/actions/transaction-detail.ts`) sets it to `null` when a user un-marks a transfer. No detection heuristic ever pairs the two sides of a transfer, so the link never renders. Related but distinct: `docs/issues/ISSUE-011` tracks a narrower transfer-classification nuance (business-to-personal transfers counted like any other transfer) — fixing that doesn't fix this.

5. **AI chat's `searchTransactions` tool silently ignores its own `category` filter.** The tool schema declares a `category` parameter, so the model confidently passes it — but `execute` in `src/lib/ai/chat/tools.ts` never destructures or applies it. "Show my dining transactions" returns unfiltered results the model then presents as filtered. Small bug, but it makes the AI wrong about specific numbers with confidence.

6. **Bill detection is Plaid-only.** `recurring_transactions` is populated exclusively via `syncRecurringTransactions` (`lib/plaid/recurring.ts`) calling Plaid's recurring-streams endpoint. CSV/OFX-imported and manually-added accounts — the audience a self-hosted, works-without-Plaid app courts — get an empty Bills page, an empty dashboard widget, and empty MCP/chat bill tools. No local recurrence heuristic exists, and there's no manual add/edit for a recurring bill either.

7. **Budget rollover exists in schema only.** `budgetCategories.rollover` is written by `copyBudgetFromMonth` and the demo seed, then never read — no query consumes it, no UI surfaces it, no carry-forward math exists. Someone inspecting the schema (or the demo data) reasonably assumes rollover budgeting works; it doesn't.

8. **No alerting of any kind.** No notifications table, no email library, no in-app alert center. Budget overruns, upcoming/missed bills, large or duplicate charges, a broken Plaid connection needing relink — all discoverable only by opening the app and looking. Arguably the core retention loop a finance app needs, and it's entirely absent.

9. **Mobile responsiveness is half-done.** A mobile header, `use-mobile` hook, and mobile widget ordering exist (design spec: `docs/superpowers/specs/2026-05-11-mobile-responsiveness-design.md`), but tables and report charts are largely unadapted (~80 responsive utility classes across all components). Still unchecked on the README roadmap.

10. **Multi-currency is display-deep only.** Account currency is stored and displayed, but `userSettings.currency` is never read, there are no FX rates, and every aggregation (net worth, reports, budgets) sums raw cents across accounts regardless of currency — a multi-currency household gets numerically wrong totals, not just unconverted ones.

11. **Goals: absent entirely.** No savings-goal or debt-payoff tracking anywhere — no table, no UI. Every named competitor in the README's own comparison table (Actual, Firefly, Maybe) has this.

12. **Tags: a dead column.** `transactions.tags` is the single occurrence of tags in the entire repo — never written, never read, never rendered.

13. **No global search / command palette.** Search is per-surface `LIKE %q%` on transaction names only. `cmdk` is already a dependency but used only for category-picker popovers, not a ⌘K palette.

14. **AI chat is stateless and read-only.** No conversation persistence (refresh loses everything), and no write tools — chat can diagnose a miscategorized transaction but can't fix it, while MCP can. Inconsistent capability between the two AI surfaces of the same app.

15. **Budget templates: manual copy only.** "Recurring budget templates" is a README roadmap item; today there's only a manual "copy from previous month" that fills empty categories, with no stored template and no auto-roll-forward when a month begins.

16. **Custom report builder is really saved filter presets.** `saved_reports` stores named filter sets over five fixed tabs — useful, but not the roadmap's "custom report builder" (no metric/dimension/chart choice). Worth renaming in the README until it's real.

17. **Export stops at transactions CSV.** No export for budgets, reports, or holdings, and — more important for a self-hosted app — no full-fidelity household backup/restore short of a raw Postgres dump.

## Suggested sequencing

The categorization-focused subset of these (1–3 above, i.e. `ISSUE-001`/`ISSUE-002`) is already sequenced in `docs/roadmap.md`. For the rest: gap 4 (transfer pairing) and gap 5 (chat search bug) are both small, high-confidence fixes worth doing alongside 1–3 as a single "make the advertised product true" pass. Gaps 6–8 (local bill detection, budget rollover, alerts) are the next tier — they're also the data/plumbing foundation several ideas in `docs/planning/ideas.md` build on (local recurrence detection in particular feeds alerts, bills, and the subscription-audit idea at once).
