CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"contractor_id" uuid NOT NULL,
	"report_type_code" text NOT NULL,
	"from_month" date NOT NULL,
	"until_month" date,
	"ended_on" date,
	"responsible_employee_id" uuid,
	"rate" text,
	"en_rates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rate_additions" text[] DEFAULT '{}' NOT NULL,
	"due_day" smallint,
	"own_period" text,
	"own_day" smallint,
	"own_month" smallint,
	"fixed_amount" bigint,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "assignments_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "assignments_from_check" CHECK ("assignments"."from_month" = date_trunc('month', "assignments"."from_month")::date),
	CONSTRAINT "assignments_until_check" CHECK ("assignments"."until_month" is null or ("assignments"."until_month" = date_trunc('month', "assignments"."until_month")::date and "assignments"."until_month" >= "assignments"."from_month")),
	CONSTRAINT "assignments_due_day_check" CHECK ("assignments"."due_day" is null or "assignments"."due_day" in (10, 15, 20, 25, 31)),
	CONSTRAINT "assignments_own_check" CHECK (("assignments"."own_period" is null and "assignments"."own_day" is null and "assignments"."own_month" is null) or ("assignments"."own_period" in ('M', 'Q', 'H', 'Y') and "assignments"."own_day" between 1 and 31 and "assignments"."own_month" between case when "assignments"."own_period" = 'Y' then 1 else 0 end and 12)),
	CONSTRAINT "assignments_en_rates_check" CHECK (jsonb_typeof("assignments"."en_rates") = 'array'),
	CONSTRAINT "assignments_fixed_check" CHECK ("assignments"."fixed_amount" is null or "assignments"."fixed_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_due_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"report_id" uuid NOT NULL,
	"from_due" date,
	"to_due" date NOT NULL,
	"reason_code" text NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_by" uuid DEFAULT app.current_user_id(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_due_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"contractor_id" uuid NOT NULL,
	"report_type_code" text NOT NULL,
	"assignment_id" uuid,
	"period" text NOT NULL,
	"period_start" date NOT NULL,
	"event_date" date,
	"act" text NOT NULL,
	"revision" smallint DEFAULT 0 NOT NULL,
	"superseded" boolean DEFAULT false NOT NULL,
	"due_base" date NOT NULL,
	"due_date" date NOT NULL,
	"due_manual" boolean DEFAULT false NOT NULL,
	"pay_due" date,
	"status" text DEFAULT 'todo' NOT NULL,
	"submitted_on" date,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"confirm_note" text DEFAULT '' NOT NULL,
	"amount" bigint,
	"amount_auto" boolean DEFAULT false NOT NULL,
	"responsible_employee_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "reports_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "reports_period_key" UNIQUE NULLS NOT DISTINCT("org_id","contractor_id","report_type_code","period_start","event_date","revision"),
	CONSTRAINT "reports_period_check" CHECK ("reports"."period" in ('M', 'Q', 'H', 'Y')),
	CONSTRAINT "reports_period_start_check" CHECK ("reports"."period_start" = date_trunc('month', "reports"."period_start")::date),
	CONSTRAINT "reports_event_check" CHECK ("reports"."event_date" is null or date_trunc('month', "reports"."event_date")::date = "reports"."period_start"),
	CONSTRAINT "reports_revision_check" CHECK ("reports"."revision" >= 0),
	CONSTRAINT "reports_act_check" CHECK ("reports"."act" in ('sub', 'pay', 'both')),
	CONSTRAINT "reports_status_check" CHECK ("reports"."status" in ('todo', 'in_progress', 'submitted', 'needs_fix', 'not_required')),
	CONSTRAINT "reports_amount_check" CHECK ("reports"."amount" is null or "reports"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_report_type_code_report_types_code_fk" FOREIGN KEY ("report_type_code") REFERENCES "public"."report_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_responsible_fk" FOREIGN KEY ("responsible_employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_due_changes" ADD CONSTRAINT "report_due_changes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_due_changes" ADD CONSTRAINT "report_due_changes_reason_code_due_change_reasons_code_fk" FOREIGN KEY ("reason_code") REFERENCES "public"."due_change_reasons"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_due_changes" ADD CONSTRAINT "report_due_changes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_due_changes" ADD CONSTRAINT "report_due_changes_report_fk" FOREIGN KEY ("report_id","org_id") REFERENCES "public"."reports"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_report_type_code_report_types_code_fk" FOREIGN KEY ("report_type_code") REFERENCES "public"."report_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_assignment_fk" FOREIGN KEY ("assignment_id","org_id") REFERENCES "public"."assignments"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_responsible_fk" FOREIGN KEY ("responsible_employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_active_key" ON "assignments" USING btree ("org_id","contractor_id","report_type_code") WHERE "assignments"."ended_on" is null;--> statement-breakpoint
CREATE INDEX "assignments_type_idx" ON "assignments" USING btree ("org_id","report_type_code");--> statement-breakpoint
CREATE INDEX "report_due_changes_report_idx" ON "report_due_changes" USING btree ("org_id","report_id","created_at");--> statement-breakpoint
CREATE INDEX "reports_due_idx" ON "reports" USING btree ("org_id","due_date");--> statement-breakpoint
CREATE INDEX "reports_contractor_idx" ON "reports" USING btree ("org_id","contractor_id","report_type_code");--> statement-breakpoint
CREATE INDEX "reports_responsible_idx" ON "reports" USING btree ("org_id","responsible_employee_id");--> statement-breakpoint
CREATE POLICY "assignments_isolation" ON "assignments" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("assignments"."org_id" = app.current_org_id()) WITH CHECK ("assignments"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "report_due_changes_isolation" ON "report_due_changes" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("report_due_changes"."org_id" = app.current_org_id()) WITH CHECK ("report_due_changes"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "reports_isolation" ON "reports" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("reports"."org_id" = app.current_org_id()) WITH CHECK ("reports"."org_id" = app.current_org_id());