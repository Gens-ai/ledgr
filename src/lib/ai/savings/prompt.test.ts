import { describe, it, expect } from "vitest";
import { buildSavingsPrompt } from "./prompt";
import type { SpendingProfile } from "./types";

function makeProfile(overrides: Partial<SpendingProfile> = {}): SpendingProfile {
  return {
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
        totalCents: 22080,
        avgCents: 1840,
        firstDate: "2026-05-25",
        lastDate: "2026-08-19",
        priorWindowTotalCents: 15000,
      },
    ],
    categories: [],
    recurring: [],
    ...overrides,
  };
}

describe("buildSavingsPrompt", () => {
  it("includes the scope label and window", () => {
    const prompt = buildSavingsPrompt(makeProfile());
    expect(prompt).toContain("Five Guys");
    expect(prompt).toContain("last 90 days");
  });

  it("includes merchant evidence with its key, visit count, and dollar totals", () => {
    const prompt = buildSavingsPrompt(makeProfile());
    expect(prompt).toContain("merchant:merch-1");
    expect(prompt).toContain("12 visits");
    expect(prompt).toContain("$220.80");
    expect(prompt).toContain("$18.40");
  });

  it("describes an upward trend when spend increased vs the prior window", () => {
    const prompt = buildSavingsPrompt(makeProfile());
    expect(prompt).toContain("up from $150.00 last period");
  });

  it("includes category evidence with budget context when present", () => {
    const prompt = buildSavingsPrompt(
      makeProfile({
        categories: [
          {
            key: "category:cat-1",
            categoryId: "cat-1",
            name: "Food & Dining",
            groupName: "Food",
            totalCents: 50000,
            shareOfSpend: 0.3,
            budgetLimitCents: 40000,
            budgetSpentCents: 45000,
          },
        ],
      }),
    );
    expect(prompt).toContain("category:cat-1");
    expect(prompt).toContain("over budget by $50.00 this month");
  });

  it("includes recurring evidence", () => {
    const prompt = buildSavingsPrompt(
      makeProfile({
        recurring: [
          {
            key: "recurring:rec-1",
            recurringTransactionId: "rec-1",
            name: "Streaming Co",
            frequency: "monthly",
            averageAmountCents: 1599,
            nextDate: "2026-09-01",
          },
        ],
      }),
    );
    expect(prompt).toContain("recurring:rec-1");
    expect(prompt).toContain("Streaming Co");
  });

  it("notes when there is no evidence at all", () => {
    const prompt = buildSavingsPrompt(makeProfile({ merchants: [], categories: [], recurring: [] }));
    expect(prompt).toContain("No merchant, category, or recurring-charge history");
  });

  it("adds deals-search instructions only when requested", () => {
    const withoutDeals = buildSavingsPrompt(makeProfile());
    const withDeals = buildSavingsPrompt(makeProfile(), { includeDeals: true, location: "Seattle, WA" });
    expect(withoutDeals).not.toContain("Deals search");
    expect(withDeals).toContain("Deals search");
    expect(withDeals).toContain("Seattle, WA");
  });
});
