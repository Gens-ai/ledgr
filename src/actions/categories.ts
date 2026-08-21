"use server";

import { eq, and, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { db as defaultDb, type LedgrDb } from "@/db";
import {
  categoryGroups,
  categories,
  transactions,
  transactionSplits,
  recurringTransactions,
  merchants,
  categoryRules,
  budgetCategories,
} from "@/db/schema";
import { scopedQuery } from "@/lib/scoped-query";
import { authorizeAction } from "@/lib/auth/authorize-action";
import { countRows } from "@/lib/query-helpers";
import { getCategoryUsage, type CategoryUsage } from "@/queries/categories";

const nameSchema = z.string().min(1).max(100);
const iconSchema = z.string().min(1).max(50).nullable().optional();

function revalidateCategoryPaths() {
  revalidatePath("/categories");
  revalidatePath("/budgets");
  revalidatePath("/transactions");
}

// ── Category groups ──────────────────────────────────────────────────

const createGroupSchema = z.object({ name: nameSchema, icon: iconSchema });

export async function createCategoryGroup(
  data: { name: string; icon?: string | null },
  db: LedgrDb = defaultDb,
): Promise<{ success: true; groupId: string } | { error: string }> {
  const parsed = createGroupSchema.safeParse(data);
  if (!parsed.success) {
    return { error: "Invalid input" };
  }

  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  const { householdId } = auth;

  const scoped = scopedQuery(householdId, db);
  const [maxRow] = await db
    .select({ max: sql<number>`COALESCE(MAX(${categoryGroups.sortOrder}), -1)`.mapWith(Number) })
    .from(categoryGroups)
    .where(scoped.where(categoryGroups));

  const id = uuid();
  await db.insert(categoryGroups).values({
    id,
    householdId,
    name: parsed.data.name,
    icon: parsed.data.icon ?? null,
    sortOrder: (maxRow?.max ?? -1) + 1,
  });

  revalidateCategoryPaths();
  return { success: true, groupId: id };
}

const updateGroupSchema = z.object({ name: nameSchema.optional(), icon: iconSchema });

export async function updateCategoryGroup(
  groupId: string,
  data: { name?: string; icon?: string | null },
  db: LedgrDb = defaultDb,
): Promise<{ success: true } | { error: string }> {
  const parsed = updateGroupSchema.safeParse(data);
  if (!parsed.success) {
    return { error: "Invalid input" };
  }

  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  const { householdId } = auth;

  const scoped = scopedQuery(householdId, db);
  const [existing] = await db
    .select({ id: categoryGroups.id })
    .from(categoryGroups)
    .where(scoped.where(categoryGroups, eq(categoryGroups.id, groupId)))
    .limit(1);
  if (!existing) {
    return { error: "Category group not found" };
  }

  const updates: Partial<typeof categoryGroups.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.icon !== undefined) updates.icon = parsed.data.icon;

  if (Object.keys(updates).length > 0) {
    await db.update(categoryGroups).set(updates).where(eq(categoryGroups.id, groupId));
  }

  revalidateCategoryPaths();
  return { success: true };
}

export async function deleteCategoryGroup(
  groupId: string,
  db: LedgrDb = defaultDb,
): Promise<{ success: true } | { error: string }> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  const { householdId } = auth;

  const scoped = scopedQuery(householdId, db);
  const [existing] = await db
    .select({ id: categoryGroups.id })
    .from(categoryGroups)
    .where(scoped.where(categoryGroups, eq(categoryGroups.id, groupId)))
    .limit(1);
  if (!existing) {
    return { error: "Category group not found" };
  }

  const [countRow] = await db
    .select({ count: countRows() })
    .from(categories)
    .where(eq(categories.groupId, groupId));
  const remaining = countRow?.count ?? 0;
  if (remaining > 0) {
    return { error: `Move or delete its ${remaining} ${remaining === 1 ? "category" : "categories"} first` };
  }

  await db.delete(categoryGroups).where(eq(categoryGroups.id, groupId));

  revalidateCategoryPaths();
  return { success: true };
}

// ── Categories ────────────────────────────────────────────────────────

const createCategorySchema = z.object({
  groupId: z.string().min(1),
  name: nameSchema,
  icon: iconSchema,
  isIncome: z.boolean().optional(),
});

export async function createCategory(
  data: { groupId: string; name: string; icon?: string | null; isIncome?: boolean },
  db: LedgrDb = defaultDb,
): Promise<{ success: true; categoryId: string } | { error: string }> {
  const parsed = createCategorySchema.safeParse(data);
  if (!parsed.success) {
    return { error: "Invalid input" };
  }

  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  const { householdId } = auth;

  const scoped = scopedQuery(householdId, db);
  const [group] = await db
    .select({ id: categoryGroups.id })
    .from(categoryGroups)
    .where(scoped.where(categoryGroups, eq(categoryGroups.id, parsed.data.groupId)))
    .limit(1);
  if (!group) {
    return { error: "Category group not found" };
  }

  const [maxRow] = await db
    .select({ max: sql<number>`COALESCE(MAX(${categories.sortOrder}), -1)`.mapWith(Number) })
    .from(categories)
    .where(eq(categories.groupId, parsed.data.groupId));

  const id = uuid();
  await db.insert(categories).values({
    id,
    householdId,
    groupId: parsed.data.groupId,
    name: parsed.data.name,
    icon: parsed.data.icon ?? null,
    isIncome: parsed.data.isIncome ?? false,
    sortOrder: (maxRow?.max ?? -1) + 1,
  });

  revalidateCategoryPaths();
  return { success: true, categoryId: id };
}

