---
id: ISSUE-010
title: Cash Flow / Safe to Spend undercount income via category-based classification
status: resolved
created: 2026-08-21
resolved: 2026-08-21
---

## Summary

The Cash Flow widget's Income bars rendered as effectively zero-height —
$0.01–$0.52/month — while the dashboard summary stat correctly showed
$600.52 for the same month. Traced to two different, disagreeing income
classification methods in the same app.

## Details

- `getDashboardSummary` (`src/queries/dashboard.ts`) classifies income
  correctly, by transaction sign: `normalizedAmount > 0` = income.
- `getCashFlow`, `getIncomeVsExpense`, and `getSafeToSpend`'s
  `monthlyIncome` instead classified income by category membership
  (`categories.is_income` via `getIncomeCategoryIds`/`notIncome` in
  `src/queries/shared-conditions.ts`).
- Confirmed via direct query: only 25 of 275 real income transactions
  (9%) were tagged with an income category — the rest were auto-
  categorized elsewhere by the categorization pipeline, so the
  category-based filter missed ~91% of real income.
- Same root shape as `ISSUE-002`/`ISSUE-004`: category assignment in this
  app is sparse and doesn't generalize, so anything gated on
  `categories.is_income` silently breaks.
- Separately found in `getSafeToSpend`: `discretionarySpent` filtered
  `normalizedAmount > 0` (a credit) instead of `< 0` (an actual debit/
  expense) — it was summing miscategorized income credits as if they
  were spending, which further deflated `safeToSpend`.
- First attempt swapped `notIncome()` to be sign-based everywhere, but
  that broke an existing, deliberate test: `aggregateSpending` (feeding
  `getMonthlySpending`, the Budgets page, and MCP spending tools) uses
  `notIncome()` to exclude a transaction tagged with an income category
  *even when its amount is negative* (e.g. a payroll correction). Sign
  alone doesn't cover that case, so it stayed category-based there.

## Resolution

- **2026-08-21:** Added `isIncome()` (sign-based) to
  `shared-conditions.ts`; switched `getCashFlow`, `getIncomeVsExpense`,
  and `getSafeToSpend.monthlyIncome` to use it instead of
  `getIncomeCategoryIds`. Fixed `getSafeToSpend.discretionarySpent`'s
  sign bug. Left `notIncome()` (category-based) in place for
  `aggregateSpending`/`getCategoryTrends`, which need the "income-tagged
  regardless of sign" exclusion. Left `getIncomeExpenseByCategory` and
  `getCashFlowSankey` on category-based classification since they group
  by category by design — commit `e909b68`. Verified in the browser: the
  Cash Flow widget now renders real Income bars matching the dashboard
  summary figure.

## Follow-up

`getIncomeExpenseByCategory` and `getCashFlowSankey` still undercount
income the same way, since a per-category breakdown structurally needs
category data — the real fix there is the categorization pipeline itself
(see `ISSUE-002`), not a query-level swap.
