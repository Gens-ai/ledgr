/**
 * Whether self-service sign-up is turned off on this instance
 * (`LEDGR_DISABLE_SIGNUP=true`). Server-side only — never read it through a
 * NEXT_PUBLIC variable; client components get it as a prop. Anything other
 * than the exact string "true" (including unset) leaves sign-up open.
 */
export function isSignupDisabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.LEDGR_DISABLE_SIGNUP?.trim() === "true";
}
