import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createTestDb } from "./setup";
import { insertHousehold, insertAccount, insertTransaction, insertCategoryGroup, insertCategory } from "./helpers";
import type { LedgrDb } from "../../src/db";

let db: LedgrDb;
let close: () => Promise<void>;
let householdId: string;
let accountId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());

  ({ householdId } = await insertHousehold(db));
  ({ accountId } = await insertAccount(db, householdId, { name: "Checking" }));
  const { groupId } = await insertCategoryGroup(db, householdId, { name: "Food" });
  const { categoryId } = await insertCategory(db, householdId, groupId, { name: "Groceries" });

  await insertTransaction(db, householdId, accountId, {
    date: "2026-03-15",
    normalizedAmount: -1250,
    amount: -1250,
    categoryId,
    name: "Test Store",
    originalName: "TEST STORE #123",
  });
  await insertTransaction(db, householdId, accountId, {
    date: "2026-04-01",
    normalizedAmount: -2000,
    amount: -2000,
    categoryId,
    name: "Other Store",
    originalName: "OTHER STORE",
  });
});

afterAll(async () => {
  await close();
});

describe("buildCsvString", () => {
  test("exports amounts as negated dollars", async () => {
    const { buildCsvString } = await import("../../src/app/api/export/transactions/route");
    const csv = await buildCsvString(householdId, {}, db);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Date,Account,Merchant,Amount,Category,Category Group,Notes,Original Description");
    const row1 = lines.find((l) => l.includes("Test Store"));
    expect(row1).toContain("-12.50");
  });

  test("respects date range filter", async () => {
    const { buildCsvString } = await import("../../src/app/api/export/transactions/route");
    const csv = await buildCsvString(householdId, { from: "2026-03-01", to: "2026-03-31" }, db);
    const lines = csv.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(2);
  });

  test("UTF-8 BOM present", async () => {
    const { buildCsvResponse } = await import("../../src/app/api/export/transactions/route");

    const response = await buildCsvResponse(householdId, {}, db);
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer[0]).toBe(0xef);
    expect(buffer[1]).toBe(0xbb);
    expect(buffer[2]).toBe(0xbf);
  });
});

describe("buildCsvString — category groups and CSV injection (fork)", () => {
  test("honours the group filter like the Transactions list", async () => {
    const { buildCsvString } = await import("../../src/app/api/export/transactions/route");
    const { groupId: bizGroup } = await insertCategoryGroup(db, householdId, { name: "Business" });
    const { categoryId: bizCat } = await insertCategory(db, householdId, bizGroup, { name: "Software" });
    await insertTransaction(db, householdId, accountId, {
      date: "2026-05-02",
      normalizedAmount: -999,
      amount: 999,
      categoryId: bizCat,
      name: "=HYPERLINK(\"http://evil\")",
    });

    const only = await buildCsvString(householdId, { groups: bizGroup }, db);
    const onlyRows = only.split("\n").filter((l) => l.trim().length > 0);
    expect(onlyRows).toHaveLength(2);
    // The formula is neutralised, not exported live.
    expect(onlyRows[1]).toContain(`'=HYPERLINK`);

    const except = await buildCsvString(householdId, { groups: bizGroup, groupMode: "exclude" }, db);
    expect(except).not.toContain("HYPERLINK");
    expect(except).toContain("Test Store");
  });
});
