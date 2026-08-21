import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { households } from "./households";

export const SAVINGS_SCOPE_TYPES = ["transaction", "merchant", "category", "overall"] as const;
export type SavingsScopeType = (typeof SAVINGS_SCOPE_TYPES)[number];

export const SAVINGS_SUGGESTION_STATUSES = ["new", "dismissed", "acted"] as const;
export type SavingsSuggestionStatus = (typeof SAVINGS_SUGGESTION_STATUSES)[number];

/**
 * One run of the savings advisor for a given scope. `payload` is the
 * validated suggestion list plus a lightweight profile snapshot, stored as
 * JSON text (matching the `saved_reports.filters` convention — see
 * queries/savings.ts for the parsed shape). Status starts "new"; the
 * household can dismiss a run or mark it "acted" to unlock realized-savings
 * comparison against the profile snapshot.
 */
export const savingsSuggestions = pgTable(
  "savings_suggestions",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    scopeType: text("scope_type", { enum: SAVINGS_SCOPE_TYPES }).notNull(),
    scopeId: text("scope_id"),
    scopeLabel: text("scope_label").notNull(),
    windowDays: integer("window_days").notNull(),
    payload: text("payload").notNull(),
    model: text("model").notNull(),
    dealsIncluded: boolean("deals_included").notNull().default(false),
    status: text("status", { enum: SAVINGS_SUGGESTION_STATUSES }).notNull().default("new"),
    actedAt: timestamp("acted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_savings_suggestions_household_created").on(table.householdId, table.createdAt),
    index("idx_savings_suggestions_scope").on(table.householdId, table.scopeType, table.scopeId),
  ],
);
