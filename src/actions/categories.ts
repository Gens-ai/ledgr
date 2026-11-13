"use server";

import { and, desc, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { db as defaultDb, type LedgrDb } from "@/db";
import {
  budgetCategories,
  categories,
  categoryGroups,
  categoryRules,
  merchants,
  recurringTransactions,
  transactionSplits,
  transactions,
} from "@/db/schema";
import { authorizeAction } from "@/lib/auth/authorize-action";
import { withHousehold } from "@/lib/household-context";
import { scopedQuery } from "@/lib/scoped-query";
import { getCategoryUsage as queryCategoryUsage, type CategoryUsage } from "@/queries/categories";

type ActionResult = { success: true } | { error: string };
type CreateResult = { success: true; id: string } | { error: string };

const idSchema = z.string().min(1);
const nameSchema = z.string().trim().min(1).max(80);
/** A lucide icon name, kebab-case (see components/atoms/category-icon.tsx). */
const iconSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(50);
const categoryInputSchema = z.object({
  groupId: idSchema,
  name: nameSchema,
  icon: iconSchema.nullable().optional(),
  isIncome: z.boolean().default(false),
  includeTransferInSpending: z.boolean().default(false),
});
const categoryUpdateSchema = z.object({
  icon: iconSchema.nullable().optional(),
  groupId: idSchema.optional(),
  isIncome: z.boolean().optional(),
});

function revalidateCategoryConsumers() {
  for (const path of ["/categories", "/transactions", "/rules", "/budgets", "/bills", "/reports"]) {
    revalidatePath(path);
  }
}

async function getOwnedGroup(householdId: string, groupId: string, db: LedgrDb) {
  const scoped = scopedQuery(householdId, db);
  const [group] = await db
    .select({ id: categoryGroups.id, isSystem: categoryGroups.isSystem })
    .from(categoryGroups)
    .where(scoped.where(categoryGroups, eq(categoryGroups.id, groupId)))
    .limit(1);
  return group;
}

async function getOwnedCategory(householdId: string, categoryId: string, db: LedgrDb) {
  const scoped = scopedQuery(householdId, db);
  const [category] = await db
    .select({
      id: categories.id,
      groupId: categories.groupId,
      isSystem: categories.isSystem,
      isIncome: categories.isIncome,
    })
    .from(categories)
    .where(scoped.where(categories, eq(categories.id, categoryId)))
    .limit(1);
  return category;
}

async function nextCategorySortOrder(householdId: string, groupId: string, db: LedgrDb) {
  const scoped = scopedQuery(householdId, db);
  const [last] = await db
    .select({ sortOrder: categories.sortOrder })
    .from(categories)
    .where(scoped.where(categories, eq(categories.groupId, groupId)))
    .orderBy(desc(categories.sortOrder))
    .limit(1);
  return (last?.sortOrder ?? -1) + 1;
}

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

/**
 * Category names must be unique per household, system or custom, so pickers
 * and reports never show two indistinguishable entries. (PFC categorization
 * keys off `pfc_seed_key`, not the name, so this is about clarity, not the
 * engine.)
 */
async function categoryNameTaken(
  householdId: string,
  name: string,
  db: LedgrDb,
  excludeId?: string,
): Promise<boolean> {
  const scoped = scopedQuery(householdId, db);
  const rows = await db
    .select({ name: categories.name })
    .from(categories)
    .where(
      excludeId
        ? scoped.where(categories, ne(categories.id, excludeId))
        : scoped.where(categories),
    );
  const wanted = normalizeName(name);
  return rows.some((row) => normalizeName(row.name) === wanted);
}

async function groupNameTaken(
  householdId: string,
  name: string,
  db: LedgrDb,
  excludeId?: string,
): Promise<boolean> {
  const scoped = scopedQuery(householdId, db);
  const rows = await db
    .select({ name: categoryGroups.name })
    .from(categoryGroups)
    .where(
      excludeId
        ? scoped.where(categoryGroups, ne(categoryGroups.id, excludeId))
        : scoped.where(categoryGroups),
    );
  const wanted = normalizeName(name);
  return rows.some((row) => normalizeName(row.name) === wanted);
}

// ── Category groups ──────────────────────────────────────────────────

export async function createCategoryGroupScoped(
  householdId: string,
  name: string,
  db: LedgrDb = defaultDb,
): Promise<CreateResult> {
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { error: "Enter a group name between 1 and 80 characters." };
  if (await groupNameTaken(householdId, parsed.data, db)) {
    return { error: "A category group with that name already exists." };
  }

  const scoped = scopedQuery(householdId, db);
  const [last] = await db
    .select({ sortOrder: categoryGroups.sortOrder })
    .from(categoryGroups)
    .where(scoped.where(categoryGroups))
    .orderBy(desc(categoryGroups.sortOrder))
    .limit(1);

  const id = uuid();
  await db.insert(categoryGroups).values({
    id,
    householdId,
    name: parsed.data,
    isSystem: false,
    sortOrder: (last?.sortOrder ?? -1) + 1,
  });

  revalidateCategoryConsumers();
  return { success: true, id };
}

export async function createCategoryGroup(
  name: string,
  db: LedgrDb = defaultDb,
): Promise<CreateResult> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  return createCategoryGroupScoped(auth.householdId, name, db);
}

