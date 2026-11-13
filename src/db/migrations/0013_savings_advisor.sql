CREATE TABLE "savings_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"scope_label" text NOT NULL,
	"window_days" integer NOT NULL,
	"payload" text NOT NULL,
	"model" text NOT NULL,
	"deals_included" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "deals_location" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "deals_web_search_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "savings_suggestions" ADD CONSTRAINT "savings_suggestions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_savings_suggestions_household_created" ON "savings_suggestions" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_savings_suggestions_scope" ON "savings_suggestions" USING btree ("household_id","scope_type","scope_id");