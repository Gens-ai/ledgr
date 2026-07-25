import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

// Asserted against package.json rather than a literal so a version bump does
// not require editing this test.
const { version } = JSON.parse(readFileSync("./package.json", "utf8"));

test("GET /api/health returns ok", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);

  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.version).toBe(version);
  expect(body.db).toBe("connected");
});
