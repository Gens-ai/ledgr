"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db as defaultDb, type LedgrDb } from "@/db";
import { savingsSuggestions, SAVINGS_SCOPE_TYPES } from "@/db/schema";
import { scopedQuery } from "@/lib/scoped-query";
import { authorizeAction } from "@/lib/auth/authorize-action";
import { upsertUserSetting } from "@/queries/user-settings";
import { getSavingsSuggestions, type GetSavingsSuggestionsResult } from "@/lib/ai/savings/advisor";
import { computeRealizedSavings, type RealizedSavings } from "@/lib/ai/savings/realized";
import { listSavingsSuggestions, getSavingsSuggestionById, getDealsSettings, type SavingsSuggestionRecord, type DealsSettings } from "@/queries/savings";
import type { SavingsScopeType } from "@/db/schema";

const scopeSchema = z.object({
  type: z.enum(SAVINGS_SCOPE_TYPES),
  id: z.string().min(1).optional(),
});

const getSuggestionsSchema = z.object({
  scope: scopeSchema,
  windowDays: z.number().int().min(7).max(365).optional(),
  includeDeals: z.boolean().optional(),
});

export async function getSavingsSuggestionsAction(
  input: z.infer<typeof getSuggestionsSchema>,
  db: LedgrDb = defaultDb,
): Promise<GetSavingsSuggestionsResult | { error: string }> {
  const parsed = getSuggestionsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  const { householdId, userId } = auth;

  const result = await getSavingsSuggestions(
    householdId,
    userId,
    parsed.data.scope,
    { windowDays: parsed.data.windowDays, includeDeals: parsed.data.includeDeals },
    db,
  );
  if (!("error" in result)) {
    revalidatePath("/");
  }
  return result;
}

export async function listSavingsSuggestionsAction(
  scope: { type: SavingsScopeType; id?: string } | null,
  db: LedgrDb = defaultDb,
): Promise<SavingsSuggestionRecord[] | { error: string }> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  return listSavingsSuggestions(auth.householdId, scope, db);
}

async function setSuggestionStatus(
  id: string,
  status: "dismissed" | "acted",
  db: LedgrDb,
): Promise<{ success: true } | { error: string }> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  const { householdId } = auth;

  const scoped = scopedQuery(householdId, db);
  const [existing] = await db
    .select({ id: savingsSuggestions.id })
    .from(savingsSuggestions)
    .where(scoped.where(savingsSuggestions, eq(savingsSuggestions.id, id)))
    .limit(1);
  if (!existing) return { error: "Suggestion not found" };

  await db
    .update(savingsSuggestions)
    .set({
      status,
      actedAt: status === "acted" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(savingsSuggestions.id, id));

  return { success: true };
}

export async function dismissSavingsSuggestionAction(
  id: string,
  db: LedgrDb = defaultDb,
): Promise<{ success: true } | { error: string }> {
  return setSuggestionStatus(id, "dismissed", db);
}

export async function markSavingsSuggestionActedAction(
  id: string,
  db: LedgrDb = defaultDb,
): Promise<{ success: true } | { error: string }> {
  return setSuggestionStatus(id, "acted", db);
}

export async function getRealizedSavingsAction(
  id: string,
  db: LedgrDb = defaultDb,
): Promise<RealizedSavings[] | { error: string }> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  const { householdId } = auth;

  const record = await getSavingsSuggestionById(householdId, id, db);
  if (!record) return { error: "Suggestion not found" };

  return computeRealizedSavings(householdId, record, db);
}

export async function getDealsSettingsAction(db: LedgrDb = defaultDb): Promise<DealsSettings | { error: string }> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  return getDealsSettings(auth.userId, db);
}

const dealsSettingsSchema = z.object({
  dealsWebSearchEnabled: z.boolean(),
  dealsLocation: z.string().max(120).nullable(),
});

export async function updateDealsSettingsAction(
  input: z.infer<typeof dealsSettingsSchema>,
  db: LedgrDb = defaultDb,
): Promise<{ success: true } | { error: string }> {
  const parsed = dealsSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  const { userId } = auth;

  await upsertUserSetting(
    userId,
    {
      dealsWebSearchEnabled: parsed.data.dealsWebSearchEnabled,
      dealsLocation: parsed.data.dealsLocation?.trim() || null,
    },
    db,
  );

  revalidatePath("/settings");
  return { success: true };
}
