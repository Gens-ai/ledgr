import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { LedgrDb } from "../../src/db";
import {
  insertAccount,
  insertCategory,
  insertCategoryGroup,
  insertHousehold,
  insertTransaction,
  insertTransactionSplit,
} from "./helpers";
import { createTestDb } from "./setup";

let mockHouseholdId: string;
vi.mock("../../src/lib/auth/session", () => ({
  getHouseholdId: vi.fn(() => Promise.resolve(mockHouseholdId)),
}));

// An explicit calendar year, so absolute dates are the point, not a rot risk.
const YEAR = 2025;
const debit = (cents: number) => ({ amount: cents, normalizedAmount: -cents });
const credit = (cents: number) => ({ amount: -cents, normalizedAmount: cents });

describe("tax-year export", () => {
  let db: LedgrDb;
  let close: () => Promise<void>;
  let householdId: string;
  let businessGroup: string;
  let personalGroup: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    ({ householdId } = await insertHousehold(db));
    mockHouseholdId = householdId;
    const { accountId: llc } = await insertAccount(db, householdId, { name: "LLC checking" });
    const { accountId: personal } = await insertAccount(db, householdId, { name: "Personal" });

    ({ groupId: businessGroup } = await insertCategoryGroup(db, householdId, { name: "Business" }));
    ({ groupId: personalGroup } = await insertCategoryGroup(db, householdId, { name: "Personal" }));
    const { categoryId: income } = await insertCategory(db, householdId, businessGroup, {
      name: "Business Income",
      isIncome: true,
    });
    const { categoryId: software } = await insertCategory(db, householdId, businessGroup, { name: "Software" });
    const { categoryId: meals } = await insertCategory(db, householdId, businessGroup, { name: "Business Meals" });
    const { categoryId: draw } = await insertCategory(db, householdId, businessGroup, {
      name: "Owner's Draw",
      includeTransferCreditsAsIncome: true,
    });
    const { categoryId: groceries } = await insertCategory(db, householdId, personalGroup, { name: "Groceries" });

    await insertTransaction(db, householdId, llc, {
      date: `${YEAR}-03-01`,
      ...credit(500_000),
      categoryId: income,
      name: "Client A",
    });
    await insertTransaction(db, householdId, llc, {
      date: `${YEAR}-04-01`,
      ...debit(2_999),
      categoryId: software,
      name: "=cmd|' /C calc'!A0",
      notes: "Annual, plan \"pro\"",
    });
    await insertTransaction(db, householdId, llc, {
      date: `${YEAR}-04-02`,
      ...debit(1_000),
      categoryId: software,
      name: "GitHub",
    });
    // Owner's draw: credit is personal income; debit is never an expense.
    await insertTransaction(db, householdId, llc, {
      date: `${YEAR}-05-01`,
      ...debit(100_000),
      categoryId: draw,
      name: "Draw out",
      isTransfer: true,
    });
    await insertTransaction(db, householdId, personal, {
      date: `${YEAR}-05-01`,
      ...credit(100_000),
      categoryId: draw,
      name: "Draw in",
      isTransfer: true,
    });
    // A split charge: 600 business meals, 400 groceries.
    const { transactionId: split } = await insertTransaction(db, householdId, personal, {
      date: `${YEAR}-06-01`,
      ...debit(1_000),
      categoryId: groceries,
      name: "Costco",
    });
    await insertTransactionSplit(db, split, meals, 600);
    await insertTransactionSplit(db, split, groceries, 400);
    await insertTransaction(db, householdId, personal, {
      date: `${YEAR}-07-01`,
      ...debit(5_000),
      name: "Unknown charge",
    });
    // Excluded: pending, hidden, an ordinary transfer, another year.
    await insertTransaction(db, householdId, llc, {
      date: `${YEAR}-08-01`,
      ...debit(7_000),
      categoryId: software,
      pending: true,
    });
    await insertTransaction(db, householdId, llc, {
      date: `${YEAR}-08-02`,
      ...debit(7_000),
      categoryId: software,
      isHidden: true,
    });
    await insertTransaction(db, householdId, llc, {
      date: `${YEAR}-08-03`,
      ...debit(7_000),
      categoryId: software,
      isTransfer: true,
    });
    await insertTransaction(db, householdId, llc, {
      date: `${YEAR + 1}-01-01`,
      ...debit(7_000),
      categoryId: software,
    });

    // Another household's rows never appear.
    const other = await insertHousehold(db, "Other");
    const { accountId: theirs } = await insertAccount(db, other.householdId);
    await insertTransaction(db, other.householdId, theirs, { date: `${YEAR}-03-01`, ...debit(123_456) });
  });

  afterAll(async () => {
    await close();
  });

  test("per-category totals follow the Reports totals rules, splits by their own category", async () => {
    const { getTaxYearExport } = await import("../../src/queries/tax-export");
    const { totals } = await getTaxYearExport(householdId, { year: YEAR }, db);
    const byName = Object.fromEntries(totals.map((t) => [t.categoryName, t]));

    expect(byName["Business Income"]).toMatchObject({ groupName: "Business", income: 500_000, expenses: 0, count: 1 });
    expect(byName.Software).toMatchObject({ income: 0, expenses: 3_999, count: 2 });
    expect(byName["Owner's Draw"]).toMatchObject({ income: 100_000, expenses: 0, count: 1 });
    expect(byName["Business Meals"]).toMatchObject({ expenses: 600, count: 1 });
    expect(byName.Groceries).toMatchObject({ groupName: "Personal", expenses: 400, count: 1 });
    expect(byName.Uncategorized).toMatchObject({ groupName: null, expenses: 5_000, count: 1 });
    expect(totals).toHaveLength(6);
  });

  test("the group filter narrows both files; include drops uncategorized, exclude keeps it", async () => {
    const { getTaxYearExport } = await import("../../src/queries/tax-export");
    const only = await getTaxYearExport(householdId, { year: YEAR, groupIds: [businessGroup], groupMode: "include" }, db);
    expect(only.totals.map((t) => t.categoryName).sort()).toEqual([
      "Business Income",
      "Business Meals",
      "Owner's Draw",
      "Software",
    ]);
    expect(only.transactions.every((t) => t.groupName === "Business")).toBe(true);
    expect(only.transactions).toHaveLength(5);

    const except = await getTaxYearExport(
      householdId,
      { year: YEAR, groupIds: [businessGroup], groupMode: "exclude" },
      db,
    );
    expect(except.totals.map((t) => t.categoryName).sort()).toEqual(["Groceries", "Uncategorized"]);
  });

  test("the totals CSV renders dollars, and the transactions CSV neutralises formulas", async () => {
    const { buildTaxYearCsv } = await import("../../src/app/api/export/tax-year/route");
    const totalsCsv = await buildTaxYearCsv(householdId, { year: YEAR, kind: "totals" }, db);
    const totalLines = totalsCsv.split("\n").filter(Boolean);
    expect(totalLines[0]).toBe("Group,Category,Income,Expenses,Transactions");
    expect(totalLines).toContain("Business,Software,0.00,39.99,2");
    expect(totalLines).toContain(",Uncategorized,0.00,50.00,1");
    expect(totalLines.at(-1)).toBe("Total,,6000.00,99.99,7");

    const txnCsv = await buildTaxYearCsv(householdId, { year: YEAR, kind: "transactions" }, db);
    const txnLines = txnCsv.split("\n").filter(Boolean);
    expect(txnLines[0]).toBe("Date,Account,Description,Category,Group,Type,Amount,Notes");
    expect(txnLines).toHaveLength(1 + 7);
    expect(txnCsv).toContain(`2025-04-01,LLC checking,'=cmd|' /C calc'!A0,Software,Business,Expense,-29.99,"Annual, plan ""pro"""`);
    expect(txnCsv).toContain("2025-05-01,Personal,Draw in,Owner's Draw,Business,Income,1000.00,");
    expect(txnCsv).not.toContain("Draw out");
    expect(txnCsv).toContain("Costco (split),Business Meals,Business,Expense,-6.00");
  });

  test("the route refuses a bad year or kind, and downloads a named CSV", async () => {
    const { GET } = await import("../../src/app/api/export/tax-year/route");
    const { NextRequest } = await import("next/server");
    const bad = await GET(new NextRequest(`http://x/api/export/tax-year?year=abc&kind=totals`));
    expect(bad.status).toBe(400);
    const badKind = await GET(new NextRequest(`http://x/api/export/tax-year?year=${YEAR}&kind=everything`));
    expect(badKind.status).toBe(400);
  });
});
