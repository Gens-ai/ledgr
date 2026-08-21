import { z } from "zod";
import { SAVINGS_SCOPE_TYPES, type SavingsScopeType } from "@/db/schema";

export { SAVINGS_SCOPE_TYPES };
export type { SavingsScopeType };

/** What the advisor is being asked to look at. `id` is required for every
 * type except "overall" — see resolveScope() in profile.ts. */
export interface SavingsScope {
  type: SavingsScopeType;
  id?: string;
}

export const DEFAULT_WINDOW_DAYS = 90;

export const SAVINGS_SUGGESTION_KINDS = [
  "substitution",
  "reduction",
  "cancellation",
  "switch_provider",
  "timing",
  "deal",
] as const;
export type SavingsSuggestionKind = (typeof SAVINGS_SUGGESTION_KINDS)[number];

export const SAVINGS_EFFORT_LEVELS = ["low", "medium", "high"] as const;
export type SavingsEffort = (typeof SAVINGS_EFFORT_LEVELS)[number];

/** One merchant's activity within the profile window — the primary evidence
 * unit for substitution/reduction suggestions ("you visit here N times/mo"). */
export interface MerchantEvidence {
  key: string;
  merchantId: string;
  name: string;
  categoryName: string | null;
  visitCount: number;
  totalCents: number;
  avgCents: number;
  firstDate: string;
  lastDate: string;
  priorWindowTotalCents: number;
}

/** A category's totals within the window — used for category-scope profiles
 * and to give the model budget context ("you're $40 over budget here"). */
export interface CategoryEvidence {
  key: string;
  categoryId: string | null;
  name: string;
  groupName: string | null;
  totalCents: number;
  shareOfSpend: number;
  budgetLimitCents: number | null;
  budgetSpentCents: number | null;
}

/** An active recurring stream relevant to the scope — subscription/bill
 * cancellation and downgrade material. */
export interface RecurringEvidence {
  key: string;
  recurringTransactionId: string;
  name: string;
  frequency: string | null;
  averageAmountCents: number;
  nextDate: string | null;
}

export interface SpendingProfile {
  scope: SavingsScope;
  scopeLabel: string;
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  /** Total actual (non-transfer, non-income) spend evidence in this profile is
   * drawn from — the ceiling any suggestion's savings estimate is checked
   * against. Not necessarily the household's total spend for "merchant"/
   * "category" scope, which is scoped to that merchant/category only. */
  totalSpendCents: number;
  currency: string;
  merchants: MerchantEvidence[];
  categories: CategoryEvidence[];
  recurring: RecurringEvidence[];
}

export const savingsSuggestionSchema = z.object({
  title: z.string().min(1).max(80),
  detail: z.string().min(1).max(400),
  kind: z.enum(SAVINGS_SUGGESTION_KINDS),
  estMonthlySavingsCents: z.number().int().min(0),
  effort: z.enum(SAVINGS_EFFORT_LEVELS),
  timeCostMinutes: z.number().int().min(0).max(1440).nullable(),
  evidenceKeys: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type RawSavingsSuggestion = z.infer<typeof savingsSuggestionSchema>;

export const savingsSuggestionsResultSchema = z.object({
  suggestions: z.array(savingsSuggestionSchema).max(8),
});

/** A suggestion that survived validate.ts — grounded in real evidence keys
 * and a savings estimate that can't exceed what the scope actually spends. */
export type SavingsSuggestion = RawSavingsSuggestion;

/** The JSON stored in savings_suggestions.payload — the validated
 * suggestions plus the exact profile they were grounded in, so a later
 * "realized savings" comparison (see realized.ts) has the original numbers
 * to compare against. */
export interface SavingsPayload {
  suggestions: SavingsSuggestion[];
  profileSnapshot: SpendingProfile;
}
