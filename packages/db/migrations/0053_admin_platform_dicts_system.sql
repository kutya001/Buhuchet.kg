CREATE TABLE "message_templates" (
	"key" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"sort_order" integer NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "status_tones" (
	"scale" text NOT NULL,
	"status" text NOT NULL,
	"tone" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "status_tones_scale_status_pk" PRIMARY KEY("scale","status"),
	CONSTRAINT "status_tones_scale_check" CHECK ("status_tones"."scale" in ('report', 'payment', 'task', 'service', 'project', 'indicator')),
	CONSTRAINT "status_tones_tone_check" CHECK ("status_tones"."tone" in ('gray', 'blue', 'yellow', 'green', 'orange', 'red', 'purple', 'faint'))
);
--> statement-breakpoint
ALTER TABLE "status_tones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "permissions" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "permissions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "role_templates" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_tones" ADD CONSTRAINT "status_tones_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_templates" ADD CONSTRAINT "role_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "message_templates_read" ON "message_templates" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "status_tones_read" ON "status_tones" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
-- Админка → «Справочники платформы», часть 3 задачи 2.36: «Статусы» (цвета), «Права ролей», «Шаблоны
-- ролей» и «Шаблоны» сообщений. Роль приложения эти таблицы только читает, как остальные справочники
-- платформы (миграции 0017, 0023, 0051); правит администратор платформы узкими функциями ниже.
-- «Изменил» (updated_by) не даёт наполнению `db:seed --update` затереть правку. Названия статусов и
-- периодичности — тексты словаря: их меняет `app.admin_set_ui_text` (миграция 0038).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE status_tones, message_templates, permissions, role_templates FROM buhuchet_app;
--> statement-breakpoint
-- Цвета статусов по умолчанию (STATUS_SCALE_DEFS в @buhuchet/domain); статусы, которые добавит код,
-- допишет наполнение.
INSERT INTO status_tones (scale, status, tone) VALUES
  ('report', 'todo', 'gray'),
  ('report', 'in_progress', 'blue'),
  ('report', 'submitted', 'green'),
  ('report', 'waiting', 'yellow'),
  ('report', 'confirmed', 'green'),
  ('report', 'needs_fix', 'orange'),
  ('report', 'not_required', 'faint'),
  ('payment', 'unpaid', 'gray'),
  ('payment', 'partial', 'yellow'),
  ('payment', 'paid', 'green'),
  ('payment', 'not_required', 'faint'),
  ('task', 'todo', 'gray'),
  ('task', 'in_progress', 'blue'),
  ('task', 'rework', 'red'),
  ('task', 'on_confirm', 'purple'),
  ('task', 'confirmed', 'green'),
  ('task', 'done', 'green'),
  ('task', 'failed', 'orange'),
  ('task', 'cancelled', 'faint'),
  ('service', 'active', 'green'),
  ('service', 'paused', 'yellow'),
  ('service', 'archived', 'faint'),
  ('project', 'planned', 'blue'),
  ('project', 'in_progress', 'yellow'),
  ('project', 'done', 'green'),
  ('project', 'cancelled', 'faint'),
  ('indicator', 'empty', 'orange'),
  ('indicator', 'filled', 'blue'),
  ('indicator', 'checked', 'green')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Шаблоны сообщений переезжают из platform_reference (разделы messageTemplates и templateNotes) в свою
-- таблицу, чтобы их правил администратор платформы. Строки переносятся сразу: Telegram читает шаблоны и
-- до наполнения (`db:seed --update` потом уберёт копии разделов). Порядок — как в справочнике
-- организации (раздел templateNotes).
INSERT INTO message_templates (key, text, note, sort_order)
SELECT m.key, m.value, coalesce(n.payload ->> m.key, ''), coalesce(o.n, 100)
FROM platform_reference r
CROSS JOIN LATERAL jsonb_each_text(
  CASE WHEN jsonb_typeof(r.payload) = 'object' THEN r.payload ELSE '{}'::jsonb END
) AS m(key, value)
LEFT JOIN platform_reference n ON n.key = 'templateNotes' AND jsonb_typeof(n.payload) = 'object'
LEFT JOIN (VALUES
  ('waTax', 1), ('waFee', 2), ('tgBefore', 3), ('tgToday', 4), ('tgOver', 5), ('tgPay', 6),
  ('tgWeek', 7), ('tgCode', 8), ('tgTask', 9), ('tgConfWait', 10), ('tgFix', 11), ('waPage', 12)
) AS o(key, n) ON o.key = m.key
WHERE r.key = 'messageTemplates'
  AND btrim(m.value) <> ''
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- «Права ролей»: название и описание права (набор прав и группы задаёт система). Версия +1, «Изменил» —
-- администратор из контекста. Отвечает новой версией; пусто — нет такого права, версия устарела, пустое
-- или слишком длинное название или описание, в контексте не администратор платформы.
CREATE OR REPLACE FUNCTION app.admin_set_permission(p_id text, p_name text, p_description text, p_version integer)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.permissions
      SET name = btrim(p_name),
          description = btrim(p_description),
          version = version + 1,
          updated_at = now(),
          updated_by = app.current_user_id()
      WHERE id = p_id
        AND version = p_version
        AND length(btrim(p_name)) BETWEEN 1 AND 100
        AND length(btrim(p_description)) BETWEEN 1 AND 500
        AND app.is_platform_admin()
      RETURNING version
  $$;
--> statement-breakpoint
-- «Шаблоны ролей»: название, права и область по группам. Права — только из каталога прав и без права
-- только владельца 'org' (OWNER_ONLY_PERMISSIONS); область — «own» или «all» у групп с областью
-- (SCOPE_GROUPS). Право без просмотра группы проверяет сервер (roleTemplateProblem). Роли уже созданных
-- организаций не меняются: шаблон копируется только при регистрации. Ответ — как у права.
CREATE OR REPLACE FUNCTION app.admin_set_role_template(p_code text, p_name text, p_permissions text[], p_scopes jsonb, p_version integer)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.role_templates
      SET name = btrim(p_name),
          permissions = p_permissions,
          scopes = p_scopes,
          version = version + 1,
          updated_at = now(),
          updated_by = app.current_user_id()
      WHERE code = p_code
        AND version = p_version
        AND length(btrim(p_name)) BETWEEN 1 AND 100
        AND p_permissions IS NOT NULL
        AND p_permissions <@ ARRAY(SELECT p.id FROM public.permissions p)
        AND NOT (p_permissions && ARRAY['org'])
        AND jsonb_typeof(p_scopes) = 'object'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_each(p_scopes) s
            WHERE s.key NOT IN ('cps', 'reports', 'fin', 'projects', 'kpi', 'files')
              OR s.value NOT IN ('"own"'::jsonb, '"all"'::jsonb)
        )
        AND app.is_platform_admin()
      RETURNING version
  $$;
