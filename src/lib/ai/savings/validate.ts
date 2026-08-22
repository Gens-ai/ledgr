import { monthlyEquivalentCents, recurringMonthlyCents } from "./window";
import type { RawSavingsSuggestion, SavingsSuggestion, SpendingProfile } from "./types";

/** Monthly-equivalent ceiling for each evidence key the model could have
 * cited — a merchant/category's window total converted to a monthly rate,
 * or a recurring charge's own monthly cost. Anything not in this map is not
 * real evidence and gets stripped from a suggestion's evidenceKeys. */
/** Exported for realized.ts, which reuses the same monthly-equivalent
 * ceilings to compute the "expected spend without the suggestion" baseline. */
export function evidenceCeilings(profile: SpendingProfile): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of profile.merchants) {
    map.set(m.key, monthlyEquivalentCents(m.totalCents, profile.windowDays));
  }
  for (const c of profile.categories) {
    map.set(c.key, monthlyEquivalentCents(c.totalCents, profile.windowDays));
  }
  for (const r of profile.recurring) {
    map.set(r.key, recurringMonthlyCents(r.frequency, r.averageAmountCents));
  }
  return map;
}

/** Grounds the model's raw suggestions in the same profile it was given:
 * drops any suggestion whose evidenceKeys don't reference real evidence (a
 * hallucination signal), and clamps estMonthlySavingsCents so a suggestion
 * can never claim to save more than what its cited evidence actually costs
 * per month. Mirrors validateAssignments() in lib/ai/categorize.ts. */
export function validateSuggestions(
  raw: RawSavingsSuggestion[],
  profile: SpendingProfile,
): SavingsSuggestion[] {
  const ceilings = evidenceCeilings(profile);
  const result: SavingsSuggestion[] = [];

  for (const suggestion of raw) {
    const validKeys = suggestion.evidenceKeys.filter((k) => ceilings.has(k));
    if (validKeys.length === 0) continue;

    const ceiling = validKeys.reduce((sum, k) => sum + (ceilings.get(k) ?? 0), 0);
    if (ceiling <= 0) continue;

    result.push({
      ...suggestion,
      evidenceKeys: validKeys,
      estMonthlySavingsCents: Math.min(suggestion.estMonthlySavingsCents, ceiling),
    });
  }

  return result;
}
