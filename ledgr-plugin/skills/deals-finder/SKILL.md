---
name: ledgr:deals-finder
description: Find current deals, sales, and coupons for merchants and staples the household actually buys
version: 1.0.0
tools:
  - get_spending_profile
  - get_savings_suggestions
---

# Deals Finder

## When to use

Use when the user asks about deals, sales, coupons, cheaper alternatives near them, or where to find a better price on something they regularly buy. Trigger phrases: "find me deals", "what's on sale", "coupons for", "cheaper alternative to", "deals near me".

## How this works

Ledgr's server never makes outbound web calls on its own — `get_spending_profile` returns the household's raw spending evidence (merchant visit frequency, totals, categories, active recurring charges) as plain data, and **you** do the web search yourself using whatever search capability you have available in this conversation. This keeps the deals search entirely under the client's control instead of routing it through Ledgr's own AI provider.

(Ledgr also has a separate, opt-in "deals search" built into `get_savings_suggestions` — see step 4 below — which uses the household's own configured AI provider's hosted web search instead of yours. Prefer this skill when you already have web search available; fall back to step 4 only if you don't.)

## Steps

1. **Ask for a location if you don't have one.** A city, region, or zip is enough — you need it to search for local sales. If the user doesn't want to share one, search for online/national deals instead and say so.

2. **Get the spending evidence.** Call `get_spending_profile` with the relevant scope:
   - A specific merchant the user named: `scopeType: "merchant"`, `scopeId` (look it up from a recent transaction or `list_categories`/`get_transactions` if you don't have it).
   - A category (e.g. "groceries", "gas"): `scopeType: "category"`, `scopeId`.
   - Nothing specific — "find me deals": `scopeType: "overall"` to get the top merchants and categories by spend.

3. **Search the web** for current sales, coupons, or lower-priced alternatives for the merchants/categories/staples in the profile, near the location from step 1. Use your own web search tool — this is not something Ledgr's MCP server does for you.

4. **If you have no web search available**, call `get_savings_suggestions` instead with `includeDeals: true` and the same scope. This asks the household's own AI provider to search (only works if they've opted in under Settings → Savings Advisor — if it comes back with `dealsIncluded: false`, tell the user deals search isn't enabled and point them to that setting).

5. **Present findings grounded in the spending evidence**, not generic deal listicles:
   - Tie each deal back to something the profile showed they actually buy ("You visit [merchant] ~N times/month — found a coupon for X% off there this week")
   - Cite savings only from what you actually found in step 3/4 — don't estimate a deal's value from general knowledge
   - Note the deal's expiration/validity window if you found one

## Important

- Never claim a specific price or discount you didn't actually find via search — if you're estimating, say so explicitly.
- Do not store the household's location or spending data beyond this conversation.
- If the household hasn't opted into `get_savings_suggestions`'s own deals search, don't suggest they need to for this skill to work — your own web search (steps 1-3) needs no such opt-in, since it isn't Ledgr's server doing the searching.
