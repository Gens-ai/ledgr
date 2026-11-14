import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { LedgrDb } from "../../src/db";
import { getCurrentMonth, monthBounds } from "../../src/lib/date-utils";
import {
  insertAccount,
  insertCategory,
  insertCategoryGroup,
  insertHousehold,
  insertTransaction,
  insertTransactionSplit,
} from "./helpers";
import { createTestDb } from "./setup";
import type { ReportFilters } from "../../src/queries/reports";

const month = getCurrentMonth();
const { from: dateFrom, to: dateTo } = monthBounds(month);
const day = (n: number) => `${month}-${String(n).padStart(2, "0")}`;
const debit = (cents: number) => ({ amount: cents, normalizedAmount: -cents });
const credit = (cents: number) => ({ amount: -cents, normalizedAmount: cents });

// Business: software 1,000 + meals 2,000 + split 600 = 3,600 spent; 50,000 income.
// Personal: groceries 4,000 + split 400 = 4,400 spent; 30,000 income.
// Uncategorized: 8,000 spent, 9,000 credit.
describe("category-group filter (Reports and Transactions)", () => {
  let db: LedgrDb;
  let close: () => Promise<void>;
  let householdId: string;
  let businessGroup: string;
  let personalGroup: string;
  let foreignGroup: string;
  let softwareId: string;
  let mealsId: string;
  let groceriesId: string;
  let businessIncomeId: string;
  let salaryId: string;

  const range = (extra: Partial<ReportFilters> = {}): ReportFilters => ({ dateFrom, dateTo, ...extra });
  const only = (...groupIds: string[]) => range({ groupIds, groupMode: "include" });
  const except = (...groupIds: string[]) => range({ groupIds, groupMode: "exclude" });

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    ({ householdId } = await insertHousehold(db));
    const { accountId } = await insertAccount(db, householdId);

    ({ groupId: businessGroup } = await insertCategoryGroup(db, householdId, { name: "Business" }));
    ({ groupId: personalGroup } = await insertCategoryGroup(db, householdId, { name: "Personal" }));
    ({ categoryId: softwareId } = await insertCategory(db, householdId, businessGroup, { name: "Software" }));
    ({ categoryId: mealsId } = await insertCategory(db, householdId, businessGroup, { name: "Meals" }));
    ({ categoryId: businessIncomeId } = await insertCategory(db, householdId, businessGroup, {
      name: "Business Income",
      isIncome: true,
    }));
    ({ categoryId: groceriesId } = await insertCategory(db, householdId, personalGroup, { name: "Groceries" }));
    ({ categoryId: salaryId } = await insertCategory(db, householdId, personalGroup, {
      name: "Salary",
      isIncome: true,
    }));

    const other = await insertHousehold(db, "Other");
    ({ groupId: foreignGroup } = await insertCategoryGroup(db, other.householdId, { name: "Theirs" }));
    // Another household's category under its own group, used by none of our rows.
    await insertCategory(db, other.householdId, foreignGroup, { name: "Their cat" });

    await insertTransaction(db, householdId, accountId, { date: day(1), ...debit(1000), categoryId: softwareId });
    await insertTransaction(db, householdId, accountId, { date: day(2), ...debit(2000), categoryId: mealsId });
    await insertTransaction(db, householdId, accountId, {
      date: day(3),
      ...credit(50_000),
      categoryId: businessIncomeId,
    });
    await insertTransaction(db, householdId, accountId, { date: day(4), ...debit(4000), categoryId: groceriesId });
    await insertTransaction(db, householdId, accountId, { date: day(5), ...credit(30_000), categoryId: salaryId });
    await insertTransaction(db, householdId, accountId, { date: day(6), ...debit(8000), name: "Mystery" });
    await insertTransaction(db, householdId, accountId, { date: day(7), ...credit(9000), name: "Mystery credit" });
    // A split charge: 600 to business meals, 400 to groceries.
    const { transactionId: splitId } = await insertTransaction(db, householdId, accountId, {
      date: day(8),
      ...debit(1000),
      categoryId: groceriesId,
      name: "Costco",
    });
    await insertTransactionSplit(db, splitId, mealsId, 600);
    await insertTransactionSplit(db, splitId, groceriesId, 400);
  });

  afterAll(async () => {
    await close();
  });

  describe("Reports", () => {
    test("Spending: 'only these groups' keeps those groups' categories and drops uncategorized", async () => {
      const { getSpendingByCategory } = await import("../../src/queries/reports");
      const rows = await getSpendingByCategory(householdId, only(businessGroup), db);
      expect(Object.fromEntries(rows.map((r) => [r.categoryName, r.total]))).toEqual({
        Software: 1000,
        Meals: 2600,
      });
    });

    test("Spending: 'all except' drops those groups and keeps uncategorized", async () => {
      const { getSpendingByCategory } = await import("../../src/queries/reports");
      const rows = await getSpendingByCategory(householdId, except(businessGroup), db);
      expect(Object.fromEntries(rows.map((r) => [r.categoryName, r.total]))).toEqual({
        Groceries: 4400,
        Uncategorized: 8000,
      });
    });

    test("Income vs Expense tiles honour the group filter", async () => {
      const { getIncomeVsExpense } = await import("../../src/queries/reports");
      const [biz] = await getIncomeVsExpense(householdId, only(businessGroup), db);
      expect(biz).toMatchObject({ income: 50_000, expenses: 3000 });

      const [rest] = await getIncomeVsExpense(householdId, except(businessGroup), db);
      // Groceries 4,000 + the split parent (filed under Groceries) 1,000 + uncategorized 8,000.
      expect(rest).toMatchObject({ income: 30_000 + 9000, expenses: 13_000 });
    });

    test("the Income vs Expense category table and the Sankey honour it", async () => {
      const { getIncomeExpenseByCategory, getCashFlowSankey } = await import("../../src/queries/reports");
      const table = await getIncomeExpenseByCategory(householdId, only(personalGroup), db);
      expect(table.map((r) => r.categoryName).sort()).toEqual(["Groceries", "Salary"]);

      const { nodes } = await getCashFlowSankey(householdId, except(personalGroup), db);
      const names = nodes.map((n) => n.name);
      expect(names).toEqual(expect.arrayContaining(["Business Income", "Software", "Meals", "Uncategorized"]));
      expect(names).not.toContain("Groceries");
      expect(names).not.toContain("Salary");
    });

    test("Trends honour it, splits included", async () => {
      const { getCategoryTrends } = await import("../../src/queries/reports");
      const rows = await getCategoryTrends(householdId, except(personalGroup), db);
      const byName = Object.fromEntries(rows.map((r) => [r.categoryName, r.total]));
      expect(byName.Groceries).toBeUndefined();
      expect(byName.Software).toBe(1000);
      expect(byName.Uncategorized).toBe(8000);
    });

    test("another household's group matches nothing of ours", async () => {
      const { getSpendingByCategory } = await import("../../src/queries/reports");
      expect(await getSpendingByCategory(householdId, only(foreignGroup), db)).toEqual([]);
      const all = await getSpendingByCategory(householdId, range(), db);
      const excepted = await getSpendingByCategory(householdId, except(foreignGroup), db);
      expect(excepted.reduce((t, r) => t + r.total, 0)).toBe(all.reduce((t, r) => t + r.total, 0));
    });
  });

  describe("Transactions", () => {
    test("the list and its summary honour 'only these groups'", async () => {
      const { getTransactions, getTransactionSummary } = await import("../../src/queries/transactions");
      const filters = { groupIds: [businessGroup], groupMode: "include" as const };
      const page = await getTransactions(householdId, filters, 50, null, db);
      expect(page.rows.map((r) => r.categoryName).sort()).toEqual(["Business Income", "Meals", "Software"]);
      const summary = await getTransactionSummary(householdId, filters, db);
      expect(summary).toMatchObject({ count: 3, totalIncome: 50_000, totalExpense: 3000 });
    });

    test("'all except' keeps uncategorized rows", async () => {
      const { getTransactions } = await import("../../src/queries/transactions");
      const page = await getTransactions(
        householdId,
        { groupIds: [businessGroup], groupMode: "exclude" },
        50,
        null,
        db,
      );
      const names = page.rows.map((r) => r.categoryName ?? "(none)");
      expect(names.filter((n) => n === "(none)")).toHaveLength(2);
      expect(names).not.toContain("Software");
    });
  });
});