--> statement-breakpoint
-- «Статусы»: цвет статуса (набор цветов держит ограничение таблицы). Ответ — как у права.
CREATE OR REPLACE FUNCTION app.admin_set_status_tone(p_scale text, p_status text, p_tone text, p_version integer)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.status_tones
      SET tone = p_tone,
          version = version + 1,
          updated_at = now(),
          updated_by = app.current_user_id()
      WHERE scale = p_scale
        AND status = p_status
        AND version = p_version
        AND app.is_platform_admin()
      RETURNING version
  $$;
--> statement-breakpoint
-- «Шаблоны»: текст шаблона сообщения с подстановками как есть. Ответ — как у права.
CREATE OR REPLACE FUNCTION app.admin_set_message_template(p_key text, p_text text, p_version integer)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.message_templates
      SET text = btrim(p_text),
          version = version + 1,
          updated_at = now(),
          updated_by = app.current_user_id()
      WHERE key = p_key
        AND version = p_version
        AND length(btrim(p_text)) BETWEEN 1 AND 2000
        AND app.is_platform_admin()
      RETURNING version
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_set_permission(text, text, text, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_set_role_template(text, text, text[], jsonb, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_set_status_tone(text, text, text, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_set_message_template(text, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_set_permission(text, text, text, integer) TO buhuchet_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_set_role_template(text, text, text[], jsonb, integer) TO buhuchet_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_set_status_tone(text, text, text, integer) TO buhuchet_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_set_message_template(text, text, integer) TO buhuchet_app;
