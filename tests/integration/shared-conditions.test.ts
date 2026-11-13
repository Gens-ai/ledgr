import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "./setup";
import {
  insertHousehold,
  insertAccount,
  insertCategoryGroup,
  insertCategory,
  insertTransaction,
} from "./helpers";
import { getIncomeCategoryIds, incomeTotalsRule, notIncome } from "../../src/queries/shared-conditions";
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

describe("incomeTotalsRule", () => {
  async function ids(clause: "isIncome" | "isExpense") {
    const rule = await incomeTotalsRule(householdA, db);
    const rows = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdA), rule[clause]));
    return rows.map((r) => r.id);
  }

  test("classifies by transaction sign, ignoring category", async () => {
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

    expect(await ids("isIncome")).toEqual([incomeTxnId]);
    expect(await ids("isExpense")).toEqual([expenseTxnId]);
  });

  test("a debit in an income category is neither income nor an expense", async () => {
    // e.g. a payroll correction: excluded from expenses, matching Spending.
    const { accountId } = await insertAccount(db, householdA);
    const { transactionId: correctionId } = await insertTransaction(db, householdA, accountId, {
      categoryId: aIncomeCatId,
      normalizedAmount: -9999,
      amount: 9999,
    });

    expect(await ids("isIncome")).not.toContain(correctionId);
    expect(await ids("isExpense")).not.toContain(correctionId);
  });

  test("counts a credit in a non-income category as income (ISSUE-010)", async () => {
    // A paycheck the auto-categorizer filed elsewhere must count; a refund in a
    // spending category counts too, which is the accepted trade-off.
    const { accountId } = await insertAccount(db, householdA);
    const otherGroup = await insertCategoryGroup(db, householdA, { name: "Other" });
    const { categoryId: miscCategoryId } = await insertCategory(db, householdA, otherGroup.groupId, {
      name: "Miscellaneous",
      isIncome: false,
    });
    const { transactionId: miscategorizedCredit } = await insertTransaction(db, householdA, accountId, {
      categoryId: miscCategoryId,
      normalizedAmount: 250000,
      amount: -250000,
    });

    expect(await ids("isIncome")).toContain(miscategorizedCredit);
  });
});
