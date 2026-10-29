CREATE TABLE "indicator_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'empty' NOT NULL,
	"status_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "indicator_months_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "indicator_months_month_check" CHECK ("indicator_months"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "indicator_months_status_check" CHECK ("indicator_months"."status" in ('empty', 'filled', 'checked'))
);
--> statement-breakpoint
ALTER TABLE "indicator_months" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "indicator_targets" (
	"org_id" uuid NOT NULL,
	"indicator_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"enabled" boolean NOT NULL,
	"from_month" text,
	"off_since" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indicator_targets_indicator_id_contractor_id_pk" PRIMARY KEY("indicator_id","contractor_id"),
	CONSTRAINT "indicator_targets_from_check" CHECK ("indicator_targets"."from_month" is null or "indicator_targets"."from_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "indicator_targets_off_check" CHECK ("indicator_targets"."off_since" is null or "indicator_targets"."off_since" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "indicator_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "indicator_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"indicator_id" uuid NOT NULL,
	"month" text NOT NULL,
	"value" bigint,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "indicator_values_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "indicator_values_month_check" CHECK ("indicator_values"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "indicator_values_note_check" CHECK (char_length("indicator_values"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "indicator_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "indicators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"type" text NOT NULL,
	"total" text DEFAULT 'sum' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"due_day" smallint DEFAULT 10 NOT NULL,
	"start_month" text NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"auto_new" boolean DEFAULT true NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "indicators_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "indicators_type_check" CHECK ("indicators"."type" in ('int', 'dec', 'som', 'pct')),
	CONSTRAINT "indicators_total_check" CHECK ("indicators"."total" in ('sum', 'avg', 'max', 'min', 'last')),
	CONSTRAINT "indicators_scope_check" CHECK ("indicators"."scope" in ('all', 'selected')),
	CONSTRAINT "indicators_name_check" CHECK (btrim("indicators"."name") <> '' and char_length("indicators"."name") <= 100),
	CONSTRAINT "indicators_unit_check" CHECK (btrim("indicators"."unit") <> '' and char_length("indicators"."unit") <= 20),
	CONSTRAINT "indicators_description_check" CHECK (char_length("indicators"."description") <= 1000),
	CONSTRAINT "indicators_due_day_check" CHECK ("indicators"."due_day" between 1 and 28),
	CONSTRAINT "indicators_start_check" CHECK ("indicators"."start_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "indicators_auto_new_check" CHECK ("indicators"."scope" <> 'all' or "indicators"."auto_new")
);
--> statement-breakpoint
ALTER TABLE "indicators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "indicator_months" ADD CONSTRAINT "indicator_months_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_months" ADD CONSTRAINT "indicator_months_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_targets" ADD CONSTRAINT "indicator_targets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_targets" ADD CONSTRAINT "indicator_targets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_targets" ADD CONSTRAINT "indicator_targets_indicator_fk" FOREIGN KEY ("indicator_id","org_id") REFERENCES "public"."indicators"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_targets" ADD CONSTRAINT "indicator_targets_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_values" ADD CONSTRAINT "indicator_values_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_values" ADD CONSTRAINT "indicator_values_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_values" ADD CONSTRAINT "indicator_values_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_values" ADD CONSTRAINT "indicator_values_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_values" ADD CONSTRAINT "indicator_values_indicator_fk" FOREIGN KEY ("indicator_id","org_id") REFERENCES "public"."indicators"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "indicator_months_key" ON "indicator_months" USING btree ("contractor_id","month");--> statement-breakpoint
CREATE INDEX "indicator_months_month_idx" ON "indicator_months" USING btree ("org_id","month");--> statement-breakpoint
CREATE INDEX "indicator_targets_contractor_idx" ON "indicator_targets" USING btree ("org_id","contractor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "indicator_values_key" ON "indicator_values" USING btree ("contractor_id","indicator_id","month");--> statement-breakpoint
CREATE INDEX "indicator_values_indicator_idx" ON "indicator_values" USING btree ("org_id","indicator_id");--> statement-breakpoint
CREATE INDEX "indicator_values_month_idx" ON "indicator_values" USING btree ("org_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "indicators_org_name_key" ON "indicators" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE INDEX "indicators_org_order_idx" ON "indicators" USING btree ("org_id","sort_order");--> statement-breakpoint
CREATE POLICY "indicator_months_isolation" ON "indicator_months" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("indicator_months"."org_id" = app.current_org_id()) WITH CHECK ("indicator_months"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "indicator_targets_isolation" ON "indicator_targets" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("indicator_targets"."org_id" = app.current_org_id()) WITH CHECK ("indicator_targets"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "indicator_values_isolation" ON "indicator_values" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("indicator_values"."org_id" = app.current_org_id()) WITH CHECK ("indicator_values"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "indicators_isolation" ON "indicators" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("indicators"."org_id" = app.current_org_id()) WITH CHECK ("indicators"."org_id" = app.current_org_id());