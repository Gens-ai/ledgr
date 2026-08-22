import { and, desc, eq, gte, inArray, isNull, lte, lt, type SQL, sql } from "drizzle-orm";
import { db as defaultDb, type LedgrDb } from "@/db";
import {
  transactions,
  merchants,
  categories,
  categoryGroups,
  budgets,
  budgetCategories,
  recurringTransactions,
} from "@/db/schema";
import { scopedQuery } from "@/lib/scoped-query";
import { notDeleted, sumAbs, countRows } from "@/lib/query-helpers";
import { notIncome } from "@/queries/shared-conditions";
import { resolvedCategoryLabel } from "@/lib/labels";
import { todayDateString, getCurrentMonth, monthBounds } from "@/lib/date-utils";
import {
  DEFAULT_WINDOW_DAYS,
  type SavingsScope,
  type SpendingProfile,
  type MerchantEvidence,
  type CategoryEvidence,
  type RecurringEvidence,
} from "./types";

const MAX_OVERALL_MERCHANTS = 10;
const MAX_OVERALL_CATEGORIES = 10;
const MAX_SCOPED_MERCHANTS = 8;
const MAX_RECURRING = 10;

export type ResolveScopeResult =
  | { type: "merchant"; merchantId: string; label: string }
  | { type: "category"; categoryId: string; label: string }
  | { type: "overall" }
  | { type: "transaction_only"; transactionId: string; name: string }
  | { error: string };

function windowStartDate(days: number, endDate: string): string {
  const end = new Date(endDate + "T12:00:00");
  end.setDate(end.getDate() - days);
  return end.toISOString().slice(0, 10);
}

/** Turns a user-facing scope (which may just be a transaction id) into the
 * concrete merchant/category/overall the profile is actually built for. A
 * transaction resolves to its merchant first, its category second, and only
 * falls back to a single-transaction profile when it has neither (e.g. an
 * uncategorized CSV import with no merchant match). */
export async function resolveScope(
  householdId: string,
  scope: SavingsScope,
  db: LedgrDb,
): Promise<ResolveScopeResult> {
  const scoped = scopedQuery(householdId, db);

  if (scope.type === "overall") return { type: "overall" };

  if (scope.type === "merchant") {
    if (!scope.id) return { error: "A merchant id is required for merchant scope" };
    const [row] = await db
      .select({ id: merchants.id, name: merchants.name })
      .from(merchants)
      .where(scoped.where(merchants, eq(merchants.id, scope.id)))
      .limit(1);
    if (!row) return { error: "Merchant not found" };
    return { type: "merchant", merchantId: row.id, label: row.name };
  }

  if (scope.type === "category") {
    if (!scope.id) return { error: "A category id is required for category scope" };
    const [row] = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(scoped.where(categories, eq(categories.id, scope.id)))
      .limit(1);
    if (!row) return { error: "Category not found" };
    return { type: "category", categoryId: row.id, label: resolvedCategoryLabel(row.name) };
  }

  // scope.type === "transaction"
  if (!scope.id) return { error: "A transaction id is required for transaction scope" };
  const [txn] = await db
    .select({
      id: transactions.id,
      name: transactions.name,
      merchantId: transactions.merchantId,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(scoped.where(transactions, eq(transactions.id, scope.id), notDeleted(transactions)))
    .limit(1);
  if (!txn) return { error: "Transaction not found" };

  if (txn.merchantId) {
    const [merchant] = await db
      .select({ id: merchants.id, name: merchants.name })
      .from(merchants)
      .where(eq(merchants.id, txn.merchantId))
      .limit(1);
    if (merchant) return { type: "merchant", merchantId: merchant.id, label: merchant.name };
  }
  if (txn.categoryId) {
    const [category] = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.id, txn.categoryId))
      .limit(1);
    if (category) {
      return { type: "category", categoryId: category.id, label: resolvedCategoryLabel(category.name) };
    }
  }
  return { type: "transaction_only", transactionId: txn.id, name: txn.name };
}

async function expenseConditions(householdId: string, from: string, to: string, db: LedgrDb): Promise<SQL[]> {
  return [
    notDeleted(transactions),
    lt(transactions.normalizedAmount, 0),
    eq(transactions.pending, false),
    eq(transactions.isTransfer, false),
    isNull(transactions.transferPairId),
    gte(transactions.date, from),
    lte(transactions.date, to),
    await notIncome(householdId, db),
  ];
}

interface MerchantAgg {
  merchantId: string;
  visitCount: number;
  total: number;
  firstDate: string;
  lastDate: string;
}

