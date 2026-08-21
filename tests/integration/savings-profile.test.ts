import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { LedgrDb } from "../../src/db";
import { createTestDb } from "./setup";
import {
  insertHousehold,
  insertAccount,
  insertTransaction,
  insertMerchant,
  insertCategoryGroup,
  insertCategory,
  insertBudget,
  insertBudgetCategory,
  insertRecurringTransaction,
} from "./helpers";
import { buildSpendingProfile, resolveScope } from "../../src/lib/ai/savings/profile";
import { getCurrentMonth } from "../../src/lib/date-utils";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

describe("buildSpendingProfile", () => {
  let db: LedgrDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  async function baseFixtures() {
    const { householdId } = await insertHousehold(db);
    const { accountId } = await insertAccount(db, householdId);
    const { groupId } = await insertCategoryGroup(db, householdId);
    const { categoryId } = await insertCategory(db, householdId, groupId, { name: "Food & Dining" });
    const { merchantId } = await insertMerchant(db, householdId, { name: "Five Guys", categoryId });
    return { householdId, accountId, groupId, categoryId, merchantId };
  }

  it("aggregates a merchant's visits, total, and average within the window", async () => {
    const { householdId, accountId, categoryId, merchantId } = await baseFixtures();

    for (const days of [5, 20, 40]) {
      await insertTransaction(db, householdId, accountId, {
        date: daysAgo(days),
        merchantId,
        categoryId,
        amount: 1840,
        normalizedAmount: -1840,
      });
    }

    const profile = await buildSpendingProfile(householdId, { type: "merchant", id: merchantId }, db, 90);
    if ("error" in profile) throw new Error(profile.error);

    expect(profile.scopeLabel).toBe("Five Guys");
    expect(profile.merchants).toHaveLength(1);
    expect(profile.merchants[0].visitCount).toBe(3);
    expect(profile.merchants[0].totalCents).toBe(5520);
    expect(profile.merchants[0].avgCents).toBe(1840);
    expect(profile.totalSpendCents).toBe(5520);
  });

  it("excludes transfers, pending transactions, and income from a merchant's evidence", async () => {
    const { householdId, accountId, categoryId, merchantId } = await baseFixtures();

    await insertTransaction(db, householdId, accountId, {
      date: daysAgo(5),
      merchantId,
      categoryId,
      amount: 1840,
      normalizedAmount: -1840,
    });
    await insertTransaction(db, householdId, accountId, {
      date: daysAgo(6),
      merchantId,
      categoryId,
      amount: 5000,
      normalizedAmount: -5000,
      isTransfer: true,
    });
    await insertTransaction(db, householdId, accountId, {
      date: daysAgo(7),
      merchantId,
      categoryId,
      amount: 5000,
      normalizedAmount: -5000,
      pending: true,
    });
    await insertTransaction(db, householdId, accountId, {
      date: daysAgo(8),
      merchantId,
      categoryId,
      amount: -20000,
      normalizedAmount: 20000, // income-signed
    });

    const profile = await buildSpendingProfile(householdId, { type: "merchant", id: merchantId }, db, 90);
    if ("error" in profile) throw new Error(profile.error);

    expect(profile.merchants[0].visitCount).toBe(1);
    expect(profile.merchants[0].totalCents).toBe(1840);
  });

  it("does not leak another household's transactions into the profile", async () => {
    const { householdId, accountId, categoryId, merchantId } = await baseFixtures();
    const other = await insertHousehold(db, "Other Household");
    const otherAccount = await insertAccount(db, other.householdId);

    await insertTransaction(db, householdId, accountId, {
      date: daysAgo(5),
      merchantId,
      categoryId,
      amount: 1000,
      normalizedAmount: -1000,
    });
    await insertTransaction(db, other.householdId, otherAccount.accountId, {
      date: daysAgo(5),
      amount: 999999,
      normalizedAmount: -999999,
    });

    const profile = await buildSpendingProfile(householdId, { type: "merchant", id: merchantId }, db, 90);
    if ("error" in profile) throw new Error(profile.error);
    expect(profile.merchants[0].totalCents).toBe(1000);
  });

  it("groups category-scope merchants by how transactions were actually categorized, not each merchant's default category", async () => {
    const { householdId, accountId, groupId, categoryId, merchantId } = await baseFixtures();
    // A second merchant whose *default* category differs from Food & Dining,
    // but whose transaction here was manually recategorized into it.
    const { categoryId: otherCategoryId } = await insertCategory(db, householdId, groupId, { name: "Shopping" });
    const { merchantId: otherMerchantId } = await insertMerchant(db, householdId, {
      name: "General Store",
      categoryId: otherCategoryId,
    });

    await insertTransaction(db, householdId, accountId, {
      date: daysAgo(5),
      merchantId,
      categoryId,
      amount: 1000,
      normalizedAmount: -1000,
    });
    // Categorized into Food & Dining even though the merchant's own default is Shopping.
    await insertTransaction(db, householdId, accountId, {
      date: daysAgo(6),
      merchantId: otherMerchantId,
      categoryId,
      amount: 2000,
      normalizedAmount: -2000,
    });

    const profile = await buildSpendingProfile(householdId, { type: "category", id: categoryId }, db, 90);
    if ("error" in profile) throw new Error(profile.error);

    const names = profile.merchants.map((m) => m.name).sort();
    expect(names).toEqual(["Five Guys", "General Store"]);
    expect(profile.categories[0].totalCents).toBe(3000);
  });

  it("resolves a transaction scope to its merchant when it has one", async () => {
    const { householdId, accountId, categoryId, merchantId } = await baseFixtures();
    const { transactionId } = await insertTransaction(db, householdId, accountId, {
      date: daysAgo(5),
      merchantId,
      categoryId,
      amount: 1840,
      normalizedAmount: -1840,
    });

    const resolved = await resolveScope(householdId, { type: "transaction", id: transactionId }, db);
    expect(resolved).toMatchObject({ type: "merchant", merchantId, label: "Five Guys" });
  });

  it("falls back to a single-transaction profile when a transaction has no merchant or category", async () => {
    const { householdId } = await insertHousehold(db);
    const { accountId } = await insertAccount(db, householdId);
    const { transactionId } = await insertTransaction(db, householdId, accountId, {
      date: daysAgo(5),
      name: "Uncategorized Cash Withdrawal",
      amount: 4000,
      normalizedAmount: -4000,
    });

    const profile = await buildSpendingProfile(householdId, { type: "transaction", id: transactionId }, db, 90);
    if ("error" in profile) throw new Error(profile.error);

    expect(profile.scope).toEqual({ type: "transaction", id: transactionId });
    expect(profile.scopeLabel).toBe("Uncategorized Cash Withdrawal");
    expect(profile.totalSpendCents).toBe(4000);
    expect(profile.merchants).toEqual([]);
  });

  it("computes the prior window's total for trend context", async () => {
    const { householdId, accountId, categoryId, merchantId } = await baseFixtures();
    await insertTransaction(db, householdId, accountId, {
      date: daysAgo(10), // inside current 90-day window
      merchantId,
      categoryId,
      amount: 1000,
      normalizedAmount: -1000,
    });
    await insertTransaction(db, householdId, accountId, {
      date: daysAgo(100), // inside the prior 90-day window, not the current one
      merchantId,
      categoryId,
      amount: 500,
      normalizedAmount: -500,
    });

    const profile = await buildSpendingProfile(householdId, { type: "merchant", id: merchantId }, db, 90);
    if ("error" in profile) throw new Error(profile.error);

    expect(profile.merchants[0].totalCents).toBe(1000);
    expect(profile.merchants[0].priorWindowTotalCents).toBe(500);
  });

  it("surfaces the current month's budget limit and spend for category scope", async () => {
    const { householdId, accountId, categoryId } = await baseFixtures();
    const { budgetId } = await insertBudget(db, householdId, { month: getCurrentMonth() });
    await insertBudgetCategory(db, budgetId, categoryId, { limitAmount: 10000 });

    await insertTransaction(db, householdId, accountId, {
      date: getCurrentMonth() + "-01",
      categoryId,
      amount: 12000,
      normalizedAmount: -12000,
    });

    const profile = await buildSpendingProfile(householdId, { type: "category", id: categoryId }, db, 90);
    if ("error" in profile) throw new Error(profile.error);

    expect(profile.categories[0].budgetLimitCents).toBe(10000);
    expect(profile.categories[0].budgetSpentCents).toBe(12000);
  });

  it("includes active recurring charges tied to the scope", async () => {
    const { householdId, categoryId, merchantId } = await baseFixtures();
    await insertRecurringTransaction(db, householdId, {
      name: "Streaming Co",
      merchantId,
      categoryId,
      frequency: "monthly",
      averageAmount: -1599,
      isActive: true,
    });
    await insertRecurringTransaction(db, householdId, {
      name: "Cancelled Thing",
      merchantId,
      categoryId,
      frequency: "monthly",
      averageAmount: -999,
      isActive: false,
    });

    const profile = await buildSpendingProfile(householdId, { type: "merchant", id: merchantId }, db, 90);
    if ("error" in profile) throw new Error(profile.error);

    expect(profile.recurring).toHaveLength(1);
    expect(profile.recurring[0].name).toBe("Streaming Co");
    expect(profile.recurring[0].averageAmountCents).toBe(1599);
  });

  it("ranks overall-scope merchants and categories by total spend, descending", async () => {
    const { householdId, accountId, categoryId, merchantId } = await baseFixtures();
    const { groupId } = await insertCategoryGroup(db, householdId, { name: "Transport" });
    const { categoryId: gasCategoryId } = await insertCategory(db, householdId, groupId, { name: "Gas" });
    const { merchantId: gasMerchantId } = await insertMerchant(db, householdId, { name: "Gas Station", categoryId: gasCategoryId });

    await insertTransaction(db, householdId, accountId, {
      date: daysAgo(5),
      merchantId,
      categoryId,
      amount: 1000,
      normalizedAmount: -1000,
    });
    await insertTransaction(db, householdId, accountId, {
      date: daysAgo(5),
      merchantId: gasMerchantId,
      categoryId: gasCategoryId,
      amount: 5000,
      normalizedAmount: -5000,
    });

    const profile = await buildSpendingProfile(householdId, { type: "overall" }, db, 90);
    if ("error" in profile) throw new Error(profile.error);

    expect(profile.merchants[0].name).toBe("Gas Station");
    expect(profile.merchants[1].name).toBe("Five Guys");
    expect(profile.totalSpendCents).toBe(6000);
  });

  it("returns an error for a scope id that doesn't exist", async () => {
    const { householdId } = await insertHousehold(db);
    const profile = await buildSpendingProfile(householdId, { type: "merchant", id: "does-not-exist" }, db, 90);
    expect(profile).toHaveProperty("error");
  });
});
