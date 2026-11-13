import { eq } from "drizzle-orm";
import { db as defaultDb, type LedgrDb } from "@/db";
import {
  budgetCategories,
  categoryGroups,
  categories,
  categoryRules,
  merchants,
  recurringTransactions,
  transactionSplits,
  transactions,
} from "@/db/schema";
import { scopedQuery } from "@/lib/scoped-query";
import { countRows } from "@/lib/query-helpers";

interface CategoryOption {
  id: string;
  name: string;
  icon: string | null;
  isIncome: boolean;
  includeTransferInSpending: boolean;
  isSystem: boolean;
  sortOrder: number;
}

export interface CategoryGroup {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  isSystem: boolean;
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
      includeTransferInSpending: cat.includeTransferInSpending ?? false,
      isSystem: cat.isSystem ?? false,
      sortOrder: cat.sortOrder ?? 0,
    });
    catsByGroup.set(cat.groupId, list);
  }

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.icon,
    sortOrder: g.sortOrder ?? 0,
    isSystem: g.isSystem ?? false,
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

/**
 * Fork: counts every row that references a category, across all six tables
 * with a category foreign key. Drives delete-with-reassign: a zero total means
 * the category can be deleted directly.
 *
 * Reads `transactions`, which has row-level security — call it inside
 * withHousehold() or the restricted app role counts zero transactions.
 * `categoryId` must already be verified as belonging to `householdId`: splits
 * and budget lines have no household_id of their own, so they are matched on
 * the (household-owned) category id alone.
 */
export async function getCategoryUsage(
  categoryId: string,
  householdId: string,
  db: LedgrDb = defaultDb,
): Promise<CategoryUsage> {
  const scoped = scopedQuery(householdId, db);
  const [[txn], [split], [recurring], [merchant], [rule], [budgetLine]] = await Promise.all([
    db
      .select({ count: countRows() })
      .from(transactions)
      .where(scoped.where(transactions, eq(transactions.categoryId, categoryId))),
    db
      .select({ count: countRows() })
      .from(transactionSplits)
      .where(eq(transactionSplits.categoryId, categoryId)),
    db
      .select({ count: countRows() })
      .from(recurringTransactions)
      .where(scoped.where(recurringTransactions, eq(recurringTransactions.categoryId, categoryId))),
    db
      .select({ count: countRows() })
      .from(merchants)
      .where(scoped.where(merchants, eq(merchants.categoryId, categoryId))),
    db
      .select({ count: countRows() })
      .from(categoryRules)
      .where(scoped.where(categoryRules, eq(categoryRules.categoryId, categoryId))),
    db
      .select({ count: countRows() })
      .from(budgetCategories)
      .where(eq(budgetCategories.categoryId, categoryId)),
  ]);

  return {
    transactions: txn?.count ?? 0,
    transactionSplits: split?.count ?? 0,
    recurringTransactions: recurring?.count ?? 0,
    merchants: merchant?.count ?? 0,
    categoryRules: rule?.count ?? 0,
    budgetCategories: budgetLine?.count ?? 0,
  };
}
