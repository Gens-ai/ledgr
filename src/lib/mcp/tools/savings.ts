import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSavingsSuggestions } from "@/lib/ai/savings/advisor";
import { buildSpendingProfile } from "@/lib/ai/savings/profile";
import { SAVINGS_SCOPE_TYPES, DEFAULT_WINDOW_DAYS } from "@/lib/ai/savings/types";
import { READ_ANNOTATIONS } from "../constants";
import { jsonResult } from "../tool-result";

const scopeShape = {
  scopeType: z
    .enum(SAVINGS_SCOPE_TYPES)
    .describe('What to analyze: "merchant" or "category" (with scopeId), "transaction" (with scopeId), or "overall"'),
  scopeId: z.string().optional().describe('The merchant/category/transaction id — required unless scopeType is "overall"'),
};

/**
 * Registered under ledgr:read even though get_savings_suggestions persists a
 * row: it only ever writes an advisory suggestion, never touches real
 * financial data (accounts, transactions, budgets) — see
 * docs/superpowers/specs/2026-08-21-savings-advisor-design.md.
 */
export function registerSavingsReadTools(server: McpServer, householdId: string, userId: string) {
  server.registerTool(
    "get_savings_suggestions",
    {
      title: "Get Savings Suggestions",
      description:
        "Find specific, evidence-based ways to save money for a merchant, category, transaction, or the " +
        "household's overall spending — grounded in real transaction history, not generic advice. Runs only " +
        "when called (never automatically). Pass includeDeals=true to also have the household's configured AI " +
        "provider search the web for current deals, if the household has opted in under Settings.",
      inputSchema: {
        ...scopeShape,
        windowDays: z.number().int().min(7).max(365).optional().describe(`Lookback window in days (default ${DEFAULT_WINDOW_DAYS})`),
        includeDeals: z.boolean().optional().describe("Also search the web for current deals (requires the household's deals opt-in)"),
      },
      annotations: READ_ANNOTATIONS,
    },
    async ({ scopeType, scopeId, windowDays, includeDeals }) => {
      const result = await getSavingsSuggestions(
        householdId,
        userId,
        { type: scopeType, id: scopeId },
        { windowDays, includeDeals },
      );
      return jsonResult(result);
    },
  );

  server.registerTool(
    "get_spending_profile",
    {
      title: "Get Spending Profile",
      description:
        "Get the raw evidence (merchant visit frequency and totals, category spend and budget context, active " +
        "recurring charges) behind a scope's spending, without AI suggestions. Intended for a client that wants " +
        "to do its own reasoning or web search over this data — e.g. finding current deals for the merchants " +
        "listed near a location the user provides.",
      inputSchema: {
        ...scopeShape,
        windowDays: z.number().int().min(7).max(365).optional().describe(`Lookback window in days (default ${DEFAULT_WINDOW_DAYS})`),
      },
      annotations: READ_ANNOTATIONS,
    },
    async ({ scopeType, scopeId, windowDays }) => {
      const profile = await buildSpendingProfile(householdId, { type: scopeType, id: scopeId }, undefined, windowDays);
      return jsonResult(profile);
    },
  );
}
