import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { LedgrDb } from "../../src/db";
import { categories } from "../../src/db/schema";
import { getCurrentMonth, monthBounds } from "../../src/lib/date-utils";
import {
  insertAccount,
  insertCategory,
  insertCategoryGroup,
  insertHousehold,
  insertTransaction,
} from "./helpers";
import { createTestDb } from "./setup";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ISSUE-011. Fixtures are derived from the current month: the queries compute
// their own windows from `new Date()`, so a hardcoded date would rot.
const month = getCurrentMonth();
const { from: dateFrom, to: dateTo } = monthBounds(month);
const RANGE = { dateFrom, dateTo };
const day = (n: number) => `${month}-${String(n).padStart(2, "0")}`;

/** Plaid convention: a debit has a positive `amount`; normalizedAmount flips it. */
const debit = (cents: number) => ({ amount: cents, normalizedAmount: -cents });
const credit = (cents: number) => ({ amount: -cents, normalizedAmount: cents });

const DRAW = 500_000;
const CLIENT_PAYMENT = 200_000;
const GROCERIES = 10_000;
const INCOME = DRAW + CLIENT_PAYMENT;

describe("owner's draw counts as personal income (transfer credits as income)", () => {
  let db: LedgrDb;
  let close: () => Promise<void>;
  let householdId: string;
  let drawId: string;
  let businessIncomeId: string;
  let groceriesId: string;
  let savingsId: string;
  let systemId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    ({ householdId } = await insertHousehold(db));
    const { accountId: llcId } = await insertAccount(db, householdId, { name: "LLC checking" });
    const { accountId: personalId } = await insertAccount(db, householdId, { name: "Personal checking" });

    const { groupId: businessGroup } = await insertCategoryGroup(db, householdId, { name: "Business" });
    ({ categoryId: drawId } = await insertCategory(db, householdId, businessGroup, {
      name: "Owner's Draw",
      includeTransferCreditsAsIncome: true,
    }));
    ({ categoryId: businessIncomeId } = await insertCategory(db, householdId, businessGroup, {
      name: "Business Income",
      isIncome: true,
    }));
    const { groupId: personalGroup } = await insertCategoryGroup(db, householdId, { name: "Personal" });
    ({ categoryId: groceriesId } = await insertCategory(db, householdId, personalGroup, { name: "Groceries" }));
    ({ categoryId: savingsId } = await insertCategory(db, householdId, personalGroup, { name: "Savings moves" }));
    // A system category with the flag set by hand never qualifies.
    ({ categoryId: systemId } = await insertCategory(db, householdId, personalGroup, {
      name: "System hand-edited",
      isSystem: true,
      includeTransferCreditsAsIncome: true,
    }));

    // The draw: both legs detected as a paired transfer, both filed as Owner's Draw.
    const { transactionId: drawOut } = await insertTransaction(db, householdId, llcId, {
      date: day(2),
      ...debit(DRAW),
      name: "Transfer to personal",
      categoryId: drawId,
      isTransfer: true,
      transferSource: "auto",
    });
    await insertTransaction(db, householdId, personalId, {
      date: day(2),
      ...credit(DRAW),
      name: "Transfer from LLC",
      categoryId: drawId,
      isTransfer: true,
      transferSource: "auto",
      transferPairId: drawOut,
    });
    await insertTransaction(db, householdId, llcId, {
      date: day(3),
      ...credit(CLIENT_PAYMENT),
      name: "Client payment",
      categoryId: businessIncomeId,
    });
    await insertTransaction(db, householdId, personalId, {
      date: day(4),
      ...debit(GROCERIES),
      name: "Groceries",
      categoryId: groceriesId,
    });
    // Not income: a transfer credit in an ordinary category.
    await insertTransaction(db, householdId, personalId, {
      date: day(5),
      ...credit(30_000),
      name: "From savings",
      categoryId: savingsId,
      isTransfer: true,
    });
    // Not income: brokerage activity, even in the flagged category.
    await insertTransaction(db, householdId, personalId, {
      date: day(6),
      ...credit(70_000),
      name: "Brokerage sale",
      categoryId: drawId,
      isTransfer: true,
      transferSource: "investment_account",
    });
    // Not income: the hand-edited system category.
    await insertTransaction(db, householdId, personalId, {
      date: day(7),
      ...credit(40_000),
      name: "System transfer",
      categoryId: systemId,
      isTransfer: true,
    });
  });

  afterAll(async () => {
    await close();
  });

  test("dashboard tiles count the draw credit as income, and its debit as nothing", async () => {
    const { getDashboardSummary } = await import("../../src/queries/dashboard");
    const summary = await getDashboardSummary(householdId, month, db);
    expect(summary.monthlyIncome).toBe(INCOME);
    expect(summary.monthlyExpenses).toBe(GROCERIES);
  });

  test("Cash Flow and the Reports tiles agree with the dashboard", async () => {
    const { getCashFlow } = await import("../../src/queries/dashboard");
    const { getIncomeVsExpense } = await import("../../src/queries/reports");

    const cashFlow = (await getCashFlow(householdId, 1, db)).find((r) => r.month === month);
    expect(cashFlow).toMatchObject({ income: INCOME, expenses: GROCERIES });

    const [tiles] = await getIncomeVsExpense(householdId, RANGE, db);
    expect(tiles).toMatchObject({ income: INCOME, expenses: GROCERIES });
  });

  test("Safe to Spend counts the draw as income", async () => {
    const { getSafeToSpend } = await import("../../src/queries/reports");
    const result = await getSafeToSpend(householdId, db, month);
    expect(result.monthlyIncome).toBe(INCOME);
    expect(result.discretionarySpent).toBe(GROCERIES);
  });

  test("the draw's debit is never spending — not on the Spending tab, the Sankey or the category table", async () => {
    const { getSpendingByCategory, getCashFlowSankey, getIncomeExpenseByCategory } = await import(
      "../../src/queries/reports"
    );
    const spending = await getSpendingByCategory(householdId, RANGE, db);
    expect(spending.find((r) => r.categoryId === drawId)).toBeUndefined();

    const { nodes } = await getCashFlowSankey(householdId, RANGE, db);
    expect(nodes.find((n) => n.id === `expense-${drawId}`)).toBeUndefined();

    const table = await getIncomeExpenseByCategory(householdId, RANGE, db);
    expect(table.find((r) => r.categoryId === drawId && !r.isIncome)).toBeUndefined();
  });

  describe("the category flag", () => {
    test("is settable on a custom non-income category, and clears transfer-as-spending", async () => {
      const { updateCategoryTransferIncomeScoped } = await import("../../src/actions/categories");
      await db.update(categories).set({ includeTransferInSpending: true }).where(eq(categories.id, savingsId));

      expect(await updateCategoryTransferIncomeScoped(householdId, savingsId, true, db)).toEqual({ success: true });
      const [row] = await db.select().from(categories).where(eq(categories.id, savingsId));
      expect(row).toMatchObject({ includeTransferCreditsAsIncome: true, includeTransferInSpending: false });

      expect(await updateCategoryTransferIncomeScoped(householdId, savingsId, false, db)).toEqual({ success: true });
    });

    test("is refused on system and income categories, and another household's", async () => {
      const { updateCategoryTransferIncomeScoped } = await import("../../src/actions/categories");
      expect(await updateCategoryTransferIncomeScoped(householdId, systemId, true, db)).toHaveProperty("error");
      expect(await updateCategoryTransferIncomeScoped(householdId, businessIncomeId, true, db)).toHaveProperty(
        "error",
      );
      const other = await insertHousehold(db, "Other");
      expect(await updateCategoryTransferIncomeScoped(other.householdId, drawId, false, db)).toHaveProperty("error");
      const [row] = await db.select().from(categories).where(eq(categories.id, drawId));
      expect(row.includeTransferCreditsAsIncome).toBe(true);
    });

    test("turning on transfer-as-spending clears it, so a draw's debit can never become spending", async () => {
      const { updateCategoryReportingScoped, updateCategoryTransferIncomeScoped } = await import(
        "../../src/actions/categories"
      );
      await updateCategoryTransferIncomeScoped(householdId, savingsId, true, db);
      await updateCategoryReportingScoped(householdId, savingsId, true, db);
      const [row] = await db.select().from(categories).where(eq(categories.id, savingsId));
      expect(row).toMatchObject({ includeTransferCreditsAsIncome: false, includeTransferInSpending: true });
      await updateCategoryReportingScoped(householdId, savingsId, false, db);
    });

    test("making the category income clears it", async () => {
      const { updateCategoryScoped, updateCategoryTransferIncomeScoped } = await import(
        "../../src/actions/categories"
      );
      await updateCategoryTransferIncomeScoped(householdId, savingsId, true, db);
      await updateCategoryScoped(householdId, savingsId, { isIncome: true }, db);
      const [row] = await db.select().from(categories).where(eq(categories.id, savingsId));
      expect(row.includeTransferCreditsAsIncome).toBe(false);
      await updateCategoryScoped(householdId, savingsId, { isIncome: false }, db);
    });

    test("a hand-edited row with both flags counts neither the debit as spending nor loses the credit", async () => {
      const { getTransferReportingCategoryIds, getTransferIncomeCategoryIds } = await import(
        "../../src/queries/shared-conditions"
      );
      await db
        .update(categories)
        .set({ includeTransferInSpending: true })
        .where(eq(categories.id, drawId));
      expect(await getTransferReportingCategoryIds(householdId, db)).not.toContain(drawId);
      expect(await getTransferIncomeCategoryIds(householdId, db)).toContain(drawId);
      await db
        .update(categories)
        .set({ includeTransferInSpending: false })
        .where(eq(categories.id, drawId));
    });
  });
});