/** Aggregates spend per merchant over `conditions`. Pass `merchantId` to
 * scope to one merchant, or `limit` to take the top N by total spend
 * (callers wanting merchants within a specific category pass that as an
 * extra `eq(transactions.categoryId, ...)` condition rather than a separate
 * option — that groups by how transactions were actually categorized,
 * not by each merchant's possibly-stale default category). */
async function aggregateMerchants(
  householdId: string,
  conditions: SQL[],
  db: LedgrDb,
  opts: { merchantId?: string; limit?: number },
): Promise<MerchantAgg[]> {
  const scoped = scopedQuery(householdId, db);
  const merchantFilter = opts.merchantId
    ? eq(transactions.merchantId, opts.merchantId)
    : sql`${transactions.merchantId} IS NOT NULL`;

  const query = db
    .select({
      merchantId: transactions.merchantId,
      visitCount: countRows(),
      total: sumAbs(transactions.normalizedAmount),
      firstDate: sql<string>`MIN(${transactions.date})`,
      lastDate: sql<string>`MAX(${transactions.date})`,
    })
    .from(transactions)
    .where(scoped.where(transactions, ...conditions, merchantFilter))
    .groupBy(transactions.merchantId)
    .orderBy(desc(sumAbs(transactions.normalizedAmount)));

  const rows = opts.limit ? await query.limit(opts.limit) : await query;
  return rows
    .filter((r): r is typeof r & { merchantId: string } => r.merchantId !== null)
    .map((r) => ({
      merchantId: r.merchantId,
      visitCount: r.visitCount,
      total: r.total,
      firstDate: r.firstDate,
      lastDate: r.lastDate,
    }));
}

async function priorWindowTotals(
  householdId: string,
  merchantIds: string[],
  priorFrom: string,
  priorTo: string,
  db: LedgrDb,
): Promise<Map<string, number>> {
  if (merchantIds.length === 0) return new Map();
  const scoped = scopedQuery(householdId, db);
  const conditions = await expenseConditions(householdId, priorFrom, priorTo, db);
  const rows = await db
    .select({ merchantId: transactions.merchantId, total: sumAbs(transactions.normalizedAmount) })
    .from(transactions)
    .where(scoped.where(transactions, ...conditions, inArray(transactions.merchantId, merchantIds)))
    .groupBy(transactions.merchantId);
  return new Map(rows.filter((r) => r.merchantId !== null).map((r) => [r.merchantId as string, r.total]));
}

async function enrichMerchants(
  aggs: MerchantAgg[],
  priorTotals: Map<string, number>,
  db: LedgrDb,
): Promise<MerchantEvidence[]> {
  if (aggs.length === 0) return [];
  const merchantIds = aggs.map((a) => a.merchantId);
  const rows = await db
    .select({
      id: merchants.id,
      name: merchants.name,
      categoryId: merchants.categoryId,
    })
    .from(merchants)
    .where(inArray(merchants.id, merchantIds));
  const categoryIds = [...new Set(rows.map((r) => r.categoryId).filter((id): id is string => id !== null))];
  const catRows = categoryIds.length
    ? await db.select({ id: categories.id, name: categories.name }).from(categories).where(inArray(categories.id, categoryIds))
    : [];
  const catNameById = new Map(catRows.map((c) => [c.id, c.name]));
  const merchantById = new Map(rows.map((r) => [r.id, r]));

  return aggs.map((a) => {
    const m = merchantById.get(a.merchantId);
    return {
      key: `merchant:${a.merchantId}`,
      merchantId: a.merchantId,
      name: m?.name ?? "Unknown merchant",
      categoryName: m?.categoryId ? (catNameById.get(m.categoryId) ?? null) : null,
      visitCount: a.visitCount,
      totalCents: a.total,
      avgCents: a.visitCount > 0 ? Math.round(a.total / a.visitCount) : 0,
      firstDate: a.firstDate,
      lastDate: a.lastDate,
      priorWindowTotalCents: priorTotals.get(a.merchantId) ?? 0,
    };
  });
}

