-- Админка → «Справочники платформы» → «Загрузки» (задача 2.37; ТЗ «Каждая загрузка — отдельная запись
-- в истории (кто, когда, сколько строк); последнюю загрузку можно откатить»): загрузки справочников из
-- Excel. Читает, добавляет и откатывает только администратор платформы (политики ниже).
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
ALTER TABLE "dict_loads" ADD CONSTRAINT "dict_loads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_loads" ADD CONSTRAINT "dict_loads_rolled_back_by_users_id_fk" FOREIGN KEY ("rolled_back_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dict_loads_created_idx" ON "dict_loads" USING btree ("created_at");--> statement-breakpoint
CREATE POLICY "dict_loads_read" ON "dict_loads" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "dict_loads_insert" ON "dict_loads" AS PERMISSIVE FOR INSERT TO "buhuchet_app" WITH CHECK (app.is_platform_admin() and "dict_loads"."created_by" = app.current_user_id() and "dict_loads"."created_at" = now() and "dict_loads"."rolled_back_at" is null);--> statement-breakpoint
CREATE POLICY "dict_loads_rollback" ON "dict_loads" AS PERMISSIVE FOR UPDATE TO "buhuchet_app" USING (app.is_platform_admin() and "dict_loads"."rolled_back_at" is null) WITH CHECK (app.is_platform_admin() and "dict_loads"."rolled_back_by" = app.current_user_id() and "dict_loads"."rolled_back_at" = now());
--> statement-breakpoint
-- Запись загрузки не удаляется и не правится; меняется только отметка отката — «кто» и «когда»
-- (политика dict_loads_rollback).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE dict_loads FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (rolled_back_by, rolled_back_at) ON TABLE dict_loads TO buhuchet_app;
