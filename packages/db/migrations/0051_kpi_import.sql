CREATE TABLE "indicator_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"from_month" text,
	"to_month" text,
	"added" integer NOT NULL,
	"changed" integer NOT NULL,
	"errors" integer NOT NULL,
	"skipped_checked" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indicator_imports_from_check" CHECK ("indicator_imports"."from_month" is null or "indicator_imports"."from_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "indicator_imports_to_check" CHECK ("indicator_imports"."to_month" is null or "indicator_imports"."to_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "indicator_imports_file_check" CHECK (char_length("indicator_imports"."file_name") between 1 and 255),
	CONSTRAINT "indicator_imports_counts_check" CHECK ("indicator_imports"."added" >= 0 and "indicator_imports"."changed" >= 0 and "indicator_imports"."errors" >= 0 and "indicator_imports"."skipped_checked" >= 0)
);
--> statement-breakpoint
ALTER TABLE "indicator_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "indicator_imports" ADD CONSTRAINT "indicator_imports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_imports" ADD CONSTRAINT "indicator_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "indicator_imports_org_idx" ON "indicator_imports" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE POLICY "indicator_imports_isolation" ON "indicator_imports" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("indicator_imports"."org_id" = app.current_org_id()) WITH CHECK ("indicator_imports"."org_id" = app.current_org_id());