async function buildCategoryEvidence(
  householdId: string,
  conditions: SQL[],
  db: LedgrDb,
  opts: { categoryId?: string; limit?: number },
  grandTotalCents: number,
): Promise<CategoryEvidence[]> {
  const scoped = scopedQuery(householdId, db);
  const categoryFilter = opts.categoryId
    ? eq(transactions.categoryId, opts.categoryId)
    : sql`${transactions.categoryId} IS NOT NULL`;

  const query = db
    .select({
      categoryId: transactions.categoryId,
      total: sumAbs(transactions.normalizedAmount),
    })
    .from(transactions)
    .where(scoped.where(transactions, ...conditions, categoryFilter))
    .groupBy(transactions.categoryId)
    .orderBy(desc(sumAbs(transactions.normalizedAmount)));

  const rows = opts.limit ? await query.limit(opts.limit) : await query;
  const categoryIds = rows.map((r) => r.categoryId).filter((id): id is string => id !== null);
  if (categoryIds.length === 0) return [];

  const catRows = await db
    .select({ id: categories.id, name: categories.name, groupId: categories.groupId })
    .from(categories)
    .where(inArray(categories.id, categoryIds));
  const groupIds = [...new Set(catRows.map((c) => c.groupId))];
  const groupRows = groupIds.length
    ? await db.select({ id: categoryGroups.id, name: categoryGroups.name }).from(categoryGroups).where(inArray(categoryGroups.id, groupIds))
    : [];
  const groupNameById = new Map(groupRows.map((g) => [g.id, g.name]));
  const catById = new Map(catRows.map((c) => [c.id, c]));

  const month = getCurrentMonth();
  const [budgetRow] = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(and(eq(budgets.householdId, householdId), eq(budgets.month, month)))
    .limit(1);
  const budgetByCategory = new Map<string, { limitAmount: number }>();
  if (budgetRow) {
    const bcRows = await db
      .select({ categoryId: budgetCategories.categoryId, limitAmount: budgetCategories.limitAmount })
      .from(budgetCategories)
      .where(and(eq(budgetCategories.budgetId, budgetRow.id), inArray(budgetCategories.categoryId, categoryIds)));
    for (const bc of bcRows) budgetByCategory.set(bc.categoryId, { limitAmount: bc.limitAmount });
  }

  const { from: monthFrom, to: monthTo } = monthBounds(month);
  const monthConditions = await expenseConditions(householdId, monthFrom, monthTo, db);
  const monthRows = budgetByCategory.size
    ? await db
        .select({ categoryId: transactions.categoryId, total: sumAbs(transactions.normalizedAmount) })
        .from(transactions)
        .where(scoped.where(transactions, ...monthConditions, inArray(transactions.categoryId, [...budgetByCategory.keys()])))
        .groupBy(transactions.categoryId)
    : [];
  const monthSpentByCategory = new Map(monthRows.filter((r) => r.categoryId !== null).map((r) => [r.categoryId as string, r.total]));

  return rows
    .filter((r): r is typeof r & { categoryId: string } => r.categoryId !== null)
    .map((r) => {
      const cat = catById.get(r.categoryId);
      const budget = budgetByCategory.get(r.categoryId);
      return {
        key: `category:${r.categoryId}`,
        categoryId: r.categoryId,
        name: resolvedCategoryLabel(cat?.name),
        groupName: cat ? (groupNameById.get(cat.groupId) ?? null) : null,
        totalCents: r.total,
        shareOfSpend: grandTotalCents > 0 ? r.total / grandTotalCents : 0,
        budgetLimitCents: budget?.limitAmount ?? null,
        budgetSpentCents: budget ? (monthSpentByCategory.get(r.categoryId) ?? 0) : null,
      };
    });
}

async function buildRecurringEvidence(
  householdId: string,
  db: LedgrDb,
  opts: { merchantId?: string; categoryId?: string },
): Promise<RecurringEvidence[]> {
  const conditions = [
    eq(recurringTransactions.householdId, householdId),
    eq(recurringTransactions.isActive, true),
    eq(recurringTransactions.isIncome, false),
  ];
  if (opts.merchantId) conditions.push(eq(recurringTransactions.merchantId, opts.merchantId));
  if (opts.categoryId) conditions.push(eq(recurringTransactions.categoryId, opts.categoryId));

  const rows = await db
    .select({
      id: recurringTransactions.id,
      name: recurringTransactions.name,
      frequency: recurringTransactions.frequency,
      averageAmount: recurringTransactions.averageAmount,
      nextDate: recurringTransactions.nextDate,
    })
    .from(recurringTransactions)
    .where(and(...conditions))
    .orderBy(recurringTransactions.nextDate)
    .limit(MAX_RECURRING);

  return rows.map((r) => ({
    key: `recurring:${r.id}`,
    recurringTransactionId: r.id,
    name: r.name,
    frequency: r.frequency,
    averageAmountCents: Math.abs(r.averageAmount ?? 0),
    nextDate: r.nextDate,
  }));
}

async function grandTotalSpend(householdId: string, conditions: SQL[], db: LedgrDb): Promise<number> {
  const scoped = scopedQuery(householdId, db);
  const [row] = await db
    .select({ total: sumAbs(transactions.normalizedAmount) })
    .from(transactions)
    .where(scoped.where(transactions, ...conditions));
  return row?.total ?? 0;
}

/** Computes the deterministic, evidence-only profile a scope's savings
 * suggestions must be grounded in — no AI involved. See resolveScope() for
 * how a transaction scope narrows to a merchant/category/single transaction. */
