import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { count, eq } from "drizzle-orm";
import { createTestDb } from "./setup";
import { createAuthOptions } from "@/lib/auth";
import { householdMembers, user } from "@/db/schema";

let db: Awaited<ReturnType<typeof createTestDb>>["db"];
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

function buildAuth(signupDisabled: boolean) {
  return betterAuth({
    ...createAuthOptions(db, { signupDisabled }),
    secret: "test-secret-for-signup-flag-integration-test",
    baseURL: "http://localhost:4200",
  });
}

async function userCount(email: string) {
  const [row] = await db.select({ n: count() }).from(user).where(eq(user.email, email));
  return row.n;
}

describe("LEDGR_DISABLE_SIGNUP (Better Auth disableSignUp)", () => {
  it("refuses email/password sign-up and creates no user when disabled", async () => {
    const auth = buildAuth(true);
    const email = "blocked@example.com";

    await expect(
      auth.api.signUpEmail({ body: { email, password: "password123", name: "Blocked" } }),
    ).rejects.toMatchObject({ body: { code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" } });

    expect(await userCount(email)).toBe(0);
  });

  it("refuses passkey registration without a session (no account-less passkey sign-up)", async () => {
    const auth = buildAuth(true);
    await expect(
      auth.api.generatePasskeyRegistrationOptions({ headers: new Headers() }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("still lets an existing user sign in when disabled", async () => {
    const email = "existing@example.com";
    await buildAuth(false).api.signUpEmail({
      body: { email, password: "password123", name: "Existing" },
    });

    const result = await buildAuth(true).api.signInEmail({
      body: { email, password: "password123" },
    });
    expect(result.user.email).toBe(email);
  });

  it("creates and provisions a user when sign-up is open", async () => {
    const email = "open@example.com";
    const result = await buildAuth(false).api.signUpEmail({
      body: { email, password: "password123", name: "Open" },
    });

    expect(await userCount(email)).toBe(1);
    const members = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, result.user.id));
    expect(members).toHaveLength(1);
  });
});
