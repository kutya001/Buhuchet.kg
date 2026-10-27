CREATE TABLE "banks" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"by_phone" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "banks_kind_check" CHECK ("banks"."kind" in ('bank', 'wallet'))
);
--> statement-breakpoint
ALTER TABLE "banks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"bank_code" text,
	"account_no" text,
	"phone" text,
	"phone_banks" text[] DEFAULT '{}' NOT NULL,
	"holder_name" text DEFAULT '' NOT NULL,
	"is_main" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "employee_wallets_kind_check" CHECK ("employee_wallets"."kind" in ('acc', 'phone')),
	CONSTRAINT "employee_wallets_fields_check" CHECK (("employee_wallets"."kind" = 'acc' and "employee_wallets"."bank_code" is not null and "employee_wallets"."account_no" is not null and "employee_wallets"."phone" is null and cardinality("employee_wallets"."phone_banks") = 0) or ("employee_wallets"."kind" = 'phone' and "employee_wallets"."phone" ~ '^[+][0-9]{6,15}$' and cardinality("employee_wallets"."phone_banks") between 1 and 50 and "employee_wallets"."bank_code" is null and "employee_wallets"."account_no" is null)),
	CONSTRAINT "employee_wallets_length_check" CHECK (length(coalesce("employee_wallets"."account_no", '')) <= 40 and length("employee_wallets"."holder_name") <= 200)
);
--> statement-breakpoint
ALTER TABLE "employee_wallets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "org_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"bank_code" text,
	"account_no" text,
	"bik" text,
	"phone" text,
	"phone_banks" text[] DEFAULT '{}' NOT NULL,
	"holder_name" text DEFAULT '' NOT NULL,
	"purpose" text DEFAULT 'both' NOT NULL,
	"main_tax" boolean DEFAULT false NOT NULL,
	"main_fee" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "org_accounts_kind_check" CHECK ("org_accounts"."kind" in ('acc', 'phone')),
	CONSTRAINT "org_accounts_purpose_check" CHECK ("org_accounts"."purpose" in ('both', 'tax', 'fee')),
	CONSTRAINT "org_accounts_fields_check" CHECK (("org_accounts"."kind" = 'acc' and "org_accounts"."bank_code" is not null and "org_accounts"."account_no" is not null and "org_accounts"."bik" ~ '^[0-9]{6}$' and "org_accounts"."phone" is null and cardinality("org_accounts"."phone_banks") = 0) or ("org_accounts"."kind" = 'phone' and "org_accounts"."phone" ~ '^[+][0-9]{6,15}$' and cardinality("org_accounts"."phone_banks") between 1 and 50 and "org_accounts"."bank_code" is null and "org_accounts"."account_no" is null and "org_accounts"."bik" is null)),
	CONSTRAINT "org_accounts_main_check" CHECK ((not "org_accounts"."main_tax" or "org_accounts"."purpose" <> 'fee') and (not "org_accounts"."main_fee" or "org_accounts"."purpose" <> 'tax')),
	CONSTRAINT "org_accounts_length_check" CHECK (length(coalesce("org_accounts"."account_no", '')) <= 40 and length("org_accounts"."holder_name") <= 200)
);
--> statement-breakpoint
ALTER TABLE "org_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "banks" ADD CONSTRAINT "banks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banks" ADD CONSTRAINT "banks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_wallets" ADD CONSTRAINT "employee_wallets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_wallets" ADD CONSTRAINT "employee_wallets_bank_code_banks_code_fk" FOREIGN KEY ("bank_code") REFERENCES "public"."banks"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_wallets" ADD CONSTRAINT "employee_wallets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_wallets" ADD CONSTRAINT "employee_wallets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_wallets" ADD CONSTRAINT "employee_wallets_employee_fk" FOREIGN KEY ("employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_accounts" ADD CONSTRAINT "org_accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_accounts" ADD CONSTRAINT "org_accounts_bank_code_banks_code_fk" FOREIGN KEY ("bank_code") REFERENCES "public"."banks"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_accounts" ADD CONSTRAINT "org_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_accounts" ADD CONSTRAINT "org_accounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "banks_name_key" ON "banks" USING btree ("name");--> statement-breakpoint
CREATE INDEX "employee_wallets_employee_idx" ON "employee_wallets" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE INDEX "employee_wallets_org_idx" ON "employee_wallets" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_wallets_main_key" ON "employee_wallets" USING btree ("employee_id") WHERE "employee_wallets"."is_main";--> statement-breakpoint
CREATE INDEX "org_accounts_org_idx" ON "org_accounts" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org_accounts_main_tax_key" ON "org_accounts" USING btree ("org_id") WHERE "org_accounts"."main_tax";--> statement-breakpoint
CREATE UNIQUE INDEX "org_accounts_main_fee_key" ON "org_accounts" USING btree ("org_id") WHERE "org_accounts"."main_fee";--> statement-breakpoint
CREATE POLICY "banks_read" ON "banks" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "employee_wallets_isolation" ON "employee_wallets" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("employee_wallets"."org_id" = app.current_org_id()) WITH CHECK ("employee_wallets"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "employee_wallets_insert_own" ON "employee_wallets" AS RESTRICTIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("employee_wallets"."employee_id" in (select e.id from employees e where e.user_id = app.current_user_id()));--> statement-breakpoint
CREATE POLICY "employee_wallets_update_own" ON "employee_wallets" AS RESTRICTIVE FOR UPDATE TO "buhuchet_app" USING ("employee_wallets"."employee_id" in (select e.id from employees e where e.user_id = app.current_user_id())) WITH CHECK ("employee_wallets"."employee_id" in (select e.id from employees e where e.user_id = app.current_user_id()));--> statement-breakpoint
CREATE POLICY "employee_wallets_delete_own" ON "employee_wallets" AS RESTRICTIVE FOR DELETE TO "buhuchet_app" USING ("employee_wallets"."employee_id" in (select e.id from employees e where e.user_id = app.current_user_id()));--> statement-breakpoint
CREATE POLICY "org_accounts_isolation" ON "org_accounts" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("org_accounts"."org_id" = app.current_org_id()) WITH CHECK ("org_accounts"."org_id" = app.current_org_id());