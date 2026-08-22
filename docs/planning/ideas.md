# Ledgr — feature ideas

A brainstorm of new features, ranked by suggested build order, from the same whole-app read documented in `docs/planning/gaps.md`. Ranked by leverage: how much each amplifies Ledgr's actual differentiator (the AI/MCP surface on top of clean, self-hosted data), weighted by effort and by how many other ideas it unblocks.

**The through-line:** Ledgr's moat is that an AI agent can see clean, complete, self-hosted financial data. Every Tier 1 idea either makes the data more complete (rules, recurrence, goals) or makes the AI do something visibly valuable with it (savings, audits, alerts, writes). Features that don't feed that loop — however standard — can wait.

## Tier 1 — build next

High leverage, mostly medium effort, each compounds the core differentiator.

1. ~~**Savings Advisor + deals finder**~~ — **built.** On-demand AI that mines real per-merchant frequency and ticket sizes for specific, dollar-quantified savings ("cook 2 of your 4 monthly burger runs at home ≈ $38/mo"), invoked from a category, merchant, or transaction, plus a privacy-tiered local-deals search. Full design and current status: `docs/superpowers/specs/2026-08-21-savings-advisor-design.md`.

2. **One-click "always do this" learning.** When a user recategorizes, offer "apply to all past + future transactions from this merchant/pattern" — creating the `category_rules` row behind the scenes and retro-applying it. Converts gaps.md gaps #2/#3 from plumbing fixes into a visible, delightful feature; the matching engine already exists.

3. **Subscription auditor.** Detect price creep (this month's stream amount vs. history), zombie subscriptions (recurring charge, no usage signal), duplicate services, and annual-vs-monthly arbitrage — with an "audit my subscriptions" button and MCP tool. The `ledgr-plugin` already ships a `subscription-audit` skill for agents; making it first-class in-app closes the loop. Natural sibling of the Savings Advisor (could share its evidence layer).

4. **Local recurrence detection.** A heuristic detector (same merchant, amount within tolerance, stable interval) that fills `recurring_transactions` for CSV/manual accounts, plus manual add/edit of bills. Closes gaps.md gap #6 and is the data foundation for alerts, forecasting, and the subscription auditor.

5. **Alerts & weekly digest.** In-app notification center + opt-in channels a self-hoster loves (email via SMTP, ntfy/webhook): budget threshold crossed, bill due/missed, large or duplicate charge, Plaid item needs relink. Optionally an AI-written weekly summary. Closes gaps.md gap #8 — the retention loop the product currently lacks entirely.

6. **Savings goals & debt payoff.** Goal entities linked to accounts (target, date, funding progress from balance history) and payoff projections for loans/cards (snowball vs. avalanche). Table-stakes vs. every competitor in the README's own comparison table, and gives the AI surfaces something motivating to talk about.

7. **AI chat parity: memory + safe writes.** Persist conversations, and give chat the same confirmed write tools MCP has (recategorize, set budget, create rule) with an explicit in-UI confirm step. Closes gaps.md gap #14 — "fix it for me" in chat is the moment the AI stops being a toy.

## Tier 2 — strong follow-ons

Clear value; build once Tier 1's foundations exist.

8. **Cash-flow forecast & bill calendar.** Project account balances 30–90 days out using recurring streams + income patterns; calendar view of upcoming bills; extend the existing safe-to-spend calc into "safe to spend until payday." Reuses the Sankey/safe-to-spend query layer; depends on idea 4 for non-Plaid households.

9. **Merchant pages.** A page per merchant: spend history, frequency, average ticket, category, rules, logo. Anchor surface for Savings Advisor's merchant scope (currently only reachable via chat/MCP — see the spec's known limitations), rules management, and subscription auditing.

10. **Anomaly & fee watchdog.** Statistical flags for out-of-pattern spends, double charges, new bank fees, and gray charges — surfaced in review mode and as alerts. Cheap deterministic wins first (duplicate detection is a query), AI explanation on top.

11. **Command palette + global search.** ⌘K over transactions, merchants, pages, and actions, backed by a Postgres full-text index. `cmdk` is already installed; closes gaps.md gap #13.

12. **Budget templates, rollover & auto-create.** Stored template applied automatically when a month begins, plus real rollover math for the flag that already exists. Closes gaps.md gaps #7 and #15 together.

13. **Household backup / restore + competitor import.** Full-fidelity JSON export/import of a household, plus importers for Mint/YNAB/Actual/Firefly exports. The #1 adoption unlock for the self-hosted crowd — nobody switches finance apps without their history.

14. **Real tags.** Filterable labels orthogonal to categories ("vacation-2026", "reimbursable", "tax-deductible"), in filters, reports, and export. Redeems the dead column (gaps.md gap #12); "tax-deductible" alone sets up idea 20.

15. **Alternative sync providers.** SimpleFIN Bridge (US, self-host-friendly, cheap) and GoCardless (EU) behind a provider abstraction over the existing sync layer. Plaid keys are a real barrier for self-hosters; EU users currently have only CSV. Biggest audience-expander on this list.

## Tier 3 — later / opportunistic

Valuable, but after the above — or when a contributor shows up wanting them.

16. **Receipt attachments + AI receipt parsing.** Attach images/PDFs to transactions; optionally parse line items with the BYOK model to auto-suggest splits.

17. **Investment depth.** Dividend income tracking, cost-basis/returns (TWR), benchmark comparison, allocation drift vs. a target with rebalancing suggestions.

18. **More MCP apps & prompts.** Widgets for savings suggestions, goals, and cash-flow forecast (the Savings Advisor spec calls this out as a stretch goal it deliberately skipped); MCP prompts packaging the plugin's workflow skills so any client gets them.

19. **Automation webhooks / REST API.** Outbound events (transaction created, budget exceeded) and a token-scoped API for n8n / Home Assistant / scripts — the self-hosted ecosystem's love language.

20. **Tax year-end report.** Deductible-tagged spending, charitable giving, and investment income rolled into an exportable year-end summary.

21. **True multi-currency.** Base currency per household, daily FX rates, converted aggregation everywhere. README roadmap item; large, so it ranks below features that deepen the differentiator — unless EU adoption (idea 15) makes it urgent.

22. **Multi-member households.** The schema is household-scoped already; add invites, roles, and per-member attribution ("who spent this") to make the household concept real for couples.
