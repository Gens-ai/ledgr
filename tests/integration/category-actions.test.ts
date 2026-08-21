import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { createTestDb } from "./setup";
import {
  insertHousehold,
  insertAccount,
  insertCategoryGroup,
  insertCategory,
  insertCategoryRule,
  insertTransaction,
  insertTransactionSplit,
  insertRecurringTransaction,
  insertMerchant,
  insertBudget,
  insertBudgetCategory,
} from "./helpers";
import {
  createCategoryGroup,
  updateCategoryGroup,
  deleteCategoryGroup,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../../src/actions/categories";
import { getCategoryUsage } from "../../src/queries/categories";
import {
  categoryGroups,
  categories,
  transactions,
  transactionSplits,
  recurringTransactions,
  merchants,
  categoryRules,
  budgetCategories,
} from "../../src/db/schema";
import type { LedgrDb } from "../../src/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../src/lib/demo-mode", () => ({ guardDemoMode: vi.fn(() => null) }));

const mockUserId = "test-user-id";
let mockHouseholdId: string;
vi.mock("../../src/lib/auth/session", () => ({
  getHouseholdId: vi.fn(() => Promise.resolve(mockHouseholdId)),
  getSession: vi.fn(() => Promise.resolve({ user: { id: mockUserId } })),
}));

