import { eq } from "drizzle-orm";
import { db as defaultDb, type LedgrDb } from "@/db";
import {
  categoryGroups,
  categories,
  transactions,
  transactionSplits,
  recurringTransactions,
  merchants,
  categoryRules,
  budgetCategories,
} from "@/db/schema";
import { scopedQuery } from "@/lib/scoped-query";
import { countRows } from "@/lib/query-helpers";

export interface CategoryOption {
  id: string;
  name: string;
  icon: string | null;
  isIncome: boolean;
  sortOrder: number;
}

export interface CategoryGroup {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  categories: CategoryOption[];
}

export async function getCategories(
  householdId: string,
  db: LedgrDb = defaultDb,
): Promise<CategoryGroup[]> {
  const scoped = scopedQuery(householdId, db);

  const groups = await db
    .select()
    .from(categoryGroups)
    .where(scoped.where(categoryGroups))
    .orderBy(categoryGroups.sortOrder);

  const cats = await db
    .select()
    .from(categories)
    .where(scoped.where(categories))
    .orderBy(categories.sortOrder);

  const catsByGroup = new Map<string, CategoryOption[]>();
  for (const cat of cats) {
    const list = catsByGroup.get(cat.groupId) ?? [];
    list.push({
      id: cat.id,
      name: cat.name,
      icon: cat.icon,
      isIncome: cat.isIncome ?? false,
      sortOrder: cat.sortOrder ?? 0,
    });
    catsByGroup.set(cat.groupId, list);
  }

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.icon,
    sortOrder: g.sortOrder ?? 0,
    categories: catsByGroup.get(g.id) ?? [],
  }));
}

export interface CategoryUsage {
  transactions: number;
  transactionSplits: number;
  recurringTransactions: number;
  merchants: number;
  categoryRules: number;
  budgetCategories: number;
}

/** Counts every row that references a category, across all six FK tables. Drives the
 * reassign-then-delete flow: zero total means the category can be deleted directly. */
export async function getCategoryUsage(
  categoryId: string,
  householdId: string,
  db: LedgrDb = defaultDb,
): Promise<CategoryUsage> {
  const scoped = scopedQuery(householdId, db);

  const [
    [txnRow],
    [splitRow],
    [recurringRow],
    [merchantRow],
    [ruleRow],
    [budgetCatRow],
  ] = await Promise.all([
    db.select({ count: countRows() }).from(transactions).where(scoped.where(transactions, eq(transactions.categoryId, categoryId))),
    db.select({ count: countRows() }).from(transactionSplits).where(eq(transactionSplits.categoryId, categoryId)),
    db.select({ count: countRows() }).from(recurringTransactions).where(scoped.where(recurringTransactions, eq(recurringTransactions.categoryId, categoryId))),
    db.select({ count: countRows() }).from(merchants).where(scoped.where(merchants, eq(merchants.categoryId, categoryId))),
    db.select({ count: countRows() }).from(categoryRules).where(scoped.where(categoryRules, eq(categoryRules.categoryId, categoryId))),
    db.select({ count: countRows() }).from(budgetCategories).where(eq(budgetCategories.categoryId, categoryId)),
  ]);

  return {
    transactions: txnRow?.count ?? 0,
    transactionSplits: splitRow?.count ?? 0,
    recurringTransactions: recurringRow?.count ?? 0,
    merchants: merchantRow?.count ?? 0,
    categoryRules: ruleRow?.count ?? 0,
    budgetCategories: budgetCatRow?.count ?? 0,
  };
}
