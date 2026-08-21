---
id: ISSUE-007
title: CategoryPill fails silently when the category update action errors (e.g. demo mode)
status: open
created: 2026-08-20
---

## Summary

Changing a transaction's category through the `/transactions` UI gives no feedback when the underlying action fails — the popover closes, the pill briefly flashes the newly-selected name, then reverts to the old category with no error message. This is confusing: it looks like the click just didn't register rather than like a rejected write.

## Details

- `CategoryPill` (`src/components/molecules/category-pill.tsx`) calls `execute()` from `useActionTransition` (`src/hooks/use-action-transition.ts`) but only destructures `{ isPending, execute }` — it never reads the hook's `error` state.
- `handleSelect` optimistically sets `categoryName` to the new selection and closes the popover before the server responds; on `{ error }` it calls `setCategoryName(prevName)` to revert, but nothing surfaces `result.error` to the user (no toast, no inline message).
- Confirmed via a concrete repro: a user with `user_settings.demoMode = true` gets routed to the read-only shared demo household (`getHouseholdId()`, `src/lib/auth/session.ts:37-38`); `updateTransactionCategory` → `authorizeAction()` → `guardDemoMode()` correctly blocks the write and returns `{ error: "Demo mode is read-only. Switch to your account to make changes." }`, but the UI shows nothing — it just looks broken.
- Likely affects any other error path through this action (not just demo mode), and any other component built on `useActionTransition` that doesn't read `error` either — worth checking for the same pattern elsewhere before fixing just this one spot.
