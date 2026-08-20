---
id: ISSUE-001
title: MCP list_categories tool returns {} instead of the category list
status: open
created: 2026-08-20
---

## Summary

The `list_categories` MCP tool returns an empty object (`{}`) instead of the household's category groups/categories, due to a missing `await`.

## Details

`src/lib/mcp/tools/categories.ts`:

```ts
async () => {
  const groups = getCategories(householdId);   // missing await
  return jsonResult(groups);
}
```

`getCategories()` (`src/queries/categories.ts`) is `async` and returns `Promise<CategoryGroup[]>`. Called without `await`, `groups` is a pending `Promise` object rather than the resolved data. `jsonResult()` (`src/lib/mcp/tool-result.ts`) does `JSON.stringify(data, null, 2)` — `JSON.stringify` on a bare `Promise` (no enumerable own properties) serializes to `"{}"`.

Every other call site of `getCategories()` in the app (dashboard pages) awaits it correctly — this is isolated to the one MCP tool.

## Findings

- **2026-08-20:** Root cause confirmed by reading source directly; not yet reproduced against a live running instance (no deployment stood up during this evaluation). Fix is a one-line `await` add.
