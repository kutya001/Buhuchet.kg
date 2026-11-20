-- Общая основа пакета доработок 20.11.2026 и «Витрины данных» (этап 0, пункты П1–П5 общего плана;
-- docs/decisions.md п. О-61): подписки организаций (виды, цены и реквизиты, подписка, «История оплат»),
-- отложенное удаление файлов и сверка хранилища, «Витрина данных» (шаблоны, доступ, токены, журнал) и
-- «Внешний доступ по API»; ниже — ручная часть: права, проверки, функции «занято мест и памяти» и запуска
-- тарификации, просмотр файлов всех организаций для Админки, начальные виды подписок.
-- Блокировки таблиц ждём не дольше 10 с: если выпуск совпал с долгой транзакцией, миграция падает и
-- задание выпуска перезапускают, а не держит файлы и настройки, пока ждёт.
SET LOCAL lock_timeout = '10s';--> statement-breakpoint
CREATE TABLE "org_subscriptions" (
	"org_id" uuid PRIMARY KEY DEFAULT app.current_org_id() NOT NULL,
	"plan_id" text NOT NULL,
	"seats" integer NOT NULL,
	"extra_gb" integer DEFAULT 0 NOT NULL,
	"paid_until" date NOT NULL,
	"extra_discount_pct" integer DEFAULT 0 NOT NULL,
	"first_paid" boolean DEFAULT false NOT NULL,
	"free" boolean DEFAULT false NOT NULL,
	"next_seats" integer,
	"next_extra_gb" integer,
	"next_from" date,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "org_subscriptions_values_check" CHECK ("org_subscriptions"."seats" between 0 and 100000 and "org_subscriptions"."extra_gb" between 0 and 100000 and "org_subscriptions"."extra_discount_pct" between 0 and 100),
	CONSTRAINT "org_subscriptions_next_check" CHECK (("org_subscriptions"."next_from" is null) = ("org_subscriptions"."next_seats" is null and "org_subscriptions"."next_extra_gb" is null) and ("org_subscriptions"."next_seats" is null or "org_subscriptions"."next_seats" between 0 and 100000) and ("org_subscriptions"."next_extra_gb" is null or "org_subscriptions"."next_extra_gb" between 0 and 100000))
);
--> statement-breakpoint
ALTER TABLE "org_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"kind" text NOT NULL,
	"start_mode" text DEFAULT 'now' NOT NULL,
	"plan_id" text NOT NULL,
	"months" integer NOT NULL,
	"seats" integer NOT NULL,
	"extra_gb" integer DEFAULT 0 NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"receipt_key" text,
	"receipt_name" text,
	"receipt_type" text,
	"receipt_bytes" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"opens_access" boolean DEFAULT true NOT NULL,
	"reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"paid_until" date,
	"created_by" uuid DEFAULT app.current_user_id(),
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "subscription_payments_receipt_key_unique" UNIQUE("receipt_key"),
	CONSTRAINT "subscription_payments_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "subscription_payments_kind_check" CHECK ("subscription_payments"."kind" in ('renew', 'grow', 'mem', 'free', 'admin') and "subscription_payments"."start_mode" in ('now', 'next')),
	CONSTRAINT "subscription_payments_values_check" CHECK ("subscription_payments"."months" between 0 and 12 and "subscription_payments"."seats" between 0 and 100000 and "subscription_payments"."extra_gb" between 0 and 100000 and "subscription_payments"."amount" >= 0 and jsonb_typeof("subscription_payments"."lines") = 'array'),
	CONSTRAINT "subscription_payments_receipt_check" CHECK (("subscription_payments"."kind" in ('renew', 'grow', 'mem')) = ("subscription_payments"."receipt_key" is not null) and ("subscription_payments"."receipt_key" is null or ("subscription_payments"."receipt_key" = ('org/' || "subscription_payments"."org_id"::text || '/subs/' || "subscription_payments"."id"::text) and char_length(coalesce("subscription_payments"."receipt_name", '')) between 1 and 255 and "subscription_payments"."receipt_type" in ('application/pdf', 'image/jpeg', 'image/png') and "subscription_payments"."receipt_bytes" between 1 and 20971520))),
	CONSTRAINT "subscription_payments_status_check" CHECK ("subscription_payments"."status" in ('pending', 'confirmed', 'rejected') and ("subscription_payments"."status" = 'pending') = ("subscription_payments"."decided_at" is null) and ("subscription_payments"."status" <> 'confirmed' or "subscription_payments"."paid_until" is not null) and ("subscription_payments"."kind" in ('renew', 'grow', 'mem') or "subscription_payments"."status" = 'confirmed')),
	CONSTRAINT "subscription_payments_reason_check" CHECK (char_length(coalesce("subscription_payments"."reason", '')) <= 500 and (("subscription_payments"."status" <> 'rejected' and "subscription_payments"."kind" in ('renew', 'grow', 'mem')) or char_length(btrim(coalesce("subscription_payments"."reason", ''))) >= 1))
);
--> statement-breakpoint
ALTER TABLE "subscription_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"months" integer NOT NULL,
	"discount_pct" integer DEFAULT 0 NOT NULL,
	"perks" text[] DEFAULT '{}' NOT NULL,
	"sort_order" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "subscription_plans_id_check" CHECK ("subscription_plans"."id" ~ '^[a-z0-9_-]{1,40}$'),
	CONSTRAINT "subscription_plans_name_check" CHECK (char_length("subscription_plans"."name") between 1 and 100),
	CONSTRAINT "subscription_plans_values_check" CHECK ("subscription_plans"."months" between 1 and 12 and "subscription_plans"."discount_pct" between 0 and 99 and cardinality("subscription_plans"."perks") <= 10)
);
--> statement-breakpoint
ALTER TABLE "subscription_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"seat_price" bigint DEFAULT 10000 NOT NULL,
	"seat_step" integer DEFAULT 10 NOT NULL,
	"gb_price" bigint DEFAULT 10000 NOT NULL,
	"base_mb" integer DEFAULT 2000 NOT NULL,
	"seat_mb" integer DEFAULT 200 NOT NULL,
	"first_month_pct" integer DEFAULT 50 NOT NULL,
	"extra_discount_over" integer DEFAULT 150 NOT NULL,
	"remind_days" integer DEFAULT 7 NOT NULL,
	"check_days" integer DEFAULT 3 NOT NULL,
	"recipient" text,
	"recipient_inn" text,
	"bank" text,
	"bik" text,
	"account" text,
	"purpose" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "subscription_settings_single_check" CHECK ("subscription_settings"."id" = 1),
	CONSTRAINT "subscription_settings_values_check" CHECK ("subscription_settings"."seat_price" >= 0 and "subscription_settings"."gb_price" >= 0 and "subscription_settings"."seat_step" between 1 and 1000 and "subscription_settings"."base_mb" >= 0 and "subscription_settings"."seat_mb" >= 0 and "subscription_settings"."first_month_pct" between 0 and 100 and "subscription_settings"."extra_discount_over" >= 0 and "subscription_settings"."remind_days" between 1 and 60 and "subscription_settings"."check_days" between 1 and 30),
	CONSTRAINT "subscription_settings_text_check" CHECK (char_length(coalesce("subscription_settings"."recipient", '')) <= 200 and char_length(coalesce("subscription_settings"."recipient_inn", '')) <= 20 and char_length(coalesce("subscription_settings"."bank", '')) <= 200 and char_length(coalesce("subscription_settings"."bik", '')) <= 20 and char_length(coalesce("subscription_settings"."account", '')) <= 40 and char_length(coalesce("subscription_settings"."purpose", '')) <= 300)
);
--> statement-breakpoint
ALTER TABLE "subscription_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "file_trash" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id(),
	"why" text NOT NULL,
	"file_id" uuid,
	"storage_key" text NOT NULL,
	"contractor_id" uuid,
	"name" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"source" text,
	"deleted_by" uuid DEFAULT app.current_user_id(),
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"erase_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	"erased_at" timestamp with time zone,
	"restored_at" timestamp with time zone,
	"restored_by" uuid,
	CONSTRAINT "file_trash_fields_check" CHECK ("file_trash"."why" in ('del', 'rep', 'auto', 'extra') and ("file_trash"."why" = 'del') = ("file_trash"."file_id" is not null) and ("file_trash"."why" = 'extra' or "file_trash"."org_id" is not null) and char_length("file_trash"."name") between 1 and 255 and char_length("file_trash"."storage_key") between 1 and 300 and char_length(coalesce("file_trash"."source", '')) <= 100 and "file_trash"."size_bytes" >= 0),
	CONSTRAINT "file_trash_erase_check" CHECK ("file_trash"."erase_at" >= "file_trash"."deleted_at" + interval '24 hours'),
	CONSTRAINT "file_trash_restore_check" CHECK (("file_trash"."restored_at" is null) = ("file_trash"."restored_by" is null) and ("file_trash"."restored_at" is null or ("file_trash"."why" in ('del', 'extra') and "file_trash"."erased_at" is null)))
);
--> statement-breakpoint
ALTER TABLE "file_trash" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "storage_check_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "storage_check_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"key_org_id" uuid,
	"size_bytes" bigint,
	"object_at" timestamp with time zone,
	"first_run_id" bigint NOT NULL,
	"last_run_id" bigint NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "storage_check_items_kind_check" CHECK ("storage_check_items"."kind" in ('missing', 'extra', 'stuck', 'failed') and char_length("storage_check_items"."key") between 1 and 300 and ("storage_check_items"."size_bytes" is null or "storage_check_items"."size_bytes" >= 0))
);
--> statement-breakpoint
ALTER TABLE "storage_check_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "storage_check_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "storage_check_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"state" text DEFAULT 'running' NOT NULL,
	"objects" integer DEFAULT 0 NOT NULL,
	"missing" integer DEFAULT 0 NOT NULL,
	"extra" integer DEFAULT 0 NOT NULL,
	"stuck" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "storage_check_runs_state_check" CHECK ("storage_check_runs"."state" in ('running', 'done', 'failed') and ("storage_check_runs"."state" = 'running') = ("storage_check_runs"."finished_at" is null) and char_length(coalesce("storage_check_runs"."error", '')) <= 500),
	CONSTRAINT "storage_check_runs_counts_check" CHECK ("storage_check_runs"."objects" >= 0 and "storage_check_runs"."missing" >= 0 and "storage_check_runs"."extra" >= 0 and "storage_check_runs"."stuck" >= 0 and "storage_check_runs"."failed" >= 0)
);
--> statement-breakpoint
ALTER TABLE "storage_check_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dm_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dm_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"org_id" uuid,
	"token_id" uuid,
	"template_id" uuid,
	"user_id" uuid,
	"via" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer,
	"duration_ms" integer,
	"outcome" text NOT NULL,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dm_requests_fields_check" CHECK ("dm_requests"."via" in ('screen', 'api') and "dm_requests"."outcome" in ('ok', 'denied', 'bad_param', 'rate', 'timeout', 'broken', 'closed', 'error') and jsonb_typeof("dm_requests"."params") = 'object' and ("dm_requests"."row_count" is null or "dm_requests"."row_count" >= 0) and ("dm_requests"."duration_ms" is null or "dm_requests"."duration_ms" >= 0) and char_length(coalesce("dm_requests"."ip", '')) <= 64)
);
--> statement-breakpoint
ALTER TABLE "dm_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dm_template_orgs" (
	"template_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dm_template_orgs_pk" PRIMARY KEY("template_id","org_id")
);
--> statement-breakpoint
ALTER TABLE "dm_template_orgs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dm_template_sql" (
	"template_id" uuid PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dm_template_sql_query_check" CHECK (char_length("dm_template_sql"."query") between 1 and 20000)
);
--> statement-breakpoint
ALTER TABLE "dm_template_sql" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dm_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"audience" text DEFAULT 'org' NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"module" text NOT NULL,
	"need_permission" text,
	"access" text DEFAULT 'all' NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"copied_from" uuid,
	"checked_at" timestamp with time zone,
	"checked_org_id" uuid,
	"check_error" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "dm_templates_code_unique" UNIQUE("code"),
	CONSTRAINT "dm_templates_fields_check" CHECK ("dm_templates"."code" ~ '^[a-z0-9][a-z0-9-]{1,59}$' and char_length("dm_templates"."name") between 1 and 200 and char_length(coalesce("dm_templates"."description", '')) <= 2000 and char_length(coalesce("dm_templates"."check_error", '')) <= 2000 and ("dm_templates"."need_permission" is null or "dm_templates"."need_permission" ~ '^[A-Za-z]{1,40}$')),
	CONSTRAINT "dm_templates_enum_check" CHECK ("dm_templates"."audience" in ('org', 'admin') and "dm_templates"."access" in ('all', 'selected') and "dm_templates"."state" in ('draft', 'published', 'off', 'broken') and "dm_templates"."module" in ('cps', 'reports', 'fin', 'projects', 'kpi', 'staff')),
	CONSTRAINT "dm_templates_json_check" CHECK (jsonb_typeof("dm_templates"."params") = 'array' and jsonb_typeof("dm_templates"."columns") = 'array')
);
--> statement-breakpoint
ALTER TABLE "dm_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dm_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id(),
	"template_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"replaced_by" uuid,
	"grace_until" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_ip" text,
	"created_by" uuid DEFAULT app.current_user_id() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dm_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "dm_tokens_fields_check" CHECK (char_length("dm_tokens"."name") between 1 and 100 and "dm_tokens"."token_hash" ~ '^[0-9a-f]{64}$' and "dm_tokens"."prefix" ~ '^bk_[A-Za-z0-9]{4,8}$' and char_length(coalesce("dm_tokens"."last_ip", '')) <= 64),
	CONSTRAINT "dm_tokens_term_check" CHECK ("dm_tokens"."expires_at" > "dm_tokens"."created_at" and "dm_tokens"."expires_at" <= "dm_tokens"."created_at" + interval '180 days'),
	CONSTRAINT "dm_tokens_revoke_check" CHECK (("dm_tokens"."revoked_at" is null) = ("dm_tokens"."revoked_by" is null) and ("dm_tokens"."replaced_by" is null) = ("dm_tokens"."grace_until" is null))
);
--> statement-breakpoint
ALTER TABLE "dm_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "ext_api" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_settings" ADD CONSTRAINT "subscription_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_trash" ADD CONSTRAINT "file_trash_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_trash" ADD CONSTRAINT "file_trash_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_trash" ADD CONSTRAINT "file_trash_restored_by_users_id_fk" FOREIGN KEY ("restored_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_trash" ADD CONSTRAINT "file_trash_file_fk" FOREIGN KEY ("file_id","org_id") REFERENCES "public"."files"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_check_items" ADD CONSTRAINT "storage_check_items_first_run_id_storage_check_runs_id_fk" FOREIGN KEY ("first_run_id") REFERENCES "public"."storage_check_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_check_items" ADD CONSTRAINT "storage_check_items_last_run_id_storage_check_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."storage_check_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_requests" ADD CONSTRAINT "dm_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_requests" ADD CONSTRAINT "dm_requests_token_id_dm_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."dm_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_requests" ADD CONSTRAINT "dm_requests_template_id_dm_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."dm_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_requests" ADD CONSTRAINT "dm_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_template_orgs" ADD CONSTRAINT "dm_template_orgs_template_id_dm_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."dm_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_template_orgs" ADD CONSTRAINT "dm_template_orgs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_template_orgs" ADD CONSTRAINT "dm_template_orgs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_template_sql" ADD CONSTRAINT "dm_template_sql_template_id_dm_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."dm_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_template_sql" ADD CONSTRAINT "dm_template_sql_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_templates" ADD CONSTRAINT "dm_templates_checked_org_id_organizations_id_fk" FOREIGN KEY ("checked_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_templates" ADD CONSTRAINT "dm_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_templates" ADD CONSTRAINT "dm_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_tokens" ADD CONSTRAINT "dm_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_tokens" ADD CONSTRAINT "dm_tokens_template_id_dm_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."dm_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_tokens" ADD CONSTRAINT "dm_tokens_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_tokens" ADD CONSTRAINT "dm_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_subscriptions_paid_until_idx" ON "org_subscriptions" USING btree ("paid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payments_one_pending" ON "subscription_payments" USING btree ("org_id") WHERE "subscription_payments"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "subscription_payments_org_idx" ON "subscription_payments" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "subscription_payments_pending_idx" ON "subscription_payments" USING btree ("created_at") WHERE "subscription_payments"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "file_trash_live_key" ON "file_trash" USING btree ("storage_key") WHERE "file_trash"."erased_at" is null and "file_trash"."restored_at" is null;--> statement-breakpoint
CREATE INDEX "file_trash_erase_idx" ON "file_trash" USING btree ("erase_at") WHERE "file_trash"."erased_at" is null and "file_trash"."restored_at" is null;--> statement-breakpoint
CREATE INDEX "file_trash_org_idx" ON "file_trash" USING btree ("org_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_check_items_open_key" ON "storage_check_items" USING btree ("kind","key") WHERE "storage_check_items"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "storage_check_items_open_idx" ON "storage_check_items" USING btree ("kind","first_seen_at") WHERE "storage_check_items"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "storage_check_runs_started_idx" ON "storage_check_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dm_requests_org_idx" ON "dm_requests" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "dm_requests_token_idx" ON "dm_requests" USING btree ("token_id","at");--> statement-breakpoint
CREATE INDEX "dm_requests_at_idx" ON "dm_requests" USING btree ("at");--> statement-breakpoint
CREATE INDEX "dm_template_orgs_org_idx" ON "dm_template_orgs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "dm_templates_state_idx" ON "dm_templates" USING btree ("audience","state");--> statement-breakpoint
CREATE INDEX "dm_tokens_org_idx" ON "dm_tokens" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "dm_tokens_template_idx" ON "dm_tokens" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "files_usage_idx" ON "files" USING btree ("org_id","size_bytes") WHERE "files"."state" = 'ready';--> statement-breakpoint
CREATE POLICY "org_subscriptions_isolation" ON "org_subscriptions" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("org_subscriptions"."org_id" = app.current_org_id()) WITH CHECK ("org_subscriptions"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "org_subscriptions_admin_read" ON "org_subscriptions" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (app.current_org_id() is null and app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "org_subscriptions_admin_insert" ON "org_subscriptions" AS RESTRICTIVE FOR INSERT TO "buhuchet_app" WITH CHECK (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "org_subscriptions_admin_update" ON "org_subscriptions" AS RESTRICTIVE FOR UPDATE TO "buhuchet_app" USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "subscription_payments_isolation" ON "subscription_payments" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("subscription_payments"."org_id" = app.current_org_id()) WITH CHECK ("subscription_payments"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "subscription_payments_admin_read" ON "subscription_payments" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (app.current_org_id() is null and app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "subscription_payments_insert_guard" ON "subscription_payments" AS RESTRICTIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("subscription_payments"."created_by" = app.current_user_id() and (("subscription_payments"."status" = 'pending' and "subscription_payments"."kind" in ('renew', 'grow', 'mem') and not app.is_platform_admin()) or (app.is_platform_admin() and "subscription_payments"."kind" in ('free', 'admin') and "subscription_payments"."decided_by" = app.current_user_id())));--> statement-breakpoint
CREATE POLICY "subscription_payments_update_guard" ON "subscription_payments" AS RESTRICTIVE FOR UPDATE TO "buhuchet_app" USING ("subscription_payments"."status" = 'pending') WITH CHECK ("subscription_payments"."status" = 'pending' or (app.is_platform_admin() and "subscription_payments"."decided_by" = app.current_user_id()));--> statement-breakpoint
CREATE POLICY "subscription_plans_read" ON "subscription_plans" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "subscription_plans_admin_insert" ON "subscription_plans" AS PERMISSIVE FOR INSERT TO "buhuchet_app" WITH CHECK (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "subscription_plans_admin_update" ON "subscription_plans" AS PERMISSIVE FOR UPDATE TO "buhuchet_app" USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "subscription_plans_admin_delete" ON "subscription_plans" AS PERMISSIVE FOR DELETE TO "buhuchet_app" USING (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "subscription_settings_read" ON "subscription_settings" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "subscription_settings_admin_update" ON "subscription_settings" AS PERMISSIVE FOR UPDATE TO "buhuchet_app" USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "file_trash_isolation" ON "file_trash" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("file_trash"."org_id" = app.current_org_id()) WITH CHECK ("file_trash"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "file_trash_admin" ON "file_trash" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING (app.current_org_id() is null and app.is_platform_admin()) WITH CHECK (app.current_org_id() is null and app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "file_trash_insert_guard" ON "file_trash" AS RESTRICTIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("file_trash"."deleted_by" is not distinct from app.current_user_id() and "file_trash"."erased_at" is null and "file_trash"."restored_at" is null and ("file_trash"."why" <> 'extra' or app.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "file_trash_update_guard" ON "file_trash" AS RESTRICTIVE FOR UPDATE TO "buhuchet_app" USING (app.is_platform_admin() and "file_trash"."erased_at" is null and "file_trash"."restored_at" is null) WITH CHECK (app.is_platform_admin() and "file_trash"."restored_by" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "storage_check_items_admin_read" ON "storage_check_items" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "storage_check_runs_admin_read" ON "storage_check_runs" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "dm_requests_isolation" ON "dm_requests" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("dm_requests"."org_id" = app.current_org_id()) WITH CHECK ("dm_requests"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "dm_requests_admin_read" ON "dm_requests" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (app.current_org_id() is null and app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "dm_template_orgs_isolation" ON "dm_template_orgs" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("dm_template_orgs"."org_id" = app.current_org_id()) WITH CHECK ("dm_template_orgs"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "dm_template_orgs_admin" ON "dm_template_orgs" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "dm_template_orgs_admin_insert" ON "dm_template_orgs" AS RESTRICTIVE FOR INSERT TO "buhuchet_app" WITH CHECK (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "dm_template_orgs_admin_update" ON "dm_template_orgs" AS RESTRICTIVE FOR UPDATE TO "buhuchet_app" USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "dm_template_orgs_admin_delete" ON "dm_template_orgs" AS RESTRICTIVE FOR DELETE TO "buhuchet_app" USING (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "dm_template_sql_admin" ON "dm_template_sql" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "dm_templates_admin" ON "dm_templates" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "dm_templates_org_read" ON "dm_templates" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (app.current_org_id() is not null and "dm_templates"."audience" = 'org' and "dm_templates"."state" = 'published' and ("dm_templates"."access" = 'all' or exists (select 1 from public.dm_template_orgs o where o.template_id = "dm_templates"."id" and o.org_id = app.current_org_id())));--> statement-breakpoint
CREATE POLICY "dm_tokens_own_org" ON "dm_tokens" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("dm_tokens"."org_id" = app.current_org_id()) WITH CHECK ("dm_tokens"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "dm_tokens_admin" ON "dm_tokens" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING (app.current_org_id() is null and app.is_platform_admin()) WITH CHECK (app.current_org_id() is null and app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "dm_tokens_insert_guard" ON "dm_tokens" AS RESTRICTIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("dm_tokens"."created_by" = app.current_user_id() and "dm_tokens"."revoked_at" is null and "dm_tokens"."replaced_by" is null and (("dm_tokens"."org_id" is not null and not app.is_platform_admin()) or ("dm_tokens"."org_id" is null and app.is_platform_admin())));--> statement-breakpoint
CREATE POLICY "dm_tokens_update_guard" ON "dm_tokens" AS RESTRICTIVE FOR UPDATE TO "buhuchet_app" USING ("dm_tokens"."revoked_at" is null) WITH CHECK ("dm_tokens"."revoked_at" is null or "dm_tokens"."revoked_by" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "dm_tokens_no_delete" ON "dm_tokens" AS RESTRICTIVE FOR DELETE TO "buhuchet_app" USING (false);
--> statement-breakpoint
-- Ручная часть миграции (общая основа пакета доработок 20.11.2026 и «Витрины данных», этап 0).
-- Подписку организации и «Историю оплат» не удаляют; «Цены и реквизиты» — одна строка платформы.
REVOKE DELETE ON TABLE public.org_subscriptions FROM buhuchet_app;--> statement-breakpoint
REVOKE DELETE ON TABLE public.subscription_payments FROM buhuchet_app;--> statement-breakpoint
REVOKE INSERT, DELETE ON TABLE public.subscription_settings FROM buhuchet_app;--> statement-breakpoint
-- Сверку хранилища пишут функции задачи потока И (этап 1), журнал «Витрины» — исполнитель Витрины;
-- роль приложения их только читает (кто — решают политики). Токены не удаляются (журнал ссылается).
REVOKE INSERT, UPDATE, DELETE ON TABLE public.storage_check_runs FROM buhuchet_app;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON TABLE public.storage_check_items FROM buhuchet_app;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON TABLE public.dm_requests FROM buhuchet_app;--> statement-breakpoint
REVOKE DELETE ON TABLE public.dm_tokens FROM buhuchet_app;--> statement-breakpoint
-- «Ждут удаления»: строка остаётся и после стирания и «Вернуть» — это история файла.
REVOKE DELETE ON TABLE public.file_trash FROM buhuchet_app;--> statement-breakpoint
-- Открывает ли чек доступ до проверки, решает база (блок 4, пункт 6; прототип subPaySend): новый чек
-- после отклонения доступ заранее не открывает — если последняя проверенная заявка владельца отклонена.
-- Непроверенная заявка меняется только так (блок 5, пункт 5; блок 6, пункт 3): владелец заменяет файл
-- чека (ключ хранилища тот же — по номеру оплаты), администратор платформы решает — статус, кто и когда,
-- причина, «Оплачено до» и число месяцев (их можно поправить при подтверждении). Вид, пакет, память,
-- сумму и расчёт после отправки не меняет никто: их посчитал сервер в окне оплаты.
CREATE FUNCTION app.subscription_payments_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    free_cols text[];
  BEGIN
    IF TG_OP = 'INSERT' THEN
      NEW.opens_access := NEW.kind NOT IN ('renew', 'grow', 'mem') OR coalesce((
        SELECT p.status <> 'rejected' FROM public.subscription_payments p
        WHERE p.org_id = NEW.org_id AND p.kind IN ('renew', 'grow', 'mem') AND p.status <> 'pending'
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 1
      ), true);
      RETURN NEW;
    END IF;
    IF app.is_platform_admin() THEN
      free_cols := ARRAY['status', 'decided_by', 'decided_at', 'reason', 'paid_until', 'months',
        'updated_by', 'updated_at', 'version'];
    ELSE
      free_cols := ARRAY['receipt_name', 'receipt_type', 'receipt_bytes', 'updated_by', 'updated_at',
        'version'];
    END IF;
    IF (to_jsonb(NEW) - free_cols) IS DISTINCT FROM (to_jsonb(OLD) - free_cols) THEN
      RAISE EXCEPTION 'subscription_payments: эти поля оплаты не меняются'
        USING ERRCODE = '23514', CONSTRAINT = 'subscription_payments_guard';
    END IF;
    RETURN NEW;
  END
  $$;--> statement-breakpoint
CREATE TRIGGER subscription_payments_guard
  BEFORE INSERT OR UPDATE ON public.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION app.subscription_payments_guard();--> statement-breakpoint
REVOKE ALL ON FUNCTION app.subscription_payments_guard() FROM PUBLIC, buhuchet_app;--> statement-breakpoint
-- Файлы всех организаций для Админки (пакет 2, блоки 3 и 4: модуль «Файлы», «Файлы» карточки
-- организации): без ключа хранилища — файл открывается подписанной ссылкой API. security_barrier:
-- условие «администратор» проверяется раньше любых условий запроса.
CREATE VIEW app.admin_files WITH (security_barrier = true) AS
  SELECT
    f.id,
    f.org_id,
    f.source_kind,
    f.source_id,
    f.contractor_id,
    f.name,
    f.content_type,
    f.size_bytes,
    f.state,
    f.note,
    f.page_hidden,
    f.created_by,
    f.created_at,
    f.replaced_at,
    f.deleted_at,
    f.deleted_by,
    f.version
  FROM public.files f
  WHERE app.is_platform_admin() AND f.state <> 'pending';
--> statement-breakpoint
REVOKE ALL ON TABLE app.admin_files FROM PUBLIC;--> statement-breakpoint
GRANT SELECT ON TABLE app.admin_files TO buhuchet_app;--> statement-breakpoint
-- Занято мест и памяти и закрыт ли доступ (доработки 20.11.2026, блоки 2 и 4; пакет 2, блок 5, пункт 2;
-- прототип core/subs.js: subSeats, subMem, subStatus, subClosed) — одна функция для экрана «Подписка»,
-- вкладки «Подписки» и модуля «Файлы» Админки, загрузки файлов, добавления контрагентов и входа.
-- Сегодня — параметром (по Бишкеку, часы приложения). В контексте организации — только она; без
-- организации — все организации, только администратору платформы; иначе — ничего.
--   seats_used — активные контрагенты (все, кроме «В архиве»); seats_limit — пакет: «Со следующего
--   месяца», когда наступил, и пакет из чека, который ещё проверяют (если чек открыл доступ, «Сейчас»).
--   bytes_used — загруженные файлы организации (файл с несколькими ссылками — один раз) и присланные
--   контрагентами, ещё не принятые; удалённые не считаются сразу. Логотип, видео платформы, чеки
--   подписок и документы заявки — не файлы организации. p_bytes = false — без суммы (быстрая проверка).
--   bytes_limit — 2 ГБ, 200 МБ за место пакета и купленное сверх (1 ГБ = 1 000 МБ, МБ = 1 048 576 байт).
--   status — pending, overdue, expiring, none, active (demo — демо-организация, без пределов);
--   closed — подписки нет или срок прошёл и нет чека, открывшего доступ до проверки. Блокировка
--   организации — отдельная, её здесь нет.
CREATE FUNCTION app.org_usage(p_today date, p_bytes boolean DEFAULT true)
  RETURNS TABLE (
    org_id uuid,
    demo boolean,
    seats_used integer,
    seats_limit integer,
    extra_gb integer,
    bytes_used bigint,
    bytes_limit bigint,
    paid_until date,
    status text,
    closed boolean
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH scope AS (
      SELECT o.id, o.is_demo
      FROM public.organizations o
      WHERE CASE
        WHEN app.current_org_id() IS NOT NULL THEN o.id = app.current_org_id()
        ELSE app.is_platform_admin()
      END
    ),
    st AS (
      SELECT s.base_mb, s.seat_mb, s.remind_days FROM public.subscription_settings s WHERE s.id = 1
    ),
    base AS (
      SELECT
        sc.id,
        sc.is_demo,
        sub.org_id IS NOT NULL AS has_sub,
        sub.paid_until,
        CASE WHEN sub.next_from <= p_today AND sub.next_seats IS NOT NULL
          THEN sub.next_seats ELSE coalesce(sub.seats, 0) END AS seats,
        CASE WHEN sub.next_from <= p_today AND sub.next_extra_gb IS NOT NULL
          THEN sub.next_extra_gb ELSE coalesce(sub.extra_gb, 0) END AS gb,
        w.id IS NOT NULL AS waiting,
        coalesce(w.opens_access, false) AS w_open,
        w.kind AS w_kind,
        w.start_mode AS w_mode,
        w.seats AS w_seats,
        w.extra_gb AS w_gb
      FROM scope sc
      LEFT JOIN public.org_subscriptions sub ON sub.org_id = sc.id
      LEFT JOIN public.subscription_payments w ON w.org_id = sc.id AND w.status = 'pending'
    ),
    lim AS (
      SELECT
        b.*,
        greatest(b.seats, CASE WHEN b.w_open AND b.w_mode = 'now' AND b.w_kind IN ('grow', 'renew')
          THEN b.w_seats ELSE 0 END) AS pack,
        greatest(b.gb, CASE WHEN b.w_open AND b.w_mode = 'now' AND b.w_kind IN ('mem', 'renew')
          THEN b.w_gb ELSE 0 END) AS pack_gb
      FROM base b
    )
    SELECT
      l.id,
      l.is_demo,
      (SELECT count(*)::integer FROM public.contractors c
        WHERE c.org_id = l.id AND c.service_status <> 'archived'),
      CASE WHEN l.is_demo THEN NULL ELSE l.pack END,
      CASE WHEN l.is_demo THEN NULL ELSE l.pack_gb END,
      CASE WHEN p_bytes THEN
        (SELECT coalesce(sum(f.size_bytes), 0)::bigint FROM public.files f
          WHERE f.org_id = l.id AND f.state = 'ready')
        + (SELECT coalesce(sum(s.size_bytes), 0)::bigint FROM public.contractor_sent_files s
          WHERE s.org_id = l.id AND s.state = 'ready' AND s.status <> 'accepted')
      END,
      CASE WHEN l.is_demo THEN NULL
        ELSE ((SELECT st.base_mb FROM st) + (SELECT st.seat_mb FROM st) * l.pack
          + 1000 * l.pack_gb)::bigint * 1048576 END,
      l.paid_until,
      CASE
        WHEN l.is_demo THEN 'demo'
        WHEN l.waiting THEN 'pending'
        WHEN NOT l.has_sub THEN 'none'
        WHEN l.paid_until < p_today THEN 'overdue'
        WHEN l.paid_until - p_today <= (SELECT st.remind_days FROM st) THEN 'expiring'
        ELSE 'active'
      END,
      NOT l.is_demo AND NOT (coalesce(l.paid_until >= p_today, false) OR l.w_open)
    FROM lim l
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.org_usage(date, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.org_usage(date, boolean) TO buhuchet_app;--> statement-breakpoint
-- Запуск тарификации (блок 4, пункт 7; прототип — записи «Запуск подписок» в subPays): каждой
-- организации без подписки, кроме демо, — вид «Месяц», пакет по числу активных контрагентов с
-- округлением вверх до шага (не меньше шага), «Оплачено до» = день запуска + 30 дней, бесплатный период,
-- скидка первого месяца остаётся; в «Историю оплат» — запись без суммы от «Системы». Повтор (в день, когда
-- закрытие доступа заработает) никого не закрывает: организации, которые ещё ничего не платили и ничего
-- не получили от администратора, получают срок не раньше нового дня + 30 и пакет не меньше нужного.
-- Отвечает, сколько организаций получили или продлили подписку. Роли приложения недоступна.
CREATE FUNCTION app.subscriptions_launch(p_on date)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_step integer;
    v_until date := p_on + 30;
    n integer := 0;
    r record;
  BEGIN
    SELECT s.seat_step INTO v_step FROM public.subscription_settings s WHERE s.id = 1;
    v_step := coalesce(v_step, 10);
    FOR r IN
      SELECT o.id,
        greatest(v_step, (ceil((
          SELECT count(*) FROM public.contractors c
          WHERE c.org_id = o.id AND c.service_status <> 'archived'
        )::numeric / v_step) * v_step)::integer) AS pack,
        sub.org_id IS NOT NULL AS has_sub,
        sub.seats AS cur_seats
      FROM public.organizations o
      LEFT JOIN public.org_subscriptions sub ON sub.org_id = o.id
      WHERE NOT o.is_demo
        AND (sub.org_id IS NULL OR (sub.free AND sub.paid_until < v_until AND NOT EXISTS (
          SELECT 1 FROM public.subscription_payments p
          WHERE p.org_id = o.id AND p.created_by IS NOT NULL)))
      ORDER BY o.id
      FOR UPDATE OF o
    LOOP
      IF r.has_sub THEN
        UPDATE public.org_subscriptions s
          SET paid_until = v_until, seats = greatest(s.seats, r.pack), updated_at = now(),
            version = s.version + 1
          WHERE s.org_id = r.id;
      ELSE
        INSERT INTO public.org_subscriptions (org_id, plan_id, seats, paid_until, free)
          VALUES (r.id, 'm1', r.pack, v_until, true);
      END IF;
      INSERT INTO public.subscription_payments (id, org_id, kind, plan_id, months, seats, status,
          opens_access, reason, decided_at, paid_until, created_by)
        VALUES (gen_random_uuid(), r.id, 'free', 'm1', 0, greatest(coalesce(r.cur_seats, 0), r.pack),
          'confirmed', true,
          'Запуск подписок: пакет по числу активных контрагентов и 30 дней до первой оплаты',
          now(), v_until, NULL);
      n := n + 1;
    END LOOP;
    RETURN n;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.subscriptions_launch(date) FROM PUBLIC, buhuchet_app;--> statement-breakpoint
-- Виды подписок и «Цены и реквизиты» по умолчанию (блок 1, пункты 1–5; блок 6, пункты 5–6; прототип
-- ref.subKinds, ref.subPrices). Реквизиты платформы заполняет администратор: до этого в окне оплаты их нет.
INSERT INTO public.subscription_plans (id, name, months, discount_pct, perks, sort_order) VALUES
  ('m1', 'Месяц', 1, 0, ARRAY['Без скидки за срок', 'Пакет можно менять каждый месяц'], 1),
  ('m3', '3 месяца', 3, 5, ARRAY['Скидка 5 % на контрагентов и на память сверх'], 2),
  ('m6', '6 месяцев', 6, 10, ARRAY['Скидка 10 % на контрагентов и на память сверх'], 3),
  ('m9', '9 месяцев', 9, 15, ARRAY['Скидка 15 % на контрагентов и на память сверх'], 4),
  ('m12', '12 месяцев', 12, 20,
    ARRAY['Скидка 20 % на контрагентов и на память сверх', 'Цена не меняется весь год'], 5)
  ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
INSERT INTO public.subscription_settings (id, purpose)
  VALUES (1, 'Оплата подписки Buhuchet.kg за организацию {организация}, ИНН {ИНН}')
  ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
-- Запуск тарификации сейчас: доступ по подписке ещё не закрывается (это включат этапы 1–2), срок
-- «Оплачено до» продлит повтор запуска в день, когда закрытие заработает. В журнал выпуска — только число.
DO $$
BEGIN
  RAISE NOTICE 'subscriptions_launch (0165): %',
    app.subscriptions_launch((now() AT TIME ZONE 'Asia/Bishkek')::date);
END
$$;--> statement-breakpoint
ANALYZE public.org_subscriptions;--> statement-breakpoint
ANALYZE public.subscription_payments;
