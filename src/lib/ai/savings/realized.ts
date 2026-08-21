import { and, eq, gte, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import { db as defaultDb, type LedgrDb } from "@/db";
import { transactions } from "@/db/schema";
import { scopedQuery } from "@/lib/scoped-query";
import { notDeleted, sumAbs } from "@/lib/query-helpers";
import { notIncome } from "@/queries/shared-conditions";
import { todayDateString } from "@/lib/date-utils";
import { evidenceCeilings } from "./validate";
import type { SavingsSuggestionRecord } from "@/queries/savings";

export interface RealizedSavings {
  title: string;
  expectedMonthlyCents: number;
  daysSinceActed: number;
  expectedSpendCents: number;
  actualSpendCents: number;
  realizedCents: number;
}

function evidenceIdsByType(evidenceKeys: string[]): { merchantIds: string[]; categoryIds: string[]; recurringIds: string[] } {
  const merchantIds: string[] = [];
  const categoryIds: string[] = [];
  const recurringIds: string[] = [];
  for (const key of evidenceKeys) {
    const [prefix, id] = key.split(":");
    if (!id) continue;
    if (prefix === "merchant") merchantIds.push(id);
    else if (prefix === "category") categoryIds.push(id);
    else if (prefix === "recurring") recurringIds.push(id);
  }
  return { merchantIds, categoryIds, recurringIds };
}

function evidenceFilter(evidenceKeys: string[]): SQL | null {
  const { merchantIds, categoryIds, recurringIds } = evidenceIdsByType(evidenceKeys);
  const clauses: SQL[] = [];
  if (merchantIds.length) clauses.push(inArray(transactions.merchantId, merchantIds));
  if (categoryIds.length) clauses.push(inArray(transactions.categoryId, categoryIds));
  if (recurringIds.length) clauses.push(inArray(transactions.recurringTransactionId, recurringIds));
  if (clauses.length === 0) return null;
  return or(...clauses) ?? null;
}

/**
 * For a suggestion marked "acted", compares actual spend on its cited
 * evidence since actedAt against the monthly baseline captured in the
 * profile snapshot at suggestion time — the same ceiling validateSuggestions
 * clamped estMonthlySavingsCents to. A suggestion this returns 0 (or
 * negative-looking, i.e. actual > expected) for isn't a bug: it means the
 * household kept spending at (or above) the old rate.
 */
export async function computeRealizedSavings(
  householdId: string,
  record: SavingsSuggestionRecord,
  db: LedgrDb = defaultDb,
): Promise<RealizedSavings[] | { error: string }> {
  if (record.status !== "acted" || !record.actedAt) {
    return { error: "This suggestion hasn't been marked acted on yet" };
  }

  const scoped = scopedQuery(householdId, db);
  const actedDate = record.actedAt.toISOString().slice(0, 10);
  const today = todayDateString();
  const daysSinceActed = Math.max(
    1,
    Math.round((new Date(today + "T12:00:00").getTime() - new Date(actedDate + "T12:00:00").getTime()) / 86_400_000),
  );

  const ceilings = evidenceCeilings(record.profileSnapshot);
  const baseConditions = [
    notDeleted(transactions),
    lt(transactions.normalizedAmount, 0),
    eq(transactions.pending, false),
    eq(transactions.isTransfer, false),
    isNull(transactions.transferPairId),
    gte(transactions.date, actedDate),
    await notIncome(householdId, db),
  ];

  const results: RealizedSavings[] = [];
  for (const suggestion of record.suggestions) {
    const expectedMonthlyCents = suggestion.evidenceKeys.reduce((sum, k) => sum + (ceilings.get(k) ?? 0), 0);
    const expectedSpendCents = Math.round((expectedMonthlyCents / 30) * daysSinceActed);

    const filter = evidenceFilter(suggestion.evidenceKeys);
    let actualSpendCents = 0;
    if (filter) {
      const [row] = await db
        .select({ total: sumAbs(transactions.normalizedAmount) })
        .from(transactions)
        .where(scoped.where(transactions, and(...baseConditions, filter)!));
      actualSpendCents = row?.total ?? 0;
    }

    results.push({
      title: suggestion.title,
      expectedMonthlyCents,
      daysSinceActed,
      expectedSpendCents,
      actualSpendCents,
      realizedCents: Math.max(0, expectedSpendCents - actualSpendCents),
    });
  }

  return results;
}