/** Renames any group the household owns, system groups included (fork). */
export async function renameCategoryGroupScoped(
  householdId: string,
  groupId: string,
  name: string,
  db: LedgrDb = defaultDb,
): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(groupId);
  const parsedName = nameSchema.safeParse(name);
  if (!parsedId.success || !parsedName.success) return { error: "Invalid input." };

  if (await groupNameTaken(householdId, parsedName.data, db, parsedId.data)) {
    return { error: "A category group with that name already exists." };
  }

  const scoped = scopedQuery(householdId, db);
  const updated = await db
    .update(categoryGroups)
    .set({ name: parsedName.data })
    .where(scoped.where(categoryGroups, eq(categoryGroups.id, parsedId.data)))
    .returning({ id: categoryGroups.id });

  if (updated.length === 0) return { error: "Category group not found." };
  revalidateCategoryConsumers();
  return { success: true };
}

export async function renameCategoryGroup(
  groupId: string,
  name: string,
  db: LedgrDb = defaultDb,
): Promise<ActionResult> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  return renameCategoryGroupScoped(auth.householdId, groupId, name, db);
}

export async function updateCategoryGroupIconScoped(
  householdId: string,
  groupId: string,
  icon: string | null,
  db: LedgrDb = defaultDb,
): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(groupId);
  const parsedIcon = iconSchema.nullable().safeParse(icon);
  if (!parsedId.success || !parsedIcon.success) return { error: "Invalid input." };

  const scoped = scopedQuery(householdId, db);
  const updated = await db
    .update(categoryGroups)
    .set({ icon: parsedIcon.data })
    .where(scoped.where(categoryGroups, eq(categoryGroups.id, parsedId.data)))
    .returning({ id: categoryGroups.id });

  if (updated.length === 0) return { error: "Category group not found." };
  revalidateCategoryConsumers();
  return { success: true };
}

export async function updateCategoryGroupIcon(
  groupId: string,
  icon: string | null,
  db: LedgrDb = defaultDb,
): Promise<ActionResult> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  return updateCategoryGroupIconScoped(auth.householdId, groupId, icon, db);
}

/** Deletes an empty group the household owns, system groups included (fork). */
export async function deleteCategoryGroupScoped(
  householdId: string,
  groupId: string,
  db: LedgrDb = defaultDb,
): Promise<ActionResult> {
  const parsed = idSchema.safeParse(groupId);
  if (!parsed.success) return { error: "Invalid input." };

  const group = await getOwnedGroup(householdId, parsed.data, db);
  if (!group) return { error: "Category group not found." };

  const scoped = scopedQuery(householdId, db);
  const [child] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(scoped.where(categories, eq(categories.groupId, parsed.data)))
    .limit(1);
  if (child) return { error: "Delete or move the categories in this group first." };

  await db
    .delete(categoryGroups)
    .where(scoped.where(categoryGroups, eq(categoryGroups.id, parsed.data)));

  revalidateCategoryConsumers();
  return { success: true };
}

export async function deleteCategoryGroup(
  groupId: string,
  db: LedgrDb = defaultDb,
): Promise<ActionResult> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  return deleteCategoryGroupScoped(auth.householdId, groupId, db);
}

// ── Categories ───────────────────────────────────────────────────────

export async function createCategoryScoped(
  householdId: string,
  input: z.input<typeof categoryInputSchema>,
  db: LedgrDb = defaultDb,
): Promise<CreateResult> {
  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter a valid category name and group." };

  const group = await getOwnedGroup(householdId, parsed.data.groupId, db);
  if (!group) return { error: "Category group not found." };
  if (await categoryNameTaken(householdId, parsed.data.name, db)) {
    return { error: "A category with that name already exists." };
  }

  const id = uuid();
  await db.insert(categories).values({
    id,
    householdId,
    groupId: parsed.data.groupId,
    name: parsed.data.name,
    icon: parsed.data.icon ?? null,
    isIncome: parsed.data.isIncome,
    // An income category has no spending side for a transfer to join.
    includeTransferInSpending: parsed.data.isIncome ? false : parsed.data.includeTransferInSpending,
    isSystem: false,
    sortOrder: await nextCategorySortOrder(householdId, parsed.data.groupId, db),
  });

  revalidateCategoryConsumers();
  return { success: true, id };
}