export async function buildSpendingProfile(
  householdId: string,
  scope: SavingsScope,
  db: LedgrDb = defaultDb,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<SpendingProfile | { error: string }> {
  const resolved = await resolveScope(householdId, scope, db);
  if ("error" in resolved) return resolved;

  const windowEnd = todayDateString();
  const windowStart = windowStartDate(windowDays, windowEnd);
  const priorStart = windowStartDate(windowDays, windowStart);
  const priorEnd = windowStartDate(1, windowStart);

  const conditions = await expenseConditions(householdId, windowStart, windowEnd, db);
  const grandTotal = await grandTotalSpend(householdId, conditions, db);

  if (resolved.type === "overall") {
    const merchantAggs = await aggregateMerchants(householdId, conditions, db, { limit: MAX_OVERALL_MERCHANTS });
    const priorTotals = await priorWindowTotals(householdId, merchantAggs.map((a) => a.merchantId), priorStart, priorEnd, db);
    const merchantEvidence = await enrichMerchants(merchantAggs, priorTotals, db);
    const categoryEvidence = await buildCategoryEvidence(householdId, conditions, db, { limit: MAX_OVERALL_CATEGORIES }, grandTotal);
    const recurring = await buildRecurringEvidence(householdId, db, {});

    return {
      scope: { type: "overall" },
      scopeLabel: "All spending",
      windowDays,
      windowStart,
      windowEnd,
      totalSpendCents: grandTotal,
      currency: "USD",
      merchants: merchantEvidence,
      categories: categoryEvidence,
      recurring,
    };
  }

  if (resolved.type === "merchant") {
    const merchantAggs = await aggregateMerchants(householdId, conditions, db, { merchantId: resolved.merchantId });
    const priorTotals = await priorWindowTotals(householdId, [resolved.merchantId], priorStart, priorEnd, db);
    const merchantEvidence = await enrichMerchants(merchantAggs, priorTotals, db);

    const [merchantRow] = await db
      .select({ categoryId: merchants.categoryId })
      .from(merchants)
      .where(eq(merchants.id, resolved.merchantId))
      .limit(1);
    const categoryEvidence = merchantRow?.categoryId
      ? await buildCategoryEvidence(householdId, conditions, db, { categoryId: merchantRow.categoryId }, grandTotal)
      : [];
    const recurring = await buildRecurringEvidence(householdId, db, { merchantId: resolved.merchantId });

    return {
      scope: { type: "merchant", id: resolved.merchantId },
      scopeLabel: resolved.label,
      windowDays,
      windowStart,
      windowEnd,
      totalSpendCents: merchantEvidence[0]?.totalCents ?? 0,
      currency: "USD",
      merchants: merchantEvidence,
      categories: categoryEvidence,
      recurring,
    };
  }

  if (resolved.type === "category") {
    const categoryEvidence = await buildCategoryEvidence(householdId, conditions, db, { categoryId: resolved.categoryId }, grandTotal);
    // Merchants within this category, per how transactions were actually
    // categorized in the window — not each merchant's possibly-stale default.
    const categoryMerchantConditions = [...conditions, eq(transactions.categoryId, resolved.categoryId)];
    const merchantAggs = await aggregateMerchants(householdId, categoryMerchantConditions, db, { limit: MAX_SCOPED_MERCHANTS });
    const priorTotals = await priorWindowTotals(householdId, merchantAggs.map((a) => a.merchantId), priorStart, priorEnd, db);
    const merchantEvidence = await enrichMerchants(merchantAggs, priorTotals, db);
    const recurring = await buildRecurringEvidence(householdId, db, { categoryId: resolved.categoryId });

    return {
      scope: { type: "category", id: resolved.categoryId },
      scopeLabel: resolved.label,
      windowDays,
      windowStart,
      windowEnd,
      totalSpendCents: categoryEvidence[0]?.totalCents ?? 0,
      currency: "USD",
      merchants: merchantEvidence,
      categories: categoryEvidence,
      recurring,
    };
  }

  // transaction_only: no merchant/category to key off of — ground the profile
  // in just that one transaction's own name/date/amount.
  const scoped = scopedQuery(householdId, db);
  const [txn] = await db
    .select({ name: transactions.name, amount: transactions.normalizedAmount, date: transactions.date })
    .from(transactions)
    .where(scoped.where(transactions, eq(transactions.id, resolved.transactionId)))
    .limit(1);

  return {
    scope: { type: "transaction", id: resolved.transactionId },
    scopeLabel: resolved.name,
    windowDays,
    windowStart,
    windowEnd,
    totalSpendCents: txn ? Math.abs(txn.amount) : 0,
    currency: "USD",
    merchants: [],
    categories: [],
    recurring: [],
  };
}
