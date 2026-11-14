import { eq, and, isNull, inArray } from "drizzle-orm";
import type { LedgrDb } from "@/db";
import { transactions, merchants, categoryRules, accounts, categories } from "@/db/schema";
import { scopedQuery } from "@/lib/scoped-query";
import { notDeleted } from "@/lib/query-helpers";
import { withHousehold } from "@/lib/household-context";
import { PFC_DETAILED_TO_CATEGORY } from "./pfc-map";

export interface CategorizableTransaction {
  id: string;
  /** Needed for account-scoped rules; a transaction without one only meets general rules. */
  accountId?: string | null;
  name: string;
  merchantId: string | null;
  merchantName: string | null;
  merchantCategoryId: string | null;
  pfcDetailed: string | null;
}

export interface CategoryRule {
  id: string;
  categoryId: string;
  matchField: "name" | "merchant";
  matchPattern: string;
  priority: number;
  /** Fork: limits the rule to one account. Null/absent = every account. */
  accountId?: string | null;
}

export interface CategoryAssignment {
  transactionId: string;
  categoryId: string;
  source: "rule" | "merchant_default" | "pfc";
}

export function categorizeTransactions(
  transactions: CategorizableTransaction[],
  rules: CategoryRule[],
  pfcCategoryMap: Map<string, string> = new Map(),
): CategoryAssignment[] {
  // Account-scoped rules first (fork), then priority descending within each
  // tier. Lowercase each rule's pattern once (R work) rather than per
  // transaction. A general rule with an empty pattern would match the whole
  // feed — the action refuses to create one, and this drops a hand-edited row.
  const sorted = [...rules]
    .filter((rule) => rule.accountId || rule.matchPattern.length > 0)
    .sort((a, b) => Number(!!b.accountId) - Number(!!a.accountId) || b.priority - a.priority)
    .map((rule) => ({ ...rule, patternLower: rule.matchPattern.toLowerCase() }));
  const assignments: CategoryAssignment[] = [];

  for (const txn of transactions) {
    let matched = false;
    // Lowercase each candidate field once per transaction, not once per rule.
    const nameLower = txn.name?.toLowerCase() ?? null;
    const merchantLower = txn.merchantName?.toLowerCase() ?? null;

    for (const rule of sorted) {
      if (rule.accountId && rule.accountId !== txn.accountId) continue;
      // An account rule with no pattern is a catch-all for that account.
      const catchAll = rule.accountId && rule.patternLower.length === 0;
      const target = rule.matchField === "merchant" ? merchantLower : nameLower;
      if (!catchAll && !target) continue;

      if (catchAll || target!.includes(rule.patternLower)) {
        assignments.push({
          transactionId: txn.id,
          categoryId: rule.categoryId,
          source: "rule",
        });
        matched = true;
        break;
      }
    }

    if (!matched && txn.merchantCategoryId) {
      assignments.push({
        transactionId: txn.id,
        categoryId: txn.merchantCategoryId,
        source: "merchant_default",
      });
      matched = true;
    }

    if (!matched && txn.pfcDetailed) {
      const pfcCategoryId = pfcCategoryMap.get(txn.pfcDetailed);
      if (pfcCategoryId) {
        assignments.push({
          transactionId: txn.id,
          categoryId: pfcCategoryId,
          source: "pfc",
        });
      }
    }
  }

  return assignments;
}

/** Provider-agnostic: `connectionId` is a bank_connections id, Plaid or SimpleFIN alike. */
export async function categorizeSyncedTransactions(
  connectionId: string,
  householdId: string,
  db: LedgrDb,
): Promise<void> {
  return withHousehold(householdId, (tx) => doCategorizeSyncedTransactions(connectionId, householdId, tx), db);
}