export async function createCategory(
  input: z.input<typeof categoryInputSchema>,
  db: LedgrDb = defaultDb,
): Promise<CreateResult> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  return createCategoryScoped(auth.householdId, input, db);
}

/**
 * Renames any category the household owns, system categories included
 * (fork). Safe for system categories because PFC categorization and seed
 * lookups join on the immutable `pfc_seed_key`, never on the name.
 */
export async function renameCategoryScoped(
  householdId: string,
  categoryId: string,
  name: string,
  db: LedgrDb = defaultDb,
): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(categoryId);
  const parsedName = nameSchema.safeParse(name);
  if (!parsedId.success || !parsedName.success) return { error: "Invalid input." };

  if (await categoryNameTaken(householdId, parsedName.data, db, parsedId.data)) {
    return { error: "A category with that name already exists." };
  }

  const scoped = scopedQuery(householdId, db);
  const updated = await db
    .update(categories)
    .set({ name: parsedName.data })
    .where(scoped.where(categories, eq(categories.id, parsedId.data)))
    .returning({ id: categories.id });

  if (updated.length === 0) return { error: "Category not found." };
  revalidateCategoryConsumers();
  return { success: true };
}

export async function renameCategory(
  categoryId: string,
  name: string,
  db: LedgrDb = defaultDb,
): Promise<ActionResult> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  return renameCategoryScoped(auth.householdId, categoryId, name, db);
}

/**
 * Fork: change a category's icon, move it to another group, or flip whether
 * it is an income category. Works for system categories too. Turning a
 * category into income clears its transfer-as-spending flag, the same rule
 * createCategory applies.
 */
export async function updateCategoryScoped(
  householdId: string,
  categoryId: string,
  input: z.input<typeof categoryUpdateSchema>,
  db: LedgrDb = defaultDb,
): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(categoryId);
  const parsed = categoryUpdateSchema.safeParse(input);
  if (!parsedId.success || !parsed.success) return { error: "Invalid input." };

  const existing = await getOwnedCategory(householdId, parsedId.data, db);
  if (!existing) return { error: "Category not found." };

  const updates: Partial<typeof categories.$inferInsert> = {};
  if (parsed.data.icon !== undefined) updates.icon = parsed.data.icon;
  if (parsed.data.isIncome !== undefined) {
    updates.isIncome = parsed.data.isIncome;
    if (parsed.data.isIncome) updates.includeTransferInSpending = false;
  }
  if (parsed.data.groupId !== undefined && parsed.data.groupId !== existing.groupId) {
    const group = await getOwnedGroup(householdId, parsed.data.groupId, db);
    if (!group) return { error: "Category group not found." };
    updates.groupId = parsed.data.groupId;
    updates.sortOrder = await nextCategorySortOrder(householdId, parsed.data.groupId, db);
  }

  if (Object.keys(updates).length > 0) {
    const scoped = scopedQuery(householdId, db);
    await db
      .update(categories)
      .set(updates)
      .where(scoped.where(categories, eq(categories.id, parsedId.data)));
  }

  revalidateCategoryConsumers();
  return { success: true };
}

export async function updateCategory(
  categoryId: string,
  input: z.input<typeof categoryUpdateSchema>,
  db: LedgrDb = defaultDb,
): Promise<ActionResult> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  return updateCategoryScoped(auth.householdId, categoryId, input, db);
}

export async function updateCategoryReportingScoped(
  householdId: string,
  categoryId: string,
  includeTransferInSpending: boolean,
  db: LedgrDb = defaultDb,
): Promise<ActionResult> {
  const parsedId = idSchema.safeParse(categoryId);
  if (!parsedId.success) return { error: "Invalid input." };
  const scoped = scopedQuery(householdId, db);
  const updated = await db
    .update(categories)
    .set({ includeTransferInSpending })
    .where(
      scoped.where(
        categories,
        eq(categories.id, parsedId.data),
        eq(categories.isSystem, false),
      ),
    )
    .returning({ id: categories.id });
  if (updated.length === 0) return { error: "Only custom categories can be changed." };
  revalidateCategoryConsumers();
  return { success: true };
}

export async function updateCategoryReporting(
  categoryId: string,
  includeTransferInSpending: boolean,
  db: LedgrDb = defaultDb,
): Promise<ActionResult> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  return updateCategoryReportingScoped(
    auth.householdId,
    categoryId,
    includeTransferInSpending,
    db,
  );
}

/** Counts what references a category. Reads `transactions`, so it runs under RLS. */
export async function getCategoryUsageScoped(
  householdId: string,
  categoryId: string,
  db: LedgrDb = defaultDb,
): Promise<{ success: true; usage: CategoryUsage } | { error: string }> {
  const parsed = idSchema.safeParse(categoryId);
  if (!parsed.success) return { error: "Invalid input." };
  return withHousehold(
    householdId,
    async (tx): Promise<{ success: true; usage: CategoryUsage } | { error: string }> => {
      const category = await getOwnedCategory(householdId, parsed.data, tx);
      if (!category) return { error: "Category not found." };
      return { success: true, usage: await queryCategoryUsage(parsed.data, householdId, tx) };
    },
    db,
  );
}

