ALTER TABLE "categories" ADD COLUMN "pfc_seed_key" text;--> statement-breakpoint
-- Backfill the seed key for existing households. Until this fork's category
-- editor, system categories could never be renamed (upstream refused it), so a
-- system category's current name IS its seed name. Only system categories whose
-- name is in the seed list (src/db/seed/categories.ts DEFAULT_CATEGORIES, as of
-- this migration) get a key; custom categories stay NULL.
UPDATE "categories" SET "pfc_seed_key" = "name"
WHERE "pfc_seed_key" IS NULL
  AND "is_system" = true
  AND "name" IN (
  'Salary',
  'Freelance',
  'Investment Income',
  'Other Income',
  'Rent/Mortgage',
  'Property Tax',
  'Home Insurance',
  'Maintenance',
  'Groceries',
  'Restaurants',
  'Coffee Shops',
  'Gas',
  'Public Transit',
  'Car Payment',
  'Car Insurance',
  'Parking',
  'Electric',
  'Water',
  'Internet',
  'Phone',
  'Clothing',
  'Electronics',
  'Home Goods',
  'Health Insurance',
  'Medical',
  'Pharmacy',
  'Fitness',
  'Entertainment',
  'Subscriptions',
  'Education',
  'Gifts',
  'Travel'
);
