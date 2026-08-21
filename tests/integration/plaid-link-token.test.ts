import { describe, it, expect, afterEach, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import { createLinkToken } from "@/actions/plaid";
import { resetPlaidClient } from "@/lib/plaid/client";

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(() => Promise.resolve({ user: { id: "test-user-id" } })),
  getHouseholdId: vi.fn(() => Promise.resolve("test-household-id")),
}));
vi.mock("@/lib/demo-mode", () => ({ guardDemoMode: vi.fn(() => null) }));

beforeAll(() => {
  vi.stubEnv("PLAID_CLIENT_ID", "test-id");
  vi.stubEnv("PLAID_SECRET", "test-secret");
  vi.stubEnv("PLAID_ENV", "sandbox");
  server.listen({ onUnhandledRequest: "error" });
});
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

describe("createLinkToken", () => {
  beforeEach(() => {
    resetPlaidClient();
  });
  afterEach(() => {
    server.resetHandlers();
  });

  it("requests 730 days of transaction history for new links", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    server.use(
      http.post("https://sandbox.plaid.com/link/token/create", async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          link_token: "link-sandbox-test-token",
          expiration: "2026-12-31T00:00:00Z",
          request_id: "req-test-123",
        });
      })
    );

    const result = await createLinkToken();

    expect("linkToken" in result && result.linkToken).toBe("link-sandbox-test-token");
    expect(capturedBody?.transactions).toEqual({ days_requested: 730 });
  });
});