export async function getCategoryUsageAction(
  categoryId: string,
  db: LedgrDb = defaultDb,
): Promise<{ success: true; usage: CategoryUsage } | { error: string }> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  return getCategoryUsageScoped(auth.householdId, categoryId, db);
}

function totalUsage(usage: CategoryUsage): number {
  return Object.values(usage).reduce((sum, n) => sum + n, 0);
}

/**
 * Deletes a category. With no `replacementCategoryId`, an in-use category is
 * refused (upstream's behaviour). With one, every reference — transactions,
 * splits, recurring items, merchant defaults, rules, and budget lines — moves
 * to the replacement first, then the category is deleted (fork). Budget lines
 * that would collide with the replacement's line in the same budget are merged
 * by summing their limits.
 *
 * All of it runs in one database transaction inside withHousehold: the usage
 * check and the reassignment both touch `transactions`, which has row-level
 * security. Outside withHousehold the restricted app role sees no
 * transactions, so the check would pass and `ON DELETE SET NULL` would quietly
 * uncategorize every one of them.
 */
export async function deleteCategoryScoped(
  householdId: string,
  categoryId: string,
  db: LedgrDb = defaultDb,
  replacementCategoryId?: string,
): Promise<ActionResult> {
  const parsed = idSchema.safeParse(categoryId);
  if (!parsed.success) return { error: "Invalid input." };
  const replacementId = replacementCategoryId || undefined;

  const result = await withHousehold(
    householdId,
    async (tx): Promise<ActionResult> => {
      const scoped = scopedQuery(householdId, tx);
      const category = await getOwnedCategory(householdId, parsed.data, tx);
      if (!category) return { error: "Category not found." };

      if (replacementId) {
        if (replacementId === parsed.data) {
          return { error: "Choose a different category to move its items to." };
        }
        const replacement = await getOwnedCategory(householdId, replacementId, tx);
        if (!replacement) return { error: "Replacement category not found." };
      } else if (totalUsage(await queryCategoryUsage(parsed.data, householdId, tx)) > 0) {
        return { error: "This category is in use and cannot be deleted." };
      }

      if (replacementId) {
        await tx
          .update(transactions)
          .set({ categoryId: replacementId, updatedAt: new Date() })
          .where(scoped.where(transactions, eq(transactions.categoryId, parsed.data)));
        // Splits and budget lines carry no household_id; the category id itself
        // is household-owned (checked above), so filtering on it is scoped.
        await tx
          .update(transactionSplits)
          .set({ categoryId: replacementId })
          .where(eq(transactionSplits.categoryId, parsed.data));
        await tx
          .update(recurringTransactions)
          .set({ categoryId: replacementId })
          .where(scoped.where(recurringTransactions, eq(recurringTransactions.categoryId, parsed.data)));
        await tx
          .update(merchants)
          .set({ categoryId: replacementId, updatedAt: new Date() })
          .where(scoped.where(merchants, eq(merchants.categoryId, parsed.data)));
        await tx
          .update(categoryRules)
          .set({ categoryId: replacementId })
          .where(scoped.where(categoryRules, eq(categoryRules.categoryId, parsed.data)));

        const lines = await tx
          .select()
          .from(budgetCategories)
          .where(eq(budgetCategories.categoryId, parsed.data));
        for (const line of lines) {
          const [existing] = await tx
            .select()
            .from(budgetCategories)
            .where(
              and(
                eq(budgetCategories.budgetId, line.budgetId),
                eq(budgetCategories.categoryId, replacementId),
              ),
            )
            .limit(1);
          if (existing) {
            await tx
              .update(budgetCategories)
              .set({ limitAmount: existing.limitAmount + line.limitAmount })
              .where(eq(budgetCategories.id, existing.id));
            await tx.delete(budgetCategories).where(eq(budgetCategories.id, line.id));
          } else {
            await tx
              .update(budgetCategories)
              .set({ categoryId: replacementId })
              .where(eq(budgetCategories.id, line.id));
          }
        }
      }

      await tx.delete(categories).where(scoped.where(categories, eq(categories.id, parsed.data)));
      return { success: true };
    },
    db,
  );

  if ("success" in result) revalidateCategoryConsumers();
  return result;
}

export async function deleteCategory(
  categoryId: string,
  replacementCategoryId?: string,
  db: LedgrDb = defaultDb,
): Promise<ActionResult> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  return deleteCategoryScoped(auth.householdId, categoryId, db, replacementCategoryId);
}
