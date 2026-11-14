import { index, integer, pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { households } from "./households";
import { accounts } from "./accounts";

export const categoryGroups = pgTable(
  "category_groups",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon"),
    sortOrder: integer("sort_order").default(0),
    isSystem: boolean("is_system").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("idx_catgroups_household").on(table.householdId)]
);

export const categories = pgTable(
  "categories",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => categoryGroups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon"),
    isIncome: boolean("is_income").default(false),
    includeTransferInSpending: boolean("include_transfer_in_spending")
      .default(false)
      .notNull(),
    /** Fork: the incoming (credit) side of a transfer filed under this category
     * counts as income in income totals — an owner's draw landing in a personal
     * account. The outgoing side stays excluded from spending. Custom,
     * non-income categories only; mutually exclusive with
     * `includeTransferInSpending`. See `includedInIncomeTotals`. */
    includeTransferCreditsAsIncome: boolean("include_transfer_credits_as_income")
      .default(false)
      .notNull(),
    isSystem: boolean("is_system").default(false),
    sortOrder: integer("sort_order").default(0),
    /** Fork: immutable seed identifier — the category's original seed name, set
     * at seed time and never changed by edits. The PFC map
     * (lib/categorization/pfc-map.ts) and seed lookups join on this instead of
     * the mutable `name`, so a renamed system category keeps its automatic
     * categorization. Null for custom categories. */
    pfcSeedKey: text("pfc_seed_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_categories_household").on(table.householdId),
    index("idx_categories_group").on(table.groupId),
  ]
);

export const categoryRules = pgTable(
  "category_rules",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    matchField: text("match_field", { enum: ["name", "merchant"] }).default(
      "name"
    ),
    /** May be "" only when `accountId` is set: a catch-all for that account. */
    matchPattern: text("match_pattern").notNull(),
    priority: integer("priority").default(0),
    /** Fork: when set, the rule only matches transactions on this account, and
     * account rules are evaluated before rules for every account. */
    accountId: text("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_catrules_household").on(table.householdId, table.priority),
  ]
);
