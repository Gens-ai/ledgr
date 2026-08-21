import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { v4 as uuid } from "uuid";
import { createTestDb } from "./setup";
import {
  insertHousehold,
  insertAccount,
  insertTransaction,
  insertMerchant,
  insertCategoryGroup,
  insertCategory,
  insertCategoryRule,
} from "./helpers";
import { categorizeSyncedTransactions } from "../../src/lib/categorization/engine";
import { transactions, plaidItems } from "../../src/db/schema";
import { eq } from "drizzle-orm";
import type { LedgrDb } from "../../src/db";

describe("categorizeSyncedTransactions", () => {
  let db: LedgrDb;
  let close: () => Promise<void>;
  let householdId: string;
  let accountId: string;
  let plaidItemId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());

    ({ householdId } = await insertHousehold(db));
    plaidItemId = uuid();
    await db.insert(plaidItems).values({
      id: plaidItemId,
      householdId,
      accessToken: "encrypted-token",
      status: "active",
    });
    ({ accountId } = await insertAccount(db, householdId, { plaidItemId }));
  });

  afterAll(async () => {
    await close();
  });

  it("applies matching rule to uncategorized transactions", async () => {
    const { groupId } = await insertCategoryGroup(db, householdId, { name: "Food" });
    const { categoryId } = await insertCategory(db, householdId, groupId, { name: "Groceries" });
    await insertCategoryRule(db, householdId, categoryId, { matchField: "name", matchPattern: "whole foods" });

    const { transactionId } = await insertTransaction(db, householdId, accountId, { name: "Whole Foods Market" });

    await categorizeSyncedTransactions(plaidItemId, householdId, db);

    const [row] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
    expect(row!.categoryId).toBe(categoryId);
  });

  it("respects rule priority — higher wins", async () => {
    const { groupId } = await insertCategoryGroup(db, householdId, { name: "Drinks" });
    const { categoryId: catLow } = await insertCategory(db, householdId, groupId, { name: "Dining" });
    const { categoryId: catHigh } = await insertCategory(db, householdId, groupId, { name: "Coffee" });
    await insertCategoryRule(db, householdId, catLow, { matchPattern: "starbucks", priority: 0 });
    await insertCategoryRule(db, householdId, catHigh, { matchPattern: "starbucks", priority: 10 });

    const { transactionId } = await insertTransaction(db, householdId, accountId, { name: "Starbucks #42" });

    await categorizeSyncedTransactions(plaidItemId, householdId, db);

    const [row] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
    expect(row!.categoryId).toBe(catHigh);
  });

  it("falls back to merchant default category", async () => {
    const { groupId } = await insertCategoryGroup(db, householdId, { name: "Subs" });
    const { categoryId } = await insertCategory(db, householdId, groupId, { name: "Subscriptions" });
    const { merchantId } = await insertMerchant(db, householdId, { name: "Netflix", categoryId });

    const { transactionId } = await insertTransaction(db, householdId, accountId, {
      name: "NETFLIX.COM",
      merchantId,
    });

    await categorizeSyncedTransactions(plaidItemId, householdId, db);

    const [row] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
    expect(row!.categoryId).toBe(categoryId);
  });

  it("never overwrites an existing manual category assignment", async () => {
    const { groupId } = await insertCategoryGroup(db, householdId, { name: "Manual" });
    const { categoryId: manualCat } = await insertCategory(db, householdId, groupId, { name: "Manual Cat" });
    const { categoryId: ruleCat } = await insertCategory(db, householdId, groupId, { name: "Rule Cat" });
    await insertCategoryRule(db, householdId, ruleCat, { matchPattern: "manual-test" });

    const { transactionId } = await insertTransaction(db, householdId, accountId, {
      name: "manual-test store",
      categoryId: manualCat,
    });

    await categorizeSyncedTransactions(plaidItemId, householdId, db);

    const [row] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
    expect(row!.categoryId).toBe(manualCat);
  });

  it("falls back to a PFC-mapped category via its seed key", async () => {
    const { groupId } = await insertCategoryGroup(db, householdId, { name: "Food & Dining" });
    const { categoryId } = await insertCategory(db, householdId, groupId, {
      name: "Groceries",
      pfcSeedKey: "Groceries",
    });

    const { transactionId } = await insertTransaction(db, householdId, accountId, {
      name: "Trader Joe's",
      pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
    });

    await categorizeSyncedTransactions(plaidItemId, householdId, db);

    const [row] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
    expect(row!.categoryId).toBe(categoryId);
    expect(row!.categorySource).toBe("pfc");
  });

  it("PFC mapping keys off the seed key, not the current display name, so renaming a category doesn't break it", async () => {
    const { groupId } = await insertCategoryGroup(db, householdId, { name: "Renamed Group" });
    // Seeded as "Groceries" (pfcSeedKey set at seed time), then renamed — pfcSeedKey never changes.
    const { categoryId: renamedCat } = await insertCategory(db, householdId, groupId, {
      name: "Household Food",
      pfcSeedKey: "Groceries",
    });
    // A decoy category that happens to be named "Groceries" today but was never seeded as such
    // (no pfcSeedKey) — the old name-based join would have matched this one instead.
    const { categoryId: decoyCat } = await insertCategory(db, householdId, groupId, {
      name: "Groceries",
    });

    const { transactionId } = await insertTransaction(db, householdId, accountId, {
      name: "Safeway",
      pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
    });

    await categorizeSyncedTransactions(plaidItemId, householdId, db);

    const [row] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
    expect(row!.categoryId).toBe(renamedCat);
    expect(row!.categoryId).not.toBe(decoyCat);
  });

  it("categorization failure does not throw", async () => {
    await expect(
      categorizeSyncedTransactions("nonexistent-item", householdId, db),
    ).resolves.not.toThrow();
  });
});
