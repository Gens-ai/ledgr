import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "./setup";
import {
  insertHousehold,
  insertAccount,
  insertCategoryGroup,
  insertCategory,
  insertTransaction,
} from "./helpers";
import { getIncomeCategoryIds, isIncome, notIncome } from "../../src/queries/shared-conditions";
import { transactions } from "../../src/db/schema";
import { and, eq } from "drizzle-orm";
import type { LedgrDb } from "../../src/db";

let db: LedgrDb;
let close: () => Promise<void>;
let householdA: string;
let householdB: string;
let aIncomeCatId: string;
let bIncomeCatId: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());

  ({ householdId: householdA } = await insertHousehold(db, "Household A"));
  ({ householdId: householdB } = await insertHousehold(db, "Household B"));

  const aGroup = await insertCategoryGroup(db, householdA, { name: "Income" });
  ({ categoryId: aIncomeCatId } = await insertCategory(db, householdA, aGroup.groupId, {
    name: "Salary",
    isIncome: true,
  }));

  const bGroup = await insertCategoryGroup(db, householdB, { name: "Income" });
  ({ categoryId: bIncomeCatId } = await insertCategory(db, householdB, bGroup.groupId, {
    name: "Freelance",
    isIncome: true,
  }));
});

afterEach(async () => {
  await close();
});

describe("getIncomeCategoryIds", () => {
  test("returns only the caller household's income category ids", async () => {
    const ids = await getIncomeCategoryIds(householdA, db);
    expect(ids.has(aIncomeCatId)).toBe(true);
    expect(ids.has(bIncomeCatId)).toBe(false);
  });

  test("scopes correctly for the other household too", async () => {
    const ids = await getIncomeCategoryIds(householdB, db);
    expect(ids.has(bIncomeCatId)).toBe(true);
    expect(ids.has(aIncomeCatId)).toBe(false);
  });
});

describe("notIncome", () => {
  test("excludes only the caller household's income category, not another household's", async () => {
    const { accountId } = await insertAccount(db, householdA);
    const { transactionId: incomeTxnId } = await insertTransaction(db, householdA, accountId, {
      categoryId: aIncomeCatId,
      normalizedAmount: 500000,
      amount: -500000,
    });
    const { transactionId: expenseTxnId } = await insertTransaction(db, householdA, accountId, {
      categoryId: null,
      normalizedAmount: -2000,
      amount: 2000,
    });

    const condition = await notIncome(householdA, db);
    const rows = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdA), condition));

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(expenseTxnId);
    expect(ids).not.toContain(incomeTxnId);
  });

  test("excludes an income-category row even when its amount is negative", async () => {
    // e.g. a payroll correction posted as a debit should still be excluded
    // from spending breakdowns (aggregateSpending, getCategoryTrends).
    const { accountId } = await insertAccount(db, householdA);
    const { transactionId: correctionTxnId } = await insertTransaction(db, householdA, accountId, {
      categoryId: aIncomeCatId,
      normalizedAmount: -9999,
      amount: 9999,
    });

    const condition = await notIncome(householdA, db);
    const rows = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdA), condition));

    expect(rows.map((r) => r.id)).not.toContain(correctionTxnId);
  });
});

describe("isIncome", () => {
  test("classifies by transaction sign, ignoring category", async () => {
    const { accountId } = await insertAccount(db, householdA);
    // Properly tagged income, positive amount
    const { transactionId: incomeTxnId } = await insertTransaction(db, householdA, accountId, {
      categoryId: aIncomeCatId,
      normalizedAmount: 500000,
      amount: -500000,
    });
    // Negative amount, no category
    const { transactionId: expenseTxnId } = await insertTransaction(db, householdA, accountId, {
      categoryId: null,
      normalizedAmount: -2000,
      amount: 2000,
    });

    const rows = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdA), isIncome()));

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(incomeTxnId);
    expect(ids).not.toContain(expenseTxnId);
  });

  test("counts a positive-amount transaction as income even when miscategorized", async () => {
    // Reproduces ISSUE-010: a real paycheck deposit that the auto-categorizer
    // filed under a non-income category must still count as income for
    // income-vs-expense totals (getCashFlow, getIncomeVsExpense, getSafeToSpend).
    const { accountId } = await insertAccount(db, householdA);
    const otherGroup = await insertCategoryGroup(db, householdA, { name: "Other" });
    const { categoryId: miscCategoryId } = await insertCategory(db, householdA, otherGroup.groupId, {
      name: "Miscellaneous",
      isIncome: false,
    });
    const { transactionId: miscategorizedPaycheck } = await insertTransaction(db, householdA, accountId, {
      categoryId: miscCategoryId,
      normalizedAmount: 250000,
      amount: -250000,
    });

    const rows = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdA), isIncome()));

    expect(rows.map((r) => r.id)).toContain(miscategorizedPaycheck);
  });
});
