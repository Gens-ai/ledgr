---
id: ISSUE-003
title: No UI (or action) to create, rename, or delete categories
status: resolved
created: 2026-08-20
resolved: 2026-08-21
---

## Summary

Categories are a fixed, hardcoded seed list per household with no way to add, rename, or delete a category from the product.

## Details

- No `categories` page in the app router — `(dashboard)/` has `accounts`, `bills`, `budgets`, `import`, `investments`, `reports`, `transactions`, `settings`, and nothing else.
- `src/queries/categories.ts` (`getCategories()`) is read-only, used only to populate pills/selects/command-menus elsewhere.
- No `createCategory`/`updateCategory`/`deleteCategory` action exists anywhere in the repo.
- The category taxonomy (`src/db/seed/categories.ts`, `DEFAULT_CATEGORIES`) — 8 groups / ~34 categories — is inserted once per household at creation, all flagged `isSystem: true`. Every household gets the identical set, permanently.
- The MCP interface mirrors this: `list_categories` is read-only, no `create_category`/`update_category`/`delete_category` tool exists.

## Findings

- **2026-08-20:** Confirmed by searching the full route tree and action files, and by reading the MCP category tool registration (`src/lib/mcp/tools/categories.ts`) — only `list_categories` (read) is registered.

## Resolution

- **2026-08-21:** `src/actions/categories.ts` now exposes full CRUD (`createCategoryGroup`/`updateCategoryGroup`/`deleteCategoryGroup`, `createCategory`/`updateCategory`/`deleteCategory`, with dependent-row reassignment on delete), backed by a `(dashboard)/categories` page and its own settings entry point — commit `69b9172`, integration coverage in `tests/integration/category-actions.test.ts`. The MCP interface still has no `create_category`/`update_category`/`delete_category` tool (`list_categories` remains the only registered category tool) — that's outside this issue's literal scope (UI/action) but worth its own follow-up issue if MCP write-parity for categories is wanted.
