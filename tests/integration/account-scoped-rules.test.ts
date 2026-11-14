import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { createTestDb } from "./setup";
import {
  insertHousehold,
  insertAccount,
  insertTransaction,
  insertCategoryGroup,
  insertCategory,
  insertCategoryRule,
} from "./helpers";
import { categorizeSyncedTransactions } from "../../src/lib/categorization/engine";
import { createCategoryRule, updateCategoryRule } from "../../src/actions/category-rules";
import { getCategoryRules } from "../../src/queries/category-rules";
import { transactions, bankConnections, categoryRules, accounts } from "../../src/db/schema";
import type { LedgrDb } from "../../src/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../src/lib/demo-mode", () => ({ guardDemoMode: vi.fn(() => null) }));

let mockHouseholdId: string;
vi.mock("../../src/lib/auth/session", () => ({
  getHouseholdId: vi.fn(() => Promise.resolve(mockHouseholdId)),
  getSession: vi.fn(() => Promise.resolve({ user: { id: "test-user-id" } })),
}));

describe("account-scoped category rules", () => {
  let db: LedgrDb;
  let close: () => Promise<void>;
  let householdId: string;
  let connectionId: string;
  let llcAccountId: string;
  let personalAccountId: string;
  let foreignAccountId: string;
  let businessId: string;
  let coffeeId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    ({ householdId } = await insertHousehold(db));
    mockHouseholdId = householdId;
    connectionId = uuid();
    await db.insert(bankConnections).values({
      id: connectionId,
      householdId,
      provider: "plaid",
      credential: "encrypted-token",
      status: "active",
    });
    ({ accountId: llcAccountId } = await insertAccount(db, householdId, {
      name: "LLC card",
      bankConnectionId: connectionId,
    }));
    ({ accountId: personalAccountId } = await insertAccount(db, householdId, {
      name: "Personal checking",
      bankConnectionId: connectionId,
    }));
    const other = await insertHousehold(db, "Other");
    ({ accountId: foreignAccountId } = await insertAccount(db, other.householdId, { name: "Theirs" }));

    const { groupId } = await insertCategoryGroup(db, householdId, { name: "Business" });
    ({ categoryId: businessId } = await insertCategory(db, householdId, groupId, { name: "Office Expense" }));
    ({ categoryId: coffeeId } = await insertCategory(db, householdId, groupId, { name: "Coffee" }));
  });

  afterAll(async () => {
    await close();
  });

  it("sync applies an account catch-all only to that account, ahead of general rules", async () => {
    await insertCategoryRule(db, householdId, coffeeId, { matchPattern: "starbucks", priority: 999 });
    await insertCategoryRule(db, householdId, businessId, { matchPattern: "", accountId: llcAccountId });

    const onCard = await insertTransaction(db, householdId, llcAccountId, { name: "Starbucks" });
    const personal = await insertTransaction(db, householdId, personalAccountId, { name: "Starbucks" });
    const unmatchedPersonal = await insertTransaction(db, householdId, personalAccountId, { name: "Hardware" });

    await categorizeSyncedTransactions(connectionId, householdId, db);

    const category = async (id: string) =>
      (await db.select().from(transactions).where(eq(transactions.id, id)))[0]!.categoryId;
    expect(await category(onCard.transactionId)).toBe(businessId);
    expect(await category(personal.transactionId)).toBe(coffeeId);
    expect(await category(unmatchedPersonal.transactionId)).toBeNull();
  });

  it("creates an account rule with an empty pattern", async () => {
    const result = await createCategoryRule(
      { categoryId: businessId, matchField: "name", matchPattern: "  ", priority: 1, accountId: llcAccountId },
      db,
    );

    expect(result).toEqual({ success: true });
    const rows = await db.select().from(categoryRules).where(eq(categoryRules.priority, 1));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: llcAccountId, matchPattern: "" });
  });

  it("still rejects an empty pattern on a rule for every account", async () => {
    const result = await createCategoryRule(
      { categoryId: businessId, matchField: "name", matchPattern: "", priority: 2, accountId: null },
      db,
    );
    expect(result).toHaveProperty("error");
  });

  it("refuses an account from another household", async () => {
    const result = await createCategoryRule(
      { categoryId: businessId, matchField: "name", matchPattern: "x", priority: 3, accountId: foreignAccountId },
      db,
    );
    expect(result).toEqual({ error: "Account not found" });
    expect(await db.select().from(categoryRules).where(eq(categoryRules.priority, 3))).toHaveLength(0);
  });

  it("refuses a deleted account", async () => {
    const { accountId: goneId } = await insertAccount(db, householdId, { name: "Closed", deletedAt: new Date() });
    const result = await createCategoryRule(
      { categoryId: businessId, matchField: "name", matchPattern: "x", priority: 4, accountId: goneId },
      db,
    );
    expect(result).toEqual({ error: "Account not found" });
  });

  it("updates a rule's account, and clears it back to every account", async () => {
    const { ruleId } = await insertCategoryRule(db, householdId, businessId, {
      matchPattern: "adobe",
      priority: 5,
    });

    const scoped = await updateCategoryRule(
      { id: ruleId, categoryId: businessId, matchField: "name", matchPattern: "adobe", priority: 5, accountId: llcAccountId },
      db,
    );
    expect(scoped).toEqual({ success: true });
    expect((await db.select().from(categoryRules).where(eq(categoryRules.id, ruleId)))[0]!.accountId).toBe(
      llcAccountId,
    );

    const foreign = await updateCategoryRule(
      { id: ruleId, categoryId: businessId, matchField: "name", matchPattern: "adobe", priority: 5, accountId: foreignAccountId },
      db,
    );
    expect(foreign).toEqual({ error: "Account not found" });

    const cleared = await updateCategoryRule(
      { id: ruleId, categoryId: businessId, matchField: "name", matchPattern: "adobe", priority: 5, accountId: null },
      db,
    );
    expect(cleared).toEqual({ success: true });
    expect((await db.select().from(categoryRules).where(eq(categoryRules.id, ruleId)))[0]!.accountId).toBeNull();
  });

  it("lists account rules first with the account name, matching engine order", async () => {
    const rules = await getCategoryRules(householdId, db);
    const firstGeneral = rules.findIndex((r) => r.accountId === null);
    const lastScoped = rules.map((r) => r.accountId !== null).lastIndexOf(true);
    expect(lastScoped).toBeLessThan(firstGeneral);
    expect(rules.find((r) => r.accountId === llcAccountId)?.accountName).toBe("LLC card");
  });

  it("deletes an account's rules when the account row is deleted", async () => {
    const { accountId } = await insertAccount(db, householdId, { name: "Temp" });
    await insertCategoryRule(db, householdId, businessId, { matchPattern: "", accountId });
    await db.delete(accounts).where(eq(accounts.id, accountId));
    expect(await db.select().from(categoryRules).where(eq(categoryRules.accountId, accountId))).toHaveLength(0);
  });
});
