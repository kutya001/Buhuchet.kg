-- Админка → «Локализация» (ТЗ «Модуль Локализация»): история правок общих данных платформы и правка
-- текста словаря администратором платформы. Таблица истории — как audit_log, но без организации.
CREATE TABLE "platform_audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "platform_audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"actor_user_id" uuid DEFAULT app.current_user_id() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_log_entity_idx" ON "platform_audit_log" USING btree ("entity","entity_id","at");--> statement-breakpoint
CREATE POLICY "platform_audit_log_read" ON "platform_audit_log" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "platform_audit_log_insert" ON "platform_audit_log" AS PERMISSIVE FOR INSERT TO "buhuchet_app" WITH CHECK (app.is_platform_admin() and "platform_audit_log"."actor_user_id" = app.current_user_id() and "platform_audit_log"."at" = now());--> statement-breakpoint
-- История только дополняется, как audit_log (миграция 0007): роль приложения читает и добавляет
-- записи (политики выше), но не меняет и не удаляет их.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE platform_audit_log FROM buhuchet_app;
--> statement-breakpoint
-- Правка текста словаря (ui_texts роль приложения только читает, миграция 0017): новый текст, версия,
-- «Изменено» и «Изменил» — администратор из контекста. Заданный «Изменил» не даёт наполнению
-- (`db:seed --update`) затереть правку. Пустой и длиннее 2000 знаков (`UI_TEXT_MAX_LENGTH`) текст не
-- сохраняется. Отвечает новой версией; пусто — нет такого текста, версия устарела, текст не подходит
-- или в контексте не администратор платформы. Подстановки проверяет сервер (`uiTextProblem`),
-- историю пишет он же в той же транзакции.
CREATE OR REPLACE FUNCTION app.admin_set_ui_text(p_lang text, p_key text, p_text text, p_version integer)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.ui_texts
      SET text = p_text,
          version = version + 1,
          updated_at = now(),
          updated_by = app.current_user_id()
      WHERE lang = p_lang
        AND key = p_key
        AND version = p_version
        AND length(btrim(p_text)) > 0
        AND length(p_text) <= 2000
        AND app.is_platform_admin()
      RETURNING version
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_set_ui_text(text, text, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_set_ui_text(text, text, text, integer) TO buhuchet_app;
