CREATE TABLE "contractor_service_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"from_month" date NOT NULL,
	"to_month" date,
	"pause_reason" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contractor_service_periods_from_key" UNIQUE("contractor_id","from_month"),
	CONSTRAINT "contractor_service_periods_month_check" CHECK ("contractor_service_periods"."from_month" = date_trunc('month', "contractor_service_periods"."from_month")::date and ("contractor_service_periods"."to_month" is null or ("contractor_service_periods"."to_month" = date_trunc('month', "contractor_service_periods"."to_month")::date and "contractor_service_periods"."to_month" >= "contractor_service_periods"."from_month"))),
	CONSTRAINT "contractor_service_periods_reason_check" CHECK (char_length("contractor_service_periods"."pause_reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "contractor_service_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "status_history" ADD COLUMN "cause" text;--> statement-breakpoint
ALTER TABLE "contractor_service_periods" ADD CONSTRAINT "contractor_service_periods_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_service_periods" ADD CONSTRAINT "contractor_service_periods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_service_periods" ADD CONSTRAINT "contractor_service_periods_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contractor_service_periods_open_key" ON "contractor_service_periods" USING btree ("contractor_id") WHERE "contractor_service_periods"."to_month" is null;--> statement-breakpoint
CREATE INDEX "contractor_service_periods_org_idx" ON "contractor_service_periods" USING btree ("org_id","contractor_id");--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_cause_check" CHECK ("status_history"."cause" is null or "status_history"."cause" in ('service'));--> statement-breakpoint
CREATE POLICY "contractor_service_periods_isolation" ON "contractor_service_periods" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("contractor_service_periods"."org_id" = app.current_org_id()) WITH CHECK ("contractor_service_periods"."org_id" = app.current_org_id());