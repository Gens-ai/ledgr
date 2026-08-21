import { describe, it, expect, vi } from "vitest";

const getSavingsSuggestions = vi.fn(async () => ({
  suggestionId: "sug-1",
  scopeLabel: "All spending",
  windowDays: 90,
  suggestions: [],
  dealsIncluded: false,
}));
const buildSpendingProfile = vi.fn(async () => ({
  scope: { type: "overall" as const },
  scopeLabel: "All spending",
  windowDays: 90,
  windowStart: "2026-05-23",
  windowEnd: "2026-08-21",
  totalSpendCents: 0,
  currency: "USD",
  merchants: [],
  categories: [],
  recurring: [],
}));

vi.mock("@/lib/ai/savings/advisor", () => ({ getSavingsSuggestions }));
vi.mock("@/lib/ai/savings/profile", () => ({ buildSpendingProfile }));

interface FakeServer {
  registerTool: (name: string, cfg: unknown, fn: (args: unknown) => Promise<unknown>) => void;
}

function makeFakeServer() {
  const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
  const server: FakeServer = {
    registerTool: (name, _cfg, fn) => {
      handlers.set(name, fn);
    },
  };
  return { server, handlers };
}

describe("registerSavingsReadTools", () => {
  it("get_savings_suggestions passes the registrar's householdId and userId, not client-supplied ones", async () => {
    const { registerSavingsReadTools } = await import("./savings");
    const { server, handlers } = makeFakeServer();

    registerSavingsReadTools(server as never, "household-A", "user-A");
    await handlers.get("get_savings_suggestions")!({
      scopeType: "overall",
      windowDays: 30,
      includeDeals: true,
    });

    expect(getSavingsSuggestions).toHaveBeenCalledWith(
      "household-A",
      "user-A",
      { type: "overall", id: undefined },
      { windowDays: 30, includeDeals: true },
    );
  });

  it("get_spending_profile is scoped to the registrar's householdId", async () => {
    const { registerSavingsReadTools } = await import("./savings");
    const { server, handlers } = makeFakeServer();

    registerSavingsReadTools(server as never, "household-B", "user-B");
    await handlers.get("get_spending_profile")!({ scopeType: "merchant", scopeId: "merch-1" });

    expect(buildSpendingProfile).toHaveBeenCalledWith(
      "household-B",
      { type: "merchant", id: "merch-1" },
      undefined,
      undefined,
    );
  });
});
