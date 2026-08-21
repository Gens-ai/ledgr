import { cache } from "react";
import { eq, isNull, or, sql, notInArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { LedgrDb } from "@/db";
import { transactions, categories } from "@/db/schema";
import { scopedQuery } from "@/lib/scoped-query";

export const getIncomeCategoryIds = cache(
  async (householdId: string, db: LedgrDb): Promise<Set<string>> => {
    const scoped = scopedQuery(householdId, db);
    const rows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(scoped.where(categories, eq(categories.isIncome, true)));
    return new Set(rows.map((r) => r.id));
  },
);

// Excludes rows explicitly tagged with an income category, regardless of
// sign (e.g. a payroll correction posted as a negative amount should still
// be excluded from spending breakdowns). Used by category-grouped spending
// reports (aggregateSpending, getCategoryTrends) where that's the right call.
export async function notIncome(householdId: string, db: LedgrDb): Promise<SQL> {
  const ids = [...(await getIncomeCategoryIds(householdId, db))];
  if (ids.length === 0) return sql`1=1`;
  return or(
    isNull(transactions.categoryId),
    notInArray(transactions.categoryId, ids),
  )!;
}

// Income vs. expense TOTALS are classified by transaction sign instead,
// matching getDashboardSummary: normalizedAmount > 0 is a credit (income),
// < 0 is a debit (expense). Category membership badly undercounts income in
// practice, since most income transactions never get auto-categorized into
// an income category — see ISSUE-010. Use this (not notIncome/
// getIncomeCategoryIds) for any income-vs-expense total, as opposed to a
// per-category breakdown.
export function isIncome(): SQL {
  return sql`${transactions.normalizedAmount} > 0`;
}
