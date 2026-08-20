---
id: ISSUE-002
title: category_rules engine is implemented but unreachable (no way to create a rule)
status: open
created: 2026-08-20
---

## Summary

The README advertises a four-tier categorization pipeline — "your rules > merchant defaults > Plaid categories > AI fallback." The `rule` tier's schema and matching logic are fully implemented, but there is no code path anywhere in the app (no action, no API route, no UI) that ever creates a row in `category_rules`. The tier never fires in real use.

## Details

- Schema: `category_rules` table in `src/db/schema/categories.ts` (`matchField`: "name"|"merchant", `matchPattern`, `priority`).
- Matching logic: `categorizeTransactions()` in `src/lib/categorization/engine.ts` correctly sorts rules by `priority` desc and does a case-insensitive substring match, checked first before `merchant_default`/`pfc`.
- Searched the full repo for writes to `category_rules` — the only inserts anywhere are in `tests/integration/helpers.ts` (test fixtures). No `src/actions/*` file, no API route, no UI component writes to this table.

## Findings

- **2026-08-20:** Confirmed via repo-wide code search (no production writer of `category_rules` found) and by reading `src/lib/mcp/tools/categories.ts`, which only registers a read tool (`list_categories`) — no `create_category_rule`/similar MCP tool exists either. Not tracked in any upstream issue or PR as of this date (checked all 47 issues/PRs on `KenTaniguchi-R/ledgr`).
