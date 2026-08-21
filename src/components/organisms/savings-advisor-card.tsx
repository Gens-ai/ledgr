import { PiggyBank } from "lucide-react";
import { SavingsAdvisorButton } from "@/components/molecules/savings-advisor-button";

/** Dashboard entry point for the overall-scope Savings Advisor — see
 * SavingsAdvisorButton for the per-transaction/category/merchant entry
 * points and docs/superpowers/specs/2026-08-21-savings-advisor-design.md
 * for the full design. */
export function SavingsAdvisorCard() {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
          <PiggyBank className="size-5" />
        </div>
        <div>
          <p className="text-sm font-medium">Savings Advisor</p>
          <p className="text-xs text-muted-foreground">Specific ways to spend less, based on your real spending</p>
        </div>
      </div>
      <SavingsAdvisorButton scope={{ type: "overall" }} scopeLabel="All spending" variant="labeled" />
    </div>
  );
}
