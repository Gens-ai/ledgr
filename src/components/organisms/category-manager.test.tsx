/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CategoryGroup } from "@/queries/categories";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const actions = vi.hoisted(() => ({
  createCategory: vi.fn(),
  createCategoryGroup: vi.fn(),
  deleteCategory: vi.fn(async () => ({ success: true })),
  deleteCategoryGroup: vi.fn(),
  getCategoryUsageAction: vi.fn(),
  renameCategory: vi.fn(),
  renameCategoryGroup: vi.fn(),
  updateCategory: vi.fn(),
  updateCategoryGroupIcon: vi.fn(),
  updateCategoryReporting: vi.fn(),
  updateCategoryTransferIncome: vi.fn(),
}));
vi.mock("@/actions/categories", () => actions);

const groups: CategoryGroup[] = [
  {
    id: "group-uuid-one",
    name: "Everyday",
    icon: null,
    sortOrder: 0,
    isSystem: true,
    categories: [
      {
        id: "system-category",
        name: "Groceries",
        icon: null,
        isIncome: false,
        includeTransferInSpending: false,
        includeTransferCreditsAsIncome: false,
        isSystem: true,
        sortOrder: 0,
      },
    ],
  },
  {
    id: "group-uuid-two",
    name: "Family",
    icon: null,
    sortOrder: 1,
    isSystem: false,
    categories: [
      {
        id: "custom-category",
        name: "Childcare",
        icon: null,
        isIncome: false,
        includeTransferInSpending: false,
        includeTransferCreditsAsIncome: false,
        isSystem: false,
        sortOrder: 0,
      },
    ],
  },
];

describe("CategoryManager group selection", () => {
  beforeAll(() => {
    if (!Element.prototype.hasPointerCapture) {
      Element.prototype.hasPointerCapture = () => false;
    }
    if (!Element.prototype.setPointerCapture) {
      Element.prototype.setPointerCapture = () => {};
    }
    if (!Element.prototype.releasePointerCapture) {
      Element.prototype.releasePointerCapture = () => {};
    }
  });

  it("renders the selected group name instead of its ID", async () => {
    const { CategoryManager } = await import("./category-manager");
    render(<CategoryManager groups={groups} />);

    const trigger = screen.getByRole("combobox", { name: "Category group" });
    expect(trigger.textContent).toContain("Everyday");
    expect(trigger.textContent).not.toContain("group-uuid-one");

    fireEvent.click(trigger);
    const option = await screen.findByRole("option", { name: "Family" });
    expect(option.textContent).toContain("Family");
  });

  it("shows rename, icon, edit and delete controls for system and custom records alike", async () => {
    // Fork: system categories and groups are editable; PFC mapping keys off
    // pfc_seed_key, not the name.
    const { CategoryManager } = await import("./category-manager");
    render(<CategoryManager groups={groups} />);

    const renameCategory = screen.getByRole("button", { name: "Rename category Childcare" });
    expect(renameCategory.querySelector("svg")).not.toBeNull();
    for (const name of [
      "Rename group Family",
      "Rename group Everyday",
      "Rename category Groceries",
      "Edit Groceries",
      "Delete Groceries",
      "Edit Childcare",
      "Delete Childcare",
    ]) {
      expect(screen.getByRole("button", { name })).not.toBeNull();
    }
    expect(screen.getByRole("combobox", { name: "Change icon for Groceries" })).not.toBeNull();
    expect(screen.getByRole("combobox", { name: "Change icon for group Everyday" })).not.toBeNull();

    fireEvent.click(renameCategory);
    expect(await screen.findByDisplayValue("Childcare")).not.toBeNull();
  });

  it("asks for a category to move an in-use category's items to before deleting", async () => {
    actions.getCategoryUsageAction.mockResolvedValueOnce({
      success: true,
      usage: {
        transactions: 3,
        transactionSplits: 0,
        recurringTransactions: 0,
        merchants: 1,
        categoryRules: 0,
        budgetCategories: 0,
      },
    });
    const { CategoryManager } = await import("./category-manager");
    render(<CategoryManager groups={groups} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Childcare" }));
    expect(await screen.findByText(/used by 3 transactions, 1 merchant default/)).not.toBeNull();

    const confirm = screen.getByRole("button", { name: "Move and delete" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.click(screen.getByRole("combobox", { name: "Move to category" }));
    fireEvent.click(await screen.findByRole("option", { name: "Everyday / Groceries" }));
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(actions.deleteCategory).toHaveBeenCalledWith("custom-category", "system-category"),
    );
  });
  it("shows the transfer-as-spending control for custom categories only", async () => {
    const { CategoryManager } = await import("./category-manager");
    render(<CategoryManager groups={groups} />);

    // One in the create form, one on the custom category row (none for the
    // system Groceries row).
    expect(screen.getAllByRole("checkbox", { name: /^Count transfers as spending/ })).toHaveLength(2);
    expect(screen.queryByRole("checkbox", { name: /cash flow/i })).toBeNull();
    expect(screen.getByText(/credit card payments/i)).not.toBeNull();
  });
  it("offers 'count incoming transfers as income' in the edit dialog of a custom category only", async () => {
    actions.updateCategory.mockResolvedValue({ success: true });
    actions.updateCategoryTransferIncome.mockResolvedValue({ success: true });
    const { CategoryManager } = await import("./category-manager");
    render(<CategoryManager groups={groups} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Childcare" }));
    await screen.findByText("Edit Childcare");
    // Base UI labels the checkbox by its wrapping <label>, so match on a regex.
    const toggle = await screen.findByRole("checkbox", { name: /Count incoming transfers as income/ });
    expect(screen.getByText(/owner.s draw/i)).not.toBeNull();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(actions.updateCategoryTransferIncome).toHaveBeenCalledWith("custom-category", true),
    );
  });

  it("does not offer it on a system category", async () => {
    const { CategoryManager } = await import("./category-manager");
    render(<CategoryManager groups={groups} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Groceries" }));
    await screen.findByText("Edit Groceries");
    expect(
      screen.queryByRole("checkbox", { name: /Count incoming transfers as income/, hidden: true }),
    ).toBeNull();
  });
});
