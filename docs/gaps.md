# Ledgr — gaps found (verified against source)

All findings verified by reading actual source at commit `7ee62177eed892022490518382007c680565aa9b` (2026-07-25, `v0.2.0`), not inferred from the README. See `vision.md` for the intended design each of these falls short of.

## 1. Category-rules tier of the categorization pipeline is dead code

The README advertises "your rules > merchant defaults > Plaid categories > AI fallback." The `rule` tier is fully implemented in the matching engine but **unreachable from the running product**:

- Schema exists: `category_rules` table (`src/db/schema/categories.ts`) — `matchField` ("name"|"merchant"), `matchPattern`, `priority`.
- Matching logic exists and works: `categorizeTransactions()` in `src/lib/categorization/engine.ts` sorts rules by `priority` desc and does a case-insensitive substring match, correctly, first tier checked.
- **But nothing in the application ever inserts a row into `category_rules`.** Searched the entire repo for writes to that table — the only inserts anywhere are in `tests/integration/helpers.ts` (test fixtures). No server action, no API route, no UI component creates, edits, or deletes a rule.
- Net effect: the `rule` branch of the pipeline never fires in real use. Every household effectively only has tiers 2–4 (`merchant_default` → `pfc` → `ai`), regardless of what the README claims.

## 2. No category CRUD UI (or category-rules UI)

- No `categories` page anywhere in the app router — `(dashboard)/` has `accounts`, `bills`, `budgets`, `import`, `investments`, `reports`, `transactions`, `settings`, and nothing else.
- `src/queries/categories.ts` (`getCategories()`) is **read-only** — used only to populate pills/selects/command-menus on other pages.
- No `createCategory`/`updateCategory`/`deleteCategory` action exists anywhere (searched explicitly — zero hits for category-entity CRUD; the only "updateCategory"-adjacent hits are for recategorizing a *transaction*, not editing a category).
- The category taxonomy is a fixed, hardcoded list (`src/db/seed/categories.ts`, `DEFAULT_CATEGORIES`) inserted once per household at creation, all flagged `isSystem: true`. Every household gets the identical ~34 categories, permanently, with no way to add, rename, or remove any of them from the product.

## 3. Manual corrections don't generalize — no learning loop

Recategorizing a transaction (`updateTransactionCategoryScoped`, `src/actions/transactions.ts:38-69`, also exposed as the MCP tool `update_transaction_category`) **only writes to that one transaction row.** It does not:
- update `merchants.categoryId` (which would teach tier 2, `merchant_default`, for next time), or
- create/update a `category_rules` row (which would teach tier 1 — moot anyway per gap #1).

Practical consequence: correcting the same recurring merchant's category is not a one-time fix. It recurs every sync, forever, until (if ever) the AI fallback tier happens to get it right — and even the AI tier only attempts each transaction once ever (`aiCategorizationAttemptedAt` gate in `src/lib/ai/categorize.ts`), so a wrong or skipped AI attempt is also permanent per-transaction, not per-merchant.

## 4. MCP `list_categories` tool bug — returns `{}` instead of your categories

`src/lib/mcp/tools/categories.ts`:

```ts
async () => {
  const groups = getCategories(householdId);   // missing await
  return jsonResult(groups);
}
```

`getCategories()` is `async`, returning `Promise<CategoryGroup[]>`. Called without `await`, `groups` is a pending `Promise` object. `jsonResult()` (`src/lib/mcp/tool-result.ts`) does `JSON.stringify(data, null, 2)` — `JSON.stringify` on a bare `Promise` (no enumerable own properties) serializes to `"{}"`.

**As of this commit, calling `list_categories` over MCP returns an empty object, not the category list.** Confirmed by reading both the tool and the `jsonResult` helper directly — not observed live (MCP server wasn't running in this evaluation), so worth a live smoke-test before relying on this if the app is ever deployed. Every other `getCategories()` call site in the app (dashboard pages) does await it correctly — this is isolated to the one MCP tool.

## 5. None of this is tracked upstream

Checked all 47 issues + PRs (open and closed) on `KenTaniguchi-R/ledgr` for "rule", "category", "categorization" in title or body. Only one open issue exists at all (#34, mutation-test coverage — unrelated). The keyword matches that did turn up were false positives unrelated to categorization: `onDelete cascade rules` (DB constraint, PR #24), `income-category query` scoping (perf, PR #35), "chart-linked category rows" (report styling, PR #3).

**None of gaps #1–4 above are filed anywhere upstream.** If pursued, filing #1–3 as a single well-scoped feature request (with the specific file/line pointers above) would be high-signal for a single-maintainer project; #4 is a precise, one-line bug report.

## Priority, if we act on this

1. **#3 (learning loop) matters most in practice** — it's what makes the advertised pipeline actually save you repeated work. Without it, "smart categorization" degrades to "categorize the same recurring bill manually, every month, forever."
2. **#1 (wire up `category_rules`)** is the natural fix for #3 and is mostly plumbing — schema and matching logic already work; it needs an action + minimal UI (or even just exposing an MCP `create_category_rule` tool, given the existing MCP write-scope model).
3. **#2 (category CRUD)** matters less urgently — the seeded taxonomy is broad enough for most households at first, and reorganizing categories is a one-time cost, not a recurring one.
4. **#4 (MCP bug)** is a trivial one-line fix (`await getCategories(householdId)`) but is exactly the kind of thing worth reporting/fixing before depending on the MCP interface for anything category-related.
