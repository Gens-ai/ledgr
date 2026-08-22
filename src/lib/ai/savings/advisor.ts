import { generateText, Output, isStepCount } from "ai";
import { eq, desc, and } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { db as defaultDb, type LedgrDb } from "@/db";
import { savingsSuggestions } from "@/db/schema";
import { getAiConfig, createAiModel } from "@/lib/ai/config";
import { createUserSearchTool } from "@/lib/ai/provider";
import { getDealsSettings } from "@/queries/savings";
import { buildSpendingProfile } from "./profile";
import { buildSavingsPrompt } from "./prompt";
import { validateSuggestions } from "./validate";
import {
  DEFAULT_WINDOW_DAYS,
  savingsSuggestionsResultSchema,
  type RawSavingsSuggestion,
  type SavingsScope,
  type SavingsSuggestion,
  type SavingsPayload,
  type SpendingProfile,
} from "./types";

const SAVINGS_INSTRUCTIONS =
  "You are a household financial savings advisor. You only recommend savings grounded in the " +
  "evidence provided to you — never invent numbers, merchants, or categories that aren't listed. " +
  "Be specific, concrete, and conservative.";

const RATE_LIMIT_MS = 60_000;

export interface GetSavingsSuggestionsOptions {
  windowDays?: number;
  includeDeals?: boolean;
}

export interface GetSavingsSuggestionsResult {
  suggestionId: string;
  scopeLabel: string;
  windowDays: number;
  suggestions: SavingsSuggestion[];
  dealsIncluded: boolean;
}

/** Same cooldown pattern as checkSyncRateLimit — keyed on the exact scope so
 * a household can still ask about a different merchant/category immediately
 * while one scope is on cooldown. */
async function checkSavingsRateLimit(
  householdId: string,
  scope: SavingsScope,
  db: LedgrDb,
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const conditions = [eq(savingsSuggestions.householdId, householdId), eq(savingsSuggestions.scopeType, scope.type)];
  if (scope.id) conditions.push(eq(savingsSuggestions.scopeId, scope.id));

  const [last] = await db
    .select({ createdAt: savingsSuggestions.createdAt })
    .from(savingsSuggestions)
    .where(and(...conditions))
    .orderBy(desc(savingsSuggestions.createdAt))
    .limit(1);

  if (!last) return { allowed: true };
  const elapsed = Date.now() - new Date(last.createdAt).getTime();
  if (elapsed >= RATE_LIMIT_MS) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.ceil((RATE_LIMIT_MS - elapsed) / 1000) };
}

function hasEvidence(profile: SpendingProfile): boolean {
  return profile.merchants.length > 0 || profile.categories.length > 0 || profile.recurring.length > 0;
}

export async function persistSuggestions(
  householdId: string,
  profile: SpendingProfile,
  suggestions: SavingsSuggestion[],
  model: string,
  dealsIncluded: boolean,
  db: LedgrDb = defaultDb,
): Promise<string> {
  const id = uuid();
  const payload: SavingsPayload = { suggestions, profileSnapshot: profile };
  await db.insert(savingsSuggestions).values({
    id,
    householdId,
    scopeType: profile.scope.type,
    scopeId: profile.scope.id ?? null,
    scopeLabel: profile.scopeLabel,
    windowDays: profile.windowDays,
    payload: JSON.stringify(payload),
    model,
    dealsIncluded,
    status: "new",
  });
  return id;
}

/**
 * The Savings Advisor's single entry point, called identically from the
 * server action, the MCP tool, and the AI chat tool (see
 * docs/superpowers/specs/2026-08-21-savings-advisor-design.md). The app
 * computes every fact (buildSpendingProfile); the model only proposes
 * actions against those facts, and validateSuggestions() strips anything it
 * can't ground in the evidence it was actually given.
 */
export async function getSavingsSuggestions(
  householdId: string,
  userId: string,
  scope: SavingsScope,
  options: GetSavingsSuggestionsOptions = {},
  db: LedgrDb = defaultDb,
): Promise<GetSavingsSuggestionsResult | { error: string }> {
  const config = getAiConfig();
  const model = createAiModel();
  if (!config || !model) {
    return { error: "AI not configured. Set AI_PROVIDER and AI_MODEL in your .env file." };
  }

  const rateLimit = await checkSavingsRateLimit(householdId, scope, db);
  if (!rateLimit.allowed) {
    return { error: `Please wait ${rateLimit.retryAfterSeconds}s before checking this again.` };
  }

  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const profile = await buildSpendingProfile(householdId, scope, db, windowDays);
  if ("error" in profile) return profile;

  let raw: RawSavingsSuggestion[] = [];
  if (hasEvidence(profile)) {
    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: savingsSuggestionsResultSchema }),
        system: SAVINGS_INSTRUCTIONS,
        prompt: buildSavingsPrompt(profile),
      });
      raw = output?.suggestions ?? [];
    } catch (e) {
      console.error("Savings advisor suggestion generation failed:", e);
      return { error: "The AI provider failed to generate suggestions. Check your AI configuration and try again." };
    }
  }

  let dealsIncluded = false;
  if (options.includeDeals) {
    const dealsSettings = await getDealsSettings(userId, db);
    const searchTool = dealsSettings.enabled ? createUserSearchTool(config) : null;
    if (searchTool) {
      try {
        const { output } = await generateText({
          model,
          tools: { web_search: searchTool },
          stopWhen: isStepCount(4),
          output: Output.object({ schema: savingsSuggestionsResultSchema }),
          system: SAVINGS_INSTRUCTIONS,
          prompt: buildSavingsPrompt(profile, { includeDeals: true, location: dealsSettings.location }),
        });
        raw = [...raw, ...(output?.suggestions ?? [])];
        dealsIncluded = true;
      } catch (e) {
        console.error("Savings advisor deals search failed:", e);
      }
    }
  }

  const validated = validateSuggestions(raw, profile).slice(0, 8);
  const suggestionId = await persistSuggestions(householdId, profile, validated, config.aiModel, dealsIncluded, db);

  return {
    suggestionId,
    scopeLabel: profile.scopeLabel,
    windowDays: profile.windowDays,
    suggestions: validated,
    dealsIncluded,
  };
}
