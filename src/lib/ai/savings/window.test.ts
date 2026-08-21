import { describe, it, expect } from "vitest";
import { test, fc } from "@fast-check/vitest";
import { monthlyEquivalentCents, recurringMonthlyCents } from "./window";

describe("monthlyEquivalentCents", () => {
  it("scales a 90-day total to a 30-day rate", () => {
    expect(monthlyEquivalentCents(9000, 90)).toBe(3000);
  });

  it("returns 0 for a non-positive window", () => {
    expect(monthlyEquivalentCents(9000, 0)).toBe(0);
    expect(monthlyEquivalentCents(9000, -5)).toBe(0);
  });

  test.prop([fc.integer({ min: 0, max: 1_000_000_00 }), fc.integer({ min: 1, max: 365 })])(
    "never produces a negative result for non-negative input",
    (totalCents, windowDays) => {
      expect(monthlyEquivalentCents(totalCents, windowDays)).toBeGreaterThanOrEqual(0);
    },
  );

  test.prop([fc.integer({ min: 1, max: 365 })])("a full window of zero spend is zero", (windowDays) => {
    expect(monthlyEquivalentCents(0, windowDays)).toBe(0);
  });
});

describe("recurringMonthlyCents", () => {
  it("passes monthly amounts through unchanged", () => {
    expect(recurringMonthlyCents("monthly", 1500)).toBe(1500);
  });

  it("converts weekly to ~4.3x", () => {
    expect(recurringMonthlyCents("weekly", 1000)).toBe(Math.round(1000 * (30 / 7)));
  });

  it("converts yearly to 1/12", () => {
    expect(recurringMonthlyCents("yearly", 12000)).toBe(1000);
  });

  it("treats an unknown or null frequency as a single monthly occurrence", () => {
    expect(recurringMonthlyCents(null, 500)).toBe(500);
    expect(recurringMonthlyCents("quarterly" as never, 500)).toBe(500);
  });
});
