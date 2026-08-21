import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "./setup";
import {
  insertHousehold,
  insertAccount,
  insertTransaction,
  insertCategoryGroup,
  insertCategory,
} from "./helpers";
import { getSafeToSpend } from "../../src/queries/reports";
import type { LedgrDb } from "../../src/db";

let db: LedgrDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

// getSafeToSpend always uses the current month (getCurrentMonth()), so
// fixture dates must be derived relative to now rather than hardcoded.
function currentMonthDate(day: number): string {
  const now = new Date();
  return `${now.toISOString().slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

describe("getSafeToSpend", () => {
  test("counts a positive-amount transaction as income even when miscategorized", async () => {
    // Reproduces ISSUE-010: monthlyIncome used to require an income-category
    // tag, which most real income transactions never get.
    const { householdId } = await insertHousehold(db);
    const { accountId } = await insertAccount(db, householdId);
    const { groupId } = await insertCategoryGroup(db, householdId, { name: "Other" });
    const { categoryId: miscCategoryId } = await insertCategory(db, householdId, groupId, {
      name: "Miscellaneous",
      isIncome: false,
    });

    await insertTransaction(db, householdId, accountId, {
      date: currentMonthDate(1),
      normalizedAmount: 400000,
      amount: -400000,
      categoryId: miscCategoryId,
    });

    const result = await getSafeToSpend(householdId, db);
    expect(result.monthlyIncome).toBe(400000);
  });

  test("counts discretionary spending from actual expenses (negative amounts), not credits", async () => {
    // Reproduces ISSUE-010: discretionarySpent previously filtered
    // normalizedAmount > 0 (credits) instead of < 0 (real spending), which
    // summed stray income credits as if they were expenses.
    const { householdId } = await insertHousehold(db);
    const { accountId } = await insertAccount(db, householdId);

    await insertTransaction(db, householdId, accountId, {
      date: currentMonthDate(10),
      normalizedAmount: -5000,
      amount: 5000,
      pending: false,
    });

    const result = await getSafeToSpend(householdId, db);
    expect(result.discretionarySpent).toBe(5000);
    expect(result.safeToSpend).toBe(0 - 0 - 5000);
  });
});
