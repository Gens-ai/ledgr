import { expect, test } from "@playwright/test";

test("creates a custom category group and category", async ({ page }) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const password = "playwright-password";

  await page.goto("/signup");
  await page.getByLabel("Name").fill("Category Test");
  await page.getByLabel("Email").fill(`categories-${unique}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/categories");
  await expect(page.getByRole("heading", { name: "Categories" })).toBeVisible();
  await expect(page.getByText("System").first()).toBeVisible();

  await page.getByLabel("Group name").fill("Family");
  await page.getByRole("button", { name: "Add group" }).click();
  await expect(page.getByRole("button", { name: "Rename group Family" })).toBeVisible();

  await page.getByLabel("Category name").fill("Childcare");
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByRole("button", { name: "Rename category Childcare" })).toBeVisible();
});

// Fork: system categories are editable, and delete goes through a usage check.
test("renames and moves a system category, and deletes an unused custom one", async ({ page }) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const password = "playwright-password";

  await page.goto("/signup");
  await page.getByLabel("Name").fill("Category Edit Test");
  await page.getByLabel("Email").fill(`category-edit-${unique}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/categories");

  // Rename the seeded (system) Groceries category.
  await page.getByRole("button", { name: "Rename category Groceries" }).click();
  const nameInput = page.getByRole("textbox").and(page.locator(":focus"));
  await nameInput.fill("Food at Home");
  await nameInput.press("Enter");
  await expect(page.getByRole("button", { name: "Rename category Food at Home" })).toBeVisible();

  // Move it to the Shopping group.
  await page.getByRole("button", { name: "Edit Food at Home" }).click();
  await page.getByRole("combobox", { name: "Group" }).click();
  await page.getByRole("option", { name: "Shopping" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  const shopping = page.locator('[data-slot="card"]', {
    has: page.getByRole("button", { name: "Rename group Shopping" }),
  });
  await expect(shopping.getByRole("button", { name: "Rename category Food at Home" })).toBeVisible();

  // An unused custom category deletes directly.
  await page.getByLabel("Category name").fill("Scratch");
  await page.getByRole("button", { name: "Add category" }).click();
  await page.getByRole("button", { name: "Delete Scratch" }).click();
  await expect(page.getByText("isn't used anywhere")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("button", { name: "Rename category Scratch" })).toHaveCount(0);
});
