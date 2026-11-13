import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { createTestDb } from "./setup";
import { createRestrictedRole } from "./restricted-role";
import {
  insertAccount,
  insertBudget,
  insertBudgetCategory,
  insertCategory,
  insertCategoryGroup,
  insertCategoryRule,
  insertHousehold,
  insertMerchant,
  insertRecurringTransaction,
  insertTransaction,
  insertTransactionSplit,
} from "./helpers";
import {
  deleteCategoryScoped,
  getCategoryUsageScoped,
  renameCategoryScoped,
  updateCategoryGroupIconScoped,
  updateCategoryScoped,
} from "../../src/actions/categories";
import { seedDefaultCategories } from "../../src/db/seed/categories";
import { categorizeSyncedTransactions } from "../../src/lib/categorization/engine";
import {
  bankConnections,
  budgetCategories,
  categories,
  categoryGroups,
  categoryRules,
  merchants,
  recurringTransactions,
  transactionSplits,
  transactions,
} from "../../src/db/schema";
import type { LedgrDb } from "../../src/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Fork features ported onto upstream's category manager: icon editing, moving
// between groups, flipping isIncome, renaming system categories, and
// delete-with-reassign. Ported from the fork's pre-merge suite (69b9172).
describe("category editing (fork)", () => {
  let db: LedgrDb;
  let close: () => Promise<void>;
  let householdId: string;
  let otherHouseholdId: string;
  let accountId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    ({ householdId } = await insertHousehold(db, "Primary"));
    ({ householdId: otherHouseholdId } = await insertHousehold(db, "Other"));
    ({ accountId } = await insertAccount(db, householdId));
  });

  afterAll(async () => {
    await close();
  });

  describe("updateCategoryScoped", () => {
    it("moves a category to another group, appending it, and toggles isIncome and icon", async () => {
      const { groupId: groupA } = await insertCategoryGroup(db, householdId, { name: "Move A" });
      const { groupId: groupB } = await insertCategoryGroup(db, householdId, { name: "Move B" });
      await insertCategory(db, householdId, groupB, { name: "Already There", sortOrder: 4 });
      const { categoryId } = await insertCategory(db, householdId, groupA, { name: "Mover" });

      expect(
        await updateCategoryScoped(householdId, categoryId, { groupId: groupB, isIncome: true, icon: "gift" }, db),
      ).toEqual({ success: true });

      const [row] = await db.select().from(categories).where(eq(categories.id, categoryId));
      expect(row).toMatchObject({ groupId: groupB, isIncome: true, icon: "gift", sortOrder: 5 });
    });

    it("clears the transfer-as-spending flag when a category becomes income", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Flag Group" });
      const { categoryId } = await insertCategory(db, householdId, groupId, {
        name: "Was Spending",
        includeTransferInSpending: true,
      });

      await updateCategoryScoped(householdId, categoryId, { isIncome: true }, db);

      const [row] = await db.select().from(categories).where(eq(categories.id, categoryId));
      expect(row.isIncome).toBe(true);
      expect(row.includeTransferInSpending).toBe(false);
    });

    it("edits system categories too", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Sys Edit", isSystem: true });
      const { groupId: target } = await insertCategoryGroup(db, householdId, { name: "Sys Target" });
      const { categoryId } = await insertCategory(db, householdId, groupId, {
        name: "Sys Edit Cat",
        isSystem: true,
        pfcSeedKey: "Sys Edit Cat",
      });

      expect(await updateCategoryScoped(householdId, categoryId, { groupId: target, isIncome: true }, db)).toEqual({
        success: true,
      });
      const [row] = await db.select().from(categories).where(eq(categories.id, categoryId));
      expect(row).toMatchObject({ groupId: target, isIncome: true, isSystem: true, pfcSeedKey: "Sys Edit Cat" });
    });

    it("refuses another household's group or category, and an invalid icon", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Guard" });
      const { categoryId } = await insertCategory(db, householdId, groupId, { name: "Guarded" });
      const { groupId: otherGroupId } = await insertCategoryGroup(db, otherHouseholdId);
      const { categoryId: otherCategoryId } = await insertCategory(db, otherHouseholdId, otherGroupId);

      expect(await updateCategoryScoped(householdId, categoryId, { groupId: otherGroupId }, db)).toEqual({
        error: "Category group not found.",
      });
      expect(await updateCategoryScoped(householdId, otherCategoryId, { isIncome: true }, db)).toEqual({
        error: "Category not found.",
      });
      expect(await updateCategoryScoped(householdId, categoryId, { icon: "<script>" }, db)).toEqual({
        error: "Invalid input.",
      });
    });
  });

  it("sets a group's icon, but not another household's", async () => {
    const { groupId } = await insertCategoryGroup(db, householdId, { name: "Icon Group", isSystem: true });
    const { groupId: otherGroupId } = await insertCategoryGroup(db, otherHouseholdId);

    expect(await updateCategoryGroupIconScoped(householdId, groupId, "home", db)).toEqual({ success: true });
    expect(await updateCategoryGroupIconScoped(householdId, otherGroupId, "home", db)).toHaveProperty("error");

    const [row] = await db.select().from(categoryGroups).where(eq(categoryGroups.id, groupId));
    expect(row.icon).toBe("home");
  });

  it("counts usage across every referencing table", async () => {
    const { groupId } = await insertCategoryGroup(db, householdId, { name: "Usage" });
    const { categoryId } = await insertCategory(db, householdId, groupId, { name: "Counted" });
    const { transactionId } = await insertTransaction(db, householdId, accountId, { categoryId });
    await insertTransactionSplit(db, transactionId, categoryId, 500);
    await insertRecurringTransaction(db, householdId, { categoryId });
    await insertMerchant(db, householdId, { categoryId });
    await insertCategoryRule(db, householdId, categoryId, { matchPattern: "usage" });
    const { budgetId } = await insertBudget(db, householdId, { month: "2026-09" });
    await insertBudgetCategory(db, budgetId, categoryId);

    const result = await getCategoryUsageScoped(householdId, categoryId, db);
    expect(result).toEqual({
      success: true,
      usage: {
        transactions: 1,
        transactionSplits: 1,
        recurringTransactions: 1,
        merchants: 1,
        categoryRules: 1,
        budgetCategories: 1,
      },
    });
  });

  describe("deleteCategoryScoped with a replacement", () => {
    it("moves every reference to the replacement, then deletes", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Reassign" });
      const { categoryId: oldCat } = await insertCategory(db, householdId, groupId, { name: "Old" });
      const { categoryId: newCat } = await insertCategory(db, householdId, groupId, { name: "New" });

      const { transactionId } = await insertTransaction(db, householdId, accountId, { categoryId: oldCat });
      await insertTransactionSplit(db, transactionId, oldCat, 500);
      const { recurringId } = await insertRecurringTransaction(db, householdId, { categoryId: oldCat });
      const { merchantId } = await insertMerchant(db, householdId, { categoryId: oldCat });
      await insertCategoryRule(db, householdId, oldCat, { matchPattern: "coffee" });

      expect(await deleteCategoryScoped(householdId, oldCat, db, newCat)).toEqual({ success: true });

      const [txn] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
      expect(txn.categoryId).toBe(newCat);
      const splits = await db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, transactionId));
      expect(splits.map((s) => s.categoryId)).toEqual([newCat]);
      const [recurring] = await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, recurringId));
      expect(recurring.categoryId).toBe(newCat);
      const [merchant] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
      expect(merchant.categoryId).toBe(newCat);
      const rules = await db.select().from(categoryRules).where(eq(categoryRules.categoryId, newCat));
      expect(rules.some((r) => r.matchPattern === "coffee")).toBe(true);
      expect(await db.select().from(categories).where(eq(categories.id, oldCat))).toHaveLength(0);
    });

    it("merges budget lines that would collide in the same budget", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Budget Merge" });
      const { categoryId: oldCat } = await insertCategory(db, householdId, groupId, { name: "Old Budgeted" });
      const { categoryId: newCat } = await insertCategory(db, householdId, groupId, { name: "New Budgeted" });
      const { budgetId } = await insertBudget(db, householdId, { month: "2026-08" });
      await insertBudgetCategory(db, budgetId, oldCat, { limitAmount: 3000 });
      await insertBudgetCategory(db, budgetId, newCat, { limitAmount: 7000 });

      expect(await deleteCategoryScoped(householdId, oldCat, db, newCat)).toEqual({ success: true });

      const rows = await db
        .select()
        .from(budgetCategories)
        .where(and(eq(budgetCategories.budgetId, budgetId), eq(budgetCategories.categoryId, newCat)));
      expect(rows).toHaveLength(1);
      expect(rows[0].limitAmount).toBe(10000);
    });

    it("deletes a system category once its references are moved", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Sys Delete", isSystem: true });
      const { categoryId: sysCat } = await insertCategory(db, householdId, groupId, {
        name: "Sys Doomed",
        isSystem: true,
        pfcSeedKey: "Sys Doomed",
      });
      const { categoryId: newCat } = await insertCategory(db, householdId, groupId, { name: "Sys Heir" });
      const { transactionId } = await insertTransaction(db, householdId, accountId, { categoryId: sysCat });

      expect(await deleteCategoryScoped(householdId, sysCat, db)).toEqual({
        error: "This category is in use and cannot be deleted.",
      });
      expect(await deleteCategoryScoped(householdId, sysCat, db, newCat)).toEqual({ success: true });
      const [txn] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
      expect(txn.categoryId).toBe(newCat);
    });

    it("refuses another household's category on either side, and itself as the replacement", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "Delete Guard" });
      const { categoryId } = await insertCategory(db, householdId, groupId, { name: "Delete Guarded" });
      const { groupId: otherGroupId } = await insertCategoryGroup(db, otherHouseholdId);
      const { categoryId: otherCategoryId } = await insertCategory(db, otherHouseholdId, otherGroupId);

      expect(await deleteCategoryScoped(householdId, otherCategoryId, db)).toEqual({ error: "Category not found." });
      expect(await deleteCategoryScoped(householdId, categoryId, db, otherCategoryId)).toEqual({
        error: "Replacement category not found.",
      });
      expect(await deleteCategoryScoped(householdId, categoryId, db, categoryId)).toHaveProperty("error");
      expect(await db.select().from(categories).where(eq(categories.id, categoryId))).toHaveLength(1);
    });
  });

  // docker-compose runs the app as the restricted `ledgr_app` role, so these
  // repeat the critical paths under a role row-level security applies to.
  describe("as the restricted app role (RLS on)", () => {
    let role: Awaited<ReturnType<typeof createRestrictedRole>>;

    beforeAll(async () => {
      role = await createRestrictedRole(db);
    });

    afterAll(async () => {
      await role.drop();
    });

    it("the harness enforces RLS: a bare read of transactions sees nothing", async () => {
      await insertTransaction(db, householdId, accountId);
      expect(await role.asRole((tx) => tx.select().from(transactions))).toHaveLength(0);
    });

    it("reassigns on delete: transactions, merchant defaults and rules move to the target", async () => {
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "RLS Reassign" });
      const { categoryId: oldCat } = await insertCategory(db, householdId, groupId, { name: "RLS Old" });
      const { categoryId: newCat } = await insertCategory(db, householdId, groupId, { name: "RLS New" });
      const { transactionId } = await insertTransaction(db, householdId, accountId, { categoryId: oldCat });
      await insertTransactionSplit(db, transactionId, oldCat, 500);
      const { merchantId } = await insertMerchant(db, householdId, { categoryId: oldCat });
      const { ruleId } = await insertCategoryRule(db, householdId, oldCat, { matchPattern: "rls" });

      const usage = await role.asRole((tx) => getCategoryUsageScoped(householdId, oldCat, tx));
      expect(usage).toMatchObject({ success: true, usage: { transactions: 1, transactionSplits: 1 } });

      expect(await role.asRole((tx) => deleteCategoryScoped(householdId, oldCat, tx, newCat))).toEqual({
        success: true,
      });

      const [txn] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
      expect(txn.categoryId).toBe(newCat);
      const splits = await db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, transactionId));
      expect(splits.map((s) => s.categoryId)).toEqual([newCat]);
      const [merchant] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
      expect(merchant.categoryId).toBe(newCat);
      const [rule] = await db.select().from(categoryRules).where(eq(categoryRules.id, ruleId));
      expect(rule.categoryId).toBe(newCat);
    });

    it("still refuses an in-use delete with no target, rather than uncategorizing its transactions", async () => {
      // Without withHousehold the role would count zero transactions, pass the
      // check, and ON DELETE SET NULL would uncategorize them.
      const { groupId } = await insertCategoryGroup(db, householdId, { name: "RLS Refuse" });
      const { categoryId } = await insertCategory(db, householdId, groupId, { name: "RLS In Use" });
      const { transactionId } = await insertTransaction(db, householdId, accountId, { categoryId });

      expect(await role.asRole((tx) => deleteCategoryScoped(householdId, categoryId, tx))).toEqual({
        error: "This category is in use and cannot be deleted.",
      });
      const [txn] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
      expect(txn.categoryId).toBe(categoryId);
    });

    it("a renamed system category still receives PFC-mapped transactions", async () => {
      const { householdId: seeded } = await insertHousehold(db, "Seeded");
      await seedDefaultCategories(db, seeded);
      const connectionId = uuid();
      await db.insert(bankConnections).values({
        id: connectionId,
        householdId: seeded,
        provider: "plaid",
        credential: "encrypted-token",
        status: "active",
      });
      const { accountId: seededAccount } = await insertAccount(db, seeded, { bankConnectionId: connectionId });

      const [groceries] = await db
        .select()
        .from(categories)
        .where(and(eq(categories.householdId, seeded), eq(categories.pfcSeedKey, "Groceries")));
      expect(groceries.isSystem).toBe(true);

      expect(await role.asRole((tx) => renameCategoryScoped(seeded, groceries.id, "Food at Home", tx))).toEqual({
        success: true,
      });
      // A custom category now holds the old name: the name-based lookup this
      // replaced would have sent the transaction here instead.
      const { groupId } = await insertCategoryGroup(db, seeded, { name: "Decoys" });
      const { categoryId: decoy } = await insertCategory(db, seeded, groupId, { name: "Groceries" });

      const { transactionId } = await insertTransaction(db, seeded, seededAccount, {
        name: "Safeway",
        pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
      });

      await role.asRole((tx) => categorizeSyncedTransactions(connectionId, seeded, tx));

      const [row] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
      expect(row.categoryId).toBe(groceries.id);
      expect(row.categoryId).not.toBe(decoy);
      expect(row.categorySource).toBe("pfc");
    });
  });
});
