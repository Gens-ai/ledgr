---
id: ISSUE-009
title: Net worth chart shows a single point — balance_history never backfilled after linking
status: resolved
created: 2026-08-21
resolved: 2026-08-21
---

## Summary

The dashboard's "Net worth" chart rendered as a single dot instead of a
line, even for accounts with two years of transaction history (see
`ISSUE-008`'s follow-up work). Not a chart rendering bug — `balance_history`
genuinely only had one row (the link date) for the affected accounts.

## Details

- `getNetWorthHistory` (`src/queries/dashboard.ts`) groups `balance_history`
  by date and is correct — it plots whatever dates exist in the table.
- `exchangeAndStoreAccounts` (`src/actions/plaid.ts`) only inserts a
  `balance_history` row for *today* when an account is linked.
- `backfillAccountBalances()` (`src/lib/jobs/backfill-balances.ts`) already
  exists and correctly reconstructs historical daily balances by walking
  backward from `currentBalance` through posted transactions — but it was
  never called anywhere except its own test file. Not scheduled, not run
  after linking, no `pnpm` script for it. Same "implemented but never
  wired" shape as `ISSUE-002`.
- Confirmed via direct DB query: newly-linked accounts had exactly 1
  `balance_history` row each despite having ~2 years of transactions after
  the `ISSUE-008` fix.

## Resolution

- **2026-08-21:** Added an optional `householdId` scoping parameter to
  `backfillAccountBalances()` (so an auto-triggered run doesn't reprocess
  every household's accounts) and called it from `exchangePublicToken()`
  right after the existing `syncInstitution`/`syncInvestments` calls —
  commit `5c20c4c`. Also ran it once manually against the live dev DB to
  backfill the accounts linked before this fix shipped. Verified in the
  browser: the net worth chart now renders a full 6-month line.
