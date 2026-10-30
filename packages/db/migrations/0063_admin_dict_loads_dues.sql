-- Админка → «Справочники платформы» → «Загрузки» (задача 2.37; ТЗ «Каждая загрузка — отдельная запись
-- в истории (кто, когда, сколько строк); последнюю загрузку можно откатить»): загрузки справочников из
-- Excel. Читает, добавляет и откатывает только администратор платформы (политики ниже).
-- Очередь пересчёта сроков несданных отчётов после правки каталога (задача 2.37, docs/decisions.md
-- п. Д-9): dues_recalcs — без данных организаций, пишут правка администратора и задача по расписанию.
CREATE TABLE "dict_loads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dict" text NOT NULL,
	"rows" integer NOT NULL,
	"added" integer NOT NULL,
	"changed" integer NOT NULL,
	"disabled" integer NOT NULL,
	"errors" integer NOT NULL,
	"before" jsonb NOT NULL,
	"added_values" jsonb NOT NULL,
	"created_by" uuid DEFAULT app.current_user_id() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rolled_back_by" uuid,
	"rolled_back_at" timestamp with time zone,
	CONSTRAINT "dict_loads_counts_check" CHECK (least("dict_loads"."rows", "dict_loads"."added", "dict_loads"."changed", "dict_loads"."disabled", "dict_loads"."errors") >= 0),
	CONSTRAINT "dict_loads_rollback_check" CHECK (("dict_loads"."rolled_back_at" is null) = ("dict_loads"."rolled_back_by" is null))
);
--> statement-breakpoint
ALTER TABLE "dict_loads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dues_recalcs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" uuid DEFAULT app.current_user_id(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_until" timestamp with time zone,
	"claim_token" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"after_org" uuid,
	"done_at" timestamp with time zone,
	"reports" integer DEFAULT 0 NOT NULL,
	"orgs" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "dues_recalcs_kind_check" CHECK ("dues_recalcs"."kind" in ('types', 'statuses', 'calendar')),
	CONSTRAINT "dues_recalcs_counts_check" CHECK (least("dues_recalcs"."attempts", "dues_recalcs"."reports", "dues_recalcs"."orgs") >= 0)
);
--> statement-breakpoint
ALTER TABLE "dues_recalcs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dict_loads" ADD CONSTRAINT "dict_loads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_loads" ADD CONSTRAINT "dict_loads_rolled_back_by_users_id_fk" FOREIGN KEY ("rolled_back_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues_recalcs" ADD CONSTRAINT "dues_recalcs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dict_loads_created_idx" ON "dict_loads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "dues_recalcs_pending_idx" ON "dues_recalcs" USING btree ("created_at") WHERE "dues_recalcs"."done_at" is null;--> statement-breakpoint
CREATE POLICY "dict_loads_read" ON "dict_loads" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "dict_loads_insert" ON "dict_loads" AS PERMISSIVE FOR INSERT TO "buhuchet_app" WITH CHECK (app.is_platform_admin() and "dict_loads"."created_by" = app.current_user_id() and "dict_loads"."created_at" = now() and "dict_loads"."rolled_back_at" is null);--> statement-breakpoint
CREATE POLICY "dict_loads_rollback" ON "dict_loads" AS PERMISSIVE FOR UPDATE TO "buhuchet_app" USING (app.is_platform_admin() and "dict_loads"."rolled_back_at" is null) WITH CHECK (app.is_platform_admin() and "dict_loads"."rolled_back_by" = app.current_user_id() and "dict_loads"."rolled_back_at" = now());--> statement-breakpoint
CREATE POLICY "dues_recalcs_service" ON "dues_recalcs" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING (true) WITH CHECK (true);--> statement-breakpoint
-- Запись загрузки не удаляется и не правится; меняется только отметка отката — «кто» и «когда»
-- (политика dict_loads_rollback).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE dict_loads FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (rolled_back_by, rolled_back_at) ON TABLE dict_loads TO buhuchet_app;
