import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const userSettings = pgTable("user_settings", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  theme: text("theme").default("system"),
  currency: text("currency").default("USD"),
  mcpEnabled: boolean("mcp_enabled").notNull().default(false),
  dashboardLayout: text("dashboard_layout"),
  demoMode: boolean("demo_mode").notNull().default(false),
  /** Free-text shopping area (city, "city, state", or zip) used only to give the
   * Savings Advisor's deals search geographic context — never required. */
  dealsLocation: text("deals_location"),
  /** Opt-in: let the Savings Advisor call the AI provider's own hosted web-search
   * tool to look for current deals. Off by default — see docs/superpowers/specs. */
  dealsWebSearchEnabled: boolean("deals_web_search_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
