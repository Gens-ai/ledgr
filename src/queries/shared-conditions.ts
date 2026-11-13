import { cache } from "react";
import { and, eq, inArray, isNull, lt, or, sql, notInArray } from "drizzle-orm";
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

/**
 * The one rule for income-vs-expense TOTALS (fork, ISSUE-010; extended to
 * Reports 2026-11-12): dashboard tiles, Cash Flow, the Reports Total
 * Income/Expenses tiles, Safe to Spend, MCP and AI chat summaries.
 *
 * Income is classified by transaction sign, not category: `normalizedAmount
 * > 0` (a credit) is income. Category membership badly undercounts income in
 * practice — only ~9% of real income transactions land in an `isIncome`
 * category (ISSUE-010). Accepted consequence: a refund counts as income.
 *
 * Expenses are debits (`< 0`) outside income categories — exactly the Spending
 * tab's rule (`spendingBaseConditions` via `notIncome`), so a payroll
 * correction filed under an income category is not an expense anywhere.
 *
 * Callers supply the row filter (settled, not hidden, `includedInSpending` for
 * the transfer exclusion). Per-category breakdowns (spending reports via
 * `notIncome`, the Income vs Expense category table, the Sankey) stay on
 * category classification by design.
 */
export async function incomeTotalsRule(
  householdId: string,
  db: LedgrDb,
): Promise<{ isIncome: SQL; isExpense: SQL }> {
  return {
    isIncome: sql`(${transactions.normalizedAmount} > 0)`,
    isExpense: sql`(${transactions.normalizedAmount} < 0 AND ${await notIncome(householdId, db)})`,
  };
}

/**
 * Custom, non-income categories whose transfers the user counts as spending.
 * System categories can never opt in (the action refuses, and this filter
 * backstops a hand-edited row).
 */
export const getTransferReportingCategoryIds = cache(
  async (householdId: string, db: LedgrDb): Promise<string[]> => {
    const scoped = scopedQuery(householdId, db);
    const rows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        scoped.where(
          categories,
          eq(categories.includeTransferInSpending, true),
          eq(categories.isIncome, false),
          eq(categories.isSystem, false),
        ),
      );
    return rows.map((row) => row.id);
  },
);

/**
 * Which rows count toward spending-side figures.
 *
 * Ordinary rows: not a transfer and not paired. On top of that, an *outgoing*
 * transfer row (negative normalizedAmount, i.e. money out under the Plaid
 * convention) whose own category opted in via `includeTransferInSpending`
 * counts as spending in that category — e.g. rent paid by Zelle.
 *
 * Deliberate limits:
 * - Rows tagged `investment_account` are never re-included, so brokerage fills
 *   stay out of spending whatever their category says (`IS DISTINCT FROM` keeps
 *   a NULL transferSource eligible).
 * - Only outflows. An incoming transfer in an opted-in category is not
 *   spending, and income totals (`incomeTotalsRule`) must not see it become
 *   income.
 * - Pairing is not consulted for opted-in rows: each leg is judged on its own
 *   category, so only the leg filed under the opted-in category counts and the
 *   other leg (income-side or uncategorized) stays excluded. If both legs sit
 *   in opted-in categories, only the outgoing leg can qualify, so nothing is
 *   double counted.
 *
 * Income-side queries keep the plain transfer exclusion on purpose.
 */
export async function includedInSpending(householdId: string, db: LedgrDb): Promise<SQL> {
  const categoryIds = await getTransferReportingCategoryIds(householdId, db);
  const ordinaryTransaction = and(
    eq(transactions.isTransfer, false),
    isNull(transactions.transferPairId),
  )!;

  if (categoryIds.length === 0) return ordinaryTransaction;

  return or(
    ordinaryTransaction,
    and(
      eq(transactions.isTransfer, true),
      lt(transactions.normalizedAmount, 0),
      sql`${transactions.transferSource} IS DISTINCT FROM 'investment_account'`,
      inArray(transactions.categoryId, categoryIds),
    ),
  )!;
}
