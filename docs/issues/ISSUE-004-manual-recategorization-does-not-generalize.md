---
id: ISSUE-004
title: Manually recategorizing a transaction doesn't generalize to future transactions
status: resolved
created: 2026-08-20
resolved: 2026-08-20
---

## Summary

Correcting a transaction's category only updates that one transaction row. It doesn't update the merchant's default category or create a rule, so the same recurring merchant needs to be re-fixed on every future sync.

## Details

`updateTransactionCategoryScoped` (`src/actions/transactions.ts:38-69`, also exposed as the MCP tool `update_transaction_category`) writes only to `transactions.categoryId` for the given transaction ID. It does not touch `merchants.categoryId` (tier 2 of the categorization pipeline, `merchant_default`) and does not create a `category_rules` row (tier 1, `rule` — moot regardless per ISSUE-002, since nothing else can create one either).

The AI fallback tier (`src/lib/ai/categorize.ts`) only attempts each transaction once ever, gated by `aiCategorizationAttemptedAt` — so a wrong or skipped AI attempt is also permanent per-transaction, not per-merchant.

## Findings

- **2026-08-20:** Confirmed by reading `updateTransactionCategoryScoped` directly — its only side effects are setting `categoryId`, `categorySource`, `reviewed`, and `updatedAt` on the single `transactions` row (via `buildCategoryUpdate`), plus a `revalidatePath("/transactions")` call. No write to `merchants` or `category_rules`.

## Resolution

- **2026-08-20:** `updateTransactionCategoryScoped` now also writes the merchant's default category (tier 2) inside the same DB transaction when a category is set (not cleared) and the transaction has a merchant — `src/actions/transactions.ts`, with integration test coverage in `tests/integration/transaction-actions.test.ts` — commit `141f72a`. Rule creation (tier 1) remains out of scope here; tracked separately as ISSUE-002.
- **2026-08-20:** Reopened — the fix landed and was marked resolved before manual verification against a running app.
- **2026-08-20:** Manually verified end-to-end against a running app (non-demo household, `demoMode` off). Using a test account/merchant/transaction inserted directly in Postgres: (1) setting the transaction's category to Travel via the `/transactions` UI updated `merchants.category_id` to match; (2) clearing the transaction's category back to null left `merchants.category_id` untouched at Travel. Both match expected behavior. Re-closing as resolved.
