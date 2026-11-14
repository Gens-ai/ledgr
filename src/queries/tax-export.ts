import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db as defaultDb, type LedgrDb } from "@/db";
import { accounts, categories, categoryGroups, merchants, transactionSplits, transactions } from "@/db/schema";
import { scopedQuery } from "@/lib/scoped-query";
import { notDeleted, notHidden } from "@/lib/query-helpers";
import { UNCATEGORIZED } from "@/lib/labels";
import type { GroupFilter } from "@/lib/group-filter";
import { getIncomeCategoryIds, includedInIncomeTotals } from "@/queries/shared-conditions";
import { resolveGroupFilter } from "@/queries/group-filter";

export interface TaxYearFilters extends GroupFilter {
  /** Calendar year, e.g. 2025. */
  year: number;
}

export interface TaxYearTransaction {
  date: string;
  accountName: string;
  /** Merchant name when known, else the transaction name — as the transactions export. */
  description: string;
  categoryId: string | null;
  categoryName: string;
  groupName: string | null;
  side: "income" | "expense";
  /** Signed cents, credit positive (normalizedAmount convention). */
  amount: number;
  notes: string | null;
  /** True for one line of a split transaction. */
  isSplit: boolean;
}

export interface TaxYearCategoryTotal {
  groupName: string | null;
  categoryId: string | null;
  categoryName: string;
  /** Cents. */
  income: number;
  /** Cents, as a positive magnitude. */
  expenses: number;
  count: number;
}

export interface TaxYearExport {
  totals: TaxYearCategoryTotal[];
  transactions: TaxYearTransaction[];
}

/**
 * Everything behind a calendar year's income and expense totals, by category —
 * for an accountant's Schedule C prep (fork, 2026-11-14).
 *
 * The row population and the income/expense split are the Reports totals'
 * (`incomeTotalsRule` + `includedInIncomeTotals`): settled, not hidden,
 * transfers excluded except an owner's-draw credit; credits are income, debits
 * outside income categories are expenses. A row that is neither (a debit filed
 * under an income category) is behind no total, so it is left out.
 *
 * One deliberate refinement for a per-category file: a split transaction
 * contributes one line per split, under the split's own category with the
 * parent's sign — the same way the Spending tab attributes splits — so a
 * Costco run split between business meals and groceries lands in both.
 *
 * The group filter is applied to each line's own category; uncategorized lines
 * appear only with no group filter or in exclude mode (lib/group-filter.ts).
 */
export async function getTaxYearExport(
  householdId: string,
  filters: TaxYearFilters,
  db: LedgrDb = defaultDb,
): Promise<TaxYearExport> {
  const scoped = scopedQuery(householdId, db);
  const [incomeCategoryIds, rowFilter, groupFilter] = await Promise.all([
    getIncomeCategoryIds(householdId, db),
    includedInIncomeTotals(householdId, db),
    resolveGroupFilter(householdId, filters, db),
  ]);

  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      name: transactions.name,
      normalizedAmount: transactions.normalizedAmount,
      categoryId: transactions.categoryId,
      notes: transactions.notes,
      accountName: accounts.name,
      merchantName: merchants.name,
    })
    .from(transactions)
    .leftJoin(accounts, and(eq(transactions.accountId, accounts.id), eq(accounts.householdId, householdId)))
    .leftJoin(merchants, and(eq(transactions.merchantId, merchants.id), eq(merchants.householdId, householdId)))
    .where(
      scoped.where(
        transactions,
        notDeleted(transactions),
        notHidden(transactions),
        eq(transactions.pending, false),
        rowFilter,
        gte(transactions.date, `${filters.year}-01-01`),
        lte(transactions.date, `${filters.year}-12-31`),
      ),
    )
    .orderBy(transactions.date, transactions.id);

  const ids = rows.map((r) => r.id);
  const splitsByTxn = new Map<string, { categoryId: string; amount: number; notes: string | null }[]>();
  if (ids.length > 0) {
    const splits = await db
      .select({
        transactionId: transactionSplits.transactionId,
        categoryId: transactionSplits.categoryId,
        amount: transactionSplits.amount,
        notes: transactionSplits.notes,
      })
      .from(transactionSplits)
      .where(inArray(transactionSplits.transactionId, ids))
      .orderBy(transactionSplits.createdAt, transactionSplits.id);
    for (const s of splits) {
      const list = splitsByTxn.get(s.transactionId) ?? [];
      list.push(s);
      splitsByTxn.set(s.transactionId, list);
    }
  }

  // Category and group names for every category id in play, household-scoped.
  const catRows = await db
    .select({ id: categories.id, name: categories.name, groupName: categoryGroups.name })
    .from(categories)
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(scoped.where(categories));
  const catById = new Map(catRows.map((c) => [c.id, c]));

  const lines: TaxYearTransaction[] = [];
  for (const row of rows) {
    const description = row.merchantName ?? row.name;
    const sign = row.normalizedAmount > 0 ? 1 : -1;
    const parts = splitsByTxn.get(row.id)?.map((s) => ({
      categoryId: s.categoryId as string | null,
      amount: sign * Math.abs(s.amount),
      notes: s.notes ?? row.notes,
      isSplit: true,
    })) ?? [{ categoryId: row.categoryId, amount: row.normalizedAmount, notes: row.notes, isSplit: false }];

    for (const part of parts) {
      // incomeTotalsRule, per line: credits are income; debits outside income
      // categories are expenses; anything else is behind no total.
      let side: "income" | "expense" | null = null;
      if (part.amount > 0) side = "income";
      else if (part.amount < 0 && !(part.categoryId && incomeCategoryIds.has(part.categoryId))) side = "expense";
      if (side === null) continue;
      if (!groupFilter.matches(part.categoryId)) continue;

      const cat = part.categoryId ? catById.get(part.categoryId) : undefined;
      lines.push({
        date: row.date,
        accountName: row.accountName ?? "",
        description: part.isSplit ? `${description} (split)` : description,
        categoryId: part.categoryId,
        categoryName: cat?.name ?? UNCATEGORIZED,
        groupName: cat?.groupName ?? null,
        side,
        amount: part.amount,
        notes: part.notes,
        isSplit: part.isSplit,
      });
    }
  }

  const totalsByKey = new Map<string, TaxYearCategoryTotal>();
  for (const line of lines) {
    const key = line.categoryId ?? "";
    const total = totalsByKey.get(key) ?? {
      groupName: line.groupName,
      categoryId: line.categoryId,
      categoryName: line.categoryName,
      income: 0,
      expenses: 0,
      count: 0,
    };
    if (line.side === "income") total.income += line.amount;
    else total.expenses += Math.abs(line.amount);
    total.count += 1;
    totalsByKey.set(key, total);
  }

  // Grouped and alphabetical, uncategorized last — the order an accountant reads.
  const totals = [...totalsByKey.values()].sort((a, b) => {
    if (a.categoryId === null) return 1;
    if (b.categoryId === null) return -1;
    return (a.groupName ?? "").localeCompare(b.groupName ?? "") || a.categoryName.localeCompare(b.categoryName);
  });

  return { totals, transactions: lines };
}
