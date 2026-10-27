CREATE TABLE "due_change_reasons" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "due_change_reasons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ownership_forms" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"short_name" text DEFAULT '' NOT NULL,
	"declaration_for" text DEFAULT 'org' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ownership_forms_declaration_for_check" CHECK ("ownership_forms"."declaration_for" in ('org', 'ip'))
);
--> statement-breakpoint
ALTER TABLE "ownership_forms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "single_tax_rates" (
	"code" text PRIMARY KEY NOT NULL,
	"activity" text NOT NULL,
	"rate" text NOT NULL,
	"rate_cashless" text DEFAULT '' NOT NULL,
	"rate_cash" text DEFAULT '' NOT NULL,
	"conditions" text DEFAULT '' NOT NULL,
	"article" text DEFAULT '' NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"gked" jsonb,
	"adds_to" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "single_tax_rates_adds_to_check" CHECK (not ("single_tax_rates"."code" = any("single_tax_rates"."adds_to")))
);
--> statement-breakpoint
ALTER TABLE "single_tax_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "due_change_reasons" ADD CONSTRAINT "due_change_reasons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_change_reasons" ADD CONSTRAINT "due_change_reasons_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_forms" ADD CONSTRAINT "ownership_forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_forms" ADD CONSTRAINT "ownership_forms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "single_tax_rates" ADD CONSTRAINT "single_tax_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "single_tax_rates" ADD CONSTRAINT "single_tax_rates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "due_change_reasons_name_key" ON "due_change_reasons" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "ownership_forms_name_key" ON "ownership_forms" USING btree ("name");--> statement-breakpoint
CREATE POLICY "due_change_reasons_read" ON "due_change_reasons" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "ownership_forms_read" ON "ownership_forms" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "single_tax_rates_read" ON "single_tax_rates" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);