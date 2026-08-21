---
id: ISSUE-011
title: Business-to-personal transfers are excluded from income like any other transfer
status: open
created: 2026-08-21
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
