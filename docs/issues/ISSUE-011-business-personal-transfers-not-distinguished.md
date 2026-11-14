---
id: ISSUE-011
title: Business-to-personal transfers are excluded from income like any other transfer
status: resolved
created: 2026-08-21
resolved: 2026-11-14
---

## Summary

Every income/expense query in the app (`getCashFlow`, `getIncomeVsExpense`,
`getSafeToSpend`, `getIncomeExpenseByCategory`, `getCashFlowSankey`, and
`getDashboardSummary`) excludes any transaction flagged `isTransfer = true`.
For a household that owns a business account alongside personal accounts,
this incorrectly excludes real income: money moved from the business
account to a personal account is functionally an owner's draw / personal
income, not a wash transfer — but Ledgr has no way to distinguish that from
a purely internal transfer like checking → savings.

## Details

- Confirmed on this household: `Site Builder Studio LLC` (business
  checking) and `My Personal Account` (personal checking) are both linked
  accounts in the same household. Transfers between them are correctly
  detected as transfers by the existing logic and correctly excluded by
  that logic's own definition — the gap is that "transfer" and "not
  meaningful income" aren't actually the same thing for a business owner.
- The schema has no concept of a "business" vs "personal" account, or any
  per-account/per-transfer-pair override for "count this transfer as
  income/expense anyway."
- `getDashboardSummary` (`src/queries/dashboard.ts`) is the one exception
  that does NOT currently exclude transfers at all (an unrelated, separate
  bug — its August income stat was inflated by counting these same
  business→personal transfers as income, while every other query correctly
  excludes them). Left unfixed for now, pending the design below, so as
  not to make an isolated change to one query while this is unresolved
  everywhere else.

## Important technical note for the eventual fix

**A categorization rule alone will not solve this.** `isTransfer`/
`transferPairId` exclusion is checked as its own filter, independently of
and prior to category or sign-based income classification, in every
affected query. Tagging a transfer transaction with an "Income" category
(e.g. via a future `category_rules` rule, see `ISSUE-002`) will not make
it appear as income anywhere in the app, because the transfer filter
removes it before category is ever considered. Any fix needs to also
address the `isTransfer` flag itself (or add a distinct override), not
just categorization.

## Possible directions (not decided)

- Tag accounts as "business" vs "personal" (or more generally, group
  accounts into entities) and treat any transfer crossing that boundary as
  real income/expense, while transfers within one entity stay excluded.
- A per-transaction or per-transfer-pair manual override: "count this
  transfer as income/expense despite the isTransfer flag."
- Something folded into the rule-engine work referenced above, if that
  engine is extended to also touch `isTransfer`.

## Resolution

- **2026-11-14:** Decided (see `docs/product-decisions.md`, Transactions &
  income): personal vs business is separated by category group, and an owner's
  draw is marked by its *category*, not by tagging accounts. New category flag
  `include_transfer_credits_as_income` (migration
  `0016_category_transfer_credits_income`), set from the category's edit dialog
  ("Count incoming transfers as income"); custom, non-income categories only,
  and mutually exclusive with `include_transfer_in_spending`.
- For a transfer filed under a flagged category (e.g. "Owner's Draw"), the
  **credit** leg counts as income in every income/expense *total* — dashboard
  tiles, Cash Flow, Reports Total Income/Expenses tiles, Safe to Spend, MCP
  `get_dashboard_summary` / `get_income_vs_expense`, AI chat
  `getMonthlyTrends` — via `includedInIncomeTotals()` in
  `src/queries/shared-conditions.ts`, which those queries now use in place of
  `includedInSpending()`. The **debit** leg on the business account stays
  excluded everywhere, so a draw is never a business expense. Brokerage
  (`investment_account`) rows never qualify.
- This addresses the "important technical note" above: the override is part
  of the transfer row filter itself, not a categorization-only change.
- `getDashboardSummary`'s inconsistency described above is already gone: it
  has excluded transfers through `includedInSpending()` since the
  2026-11-12 income-totals unification (ISSUE-010 follow-up), and now uses
  `includedInIncomeTotals()` like the other totals.
- Not changed: per-category views (Spending tab, Income vs Expense category
  table, Sankey) keep the plain transfer exclusion, so the draw does not
  appear there as a category row. A draw that transfer detection missed (not
  `isTransfer`) is an ordinary row: its credit is income by the sign rule,
  but its debit would count as an expense until it is marked a transfer.
- Tests: `tests/integration/owners-draw-income.test.ts`.