async function doCategorizeSyncedTransactions(
  connectionId: string,
  householdId: string,
  db: LedgrDb,
): Promise<void> {
  const scoped = scopedQuery(householdId, db);

  const rules = await db
    .select({
      id: categoryRules.id,
      categoryId: categoryRules.categoryId,
      matchField: categoryRules.matchField,
      matchPattern: categoryRules.matchPattern,
      priority: categoryRules.priority,
      accountId: categoryRules.accountId,
    })
    .from(categoryRules)
    .where(scoped.where(categoryRules)) as CategoryRule[];

  // Fork: join on the immutable seed key, not the display name, so renaming a
  // system category doesn't break its PFC categorization (and a custom
  // category that happens to share a seed name never captures it).
  const allCategories = await db
    .select({ id: categories.id, pfcSeedKey: categories.pfcSeedKey })
    .from(categories)
    .where(eq(categories.householdId, householdId));
  const catSeedKeyToId = new Map(
    allCategories
      .filter((c): c is { id: string; pfcSeedKey: string } => c.pfcSeedKey !== null)
      .map((c) => [c.pfcSeedKey, c.id]),
  );
  const pfcCategoryMap = new Map<string, string>();
  for (const [pfcCode, seedKey] of Object.entries(PFC_DETAILED_TO_CATEGORY)) {
    const catId = catSeedKeyToId.get(seedKey);
    if (catId) pfcCategoryMap.set(pfcCode, catId);
  }

  const itemAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        eq(accounts.bankConnectionId, connectionId),
      ),
    );

  if (itemAccounts.length === 0) return;

  const accountIds = itemAccounts.map((a) => a.id);

  const uncategorized = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      name: transactions.name,
      merchantId: transactions.merchantId,
      pfcDetailed: transactions.pfcDetailed,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        inArray(transactions.accountId, accountIds),
        isNull(transactions.categoryId),
        notDeleted(transactions),
      ),
    );

  if (uncategorized.length === 0) return;

  const merchantIds = [...new Set(
    uncategorized.map((t) => t.merchantId).filter((id): id is string => id !== null),
  )];
  const merchantMap = new Map<string, { name: string; categoryId: string | null }>();
  if (merchantIds.length > 0) {
    const merchantRows = await db
      .select({ id: merchants.id, name: merchants.name, categoryId: merchants.categoryId })
      .from(merchants)
      .where(inArray(merchants.id, merchantIds));
    for (const m of merchantRows) {
      merchantMap.set(m.id, { name: m.name, categoryId: m.categoryId });
    }
  }

  const categorizableTxns: CategorizableTransaction[] = uncategorized.map((txn) => {
    const merchant = txn.merchantId ? merchantMap.get(txn.merchantId) : undefined;
    return {
      id: txn.id,
      accountId: txn.accountId,
      name: txn.name,
      merchantId: txn.merchantId,
      merchantName: merchant?.name ?? null,
      merchantCategoryId: merchant?.categoryId ?? null,
      pfcDetailed: txn.pfcDetailed ?? null,
    };
  });

  const assignments = categorizeTransactions(categorizableTxns, rules, pfcCategoryMap);
  if (assignments.length === 0) return;

  const now = new Date();
  // Group assignments by (categoryId, source) so each distinct pair is a single
  // UPDATE over inArray(ids) rather than one UPDATE per transaction.
  const groups = new Map<
    string,
    { categoryId: string; source: CategoryAssignment["source"]; ids: string[] }
  >();
  for (const assignment of assignments) {
    const key = `${assignment.categoryId}\0${assignment.source}`;
    let group = groups.get(key);
    if (!group) {
      group = { categoryId: assignment.categoryId, source: assignment.source, ids: [] };
      groups.set(key, group);
    }
    group.ids.push(assignment.transactionId);
  }

  for (const group of groups.values()) {
    await db.update(transactions)
      .set({
        categoryId: group.categoryId,
        categorySource: group.source,
        updatedAt: now,
      })
      .where(inArray(transactions.id, group.ids));
  }
}
