import { eq, desc } from "drizzle-orm";
import { db as defaultDb, type LedgrDb } from "@/db";
import { savingsSuggestions, userSettings } from "@/db/schema";
import { scopedQuery } from "@/lib/scoped-query";
import type { SavingsPayload } from "@/lib/ai/savings/types";
import type { SavingsScopeType, SavingsSuggestionStatus } from "@/db/schema";

export interface SavingsSuggestionRecord extends SavingsPayload {
  id: string;
  scopeType: SavingsScopeType;
  scopeId: string | null;
  scopeLabel: string;
  windowDays: number;
  model: string;
  dealsIncluded: boolean;
  status: SavingsSuggestionStatus;
  actedAt: Date | null;
  createdAt: Date;
}

function parseRecord(row: {
  id: string;
  scopeType: SavingsScopeType;
  scopeId: string | null;
  scopeLabel: string;
  windowDays: number;
  payload: string;
  model: string;
  dealsIncluded: boolean;
  status: SavingsSuggestionStatus;
  actedAt: Date | null;
  createdAt: Date;
}): SavingsSuggestionRecord | null {
  try {
    const payload = JSON.parse(row.payload) as SavingsPayload;
    return { ...row, ...payload };
  } catch {
    return null;
  }
}

/** Most recent savings-advisor runs for a household, newest first. Pass
 * `scope` to scope the history panel to one transaction/merchant/category
 * button instead of the household-wide list. */
export async function listSavingsSuggestions(
  householdId: string,
  scope: { type: SavingsScopeType; id?: string } | null,
  db: LedgrDb = defaultDb,
  limit = 10,
): Promise<SavingsSuggestionRecord[]> {
  const scoped = scopedQuery(householdId, db);
  const conditions = scope
    ? [eq(savingsSuggestions.scopeType, scope.type), ...(scope.id ? [eq(savingsSuggestions.scopeId, scope.id)] : [])]
    : [];

  const rows = await db
    .select()
    .from(savingsSuggestions)
    .where(scoped.where(savingsSuggestions, ...conditions))
    .orderBy(desc(savingsSuggestions.createdAt))
    .limit(limit);

  return rows.map(parseRecord).filter((r): r is SavingsSuggestionRecord => r !== null);
}

export async function getSavingsSuggestionById(
  householdId: string,
  id: string,
  db: LedgrDb = defaultDb,
): Promise<SavingsSuggestionRecord | null> {
  const scoped = scopedQuery(householdId, db);
  const [row] = await db
    .select()
    .from(savingsSuggestions)
    .where(scoped.where(savingsSuggestions, eq(savingsSuggestions.id, id)))
    .limit(1);
  return row ? parseRecord(row) : null;
}

export interface DealsSettings {
  enabled: boolean;
  location: string | null;
}

export async function getDealsSettings(userId: string, db: LedgrDb = defaultDb): Promise<DealsSettings> {
  const [row] = await db
    .select({ enabled: userSettings.dealsWebSearchEnabled, location: userSettings.dealsLocation })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return { enabled: row?.enabled ?? false, location: row?.location ?? null };
}
