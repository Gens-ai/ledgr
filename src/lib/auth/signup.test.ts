import { describe, expect, it } from "vitest";
import { isSignupDisabled } from "./signup";

describe("isSignupDisabled", () => {
  it('is true only for LEDGR_DISABLE_SIGNUP="true"', () => {
    expect(isSignupDisabled({ LEDGR_DISABLE_SIGNUP: "true" })).toBe(true);
    expect(isSignupDisabled({ LEDGR_DISABLE_SIGNUP: " true\n" })).toBe(true);
  });

  it("defaults to open when unset or set to anything else", () => {
    expect(isSignupDisabled({})).toBe(false);
    for (const value of ["false", "", "1", "yes", "TRUE-ish"]) {
      expect(isSignupDisabled({ LEDGR_DISABLE_SIGNUP: value })).toBe(false);
    }
  });
});
