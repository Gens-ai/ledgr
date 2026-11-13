/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));
vi.mock("@/components/auth/signup-form", () => ({
  SignupForm: () => <form aria-label="Sign-up form" />,
}));
vi.mock("@/components/auth/login-form", () => ({
  LoginForm: () => <form aria-label="Login form" />,
}));

import SignupPage from "./page";
import LoginPage from "../login/page";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

async function renderSignup() {
  render(await SignupPage());
}

async function renderLogin() {
  render(await LoginPage({ searchParams: Promise.resolve({}) }));
}

describe("sign-up pages with LEDGR_DISABLE_SIGNUP", () => {
  it("offers the sign-up form when the flag is unset", async () => {
    vi.stubEnv("LEDGR_DISABLE_SIGNUP", undefined);
    await renderSignup();
    expect(screen.getByRole("form", { name: "Sign-up form" })).toBeTruthy();
  });

  it("shows a disabled notice instead of the form when the flag is on", async () => {
    vi.stubEnv("LEDGR_DISABLE_SIGNUP", "true");
    await renderSignup();
    expect(screen.queryByRole("form", { name: "Sign-up form" })).toBeNull();
    expect(screen.getByText(/Sign-up is disabled on this instance/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
  });

  it("login page links to sign-up only while sign-up is open", async () => {
    vi.stubEnv("LEDGR_DISABLE_SIGNUP", "false");
    await renderLogin();
    expect(screen.getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe("/signup");
    cleanup();

    vi.stubEnv("LEDGR_DISABLE_SIGNUP", "true");
    await renderLogin();
    expect(screen.getByRole("form", { name: "Login form" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign up" })).toBeNull();
  });
});