describe("category actions", () => {
  let db: LedgrDb;
  let close: () => Promise<void>;
  let householdId: string;
  let accountId: string;
  let otherHouseholdId: string;
  let otherGroupId: string;
  let otherCategoryId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());

    const hh = await insertHousehold(db);
    householdId = hh.householdId;
    mockHouseholdId = householdId;
    ({ accountId } = await insertAccount(db, householdId));

    const hh2 = await insertHousehold(db, "Other Household");
    otherHouseholdId = hh2.householdId;
    ({ groupId: otherGroupId } = await insertCategoryGroup(db, otherHouseholdId, { name: "Other Group" }));
    ({ categoryId: otherCategoryId } = await insertCategory(db, otherHouseholdId, otherGroupId, { name: "Other Cat" }));
  });

  afterAll(async () => {
    await close();
  });

  describe("createCategoryGroup", () => {
    it("creates a group appended after the current max sortOrder", async () => {
      const { groupId: g1 } = await insertCategoryGroup(db, householdId, { name: "Existing", sortOrder: 5 });

      const result = await createCategoryGroup({ name: "New Group", icon: "tag" }, db);
      expect(result).toHaveProperty("success", true);
      const groupId = (result as { success: true; groupId: string }).groupId;

      const [row] = await db.select().from(categoryGroups).where(eq(categoryGroups.id, groupId));
      expect(row.name).toBe("New Group");
      expect(row.icon).toBe("tag");
      expect(row.sortOrder).toBeGreaterThan(5);

      await db.delete(categoryGroups).where(eq(categoryGroups.id, g1));
    });

    it("rejects an empty name", async () => {
      const result = await createCategoryGroup({ name: "", icon: null }, db);
      expect(result).toHaveProperty("error");
    });
  });

  describe("updateCategoryGroup", () => {
    it("renames a group it owns", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Old Name" });

      const result = await updateCategoryGroup(groupId, { name: "New Name" }, db);
      expect(result).toEqual({ success: true });

      const [row] = await db.select().from(categoryGroups).where(eq(categoryGroups.id, groupId));
      expect(row.name).toBe("New Name");
    });

    it("refuses to update a group owned by another household", async () => {
      const result = await updateCategoryGroup(otherGroupId, { name: "Hijacked" }, db);
      expect(result).toHaveProperty("error");

      const [row] = await db.select().from(categoryGroups).where(eq(categoryGroups.id, otherGroupId));
      expect(row.name).toBe("Other Group");
    });
  });

  describe("deleteCategoryGroup", () => {
    it("refuses to delete a group that still has categories", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Has Categories" });
      await insertCategory(db, householdId, groupId, { name: "A Category" });

      const result = await deleteCategoryGroup(groupId, db);
      expect(result).toHaveProperty("error");

      const [row] = await db.select().from(categoryGroups).where(eq(categoryGroups.id, groupId));
      expect(row).toBeDefined();
    });

    it("deletes a group once it has no categories left", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Empty Group" });

      const result = await deleteCategoryGroup(groupId, db);
      expect(result).toEqual({ success: true });

      const rows = await db.select().from(categoryGroups).where(eq(categoryGroups.id, groupId));
      expect(rows).toHaveLength(0);
    });
  });

  describe("createCategory", () => {
    it("creates a category appended after the current max sortOrder in its group", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Group For New Cats" });
      await insertCategory(db, householdId, groupId, { name: "First", sortOrder: 3 });

      const result = await createCategory(
        { groupId, name: "Second", icon: "car", isIncome: false },
        db,
      );
      expect(result).toHaveProperty("success", true);
      const categoryId = (result as { success: true; categoryId: string }).categoryId;

      const [row] = await db.select().from(categories).where(eq(categories.id, categoryId));
      expect(row.name).toBe("Second");
      expect(row.icon).toBe("car");
      expect(row.sortOrder).toBeGreaterThan(3);
    });

    it("refuses to create a category in a group owned by another household", async () => {
      const result = await createCategory(
        { groupId: otherGroupId, name: "Sneaky", isIncome: false },
        db,
      );
      expect(result).toHaveProperty("error");
    });
  });

  describe("updateCategory", () => {
    it("renames, moves group, and toggles isIncome", async () => {
      const { groupId: groupA } = await insertCategoryGroup(db, householdId, { name: "Group A" });
      const { groupId: groupB } = await insertCategoryGroup(db, householdId, { name: "Group B" });
      const { categoryId } = await insertCategory(db, householdId, groupA, { name: "Original" });

      const result = await updateCategory(
        categoryId,
        { name: "Renamed", groupId: groupB, isIncome: true },
        db,
      );
      expect(result).toEqual({ success: true });

      const [row] = await db.select().from(categories).where(eq(categories.id, categoryId));
      expect(row.name).toBe("Renamed");
      expect(row.groupId).toBe(groupB);
      expect(row.isIncome).toBe(true);
    });

    it("refuses to move a category into another household's group", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Group C" });
      const { categoryId } = await insertCategory(db, householdId, groupId, { name: "Mine" });

      const result = await updateCategory(categoryId, { groupId: otherGroupId }, db);
      expect(result).toHaveProperty("error");
    });
  });

  describe("deleteCategory", () => {
    it("deletes a category with zero dependents", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Unused Group" });
      const { categoryId } = await insertCategory(db, householdId, groupId, { name: "Unused" });

      const result = await deleteCategory(categoryId, undefined, db);
      expect(result).toEqual({ success: true });

      const rows = await db.select().from(categories).where(eq(categories.id, categoryId));
      expect(rows).toHaveLength(0);
    });

    it("refuses to delete an in-use category without a replacement", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "In Use Group" });
      const { categoryId } = await insertCategory(db, householdId, groupId, { name: "In Use" });
      const { transactionId } = await insertTransaction(db, householdId, accountId, { categoryId });

      const result = await deleteCategory(categoryId, undefined, db);
      expect(result).toHaveProperty("error");

      const [txn] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
      expect(txn.categoryId).toBe(categoryId);
    });

    it("reassigns all dependents to the replacement category, then deletes", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Reassign Group" });
      const { categoryId: oldCat } = await insertCategory(db, householdId, groupId, { name: "Old" });
      const { categoryId: newCat } = await insertCategory(db, householdId, groupId, { name: "New" });

      const { transactionId } = await insertTransaction(db, householdId, accountId, { categoryId: oldCat });
      await insertTransactionSplit(db, transactionId, oldCat, 500);
      const { recurringId } = await insertRecurringTransaction(db, householdId, { categoryId: oldCat });
      const { merchantId } = await insertMerchant(db, householdId, { categoryId: oldCat });
      await insertCategoryRule(db, householdId, oldCat, { matchPattern: "coffee" });

      const result = await deleteCategory(oldCat, newCat, db);
      expect(result).toEqual({ success: true });

      const [txn] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
      expect(txn.categoryId).toBe(newCat);

      const splits = await db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, transactionId));
      expect(splits.every((s) => s.categoryId === newCat)).toBe(true);

      const [recurring] = await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, recurringId));
      expect(recurring.categoryId).toBe(newCat);

      const [merchant] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
      expect(merchant.categoryId).toBe(newCat);

      const rules = await db.select().from(categoryRules).where(eq(categoryRules.categoryId, newCat));
      expect(rules.some((r) => r.matchPattern === "coffee")).toBe(true);

      const rows = await db.select().from(categories).where(eq(categories.id, oldCat));
      expect(rows).toHaveLength(0);
    });

    it("merges budget category limits instead of violating the unique (budgetId, categoryId) constraint", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Budget Merge Group" });
      const { categoryId: oldCat } = await insertCategory(db, householdId, groupId, { name: "Old Budgeted" });
      const { categoryId: newCat } = await insertCategory(db, householdId, groupId, { name: "New Budgeted" });
      const { budgetId } = await insertBudget(db, householdId, { month: "2026-08" });

      await insertBudgetCategory(db, budgetId, oldCat, { limitAmount: 3000 });
      await insertBudgetCategory(db, budgetId, newCat, { limitAmount: 7000 });

      const result = await deleteCategory(oldCat, newCat, db);
      expect(result).toEqual({ success: true });

      const rows = await db
        .select()
        .from(budgetCategories)
        .where(and(eq(budgetCategories.budgetId, budgetId), eq(budgetCategories.categoryId, newCat)));
      expect(rows).toHaveLength(1);
      expect(rows[0].limitAmount).toBe(10000);

      const oldRows = await db
        .select()
        .from(budgetCategories)
        .where(and(eq(budgetCategories.budgetId, budgetId), eq(budgetCategories.categoryId, oldCat)));
      expect(oldRows).toHaveLength(0);
    });

    it("refuses to delete or use as replacement a category owned by another household", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Guard Group" });
      const { categoryId } = await insertCategory(db, householdId, groupId, { name: "Guarded" });

      const deleteOther = await deleteCategory(otherCategoryId, undefined, db);
      expect(deleteOther).toHaveProperty("error");

      const replaceWithOther = await deleteCategory(categoryId, otherCategoryId, db);
      expect(replaceWithOther).toHaveProperty("error");
    });
  });

  describe("getCategoryUsage", () => {
    it("counts dependents across every referencing table", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Usage Group" });
      const { categoryId } = await insertCategory(db, householdId, groupId, { name: "Counted" });

      const { transactionId } = await insertTransaction(db, householdId, accountId, { categoryId });
      await insertTransactionSplit(db, transactionId, categoryId, 500);
      await insertRecurringTransaction(db, householdId, { categoryId });
      await insertMerchant(db, householdId, { categoryId });
      await insertCategoryRule(db, householdId, categoryId, { matchPattern: "test" });
      const { budgetId } = await insertBudget(db, householdId, { month: "2026-09" });
      await insertBudgetCategory(db, budgetId, categoryId);

      const usage = await getCategoryUsage(categoryId, householdId, db);
      expect(usage.transactions).toBe(1);
      expect(usage.transactionSplits).toBe(1);
      expect(usage.recurringTransactions).toBe(1);
      expect(usage.merchants).toBe(1);
      expect(usage.categoryRules).toBe(1);
      expect(usage.budgetCategories).toBe(1);
    });

    it("returns all zeros for an unused category", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Unused Usage Group" });
      const { categoryId } = await insertCategory(db, householdId, groupId, { name: "Unused" });

      const usage = await getCategoryUsage(categoryId, householdId, db);
      expect(Object.values(usage).every((n) => n === 0)).toBe(true);
    });
  });
});
