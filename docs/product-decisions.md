# Product decisions

The single reference for **what the product does and why** — behaviour and policy
calls a product owner made, not technical conventions (those live in `AGENTS.md` and
the architecture/style docs).

**How to use this file**

- Organised by domain, not by date. It reads as *current state*: if an entry is here
  and not marked superseded, it is the rule.
- Each entry: the rule in one sentence, **Why** when one is recorded, date when known,
  and a **Source** — a doc link, or a `path:line` when the decision exists only as
  code. Keep entries short; argue in the source, not here.
- When a decision changes, edit the entry in place and append
  `*(supersedes: <old rule>, <date>)*` — don't delete history silently.
- Before changing product behaviour, check here first. If the behaviour you're about
  to change is listed, it was deliberate — raise it rather than "fixing" it.
- Code behaviour that *might* be a decision but looks accidental or contradicts an
  entry here goes in [Needs a product call](#needs-a-product-call), not in the body.
  Don't promote it to a rule until someone decides.
- Entries prefixed `⟲` were added or changed since the last review and are awaiting the
  owner's approval (`/product-decisions review`).
- This is the Gens-ai fork. Entries marked **(fork)** differ from upstream
  `KenTaniguchi-R/ledgr` on purpose; keep them on upstream merges.

**Last full review:** never

---

## Platform & positioning

- **Self-hosting is the only deployment model; there is no hosted product.** **Source:** `AGENTS.md` intro
- **Licence is AGPL-3.0.** **Source:** `README.md` §License
- **The app works with no bank keys: CSV/OFX/QFX import is the fallback, Plaid is optional, and SimpleFIN is offered alongside Plaid as the no-developer-account option.** **Source:** `README.md` §Connect Your Bank
- **"Your data never leaves your server" is the pitch; CSV export is first-class for getting data out.** AI providers and the deals finder are the stated exceptions (see AI & MCP). **Source:** `README.md` §Features
- **Mobile is "quick glance" only (balances, recent transactions, budget status); no mobile-specific layouts, tables scroll horizontally.** **Why:** YAGNI. 2026-05-11. **Source:** `docs/superpowers/specs/2026-05-11-mobile-responsiveness-design.md`

## Roles & permissions

- **Every user gets exactly one household ("My Finances") at sign-up, as `owner`, with default settings and seeded categories.** Provisioning failures self-heal on the next request. **Source:** `src/lib/auth/provision.ts:30-42`, `src/lib/auth/session.ts:17-42`
- **All data is household-scoped.** Isolation is application-level; Postgres RLS additionally guards `transactions` when the app connects as the restricted `ledgr_app` role (`APP_DATABASE_URL`, set by the stock compose file). **Source:** `src/lib/household-context.ts`, `docker-compose.yml:57`, `scripts/ensure-app-role.mjs`

## Accounts, auth & API

- **Login is email + password (min 8 chars) or passkey; no 2FA/TOTP.** Passkeys bind to the `BETTER_AUTH_URL` host. **Source:** `src/lib/auth/index.ts:11-30`
- **Sessions last 7 days, refreshed at most once a day.** **Source:** `src/lib/auth/index.ts:36`
- **Everything requires login except an explicit public allowlist** (login, signup, `/api/auth`, `/api/health`, Plaid OAuth return + webhook, `.well-known`, `/api/mcp`, manifest, robots, `/privacy`). **Why:** matcher kept narrow so no route is exempted by accident. **Source:** `src/proxy.ts:3-28`
- ⟲ **Sign-up is switchable off with `LEDGR_DISABLE_SIGNUP=true` (fork): Better Auth `disableSignUp` refuses email/password sign-up server-side (the only user-creating path; passkey registration already needs a session), `/signup` shows "Sign-up is disabled on this instance" instead of the form, and the login page drops its "Sign up" link. Existing users still sign in with password or passkey. Unset/anything else = open. Read server-side only, per request. The theforest deploy turns it on once the owner account exists.** **Why:** otherwise any tailnet device can create an account. 2026-11-13. **Source:** `src/lib/auth/index.ts:44`, `src/lib/auth/signup.ts:10`, `src/app/(auth)/signup/page.tsx:11`
- **Auth error messages are deliberately short; detail goes to the server console.** **Source:** `src/components/auth/signup-form.tsx:41-45`

## Privacy & safety

- **Plaid/SimpleFIN credentials are encrypted at the app layer (AES-256-GCM, versioned keys, `pnpm rotate-keys`); the key auto-generates into the app data volume if unset, and the operator must back it up.** **Source:** `src/lib/encryption.ts`, `SECURITY.md`, `.env.example`
- **Encrypting the rest of the data at rest, and TLS, are the operator's job; the app must never be served over plain HTTP.** **Source:** `SECURITY.md`
- **The AI API key comes only from env and is never stored in the database.** 2026-05-11. **Source:** `docs/superpowers/specs/2026-05-11-ai-settings-env-migration-design.md`
- **Two Danger Zone actions, each behind a typed confirmation: "Delete all financial data" (revokes Plaid, hard-deletes accounts/transactions, keeps login, categories, budgets) and "Delete account" (hard-deletes the whole household and user; no grace period).** Plaid revocation is best-effort; local erasure proceeds anyway. **Source:** `src/lib/account-deletion.ts:44-120`, `src/components/organisms/danger-zone.tsx:192-228`
- **Disconnecting an institution is a soft delete: transactions stay, and re-linking the same institution resurrects the accounts with their history and edits.** **Why:** don't orphan user-edited data. 2026-05-11. **Source:** `docs/superpowers/specs/2026-05-11-plaid-relink-account-resurrection-design.md`, `src/actions/plaid.ts:168,262-272`
- **SimpleFIN disconnect does not revoke at the provider; the user revokes at their SimpleFIN Bridge.** **Source:** `src/actions/simplefin.ts:391`
- **Demo mode is a per-user, read-only switch to a shared fake household; AI chat is blocked in it, and the toggle itself always works so the user can leave.** 2026-05-10. **Source:** `docs/superpowers/specs/2026-05-10-demo-mode-design.md`, `src/lib/demo-mode.ts`, `src/actions/demo-mode.ts:10`
- **Playwright runs Chromium with its OS sandbox on; never disable it. (fork)** **Source:** `AGENTS.md` §Fork notes

## Bank sync

- **Plaid links request 730 days of history (US only); SimpleFIN's first sync asks for 365 days, later syncs re-read the last 7 days.** **Why (SimpleFIN):** bridges default to ~7 days; the overlap re-picks pending rows that changed. **Source:** `src/actions/plaid.ts:33`, `src/lib/simplefin/sync.ts:499-501`
- **Plaid sync is triggered by webhook, a daily backstop cron, manual sync, and right after linking; SimpleFIN only by the daily poll, manual sync, and connect.** **Source:** `src/lib/plaid/webhook-handlers.ts:79`, `src/lib/scheduler/tasks/daily-safety-sync.ts`, `src/lib/scheduler/tasks/daily-simplefin-sync.ts`
- **Scheduler defaults (server-local cron, env-overridable, `SCHEDULER_ENABLED` kill switch): balance snapshot 03:15, Plaid safety sync 04:30 (also refreshes investments), SimpleFIN sync 04:45; on startup, a balance-history gap over 2 days triggers a backfill.** **Why (backfill):** self-hosted containers aren't up 24/7. **Source:** `src/lib/scheduler/config.ts:11-48`, `src/lib/scheduler/tasks/startup-backfill-check.ts`
- **Balance history is backfilled after linking so net worth is a line, not a dot. (fork)** 2026-08-21. **Source:** `docs/issues/ISSUE-009-balance-history-never-backfilled.md`
- **Only one Plaid connection per institution per household.** **Source:** `src/actions/plaid.ts:98`
- **Login-type Plaid errors put the item in `reauth_required` and offer update-mode re-auth; transient ones set `error`; a successful sync resets to active.** **Source:** `src/lib/plaid/utils.ts:48-72`, `src/actions/reauth.ts`
- **Pending→posted keeps the user's category and reviewed flag; provider-removed rows are soft-deleted, never hard-deleted.** **Source:** `src/lib/plaid/sync.ts:205,434,520`, `src/lib/simplefin/sync.ts:281`
- **The demo household is never synced, snapshotted, or touched by webhooks.** **Source:** `src/lib/plaid/webhook-handlers.ts:33`, `src/lib/jobs/snapshot-balances.ts:17`

## Transactions & categories

- **Every household is seeded with ~34 system categories in 10 groups; income categories are Salary, Freelance, Investment Income, Other Income.** **Source:** `src/db/seed/categories.ts`
- **System categories and groups are fully editable: rename, icon, move between groups, flip income/expense. (fork)** **Source:** `src/actions/categories.ts:179,333,375`, `AGENTS.md` §Fork notes
- **System categories are deletable. Deleting an in-use category requires picking a replacement, which atomically takes over its transactions, splits, recurring items, merchant defaults, rules and budget lines (colliding budget lines merge by summing); groups must be empty to delete. (fork; upstream blocks system-category deletion)** **Why:** Joe wants to prune categories he never uses. 2026-11-12. **Source:** `src/actions/categories.ts:248,495-533`, `AGENTS.md` §Fork notes
- **Personal vs business is separated by category group, not by a separate category type. A household's business categories live in a "Business" group (Schedule C-aligned: Business Income, Advertising & Marketing, Car & Truck, Merchant & Platform Fees, Contractors, Business Insurance, Legal & Professional, Office Expense, Equipment, Repairs & Maintenance, Taxes & Licenses, Business Travel, Business Meals, Utilities & Phone, Software & SaaS, Hosting & Domains, Bank Fees, Training & Dues, Owner's Draw); views that need a personal/business split filter by group.** Built 2026-11-14: a group filter on Reports and Transactions (the dashboard stays whole-household, below). Not built: collapsible groups on Categories. **Why:** Joe tracks business expenses for taxes and business review across several accounts; groups already show as headings in category pickers, so a type field would duplicate them. 2026-11-14. **Source:** this session; Joe's household group added via SQL on theforest 2026-11-14 (not seeded for new households).
- **A categorization rule can optionally be limited to one account; with an account set, the name/merchant pattern may be empty (catch-all for that account). Account-specific rules run before general rules (then priority within each tier).** Built 2026-11-14 (`category_rules.account_id`, migration 0015). **Why:** everything on the LLC card should default to Business categories. 2026-11-14. **Source:** this session
- **Plaid category mapping keys off the immutable `pfc_seed_key`, never the display name, so renames don't break auto-categorization. (fork)** **Source:** `src/lib/categorization/engine.ts:111`
- **Categorization order: user rule > merchant default > Plaid PFC > AI > uncategorized for review; it only fills uncategorized rows, and a manual category is never overwritten by sync.** **Source:** `AGENTS.md` §Auto-Categorization Pipeline, `src/lib/categorization/engine.ts:37-80`
- **Rules match a case-insensitive substring of the name or merchant; higher priority (0–999) wins; blank patterns are rejected unless the rule is limited to one account.** **Why (blank):** it would match everything and outrank every tier. **Source:** `src/lib/categorization/engine.ts:39-53`, `src/lib/categorization/rule-pattern.ts`
- **Manually categorizing a transaction sets the merchant default the first time; if the merchant already defaults elsewhere, the user is asked instead of overwriting.** **Why:** merchants like Amazon span categories; avoids re-fixing every sync. 2026-08-20. **Source:** `src/actions/transactions.ts:86-98`, `docs/issues/ISSUE-004-manual-recategorization-does-not-generalize.md`
- **Setting a merchant default or creating a rule only affects future uncategorized rows, not existing ones.** **Source:** `src/actions/merchants.ts:14-35`, `src/actions/category-rules.ts:41-72`
- **AI categorization runs once per row, keeps low-confidence picks (marked `ai_low_confidence` for review) rather than leaving them blank, and may never file an expense under an income category.** Confidence threshold default 0.7, clamped 0.5–0.9. **Why:** an uncategorized row costs an edit anyway; an expense in an income category would vanish from spending. **Source:** `src/lib/ai/categorize.ts`, `src/lib/ai/config.ts:36-42`
- **Transfers stay visible in the ledger but are excluded from spending, income and totals; an outgoing transfer in a custom category opted in via `includeTransferInSpending` (e.g. rent by Zelle) counts as spending, and an incoming transfer in a category opted in via `includeTransferCreditsAsIncome` (owner's draw) counts as income in totals. The two flags are mutually exclusive, custom non-income categories only.** **Source:** `src/queries/shared-conditions.ts:61-125`
- **Transfer detection: exact-amount, opposite-sign pairs across accounts within 3 days (only when uniquely matched); narrow name patterns for card payoffs, reward redemptions and savings/brokerage moves; bare Zelle/Venmo/Cash App/PayPal are only suggested.** **Why:** a false positive silently drops real spending. **Source:** `src/lib/transfer-detection.ts:45-70`, `src/lib/transfer-patterns.ts`
- **All activity on investment accounts is tagged non-spending ("Investment").** **Source:** `src/lib/investment-account-tagging.ts`, `AGENTS.md` Key Conventions
- **The user's transfer decision wins: un-marking a transfer is permanent across syncs, never re-paired or re-suggested.** **Source:** `src/actions/transaction-detail.ts:88-113`
- **Hidden is a user-only flag that removes a row from the ledger, reports, totals and export; deleted is system-only (removed or superseded rows). There is no user-facing delete of transactions.** **Source:** `src/db/schema/transactions.ts:55-61`
- **Bank-synced transactions' dates can't be edited; splits can't exceed the transaction amount.** **Source:** `src/actions/transaction-detail.ts:86,254`
- **CSV/OFX/QFX import up to 10 MB; CSV defaults to "Positive = Expense" (switchable) and supports debit/credit columns; duplicates (OFX FITID, CSV date|amount|description hash) are shown and can be skipped.** **Source:** `src/app/api/import/route.ts`, `src/lib/import/`

## Reports & money totals

- **Money is integer cents everywhere.** **Source:** `AGENTS.md`, `src/lib/money.ts`
- ⟲ **Income totals use the sign rule: every settled, non-transfer, non-hidden credit is income (plus owner's-draw transfer credits, below), regardless of category — on the dashboard tiles, Cash Flow, Reports tiles, Safe to Spend, MCP and AI chat. Refunds counting as income is accepted. (fork)** **Why:** only ~9% of real income (25 of 275) landed in an income category, so the category rule read income at about a tenth of reality. 2026-11-12 (dashboard/Cash Flow since 2026-08-21). **Source:** `src/queries/shared-conditions.ts:32-59` (`incomeTotalsRule`), `docs/issues/ISSUE-010-income-undercounted-by-category-classification.md` *(supersedes: upstream's category rule for the Reports tiles, 2026-11-12)*
- ⟲ **Expense totals are debits outside income categories — the same rule as the Spending tab and Budgets — so a payroll correction filed under an income category is never "spending". (fork)** 2026-11-12. **Source:** `src/queries/shared-conditions.ts` (`incomeTotalsRule`, `notIncome`)
- **Per-category views (Spending tab, Income vs Expense category table, Sankey, budgets) stay category-based.** **Why:** a per-category breakdown needs category data. 2026-08-21. **Source:** ISSUE-010
- **Owner's draw (a transfer from a business account to a personal account, categorized in a category flagged to count transfer credits as income — "Owner's Draw") counts as personal income on its credit side only; the business-side debit stays excluded, so a draw is never a business expense or deduction.** Built 2026-11-14 (`categories.include_transfer_credits_as_income`, migration 0016); closes ISSUE-011. Per-category views (Spending, the Income vs Expense category table, the Sankey) don't show the draw — it is a totals figure. **Why:** draws are real personal income but not deductible. 2026-11-14. **Source:** this session, `docs/issues/ISSUE-011-business-personal-transfers-not-distinguished.md`
- **Reports and Transactions can be filtered by category group (include or exclude), alongside the account and category filters; the dashboard stays whole-household. Uncategorized rows show only with no group filter or in exclude mode.** Built 2026-11-14. **Why:** review business vs personal spending separately without a global mode that's easy to forget. 2026-11-14. **Source:** this session
- **Reports offer a tax-year export: pick a year and category groups, download two CSVs — per-category totals (income, expenses, count) and every transaction behind them.** No tax-form line numbers stored on categories. Same rules as the Reports totals; split transactions contribute one line per split, under the split's category. Built 2026-11-14 (`/api/export/tax-year`). **Why:** what an accountant needs for Schedule C prep. 2026-11-14. **Source:** this session
- **Pending transactions are excluded from spending and totals but listed in the ledger.** Exception: Safe to Spend income (see Needs a product call). **Source:** `src/lib/spending-helpers.ts:36`
- **The dashboard opens on the month of the latest settled transaction, not the calendar month.** **Why:** a returning user shouldn't land on an all-zero month. **Source:** `src/queries/dashboard.ts:38-58`
- **Net-worth percent change is hidden when the opening balance is under $100, and deltas are only computed over fully covered points.** **Why:** avoid "+10381%" from a $5 base. **Source:** `src/lib/net-worth-change.ts:7-26`, `src/lib/net-worth-coverage.ts:84`
- **Net-worth series carry the last known balance forward; a missing day means unchanged, not zero.** **Source:** `src/queries/dashboard.ts:184-297`
- **Reports default to the 3-month preset; the comparison period is the preceding window of equal length.** **Source:** `src/lib/report-date-selection.ts:12`, `src/lib/date-utils.ts:119-165`
- **Safe to Spend = this month's income − recurring expenses − discretionary spend, and can go negative.** **Source:** `src/queries/reports.ts:744-861`

## Budgets, bills & savings

- **Budgets are monthly per category; limits may be $0; remaining can go negative; unbudgeted spend is listed separately and counts in the total.** **Source:** `src/actions/budgets.ts:79`, `src/queries/budgets.ts:89-190`
- **"Copy from last month" only adds missing categories and never overwrites existing limits.** **Source:** `src/actions/budgets.ts:214-226`
- **Budget pace is plain arithmetic (left/over, % used, days elapsed) with no "on pace" judgement, and with no budget the tile shows plain spend and a "set a budget" link.** **Why:** a linear pace is wrong for any month with rent on the 1st. **Source:** `src/lib/budget-pace.ts`
- **Bills: Plaid recurring streams, or for SimpleFIN a conservative local detector (≥3 same-sign occurrences, regular gaps ±40%); muting a bill keeps it so it isn't re-detected.** **Why:** better to miss a real recurring charge than flag two unrelated ones. **Source:** `src/lib/simplefin/recurring.ts:34-105`, `src/actions/recurring.ts`
- **Bill status: overdue if past due, "due soon" within 3 days.** **Source:** `src/lib/date-utils.ts:188-201`
- **Savings Advisor is on demand only (button, chat, MCP) — no background job or digest. (fork)** 2026-08-21. **Source:** `docs/superpowers/specs/2026-08-21-savings-advisor-design.md`
- **The advisor's AI never invents numbers: the app computes evidence, every suggestion must cite real evidence keys or is dropped, and its estimated saving is clamped to the cited spend. (fork)** **Why:** trust. **Source:** `src/lib/ai/savings/validate.ts`, same spec
- **The advisor won't suggest cutting essentials (rent, loans, insurance, utilities) without a specific inefficiency; up to 6 suggestions; 90-day default window; 60-second cooldown per household and scope. (fork)** **Source:** `src/lib/ai/savings/prompt.ts:71-80`, `src/lib/ai/savings/advisor.ts:27`

## AI & MCP

- **AI is configured per deployment by env (one provider: openai, anthropic, google, openrouter or a custom OpenAI-compatible endpoint); unset means chat and AI categorization are off.** **Source:** `src/lib/ai/config.ts:4-34`
- **When AI is configured, categorization and merchant clean-up run automatically after every sync; they send each transaction's description, amount and direction plus category names — not account numbers or balances.** **Source:** `src/lib/plaid/sync.ts:677-690`, `src/lib/ai/categorize.ts:60-85`
- **The deals finder is opt-in per user (off by default), needs both the setting and a per-request flag, is only offered to the Savings Advisor (never chat or categorization), and isn't available for custom/local models. (fork)** **Why:** it's a deliberate exception to "data never leaves your server" because it adds location. 2026-08-21. **Source:** `docs/superpowers/specs/2026-08-21-savings-advisor-design.md` §Deals finder
- **MCP is double-gated: `MCP_ENABLED` on the server (default off) and a per-user toggle (default off).** **Source:** `src/app/api/mcp/route.ts:7`, `src/db/schema/user-settings.ts:8`
- **MCP uses its own OAuth 2.0 server (auth code + PKCE S256, public clients, dynamic registration, rotating refresh tokens); access tokens last 1 hour, refresh tokens 30 days.** **Source:** `src/lib/mcp/auth/oauth-server.ts`
- **Scopes: `ledgr:read` (required for anything), `ledgr:write` (recategorize, mark transfers, set budget lines), `ledgr:sync` (trigger bank sync). No MCP tool deletes anything.** **Source:** `src/lib/mcp/constants.ts`, `src/lib/mcp/tools/index.ts`
- **MCP `sync_accounts` is limited to once per minute per institution.** **Source:** `src/lib/mcp/rate-limit.ts:6`
- **Connected MCP clients are listed in Settings and can be revoked one by one.** **Source:** `src/actions/mcp-settings.ts:41`

## Settings defaults

New users get theme "system", currency USD, MCP off, demo mode off, deals web search off.
Server defaults: port 4200, `MCP_ENABLED=false`, `PLAID_ENV=production`, scheduler on
(03:15 / 04:30 / 04:45), AI off until `AI_PROVIDER`/`AI_MODEL` are set, AI confidence
threshold 0.7. `POSTGRES_PASSWORD` defaults to `ledgr` and must be changed for real use.
Detail lives in each section above.

## Naming & voice

- **Demo mode's write refusal reads "Demo mode is read-only. Switch to your account to make changes."** **Source:** `src/lib/demo-mode.ts:21`

---

## Needs a product call

Behaviour found in code that either contradicts a decision above or looks accidental.
Each needs a decision — then either fix the code or promote the behaviour to a rule
above and delete it here.

**Contradicts a recorded decision**

- The Transactions-page summary uses its own rule: expenses don't exclude income categories, and income uses only `isTransfer=false` (`src/queries/transactions.ts:292-293`) — contradicts the shared income/expense rule.
- Drill-down from the Total Income tile uses the category-based `incomeBaseConditions`, so it won't sum to the sign-based tile; comments at `src/lib/spending-helpers.ts:51` and `src/queries/reports.ts:312` are stale.
- Deleting a system category silently stops Plaid auto-categorization for its seed key, since nothing re-seeds it (`src/lib/categorization/engine.ts:111-122`) — worth a warning in the delete dialog.
- System categories can't opt in to `includeTransferInSpending` ("Only custom categories can be changed", `src/actions/categories.ts:439-443`), although system categories are otherwise fully editable.

**Looks accidental**

*Security / privacy*
- Turning off the per-user MCP toggle doesn't stop existing tokens; it's only checked at consent time (`src/app/mcp/authorize/actions.ts:19`; no check in `src/app/api/mcp/route.ts`).
- MCP client registration and revoke endpoints are unauthenticated and unrate-limited, and there's no general rate limit on `/api/mcp`, the OAuth endpoints or AI chat (`src/app/api/mcp/oauth/register/route.ts`, `src/app/api/ai/chat/route.ts`).
- The consent screen grants all scopes when a client names none, and the user can't narrow them (`src/lib/mcp/constants.ts:10`). Matters for the plan to give Hommie `ledgr:read` only.
- MCP tokens ignore demo mode and always reach the real household (`src/lib/mcp/tools/index.ts:16`).
- `ENCRYPTION_KEY` also signs MCP JWTs, as raw UTF-8 rather than decoded, so rotating the v1 key logs out every MCP client (`src/lib/mcp/auth/token.ts:5-9`).
- The privacy page says AI is "off unless you enable it", but there's no per-user opt-in: once the operator configures AI, every sync sends descriptions to the provider (`src/app/privacy/page.tsx`, `src/lib/plaid/sync.ts:677-690`).
- `PRIVACY.md` and `/privacy` are written for a hosted service with upstream's maintainer as controller and contact.
- Roles (`owner`/`member`/`advisor`) exist in the schema, but nothing reads them, and there's no invite flow (`src/db/schema/households.ts:18`).

*Sync & import*
- OFX/QFX imports store expenses as income, because the OFX sign is run through the Plaid-convention flip (`src/app/api/import/route.ts:121,186`, `src/lib/money.ts:85`).
- Imported rows don't run categorization or transfer detection, and don't set `provider` (`src/app/api/import/route.ts:178-187`).
- Plaid connections in `error` are never retried by the cron, only manually (`src/lib/plaid/queries.ts:23`).
- Webhook handler failures return 200, so Plaid never retries (`src/app/api/plaid/webhook/route.ts:7-21`).
- SimpleFIN's next window anchors on the last sync log row, including failed ones, so transactions can be missed after an error (`src/lib/simplefin/sync.ts:480`).
- Plaid `LOAN_PAYMENTS` are tagged as transfers at ingest (excluded from spending), but `pfc-map.ts` maps them to Rent/Mortgage, Car Payment and Education (`src/lib/plaid/sync.ts:195`).
- The card-payoff patterns include user-specific strings ("gsbank payment", "applecard") (`src/lib/transfer-patterns.ts:6-12`).
- Equal-priority rules match in unspecified order, and rule actions revalidate `/settings/rules` while the page is `/rules` (`src/lib/categorization/engine.ts:39`, `src/actions/category-rules.ts:72`).

*Money & reports*
- Partial splits drop the unsplit remainder from spending, budgets and trends (`src/lib/spending-helpers.ts:99-149`); split credits never affect income.
- Safe to Spend income includes pending credits, while every other income figure excludes them (`src/queries/reports.ts:752`). Its "posted this month" recurring lookup doesn't exclude pending or hidden rows (`:790-806`).
- Hidden accounts are handled differently in different places:
  - excluded from the dashboard net-worth headline and from Reports;
  - included in the dashboard net-worth chart;
  - skipped by the nightly snapshot;
  - not excluded from Investments.
  (`src/queries/dashboard.ts:80,164`, `src/queries/investments.ts:109`)
- The dashboard Cash Flow widget uses the calendar month, while the other tiles use the "effective month" (`src/app/(dashboard)/page.tsx:60`).
- The Reports "Last month" preset is actually a rolling 1-month window (`src/components/organisms/report-filter-bar.tsx:24`).
- Three different monthly-equivalent conventions are in use (30 days, 30.4375 days, 52/12) across the Savings Advisor, Reports and Bills (`src/lib/ai/savings/window.ts`, `src/lib/date-utils.ts:180`, `src/queries/recurring.ts:82`).
- The budget `rollover` flag and the `flex` budget type are stored and copied, but have no effect (`src/db/schema/budgets.ts:44`, `src/queries/budgets.ts:163`).
- Consolidated holdings overstate gain/loss when some lots have no cost basis (`src/queries/investments.ts:345-369`).
- The bill "due soon" boundary mixes UTC and local time (`src/lib/date-utils.ts:196-198`).
- Recurring income is summed in the Bills header but never listed (`src/queries/recurring.ts:32,104`).
- "Realized savings" uses the full evidence spend as its baseline, not the suggestion's estimate (`src/lib/ai/savings/realized.ts:75-113`).

## Open questions

Product calls that are needed but not yet made. Decide, record above, delete here.

- What feedback to show when a category update fails (it reverts silently today)? — `docs/issues/ISSUE-007-category-pill-silent-failure.md`
- Which demo-mode writes are meant to be unguarded? `AGENTS.md` says only some are gated, but the spec lists them all. — `AGENTS.md` §Fork notes vs `docs/superpowers/specs/2026-05-10-demo-mode-design.md`
- Should ISSUE-001/002/003 be closed? Category rules and the category CRUD UI now exist, but `docs/roadmap.md` and the issues still say open. — `docs/roadmap.md`
- Savings Advisor v2: per-suggestion dismiss/act, and structured flyer data. — savings-advisor spec §Known limitations
