CREATE TABLE "contractor_bases" (
	"org_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"base_code" text NOT NULL,
	CONSTRAINT "contractor_bases_contractor_id_base_code_pk" PRIMARY KEY("contractor_id","base_code")
);
--> statement-breakpoint
ALTER TABLE "contractor_bases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contractor_benefits" (
	"org_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"benefit_code" text NOT NULL,
	"valid_from" date,
	"valid_to" date,
	CONSTRAINT "contractor_benefits_contractor_id_benefit_code_pk" PRIMARY KEY("contractor_id","benefit_code"),
	CONSTRAINT "contractor_benefits_dates_check" CHECK ("contractor_benefits"."valid_from" is null or "contractor_benefits"."valid_to" is null or "contractor_benefits"."valid_to" >= "contractor_benefits"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "contractor_benefits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contractor_gked_extra" (
	"org_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"gked" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "contractor_gked_extra_contractor_id_gked_pk" PRIMARY KEY("contractor_id","gked")
);
--> statement-breakpoint
ALTER TABLE "contractor_gked_extra" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contractor_tariffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"period" text DEFAULT 'M' NOT NULL,
	"valid_from" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contractor_tariffs_amount_check" CHECK ("contractor_tariffs"."amount" >= 0),
	CONSTRAINT "contractor_tariffs_period_check" CHECK ("contractor_tariffs"."period" in ('M', 'Y')),
	CONSTRAINT "contractor_tariffs_month_check" CHECK ("contractor_tariffs"."valid_from" = date_trunc('month', "contractor_tariffs"."valid_from")::date)
);
--> statement-breakpoint
ALTER TABLE "contractor_tariffs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contractors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"inn" text NOT NULL,
	"phone" text NOT NULL,
	"kind" text DEFAULT 'regular' NOT NULL,
	"form_code" text NOT NULL,
	"regime_code" text,
	"regime2_code" text,
	"gked" text,
	"tax_office_code" text,
	"biz_size" text DEFAULT 'small' NOT NULL,
	"responsible_employee_id" uuid,
	"head" text DEFAULT '' NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"contract_no" text DEFAULT '' NOT NULL,
	"contract_date" date,
	"note" text DEFAULT '' NOT NULL,
	"registration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"start_date" date NOT NULL,
	"first_month_mode" text DEFAULT 'full' NOT NULL,
	"fee_day" smallint DEFAULT 10 NOT NULL,
	"pays_to" text DEFAULT 'emp' NOT NULL,
	"service_status" text DEFAULT 'active' NOT NULL,
	"gked_confirmation" jsonb,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contractors_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "contractors_inn_check" CHECK ("contractors"."inn" ~ '^[0-9]{14}$'),
	CONSTRAINT "contractors_kind_check" CHECK ("contractors"."kind" in ('regular', 'oneoff')),
	CONSTRAINT "contractors_biz_size_check" CHECK ("contractors"."biz_size" in ('small', 'medium', 'large')),
	CONSTRAINT "contractors_first_month_check" CHECK ("contractors"."first_month_mode" in ('prorate', 'full', 'next')),
	CONSTRAINT "contractors_pays_to_check" CHECK ("contractors"."pays_to" in ('emp', 'org')),
	CONSTRAINT "contractors_service_check" CHECK ("contractors"."service_status" in ('active', 'paused', 'archived')),
	CONSTRAINT "contractors_fee_day_check" CHECK ("contractors"."fee_day" between 1 and 28),
	CONSTRAINT "contractors_regime2_check" CHECK ("contractors"."regime2_code" is null or ("contractors"."regime_code" is not null and "contractors"."regime2_code" <> "contractors"."regime_code"))
);
--> statement-breakpoint
ALTER TABLE "contractors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contractor_bases" ADD CONSTRAINT "contractor_bases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_bases" ADD CONSTRAINT "contractor_bases_base_code_report_bases_code_fk" FOREIGN KEY ("base_code") REFERENCES "public"."report_bases"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_bases" ADD CONSTRAINT "contractor_bases_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_benefits" ADD CONSTRAINT "contractor_benefits_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_benefits" ADD CONSTRAINT "contractor_benefits_benefit_code_tax_benefits_code_fk" FOREIGN KEY ("benefit_code") REFERENCES "public"."tax_benefits"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_benefits" ADD CONSTRAINT "contractor_benefits_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_gked_extra" ADD CONSTRAINT "contractor_gked_extra_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_gked_extra" ADD CONSTRAINT "contractor_gked_extra_gked_gked_items_code_fk" FOREIGN KEY ("gked") REFERENCES "public"."gked_items"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_gked_extra" ADD CONSTRAINT "contractor_gked_extra_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_tariffs" ADD CONSTRAINT "contractor_tariffs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_tariffs" ADD CONSTRAINT "contractor_tariffs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_tariffs" ADD CONSTRAINT "contractor_tariffs_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_form_code_ownership_forms_code_fk" FOREIGN KEY ("form_code") REFERENCES "public"."ownership_forms"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_regime_code_tax_regimes_code_fk" FOREIGN KEY ("regime_code") REFERENCES "public"."tax_regimes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_regime2_code_tax_regimes_code_fk" FOREIGN KEY ("regime2_code") REFERENCES "public"."tax_regimes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_gked_gked_items_code_fk" FOREIGN KEY ("gked") REFERENCES "public"."gked_items"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_tax_office_code_tax_offices_code_fk" FOREIGN KEY ("tax_office_code") REFERENCES "public"."tax_offices"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_responsible_fk" FOREIGN KEY ("responsible_employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contractor_bases_code_idx" ON "contractor_bases" USING btree ("base_code");--> statement-breakpoint
CREATE INDEX "contractor_benefits_code_idx" ON "contractor_benefits" USING btree ("benefit_code");--> statement-breakpoint
CREATE INDEX "contractor_gked_extra_code_idx" ON "contractor_gked_extra" USING btree ("org_id","gked");--> statement-breakpoint
CREATE INDEX "contractor_tariffs_contractor_idx" ON "contractor_tariffs" USING btree ("org_id","contractor_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "contractors_org_inn_key" ON "contractors" USING btree ("org_id","inn");--> statement-breakpoint
CREATE INDEX "contractors_responsible_idx" ON "contractors" USING btree ("org_id","responsible_employee_id");--> statement-breakpoint
CREATE INDEX "contractors_service_idx" ON "contractors" USING btree ("org_id","service_status");--> statement-breakpoint
CREATE POLICY "contractor_bases_isolation" ON "contractor_bases" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("contractor_bases"."org_id" = app.current_org_id()) WITH CHECK ("contractor_bases"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "contractor_benefits_isolation" ON "contractor_benefits" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("contractor_benefits"."org_id" = app.current_org_id()) WITH CHECK ("contractor_benefits"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "contractor_gked_extra_isolation" ON "contractor_gked_extra" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("contractor_gked_extra"."org_id" = app.current_org_id()) WITH CHECK ("contractor_gked_extra"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "contractor_tariffs_isolation" ON "contractor_tariffs" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("contractor_tariffs"."org_id" = app.current_org_id()) WITH CHECK ("contractor_tariffs"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "contractors_isolation" ON "contractors" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("contractors"."org_id" = app.current_org_id()) WITH CHECK ("contractors"."org_id" = app.current_org_id());