import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { passkey } from "@better-auth/passkey";
import { db, type LedgrDb } from "@/db";
import { provisionHousehold } from "./provision";
import { isSignupDisabled } from "./signup";

/**
 * WebAuthn relying-party ID — the registrable domain passkeys are bound to.
 * Derived from the app URL (hostname only), defaulting to "localhost" for dev.
 */
function passkeyRpID(): string {
  const url = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!url) return "localhost";
  try {
    return new URL(url).hostname;
  } catch {
    return "localhost";
  }
}

/**
 * Better Auth options, parameterised so tests can build an instance against a
 * test database and either sign-up setting.
 *
 * `disableSignUp` is the only gate needed: email/password is the only path that
 * creates a user. There are no social/OAuth providers or user-creating plugins,
 * and the passkey plugin's registration endpoints require an existing session
 * (`registration.requireSession` defaults to true), so passkeys can only be
 * added to an account that already exists.
 */
export function createAuthOptions(
  database: LedgrDb = db,
  { signupDisabled = isSignupDisabled() }: { signupDisabled?: boolean } = {},
) {
  return {
    database: drizzleAdapter(database, {
      provider: "pg",
    }),
    emailAndPassword: {
      enabled: true,
      // LEDGR_DISABLE_SIGNUP=true — sign-up is refused server-side; existing
      // users still sign in with password or passkey.
      disableSignUp: signupDisabled,
      minPasswordLength: 8,
    },
    plugins: [
      passkey({
        rpID: passkeyRpID(),
        rpName: "Ledgr",
      }),
    ],
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            try {
              await provisionHousehold(user.id, database);
            } catch {
              console.error(`Failed to provision household for user ${user.id}`);
            }
          },
        },
      },
    },
  } satisfies BetterAuthOptions;
}

export const auth = betterAuth(createAuthOptions());
