import { describe, it, expect } from "vitest";
import { test, fc } from "@fast-check/vitest";
import { validateSuggestions } from "./validate";
import { monthlyEquivalentCents } from "./window";
import type { RawSavingsSuggestion, SpendingProfile } from "./types";

const profile: SpendingProfile = {
  scope: { type: "merchant", id: "merch-1" },
  scopeLabel: "Five Guys",
  windowDays: 90,
  windowStart: "2026-05-23",
  windowEnd: "2026-08-21",
  totalSpendCents: 22080,
  currency: "USD",
  merchants: [
    {
      key: "merchant:merch-1",
      merchantId: "merch-1",
      name: "Five Guys",
      categoryName: "Food & Dining",
      visitCount: 12,
      totalCents: 22080, // ~7360/mo at 90 days
      avgCents: 1840,
      firstDate: "2026-05-25",
      lastDate: "2026-08-19",
      priorWindowTotalCents: 15000,
    },
  ],
  categories: [
    {
      key: "category:cat-1",
      categoryId: "cat-1",
      name: "Food & Dining",
      groupName: "Food",
      totalCents: 90000, // 30000/mo
      shareOfSpend: 0.4,
      budgetLimitCents: null,
      budgetSpentCents: null,
    },
  ],
  recurring: [
    {
      key: "recurring:rec-1",
      recurringTransactionId: "rec-1",
      name: "Streaming Co",
      frequency: "monthly",
      averageAmountCents: 1500, // 1500/mo exactly
      nextDate: "2026-09-01",
    },
  ],
};

function makeRaw(overrides: Partial<RawSavingsSuggestion> = {}): RawSavingsSuggestion {
  return {
    title: "Cook at home twice a month",
    detail: "You visit Five Guys 12 times over 90 days — cooking 2 of those saves roughly the avg ticket each.",
    kind: "substitution",
    estMonthlySavingsCents: 1000,
    effort: "medium",
    timeCostMinutes: 35,
    evidenceKeys: ["merchant:merch-1"],
    confidence: 0.7,
    ...overrides,
  };
}

describe("validateSuggestions", () => {
  it("keeps a suggestion grounded in real evidence", () => {
    const result = validateSuggestions([makeRaw()], profile);
    expect(result).toHaveLength(1);
    expect(result[0].evidenceKeys).toEqual(["merchant:merch-1"]);
  });

  it("drops a suggestion whose evidence keys are entirely hallucinated", () => {
    const result = validateSuggestions([makeRaw({ evidenceKeys: ["merchant:does-not-exist"] })], profile);
    expect(result).toHaveLength(0);
  });

  it("drops a suggestion with no evidence keys at all", () => {
    const result = validateSuggestions([makeRaw({ evidenceKeys: [] })], profile);
    expect(result).toHaveLength(0);
  });

  it("strips unknown keys but keeps the suggestion if at least one is real", () => {
    const result = validateSuggestions(
      [makeRaw({ evidenceKeys: ["merchant:merch-1", "merchant:fake"] })],
      profile,
    );
    expect(result).toHaveLength(1);
    expect(result[0].evidenceKeys).toEqual(["merchant:merch-1"]);
  });

  it("clamps estMonthlySavingsCents to the evidence's monthly-equivalent ceiling", () => {
    const ceiling = monthlyEquivalentCents(22080, 90); // merchant's own monthly rate
    const result = validateSuggestions(
      [makeRaw({ estMonthlySavingsCents: ceiling * 100 /* absurdly inflated */ })],
      profile,
    );
    expect(result[0].estMonthlySavingsCents).toBe(ceiling);
  });

  it("does not lower an estimate that was already under the ceiling", () => {
    const result = validateSuggestions([makeRaw({ estMonthlySavingsCents: 100 })], profile);
    expect(result[0].estMonthlySavingsCents).toBe(100);
  });

  it("sums ceilings across multiple valid evidence keys", () => {
    const merchantCeiling = monthlyEquivalentCents(22080, 90);
    const categoryCeiling = monthlyEquivalentCents(90000, 90);
    const result = validateSuggestions(
      [makeRaw({ evidenceKeys: ["merchant:merch-1", "category:cat-1"], estMonthlySavingsCents: 999_999 })],
      profile,
    );
    expect(result[0].estMonthlySavingsCents).toBe(merchantCeiling + categoryCeiling);
  });

  it("uses the recurring charge's own monthly amount as its ceiling, not a windowed conversion", () => {
    const result = validateSuggestions(
      [makeRaw({ evidenceKeys: ["recurring:rec-1"], estMonthlySavingsCents: 999_999 })],
      profile,
    );
    expect(result[0].estMonthlySavingsCents).toBe(1500);
  });

  it("passes through multiple suggestions independently", () => {
    const result = validateSuggestions(
      [makeRaw({ title: "A" }), makeRaw({ title: "B", evidenceKeys: ["category:cat-1"] })],
      profile,
    );
    expect(result.map((r) => r.title)).toEqual(["A", "B"]);
  });

  test.prop([
    fc.array(
      fc.record({
        title: fc.string({ minLength: 1, maxLength: 20 }),
        detail: fc.string({ minLength: 1, maxLength: 40 }),
        kind: fc.constantFrom("substitution", "reduction", "cancellation", "switch_provider", "timing", "deal"),
        estMonthlySavingsCents: fc.integer({ min: 0, max: 100_000_000 }),
        effort: fc.constantFrom("low", "medium", "high"),
        timeCostMinutes: fc.option(fc.integer({ min: 0, max: 500 }), { nil: null }),
        evidenceKeys: fc.array(
          fc.constantFrom("merchant:merch-1", "category:cat-1", "recurring:rec-1", "merchant:hallucinated"),
          { minLength: 0, maxLength: 4 },
        ),
        confidence: fc.float({ min: 0, max: 1, noNaN: true }),
      }),
      { maxLength: 6 },
    ),
  ])("never returns a suggestion whose savings exceed what its (valid) evidence actually costs monthly", (raw) => {
    const result = validateSuggestions(raw as RawSavingsSuggestion[], profile);
    const ceilingByKey: Record<string, number> = {
      "merchant:merch-1": monthlyEquivalentCents(22080, 90),
      "category:cat-1": monthlyEquivalentCents(90000, 90),
      "recurring:rec-1": 1500,
    };
    for (const suggestion of result) {
      // Every surviving key must be real evidence — no hallucinated key leaks through.
      for (const key of suggestion.evidenceKeys) {
        expect(ceilingByKey).toHaveProperty(key);
      }
      const ceiling = suggestion.evidenceKeys.reduce((sum, k) => sum + ceilingByKey[k], 0);
      expect(suggestion.estMonthlySavingsCents).toBeLessThanOrEqual(ceiling);
      expect(suggestion.estMonthlySavingsCents).toBeGreaterThanOrEqual(0);
    }
  });
});
