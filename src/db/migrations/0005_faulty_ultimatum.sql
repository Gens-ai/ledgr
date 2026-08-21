ALTER TABLE "categories" ADD COLUMN "pfc_seed_key" text;--> statement-breakpoint
-- Backfill: at this point no category has ever been renamed through the UI (it didn't exist
-- yet), so every existing category's current name IS its original seed name. Going forward,
-- lib/categorization/pfc-map.ts joins on this stable key instead of the mutable `name` column.
UPDATE "categories" SET "pfc_seed_key" = "name" WHERE "pfc_seed_key" IS NULL;