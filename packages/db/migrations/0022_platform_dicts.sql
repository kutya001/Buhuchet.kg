CREATE TABLE "authorities" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hours" text DEFAULT '' NOT NULL,
	"site" text DEFAULT '' NOT NULL,
	"contacts_note" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "authorities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "production_calendar" (
	"day" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "production_calendar_day_check" CHECK ("production_calendar"."day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or ("production_calendar"."day" ~ '^[0-9]{2}-[0-9]{2}$' and "production_calendar"."kind" = 'holiday')),
	CONSTRAINT "production_calendar_kind_check" CHECK ("production_calendar"."kind" in ('holiday', 'transfer', 'workday'))
);
--> statement-breakpoint
ALTER TABLE "production_calendar" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_bases" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_bases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_type_bases" (
	"report_type_code" text NOT NULL,
	"base_code" text NOT NULL,
	CONSTRAINT "report_type_bases_report_type_code_base_code_pk" PRIMARY KEY("report_type_code","base_code")
);
--> statement-breakpoint
ALTER TABLE "report_type_bases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_type_regimes" (
	"report_type_code" text NOT NULL,
	"regime_code" text NOT NULL,
	"relation" text NOT NULL,
	CONSTRAINT "report_type_regimes_report_type_code_regime_code_pk" PRIMARY KEY("report_type_code","regime_code"),
	CONSTRAINT "report_type_regimes_relation_check" CHECK ("report_type_regimes"."relation" in ('applies', 'excludes'))
);
--> statement-breakpoint
ALTER TABLE "report_type_regimes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_types" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"form_code" text DEFAULT '' NOT NULL,
	"stat_index" text DEFAULT '' NOT NULL,
	"respondents" text DEFAULT '' NOT NULL,
	"authority_code" text NOT NULL,
	"period" text NOT NULL,
	"due_day" smallint NOT NULL,
	"due_after" smallint,
	"due_month" smallint,
	"due_from" text DEFAULT 'end' NOT NULL,
	"pay_day" smallint,
	"pay_after" smallint,
	"pay_month" smallint,
	"pay_schedule" jsonb,
	"shift_to_workday" boolean DEFAULT true NOT NULL,
	"skip_quarters" smallint[] DEFAULT '{}' NOT NULL,
	"one_off" boolean DEFAULT false NOT NULL,
	"event_label" text DEFAULT '' NOT NULL,
	"period_per_assignment" boolean DEFAULT false NOT NULL,
	"act" text NOT NULL,
	"payments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kind" text NOT NULL,
	"payer" text NOT NULL,
	"rates" text[] DEFAULT '{}' NOT NULL,
	"rate_additions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"not_for_en_rates" text[] DEFAULT '{}' NOT NULL,
	"biz_sizes" text[] DEFAULT '{}' NOT NULL,
	"pick_group" text NOT NULL,
	"preselect" boolean DEFAULT true NOT NULL,
	"choice_note" text DEFAULT '' NOT NULL,
	"pick_hint" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"client_note" text DEFAULT '' NOT NULL,
	"article" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"verify" boolean DEFAULT false NOT NULL,
	"verify_note" text DEFAULT '' NOT NULL,
	"gns_checked_at" date,
	"gns_checked_by" text DEFAULT '' NOT NULL,
	"gked" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "report_types_period_check" CHECK ("report_types"."period" in ('M', 'Q', 'H', 'Y')),
	CONSTRAINT "report_types_due_from_check" CHECK ("report_types"."due_from" in ('end', 'start')),
	CONSTRAINT "report_types_act_check" CHECK ("report_types"."act" in ('sub', 'pay', 'both')),
	CONSTRAINT "report_types_kind_check" CHECK ("report_types"."kind" in ('regime', 'cross', 'internal')),
	CONSTRAINT "report_types_payer_check" CHECK ("report_types"."payer" in ('org', 'ip', 'all')),
	CONSTRAINT "report_types_pick_group_check" CHECK ("report_types"."pick_group" in ('regime', 'status', 'basis', 'all', 'optional', 'disabled')),
	CONSTRAINT "report_types_biz_sizes_check" CHECK ("report_types"."biz_sizes" <@ array['small', 'medium', 'large']::text[]),
	CONSTRAINT "report_types_rule_check" CHECK ("report_types"."due_day" >= 1 and ("report_types"."due_after" is null or "report_types"."due_after" between 0 and 12)
        and ("report_types"."due_month" is null or "report_types"."due_month" between 1 and 12)
        and ("report_types"."pay_day" is null or "report_types"."pay_day" between 1 and 31)
        and ("report_types"."pay_after" is null or "report_types"."pay_after" between 0 and 12)
        and ("report_types"."pay_month" is null or "report_types"."pay_month" between 1 and 12)
        and "report_types"."skip_quarters" <@ array[1, 2, 3, 4]::smallint[])
);
--> statement-breakpoint
ALTER TABLE "report_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_benefit_due_rules" (
	"benefit_code" text NOT NULL,
	"report_type_code" text NOT NULL,
	"due_day" smallint,
	"due_after" smallint,
	"due_month" smallint,
	"pay_day" smallint,
	"pay_after" smallint,
	CONSTRAINT "tax_benefit_due_rules_benefit_code_report_type_code_pk" PRIMARY KEY("benefit_code","report_type_code"),
	CONSTRAINT "tax_benefit_due_rules_rule_check" CHECK (("tax_benefit_due_rules"."due_day" is null or "tax_benefit_due_rules"."due_day" between 1 and 31)
        and ("tax_benefit_due_rules"."due_after" is null or "tax_benefit_due_rules"."due_after" between 0 and 12)
        and ("tax_benefit_due_rules"."due_month" is null or "tax_benefit_due_rules"."due_month" between 1 and 12)
        and ("tax_benefit_due_rules"."pay_day" is null or "tax_benefit_due_rules"."pay_day" between 1 and 31)
        and ("tax_benefit_due_rules"."pay_after" is null or "tax_benefit_due_rules"."pay_after" between 0 and 12))
);
--> statement-breakpoint
ALTER TABLE "tax_benefit_due_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_benefit_offices" (
	"benefit_code" text NOT NULL,
	"tax_office_code" text NOT NULL,
	CONSTRAINT "tax_benefit_offices_benefit_code_tax_office_code_pk" PRIMARY KEY("benefit_code","tax_office_code")
);
--> statement-breakpoint
ALTER TABLE "tax_benefit_offices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_benefit_report_types" (
	"benefit_code" text NOT NULL,
	"report_type_code" text NOT NULL,
	"effect" text NOT NULL,
	CONSTRAINT "tax_benefit_report_types_benefit_code_report_type_code_pk" PRIMARY KEY("benefit_code","report_type_code"),
	CONSTRAINT "tax_benefit_report_types_effect_check" CHECK ("tax_benefit_report_types"."effect" in ('adds', 'removes'))
);
--> statement-breakpoint
ALTER TABLE "tax_benefit_report_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_benefits" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'benefit' NOT NULL,
	"gives" text DEFAULT '' NOT NULL,
	"article" text DEFAULT '' NOT NULL,
	"payer" text NOT NULL,
	"conditions" text DEFAULT '' NOT NULL,
	"confirmation" text DEFAULT '' NOT NULL,
	"combines" text DEFAULT '' NOT NULL,
	"term" text DEFAULT '' NOT NULL,
	"valid_until" date,
	"verify" boolean DEFAULT false NOT NULL,
	"verify_note" text DEFAULT '' NOT NULL,
	"gked" jsonb,
	"gked_main_only" boolean DEFAULT false NOT NULL,
	"tax_code" text DEFAULT '' NOT NULL,
	"suggest" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tax_benefits_kind_check" CHECK ("tax_benefits"."kind" in ('benefit', 'status')),
	CONSTRAINT "tax_benefits_payer_check" CHECK ("tax_benefits"."payer" in ('org', 'ip', 'all'))
);
--> statement-breakpoint
ALTER TABLE "tax_benefits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_offices" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"gns_code" text,
	"region" text DEFAULT '' NOT NULL,
	"verify" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tax_offices_gns_code_check" CHECK ("tax_offices"."gns_code" is null or "tax_offices"."gns_code" ~ '^[0-9]{3}$')
);
--> statement-breakpoint
ALTER TABLE "tax_offices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_regimes" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"kind" text NOT NULL,
	"frees" text DEFAULT '' NOT NULL,
	"who" text DEFAULT '' NOT NULL,
	"how" text DEFAULT '' NOT NULL,
	"combines" text DEFAULT '' NOT NULL,
	"accountant_note" text DEFAULT '' NOT NULL,
	"article" text DEFAULT '' NOT NULL,
	"gked" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tax_regimes_kind_check" CHECK ("tax_regimes"."kind" in ('general', 'special'))
);
--> statement-breakpoint
ALTER TABLE "tax_regimes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "authorities" ADD CONSTRAINT "authorities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorities" ADD CONSTRAINT "authorities_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_calendar" ADD CONSTRAINT "production_calendar_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_calendar" ADD CONSTRAINT "production_calendar_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_bases" ADD CONSTRAINT "report_bases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_bases" ADD CONSTRAINT "report_bases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_type_bases" ADD CONSTRAINT "report_type_bases_report_type_code_report_types_code_fk" FOREIGN KEY ("report_type_code") REFERENCES "public"."report_types"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_type_bases" ADD CONSTRAINT "report_type_bases_base_code_report_bases_code_fk" FOREIGN KEY ("base_code") REFERENCES "public"."report_bases"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_type_regimes" ADD CONSTRAINT "report_type_regimes_report_type_code_report_types_code_fk" FOREIGN KEY ("report_type_code") REFERENCES "public"."report_types"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_type_regimes" ADD CONSTRAINT "report_type_regimes_regime_code_tax_regimes_code_fk" FOREIGN KEY ("regime_code") REFERENCES "public"."tax_regimes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_types" ADD CONSTRAINT "report_types_authority_code_authorities_code_fk" FOREIGN KEY ("authority_code") REFERENCES "public"."authorities"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_types" ADD CONSTRAINT "report_types_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_types" ADD CONSTRAINT "report_types_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_benefit_due_rules" ADD CONSTRAINT "tax_benefit_due_rules_benefit_code_tax_benefits_code_fk" FOREIGN KEY ("benefit_code") REFERENCES "public"."tax_benefits"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_benefit_due_rules" ADD CONSTRAINT "tax_benefit_due_rules_report_type_code_report_types_code_fk" FOREIGN KEY ("report_type_code") REFERENCES "public"."report_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_benefit_offices" ADD CONSTRAINT "tax_benefit_offices_benefit_code_tax_benefits_code_fk" FOREIGN KEY ("benefit_code") REFERENCES "public"."tax_benefits"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_benefit_offices" ADD CONSTRAINT "tax_benefit_offices_tax_office_code_tax_offices_code_fk" FOREIGN KEY ("tax_office_code") REFERENCES "public"."tax_offices"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_benefit_report_types" ADD CONSTRAINT "tax_benefit_report_types_benefit_code_tax_benefits_code_fk" FOREIGN KEY ("benefit_code") REFERENCES "public"."tax_benefits"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_benefit_report_types" ADD CONSTRAINT "tax_benefit_report_types_report_type_code_report_types_code_fk" FOREIGN KEY ("report_type_code") REFERENCES "public"."report_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_benefits" ADD CONSTRAINT "tax_benefits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_benefits" ADD CONSTRAINT "tax_benefits_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_offices" ADD CONSTRAINT "tax_offices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_offices" ADD CONSTRAINT "tax_offices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_regimes" ADD CONSTRAINT "tax_regimes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_regimes" ADD CONSTRAINT "tax_regimes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authorities_name_key" ON "authorities" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "report_bases_name_key" ON "report_bases" USING btree ("name");--> statement-breakpoint
CREATE INDEX "report_type_bases_base_idx" ON "report_type_bases" USING btree ("base_code");--> statement-breakpoint
CREATE INDEX "report_type_regimes_regime_idx" ON "report_type_regimes" USING btree ("regime_code");--> statement-breakpoint
CREATE INDEX "report_types_authority_idx" ON "report_types" USING btree ("authority_code");--> statement-breakpoint
CREATE INDEX "tax_benefit_offices_office_idx" ON "tax_benefit_offices" USING btree ("tax_office_code");--> statement-breakpoint
CREATE INDEX "tax_benefit_report_types_type_idx" ON "tax_benefit_report_types" USING btree ("report_type_code");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_benefits_name_key" ON "tax_benefits" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_offices_gns_code_key" ON "tax_offices" USING btree ("gns_code") WHERE "tax_offices"."gns_code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_regimes_name_key" ON "tax_regimes" USING btree ("name");--> statement-breakpoint
CREATE POLICY "authorities_read" ON "authorities" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "production_calendar_read" ON "production_calendar" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "report_bases_read" ON "report_bases" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "report_type_bases_read" ON "report_type_bases" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "report_type_regimes_read" ON "report_type_regimes" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "report_types_read" ON "report_types" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "tax_benefit_due_rules_read" ON "tax_benefit_due_rules" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "tax_benefit_offices_read" ON "tax_benefit_offices" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "tax_benefit_report_types_read" ON "tax_benefit_report_types" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "tax_benefits_read" ON "tax_benefits" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "tax_offices_read" ON "tax_offices" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "tax_regimes_read" ON "tax_regimes" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);