const updateCategorySchema = z.object({
  name: nameSchema.optional(),
  icon: iconSchema,
  groupId: z.string().min(1).optional(),
  isIncome: z.boolean().optional(),
});

export async function updateCategory(
  categoryId: string,
  data: { name?: string; icon?: string | null; groupId?: string; isIncome?: boolean },
  db: LedgrDb = defaultDb,
): Promise<{ success: true } | { error: string }> {
  const parsed = updateCategorySchema.safeParse(data);
  if (!parsed.success) {
    return { error: "Invalid input" };
  }

  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  const { householdId } = auth;

  const scoped = scopedQuery(householdId, db);
  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(scoped.where(categories, eq(categories.id, categoryId)))
    .limit(1);
  if (!existing) {
    return { error: "Category not found" };
  }

  if (parsed.data.groupId !== undefined) {
    const [group] = await db
      .select({ id: categoryGroups.id })
      .from(categoryGroups)
      .where(scoped.where(categoryGroups, eq(categoryGroups.id, parsed.data.groupId)))
      .limit(1);
    if (!group) {
      return { error: "Category group not found" };
    }
  }

  const updates: Partial<typeof categories.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.icon !== undefined) updates.icon = parsed.data.icon;
  if (parsed.data.groupId !== undefined) updates.groupId = parsed.data.groupId;
  if (parsed.data.isIncome !== undefined) updates.isIncome = parsed.data.isIncome;

  if (Object.keys(updates).length > 0) {
    await db.update(categories).set(updates).where(eq(categories.id, categoryId));
  }

  revalidateCategoryPaths();
  return { success: true };
}

export async function getCategoryUsageAction(
  categoryId: string,
  db: LedgrDb = defaultDb,
): Promise<{ success: true; usage: CategoryUsage } | { error: string }> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  const { householdId } = auth;

  const scoped = scopedQuery(householdId, db);
  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(scoped.where(categories, eq(categories.id, categoryId)))
    .limit(1);
  if (!existing) {
    return { error: "Category not found" };
  }

  const usage = await getCategoryUsage(categoryId, householdId, db);
  return { success: true, usage };
}

export async function deleteCategory(
  categoryId: string,
  replacementCategoryId: string | undefined,
  db: LedgrDb = defaultDb,
): Promise<{ success: true } | { error: string }> {
  const auth = await authorizeAction();
  if ("error" in auth) return auth;
  const { householdId } = auth;

  const scoped = scopedQuery(householdId, db);
  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(scoped.where(categories, eq(categories.id, categoryId)))
    .limit(1);
  if (!existing) {
    return { error: "Category not found" };
  }

  if (replacementCategoryId) {
    if (replacementCategoryId === categoryId) {
      return { error: "Choose a different category to reassign to" };
    }
    const [replacement] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(scoped.where(categories, eq(categories.id, replacementCategoryId)))
      .limit(1);
    if (!replacement) {
      return { error: "Replacement category not found" };
    }
  } else {
    const usage = await getCategoryUsage(categoryId, householdId, db);
    const total = Object.values(usage).reduce((a, b) => a + b, 0);
    if (total > 0) {
      return { error: "This category is in use. Choose a replacement first." };
    }
  }

  await db.transaction(async (tx) => {
    if (replacementCategoryId) {
      await tx.update(transactions).set({ categoryId: replacementCategoryId }).where(eq(transactions.categoryId, categoryId));
      await tx.update(transactionSplits).set({ categoryId: replacementCategoryId }).where(eq(transactionSplits.categoryId, categoryId));
      await tx.update(recurringTransactions).set({ categoryId: replacementCategoryId }).where(eq(recurringTransactions.categoryId, categoryId));
      await tx.update(merchants).set({ categoryId: replacementCategoryId }).where(eq(merchants.categoryId, categoryId));
      await tx.update(categoryRules).set({ categoryId: replacementCategoryId }).where(eq(categoryRules.categoryId, categoryId));

      const rowsToMove = await tx.select().from(budgetCategories).where(eq(budgetCategories.categoryId, categoryId));
      for (const row of rowsToMove) {
        const [conflict] = await tx
          .select()
          .from(budgetCategories)
          .where(and(eq(budgetCategories.budgetId, row.budgetId), eq(budgetCategories.categoryId, replacementCategoryId)))
          .limit(1);

        if (conflict) {
          await tx
            .update(budgetCategories)
            .set({ limitAmount: conflict.limitAmount + row.limitAmount })
            .where(eq(budgetCategories.id, conflict.id));
          await tx.delete(budgetCategories).where(eq(budgetCategories.id, row.id));
        } else {
          await tx.update(budgetCategories).set({ categoryId: replacementCategoryId }).where(eq(budgetCategories.id, row.id));
        }
      }
    }

    await tx.delete(categories).where(eq(categories.id, categoryId));
  });

  revalidateCategoryPaths();
  return { success: true };
}
