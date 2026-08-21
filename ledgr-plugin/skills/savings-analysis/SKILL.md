---
name: ledgr:savings-analysis
description: Find specific, evidence-based ways to save money, calculate savings rate, and model what-if scenarios
version: 2.0.0
tools:
  - get_savings_suggestions
  - get_income_vs_expense
  - get_spending_report
  - show_financial_dashboard
---

# Savings Analysis

## When to use

Use when the user asks about savings, savings rate, how to save more, wants specific ways to cut spending, or wants spending reduction scenarios. Trigger phrases: "savings rate", "how much am I saving", "how to save more", "what if I cut spending", "where can I save money".

## Steps

1. **Get specific savings suggestions first.** Call `get_savings_suggestions` with `scopeType: "overall"`. This returns concrete, evidence-grounded suggestions ("cook at home 2 of your 4 monthly Five Guys visits, ~$38/mo") rather than generic percentage cuts — lead with these, they're the most actionable part of the answer. If the user mentioned a specific merchant or category, call it again with `scopeType: "merchant"`/`"category"` and the relevant `scopeId` (look it up via `list_categories` or a recent transaction if you don't already have it) for a more targeted pass.

2. **Get income vs expense history** for the savings-rate metric, which `get_savings_suggestions` doesn't cover. Call `get_income_vs_expense` with the last 3 months:
   - `dateFrom`: 3 months ago, first day (YYYY-MM-01)
   - `dateTo`: today (YYYY-MM-DD)

3. **Calculate savings rate for each month:**
   - Savings = income - expenses (both in cents)
   - Rate = savings / income * 100
   - Average across the 3 months

4. **Get current month's spending breakdown.** Call `get_spending_report` for the current month, to name discretionary categories the suggestions above didn't already cover.

5. **Show the visual.** Call `show_financial_dashboard` with `view: "net-worth-trend"` to show the income vs expense trend.

6. **Present the summary.** Structure:
   - Specific suggestions from `get_savings_suggestions` first, each with its `estMonthlySavings` and a one-line rationale
   - Savings rate: [X%] average over 3 months (trending [up/down])
   - Monthly savings: [amountDisplay] average
   - Benchmark context: "A common target is saving 20% of income"

## If the user asks about deals or current sales

Use the `ledgr:deals-finder` skill instead — it's the same underlying spending data but paired with a live web search, which this skill doesn't do.

## Important

- Always use `amountDisplay`/`estMonthlySavings` fields for presenting money to the user — never recompute cents-to-dollars yourself.
- Do not store or cache any financial data beyond this conversation.
- `get_savings_suggestions` only returns suggestions grounded in real evidence keys from the household's own data — if it returns an empty list, say so plainly rather than inventing generic advice to fill the gap.
