import { inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { LedgrDb } from "@/db";
import { categories } from "@/db/schema";
import { scopedQuery } from "@/lib/scoped-query";
import type { GroupFilter } from "@/lib/group-filter";

export interface ResolvedGroupFilter {
  /** False when no group filter applies; `condition` is then always undefined. */
  active: boolean;
  /**
   * The WHERE term for a category column — `transactions.categoryId` or a
   * split's `categoryId`. Include mode drops uncategorized rows; exclude mode
   * keeps them. Undefined when the filter does not narrow anything.
   */
  condition(column: AnyPgColumn): SQL | undefined;
  /** The same rule in JS, for rows already fetched (split rows). */
  matches(categoryId: string | null): boolean;
}

const INACTIVE: ResolvedGroupFilter = {
  active: false,
  condition: () => undefined,
  matches: () => true,
};

/**
 * Resolve a group filter to this household's category ids. Household-scoped,
 * so a group id from another household resolves to no categories: "only" it
 * matches nothing, "all except" it excludes nothing.
 */
export async function resolveGroupFilter(
  householdId: string,
  filter: GroupFilter,
  db: LedgrDb,
): Promise<ResolvedGroupFilter> {
  if (!filter.groupIds?.length) return INACTIVE;

  const scoped = scopedQuery(householdId, db);
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(scoped.where(categories, inArray(categories.groupId, filter.groupIds)));
  const ids = rows.map((r) => r.id);
  const idSet = new Set(ids);

  if (filter.groupMode === "exclude") {
    return {
      active: true,
      // `category_id NOT IN (...)` is NULL for an uncategorized row, so the
      // IS NULL branch is what keeps them.
      condition: (column) => (ids.length === 0 ? undefined : or(isNull(column), notInArray(column, ids))),
      matches: (categoryId) => categoryId === null || !idSet.has(categoryId),
    };
  }
  return {
    active: true,
    condition: (column) => (ids.length === 0 ? sql`false` : inArray(column, ids)),
    matches: (categoryId) => categoryId !== null && idSet.has(categoryId),
  };
}
