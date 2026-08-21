import { centsToDisplay } from "@/lib/money";
import { monthlyEquivalentCents } from "./window";
import type { SpendingProfile } from "./types";

function fmt(cents: number): string {
  return centsToDisplay(cents, "USD");
}

/** Builds the grounded prompt handed to the model — every fact in it comes
 * from buildSpendingProfile(), never from the model's own guesses. The model
 * is asked only to propose specific actions against these facts; validate.ts
 * then rejects anything that references evidence not listed here or claims
 * more savings than the scope actually spends. */
export function buildSavingsPrompt(profile: SpendingProfile, opts: { includeDeals?: boolean; location?: string | null } = {}): string {
  const lines: string[] = [];

  lines.push(
    `Find specific, concrete ways to save money based on this household's real spending. ` +
      `Scope: ${profile.scopeLabel}. Window: last ${profile.windowDays} days (${profile.windowStart} to ${profile.windowEnd}).`,
  );
  lines.push(
    `Total spend in this scope over the window: ${fmt(profile.totalSpendCents)} ` +
      `(~${fmt(monthlyEquivalentCents(profile.totalSpendCents, profile.windowDays))}/month equivalent).`,
  );

  if (profile.merchants.length > 0) {
    lines.push("\n## Merchants (evidence key | name | visits | total | avg/visit | trend)");
    for (const m of profile.merchants) {
      const trend =
        m.priorWindowTotalCents === 0
          ? "new"
          : m.totalCents > m.priorWindowTotalCents
            ? `up from ${fmt(m.priorWindowTotalCents)} last period`
            : m.totalCents < m.priorWindowTotalCents
              ? `down from ${fmt(m.priorWindowTotalCents)} last period`
              : "flat vs last period";
      lines.push(
        `- ${m.key} | "${m.name}"${m.categoryName ? ` (${m.categoryName})` : ""} | ` +
          `${m.visitCount} visits from ${m.firstDate} to ${m.lastDate} | total ${fmt(m.totalCents)} | avg ${fmt(m.avgCents)}/visit | ${trend}`,
      );
    }
  }

  if (profile.categories.length > 0) {
    lines.push("\n## Categories (evidence key | name | total | share of spend | budget)");
    for (const c of profile.categories) {
      const budget =
        c.budgetLimitCents !== null
          ? c.budgetSpentCents !== null && c.budgetSpentCents > c.budgetLimitCents
            ? `over budget by ${fmt(c.budgetSpentCents - c.budgetLimitCents)} this month`
            : `within ${fmt(c.budgetLimitCents)}/month budget`
          : "no budget set";
      lines.push(
        `- ${c.key} | "${c.name}"${c.groupName ? ` (${c.groupName})` : ""} | total ${fmt(c.totalCents)} | ` +
          `${Math.round(c.shareOfSpend * 100)}% of tracked spend | ${budget}`,
      );
    }
  }

  if (profile.recurring.length > 0) {
    lines.push("\n## Active recurring charges (evidence key | name | amount | frequency | next date)");
    for (const r of profile.recurring) {
      lines.push(`- ${r.key} | "${r.name}" | ${fmt(r.averageAmountCents)} | ${r.frequency ?? "unknown frequency"} | next ${r.nextDate ?? "unknown"}`);
    }
  }

  if (profile.merchants.length === 0 && profile.categories.length === 0 && profile.recurring.length === 0) {
    lines.push(`\nNo merchant, category, or recurring-charge history is available for this scope — only its own amount (${fmt(profile.totalSpendCents)}).`);
  }

  lines.push(`\n## Instructions
Propose up to 6 suggestions. Every suggestion MUST:
- Reference at least one evidence key from the lists above in "evidenceKeys" (unless there is truly no evidence, in which case return an empty suggestions array).
- Estimate "estMonthlySavingsCents" conservatively — it must be a plausible fraction of the merchant/category's own monthly-equivalent spend, never invented from nothing.
- Be concrete and actionable: name the specific merchant/habit and the specific change ("cook at home 2 of your 4 monthly Five Guys visits"), not generic advice ("eat out less").
- Set "kind" to one of: substitution (swap a purchase for a cheaper equivalent), reduction (do it less often), cancellation (stop a recurring charge), switch_provider (change vendor/plan), timing (buy at a better time/cadence), deal (a coupon/promo/discount opportunity).
- Set "confidence" honestly (0-1) — lower it when the estimate depends on assumptions not in the evidence (e.g. cooking time or ingredient cost, which come from general knowledge, not this household's data).
- Only set "timeCostMinutes" when the suggestion has a real hands-on time cost (e.g. cooking); omit (null) otherwise.
- Do not suggest cancelling or reducing anything that looks essential (rent, loan payments, insurance, utilities) unless evidence shows a specific inefficiency (price increase, duplicate charge, unused low-usage subscription).`);

  if (opts.includeDeals) {
    lines.push(`\n## Deals search
The household has opted in to web search for current deals. If you have web search available, look for current sales, coupons, or lower-priced alternatives for the merchants/categories above${opts.location ? ` near ${opts.location}` : ""}. Add these as suggestions with kind "deal", and only cite savings you can support from what you found — do not estimate deal savings from general knowledge alone.`);
  }

  return lines.join("\n");
}
