import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestDb } from "./setup";
import { insertHousehold, insertAccount, insertMerchant, insertCategoryGroup, insertCategory, insertTransaction } from "./helpers";
import { buildSpendingProfile } from "../../src/lib/ai/savings/profile";
import { persistSuggestions, getSavingsSuggestions } from "../../src/lib/ai/savings/advisor";
import type { SavingsSuggestion } from "../../src/lib/ai/savings/types";
import type { LedgrDb } from "../../src/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../src/lib/demo-mode", () => ({ guardDemoMode: vi.fn(() => null) }));

const mockUserId = "test-user-id";
let mockHouseholdId: string;
vi.mock("../../src/lib/auth/session", () => ({
  getHouseholdId: vi.fn(() => Promise.resolve(mockHouseholdId)),
  getSession: vi.fn(() => Promise.resolve({ user: { id: mockUserId } })),
}));

// Imported after the mocks above so authorizeAction() picks them up.
const {
  listSavingsSuggestionsAction,
  dismissSavingsSuggestionAction,
  markSavingsSuggestionActedAction,
  getRealizedSavingsAction,
  updateDealsSettingsAction,
  getDealsSettingsAction,
} = await import("../../src/actions/savings");

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("savings actions", () => {
  let db: LedgrDb;
  let close: () => Promise<void>;
  let householdId: string;
  let accountId: string;
  let merchantId: string;
  let otherHouseholdId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());

    const hh = await insertHousehold(db);
    householdId = hh.householdId;
    mockHouseholdId = householdId;
    ({ accountId } = await insertAccount(db, householdId));
    const { groupId } = await insertCategoryGroup(db, householdId);
    const { categoryId } = await insertCategory(db, householdId, groupId, { name: "Food & Dining" });
    ({ merchantId } = await insertMerchant(db, householdId, { name: "Five Guys", categoryId }));

    for (const days of [5, 20, 40]) {
      await insertTransaction(db, householdId, accountId, {
        date: daysAgo(days),
        merchantId,
        categoryId,
        amount: 1840,
        normalizedAmount: -1840,
      });
    }

    const other = await insertHousehold(db, "Other Household");
    otherHouseholdId = other.householdId;
  });

  afterAll(async () => {
    await close();
  });

  async function seedSuggestion(status: "new" | "dismissed" | "acted" = "new") {
    const profile = await buildSpendingProfile(householdId, { type: "merchant", id: merchantId }, db, 90);
    if ("error" in profile) throw new Error(profile.error);

    const suggestion: SavingsSuggestion = {
      title: "Cook at home twice a month",
      detail: "You visit Five Guys 3 times over 90 days.",
      kind: "substitution",
      estMonthlySavingsCents: 500,
      effort: "medium",
      timeCostMinutes: 35,
      evidenceKeys: [`merchant:${merchantId}`],
      confidence: 0.8,
    };

    const id = await persistSuggestions(householdId, profile, [suggestion], "test-model", false, db);
    if (status !== "new") {
      const result =
        status === "acted"
          ? await markSavingsSuggestionActedAction(id, db)
          : await dismissSavingsSuggestionAction(id, db);
      expect(result).toEqual({ success: true });
    }
    return { id, profile };
  }

  describe("getSavingsSuggestions (advisor)", () => {
    it("returns an error when AI is not configured", async () => {
      const saved = { p: process.env.AI_PROVIDER, m: process.env.AI_MODEL, k: process.env.AI_API_KEY };
      delete process.env.AI_PROVIDER;
      delete process.env.AI_MODEL;
      delete process.env.AI_API_KEY;

      const result = await getSavingsSuggestions(householdId, mockUserId, { type: "overall" }, {}, db);
      expect(result).toHaveProperty("error", "AI not configured. Set AI_PROVIDER and AI_MODEL in your .env file.");

      if (saved.p) process.env.AI_PROVIDER = saved.p; else delete process.env.AI_PROVIDER;
      if (saved.m) process.env.AI_MODEL = saved.m; else delete process.env.AI_MODEL;
      if (saved.k) process.env.AI_API_KEY = saved.k; else delete process.env.AI_API_KEY;
    });

    it("rate-limits repeated checks of the same scope without needing a live model call when there's no evidence", async () => {
      const empty = await insertHousehold(db, "Empty Household");
      const saved = { p: process.env.AI_PROVIDER, m: process.env.AI_MODEL, k: process.env.AI_API_KEY };
      process.env.AI_PROVIDER = "anthropic";
      process.env.AI_MODEL = "claude-test";
      process.env.AI_API_KEY = "test-key";

      // Overall scope with zero transactions has no evidence, so getSavingsSuggestions
      // skips the model call entirely (see hasEvidence() in advisor.ts) — this can run
      // without a live API key.
      const first = await getSavingsSuggestions(empty.householdId, mockUserId, { type: "overall" }, {}, db);
      expect(first).not.toHaveProperty("error");
      if (!("error" in first)) expect(first.suggestions).toEqual([]);

      const second = await getSavingsSuggestions(empty.householdId, mockUserId, { type: "overall" }, {}, db);
      expect(second).toHaveProperty("error");
      if ("error" in second) expect(second.error).toMatch(/wait \d+s/);

      if (saved.p) process.env.AI_PROVIDER = saved.p; else delete process.env.AI_PROVIDER;
      if (saved.m) process.env.AI_MODEL = saved.m; else delete process.env.AI_MODEL;
      if (saved.k) process.env.AI_API_KEY = saved.k; else delete process.env.AI_API_KEY;
    });
  });

  describe("dismissSavingsSuggestionAction / markSavingsSuggestionActedAction", () => {
    it("dismisses a suggestion the household owns", async () => {
      const { id } = await seedSuggestion();
      const result = await dismissSavingsSuggestionAction(id, db);
      expect(result).toEqual({ success: true });

      mockHouseholdId = householdId;
      const list = await listSavingsSuggestionsAction(null, db);
      if ("error" in list) throw new Error(list.error);
      expect(list.find((r) => r.id === id)?.status).toBe("dismissed");
    });

    it("marks a suggestion acted and stamps actedAt", async () => {
      const { id } = await seedSuggestion();
      const result = await markSavingsSuggestionActedAction(id, db);
      expect(result).toEqual({ success: true });

      const list = await listSavingsSuggestionsAction(null, db);
      if ("error" in list) throw new Error(list.error);
      const record = list.find((r) => r.id === id);
      expect(record?.status).toBe("acted");
      expect(record?.actedAt).not.toBeNull();
    });

    it("refuses to touch a suggestion belonging to another household", async () => {
      const { id } = await seedSuggestion();
      mockHouseholdId = otherHouseholdId;
      const result = await dismissSavingsSuggestionAction(id, db);
      expect(result).toHaveProperty("error");
      mockHouseholdId = householdId;
    });
  });

  describe("listSavingsSuggestionsAction", () => {
    it("filters by scope when given one", async () => {
      const { id } = await seedSuggestion();
      const scoped = await listSavingsSuggestionsAction({ type: "merchant", id: merchantId }, db);
      if ("error" in scoped) throw new Error(scoped.error);
      expect(scoped.some((r) => r.id === id)).toBe(true);

      const wrongScope = await listSavingsSuggestionsAction({ type: "category", id: "nope" }, db);
      if ("error" in wrongScope) throw new Error(wrongScope.error);
      expect(wrongScope.some((r) => r.id === id)).toBe(false);
    });
  });

  describe("getRealizedSavingsAction", () => {
    it("refuses to compute realized savings for a suggestion that hasn't been acted on", async () => {
      const { id } = await seedSuggestion();
      const result = await getRealizedSavingsAction(id, db);
      expect(result).toHaveProperty("error");
    });

    it("compares post-acted spend against the pre-suggestion monthly rate", async () => {
      const { id } = await seedSuggestion("acted");

      // No new spend at this merchant since acting on the suggestion — full
      // expected amount should show up as realized.
      const result = await getRealizedSavingsAction(id, db);
      if ("error" in result) throw new Error(result.error);
      expect(result).toHaveLength(1);
      expect(result[0].actualSpendCents).toBe(0);
      expect(result[0].realizedCents).toBe(result[0].expectedSpendCents);
      expect(result[0].expectedMonthlyCents).toBeGreaterThan(0);
    });

    it("reduces realized savings by spend that did happen after acting", async () => {
      const { id } = await seedSuggestion("acted");

      await insertTransaction(db, householdId, accountId, {
        date: todayDateString(),
        merchantId,
        amount: 1840,
        normalizedAmount: -1840,
      });

      const result = await getRealizedSavingsAction(id, db);
      if ("error" in result) throw new Error(result.error);
      expect(result[0].actualSpendCents).toBe(1840);
    });
  });

  describe("deals settings", () => {
    it("round-trips the deals opt-in and location", async () => {
      const before = await getDealsSettingsAction(db);
      if ("error" in before) throw new Error(before.error);
      expect(before.enabled).toBe(false);

      const update = await updateDealsSettingsAction({ dealsWebSearchEnabled: true, dealsLocation: "Seattle, WA" }, db);
      expect(update).toEqual({ success: true });

      const after = await getDealsSettingsAction(db);
      if ("error" in after) throw new Error(after.error);
      expect(after.enabled).toBe(true);
      expect(after.location).toBe("Seattle, WA");
    });
  });
});
