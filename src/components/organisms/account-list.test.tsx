/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AccountRow, InstitutionGroup } from "@/queries/accounts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/actions/accounts", () => ({ updateAccount: vi.fn() }));
vi.mock("@/actions/sync", () => ({ triggerSync: vi.fn() }));
vi.mock("@/actions/plaid", () => ({ disconnectPlaidItem: vi.fn() }));
vi.mock("@/actions/simplefin", () => ({ disconnectSimplefinConnection: vi.fn() }));
vi.mock("./plaid-link-flow", () => ({ PlaidLinkFlow: () => null }));
vi.mock("./simplefin-reconnect-flow", () => ({ SimplefinReconnectFlow: () => null }));

import { AccountList } from "./account-list";

function account(id: string, name: string, type: AccountRow["type"]): AccountRow {
  return {
    id,
    name,
    type,
    isHidden: false,
    currentBalance: "100.00",
    availableBalance: null,
    currency: "USD",
    mask: null,
    bankConnectionId: null,
  } as unknown as AccountRow;
}

const groups: InstitutionGroup[] = [
  {
    institutionName: "Manual",
    connectionId: null,
    provider: null,
    status: null,
    lastSyncedAt: null,
    logoBase64: null,
    primaryColor: null,
    accounts: [
      account("acct-checking", "Everyday Checking", "checking"),
      account("acct-savings", "Rainy Day Savings", "savings"),
    ],
  },
];

function nameInput(): HTMLInputElement {
  return screen.getByLabelText("Name") as HTMLInputElement;
}

describe("AccountList edit dialog", () => {
  it("loads the clicked account's details, not a previously edited one", () => {
    render(<AccountList groups={groups} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Everyday Checking" }));
    expect(nameInput().value).toBe("Everyday Checking");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Edit Rainy Day Savings" }));
    expect(nameInput().value).toBe("Rainy Day Savings");
  });

  it("discards unsaved edits when the dialog is reopened", () => {
    render(<AccountList groups={groups} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Everyday Checking" }));
    fireEvent.change(nameInput(), { target: { value: "Typed but not saved" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Edit Everyday Checking" }));
    expect(nameInput().value).toBe("Everyday Checking");
  });
});
