ALTER TABLE "gked_items" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gked_items" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "gked_items" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "gked_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_reference" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "gked_items" ADD CONSTRAINT "gked_items_parent_code_gked_items_code_fk" FOREIGN KEY ("parent_code") REFERENCES "public"."gked_items"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gked_items" ADD CONSTRAINT "gked_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gked_items" ADD CONSTRAINT "gked_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_reference" ADD CONSTRAINT "platform_reference_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Админка → «Справочники платформы»: ГКЭД и «Налоги и ставки» (задачи 2.37, часть 3, и 2.38, #93).
-- ГКЭД и «Ставки единого налога» правятся общим механизмом справочников (миграция 0043): строка
-- перечня app.platform_dict_specs. У ГКЭД код вводит администратор («A», «01», «01.1», «01.11»,
-- «01.11.1»), «Входит в» — внешний ключ на этот же справочник (выше): код с вложенными кодами
-- «Используется» и не удаляется. «Виды деятельности (ГКЭД)» режима, статуса и вида отчёта — столбец
-- `gked` (перечни, «Кроме», «Предупреждать при ГКЭД»); служебные признаки правила сервер сохраняет.
INSERT INTO app.platform_dict_specs (dict, table_name, columns, ordered) VALUES
  ('gked', 'gked_items', ARRAY['name', 'level', 'parent_code', 'note'], false),
  ('enrates', 'single_tax_rates', ARRAY['activity', 'rate', 'rate_cashless', 'rate_cash', 'conditions', 'article', 'explanation', 'gked', 'adds_to'], false);
--> statement-breakpoint
UPDATE app.platform_dict_specs SET columns = array_append(columns, 'gked')
  WHERE dict IN ('types', 'regimes', 'benefits') AND NOT ('gked' = ANY (columns));
--> statement-breakpoint
-- Разделы справочника платформы целиком в platform_reference (налоги, ставки налога на имущество,
-- группы кодов ГКЭД): новый раздел той версии, что видел администратор; версия +1, «Изменил» —
-- администратор (`db:seed --update` такой раздел не затирает). Только перечисленные разделы. Отвечает
-- новой версией; пусто — версия устарела, раздела нет или в контексте не администратор платформы.
CREATE OR REPLACE FUNCTION app.admin_set_reference(p_key text, p_payload jsonb, p_checksum text, p_version integer)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    result integer;
  BEGIN
    IF NOT app.is_platform_admin() OR p_key NOT IN ('taxes', 'propertyRates', 'gkedGroups')
      OR p_payload IS NULL OR p_checksum IS NULL THEN
      RETURN NULL;
    END IF;
    UPDATE public.platform_reference AS r
      SET payload = p_payload, checksum = p_checksum, version = r.version + 1, source = 'admin',
          updated_at = now(), updated_by = app.current_user_id()
      WHERE r.key = p_key AND r.version = p_version
      RETURNING r.version INTO result;
    RETURN result;
  END
  $$;
--> statement-breakpoint
-- Загрузка календаря из Excel: название и вид дня той версии, что видел администратор (день «каждый
-- год» остаётся праздником — это проверка таблицы). Отвечает новой версией; пусто — нет дня, версия
-- устарела или в контексте не администратор платформы.
CREATE OR REPLACE FUNCTION app.admin_calendar_update(p_day text, p_kind text, p_name text, p_version integer)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    result integer;
  BEGIN
    IF NOT app.is_platform_admin() THEN
      RETURN NULL;
    END IF;
    UPDATE public.production_calendar AS t
      SET kind = p_kind, name = coalesce(p_name, ''), version = t.version + 1, updated_at = now(),
          updated_by = app.current_user_id()
      WHERE t.day = p_day AND t.version = p_version
      RETURNING t.version INTO result;
    RETURN result;
  END
  $$;
--> statement-breakpoint
-- «Отметить сверку с ГНС» видов отчётов: дата — сегодня по Бишкеку, кто — администратор из контекста;
-- версия +1. Отвечает числом отмеченных видов; пусто — в контексте не администратор платформы.
CREATE OR REPLACE FUNCTION app.admin_mark_gns(p_codes text[])
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    marked integer;
  BEGIN
    IF NOT app.is_platform_admin() THEN
      RETURN NULL;
    END IF;
    UPDATE public.report_types AS t
      SET gns_checked_at = (now() AT TIME ZONE 'Asia/Bishkek')::date,
          gns_checked_by = app.current_user_id()::text, version = t.version + 1, updated_at = now(),
          updated_by = app.current_user_id()
      WHERE t.code = ANY (p_codes);
    GET DIAGNOSTICS marked = ROW_COUNT;
    RETURN marked;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_set_reference(text, jsonb, text, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_calendar_update(text, text, text, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_mark_gns(text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_set_reference(text, jsonb, text, integer) TO buhuchet_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_calendar_update(text, text, text, integer) TO buhuchet_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_mark_gns(text[]) TO buhuchet_app;
