import { describe, it, expect } from "vitest";
import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
import {
  categorizeTransactions,
  type CategorizableTransaction,
  type CategoryRule,
} from "./engine";

function makeTxn(overrides: Partial<CategorizableTransaction> = {}): CategorizableTransaction {
  return {
    id: "txn-1",
    name: "Whole Foods Market",
    merchantId: null,
    merchantName: null,
    merchantCategoryId: null,
    pfcDetailed: null,
    ...overrides,
  };
}

function makeRule(overrides: Partial<CategoryRule> = {}): CategoryRule {
  return {
    id: "rule-1",
    categoryId: "cat-groceries",
    matchField: "name",
    matchPattern: "whole foods",
    priority: 0,
    ...overrides,
  };
}

describe("categorizeTransactions", () => {
  it("matches a name rule (case-insensitive substring)", () => {
    const txns = [makeTxn({ name: "WHOLE FOODS MARKET #123" })];
    const rules = [makeRule({ matchPattern: "whole foods" })];

    const result = categorizeTransactions(txns, rules);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      transactionId: "txn-1",
      categoryId: "cat-groceries",
      source: "rule",
    });
  });

  it("matches a merchant rule against merchantName", () => {
    const txns = [makeTxn({ merchantName: "Spotify", merchantId: "m-1" })];
    const rules = [makeRule({ matchField: "merchant", matchPattern: "spotify", categoryId: "cat-subs" })];

    const result = categorizeTransactions(txns, rules);

    expect(result).toHaveLength(1);
    expect(result[0].categoryId).toBe("cat-subs");
    expect(result[0].source).toBe("rule");
  });

  it("higher priority rule wins over lower", () => {
    const txns = [makeTxn({ name: "Starbucks Coffee" })];
    const rules = [
      makeRule({ id: "r-low", matchPattern: "starbucks", categoryId: "cat-dining", priority: 0 }),
      makeRule({ id: "r-high", matchPattern: "starbucks", categoryId: "cat-coffee", priority: 10 }),
    ];

    const result = categorizeTransactions(txns, rules);

    expect(result).toHaveLength(1);
    expect(result[0].categoryId).toBe("cat-coffee");
  });

  it("falls back to merchant default when no rule matches", () => {
    const txns = [makeTxn({ name: "XYZ Corp", merchantCategoryId: "cat-misc", merchantId: "m-1" })];
    const rules = [makeRule({ matchPattern: "no-match" })];

    const result = categorizeTransactions(txns, rules);

    expect(result).toHaveLength(1);
    expect(result[0].categoryId).toBe("cat-misc");
    expect(result[0].source).toBe("merchant_default");
  });

  it("returns empty array when nothing matches and no merchant default", () => {
    const txns = [makeTxn({ name: "Unknown Store" })];
    const rules = [makeRule({ matchPattern: "no-match" })];

    const result = categorizeTransactions(txns, rules);

    expect(result).toHaveLength(0);
  });

  it("returns empty array when rules list is empty", () => {
    const txns = [makeTxn()];

    const result = categorizeTransactions(txns, []);

    expect(result).toHaveLength(0);
  });

  // Property-based tests
  test.prop(
    [
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 0, max: 100 }),
    ],
  )("higher priority always wins regardless of insertion order", (pA, pB) => {
    fc.pre(pA !== pB);
    const highPriority = Math.max(pA, pB);
    const lowPriority = Math.min(pA, pB);
    const txns = [makeTxn({ name: "test" })];
    const rules = [
      makeRule({ id: "r-low", matchPattern: "test", categoryId: "cat-low", priority: lowPriority }),
      makeRule({ id: "r-high", matchPattern: "test", categoryId: "cat-high", priority: highPriority }),
    ];

    const result = categorizeTransactions(txns, rules);

    expect(result).toHaveLength(1);
    expect(result[0].categoryId).toBe("cat-high");
  });

  test.prop(
    [fc.array(fc.record({ name: fc.string({ minLength: 1 }) }), { minLength: 1, maxLength: 20 })],
  )("output length never exceeds input length", (rawTxns) => {
    const txns = rawTxns.map((t, i) => makeTxn({ id: `txn-${i}`, name: t.name }));
    const rules = [makeRule({ matchPattern: "a" })];

    const result = categorizeTransactions(txns, rules);

    expect(result.length).toBeLessThanOrEqual(txns.length);
  });

  it("falls back to PFC mapping when no rule or merchant default matches", () => {
    const pfcMap = new Map([["FOOD_AND_DRINK_GROCERIES", "cat-groceries"]]);
    const txns = [makeTxn({ name: "Random Store", pfcDetailed: "FOOD_AND_DRINK_GROCERIES" })];
    const rules = [makeRule({ matchPattern: "no-match" })];

    const result = categorizeTransactions(txns, rules, pfcMap);

    expect(result).toHaveLength(1);
    expect(result[0].categoryId).toBe("cat-groceries");
    expect(result[0].source).toBe("pfc");
  });

  it("rule takes priority over PFC mapping", () => {
    const pfcMap = new Map([["FOOD_AND_DRINK_GROCERIES", "cat-pfc"]]);
    const txns = [makeTxn({ name: "Whole Foods", pfcDetailed: "FOOD_AND_DRINK_GROCERIES" })];
    const rules = [makeRule({ matchPattern: "whole foods", categoryId: "cat-rule" })];

    const result = categorizeTransactions(txns, rules, pfcMap);

    expect(result).toHaveLength(1);
    expect(result[0].categoryId).toBe("cat-rule");
    expect(result[0].source).toBe("rule");
  });

  it("merchant default takes priority over PFC mapping", () => {
    const pfcMap = new Map([["FOOD_AND_DRINK_GROCERIES", "cat-pfc"]]);
    const txns = [makeTxn({
      name: "Unknown",
      merchantCategoryId: "cat-merchant",
      merchantId: "m-1",
      pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
    })];

    const result = categorizeTransactions(txns, [], pfcMap);

    expect(result).toHaveLength(1);
    expect(result[0].categoryId).toBe("cat-merchant");
    expect(result[0].source).toBe("merchant_default");
  });

  it("skips PFC mapping when pfcDetailed is null", () => {
    const pfcMap = new Map([["FOOD_AND_DRINK_GROCERIES", "cat-pfc"]]);
    const txns = [makeTxn({ name: "Unknown", pfcDetailed: null })];

    const result = categorizeTransactions(txns, [], pfcMap);

    expect(result).toHaveLength(0);
  });

  it("skips PFC mapping when pfcDetailed is not in the map", () => {
    const pfcMap = new Map([["FOOD_AND_DRINK_GROCERIES", "cat-pfc"]]);
    const txns = [makeTxn({ name: "Unknown", pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER" })];

    const result = categorizeTransactions(txns, [], pfcMap);

    expect(result).toHaveLength(0);
  });

  it("works with empty PFC map (backward compatible)", () => {
    const txns = [makeTxn({ name: "Store", pfcDetailed: "FOOD_AND_DRINK_GROCERIES" })];

    const result = categorizeTransactions(txns, []);

    expect(result).toHaveLength(0);
  });
});

describe("categorizeTransactions — account-scoped rules", () => {
  it("only applies an account rule to transactions on that account", () => {
    const txns = [
      makeTxn({ id: "on-card", name: "Adobe", accountId: "acct-llc" }),
      makeTxn({ id: "elsewhere", name: "Adobe", accountId: "acct-personal" }),
    ];
    const rules = [makeRule({ matchPattern: "adobe", categoryId: "cat-software", accountId: "acct-llc" })];

    const result = categorizeTransactions(txns, rules);

    expect(result).toEqual([{ transactionId: "on-card", categoryId: "cat-software", source: "rule" }]);
  });

  it("treats an empty pattern on an account rule as a catch-all for that account", () => {
    const txns = [
      makeTxn({ id: "a", name: "Anything at all", accountId: "acct-llc" }),
      makeTxn({ id: "b", name: "", merchantName: null, accountId: "acct-llc" }),
      makeTxn({ id: "c", name: "Anything at all", accountId: "acct-personal" }),
    ];
    const rules = [makeRule({ matchPattern: "", categoryId: "cat-business", accountId: "acct-llc" })];

    const result = categorizeTransactions(txns, rules);

    expect(result.map((r) => r.transactionId).sort()).toEqual(["a", "b"]);
    expect(result.every((r) => r.categoryId === "cat-business")).toBe(true);
  });

  it("never lets an empty pattern without an account match anything", () => {
    // A hand-edited row; the action refuses to create one.
    const txns = [makeTxn({ name: "Anything", accountId: "acct-llc" })];
    const rules = [makeRule({ matchPattern: "", accountId: null })];

    expect(categorizeTransactions(txns, rules)).toEqual([]);
  });

  it("evaluates account rules before general rules, whatever their priority", () => {
    const txns = [makeTxn({ name: "Starbucks", accountId: "acct-llc" })];
    const rules = [
      makeRule({ id: "general", matchPattern: "starbucks", categoryId: "cat-coffee", priority: 999 }),
      makeRule({ id: "llc", matchPattern: "", categoryId: "cat-meals", priority: 0, accountId: "acct-llc" }),
    ];

    expect(categorizeTransactions(txns, rules)[0].categoryId).toBe("cat-meals");
  });

  it("keeps priority order within the account tier", () => {
    const txns = [makeTxn({ name: "Starbucks", accountId: "acct-llc" })];
    const rules = [
      makeRule({ id: "catch-all", matchPattern: "", categoryId: "cat-business", priority: 0, accountId: "acct-llc" }),
      makeRule({ id: "specific", matchPattern: "starbucks", categoryId: "cat-meals", priority: 5, accountId: "acct-llc" }),
    ];

    expect(categorizeTransactions(txns, rules)[0].categoryId).toBe("cat-meals");
  });

  it("falls through to general rules when no account rule matches", () => {
    const txns = [makeTxn({ name: "Starbucks", accountId: "acct-llc" })];
    const rules = [
      makeRule({ id: "llc", matchPattern: "adobe", categoryId: "cat-software", accountId: "acct-llc" }),
      makeRule({ id: "general", matchPattern: "starbucks", categoryId: "cat-coffee" }),
    ];

    expect(categorizeTransactions(txns, rules)[0].categoryId).toBe("cat-coffee");
  });
});
