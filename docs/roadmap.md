# Ledgr evaluation — roadmap

Priority order for the gaps found during evaluation (full narrative: `docs/planning/gaps.md`), tracked individually as issues (`docs/issues/`). Status here is a pointer, not a duplicate — the issue's frontmatter (`status:`) is the source of truth; update the issue first, then reflect it here.

| Order | Issue | Status | Why this order |
|---|---|---|---|
| 1 | [ISSUE-004](issues/ISSUE-004-manual-recategorization-does-not-generalize.md) — manual recategorization doesn't generalize | resolved | Highest-impact: without this, "smart categorization" degrades to fixing the same recurring merchant every sync, forever. |
| 2 | [ISSUE-002](issues/ISSUE-002-category-rules-unreachable.md) — `category_rules` engine unreachable | open | Natural fix for #1 — schema and matching logic already work, needs only a writer (action, UI, or MCP tool). |
| 3 | [ISSUE-001](issues/ISSUE-001-mcp-list-categories-missing-await.md) — MCP `list_categories` returns `{}` | open | Trivial one-line fix, but worth doing before depending on the MCP interface for anything category-related. |
| 4 | [ISSUE-003](issues/ISSUE-003-no-category-crud-ui.md) — no category CRUD UI | resolved | Lowest urgency — the seeded taxonomy is broad enough for most households at first; reorganizing categories is a one-time cost, not recurring. |

#1 and #4 are resolved. Next up: **#2, ISSUE-002** — flip it to `in-progress` in its own frontmatter when work actually begins. See `docs/planning/gaps.md` for the fuller, whole-app gap list this table doesn't yet cover (only the categorization-area gaps above have been filed as individual issues so far).
