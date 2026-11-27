-- Консоль запросов «Витрины данных», этап 0, П1 (доработки 27.11.2026: консоль запросов, блок 1, пункт 3;
-- блок 2, пункт 9; блок 4, пункт 2; docs/decisions.md п. О-68):
--   * «Мои запросы» (`dm_console_queries`) — личные запросы администратора платформы; обеим ролям
--     «Витрины данных» таблица закрыта (как тексты шаблонов), роли приложения — только строки автора;
--   * `app.dm_console_log_cleanup()` — строки журнала консоли (история платформы, вид события
--     «Запрос консоли», `entity = 'dm_console'`) старше года удаляет задача по расписанию; раньше года их
--     не удалить никому: у роли приложения права DELETE на `platform_audit_log` нет (0038);
--   * `dm.explain_admin` — «План запроса»: оценка запроса базой без выполнения (EXPLAIN без ANALYZE),
--     тот же подзапрос, роль и проверки, что у `dm.run_admin`;
--   * `app.dm_console_cancel()` — «Остановить»: отмена запроса консоли этого администратора. Строка
--     `dm.runs` запуска не зафиксирована и другим соединениям не видна, поэтому запуск консоли помечает
--     своё соединение до конца транзакции (`application_name = 'buhuchet_dm_console:<пользователь>'`),
--     а отмена ищет соединение по метке. Сама консоль метку не поставит: SET и set_config ей запрещены.
-- Новая таблица — без строк, блокировок больших таблиц нет; ждём блокировку не дольше 3 с.
-- Откат (новой миграцией): DROP FUNCTION dm.explain_admin(text, jsonb), app.dm_console_cancel(),
-- app.dm_console_log_cleanup(); DROP TABLE dm_console_queries; — «Мои запросы» пропадут, журнал платформы цел.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
CREATE TABLE "dm_console_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid DEFAULT app.current_user_id() NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "dm_console_queries_fields_check" CHECK (char_length(btrim("dm_console_queries"."name")) between 1 and 200 and char_length("dm_console_queries"."query") between 1 and 20000 and jsonb_typeof("dm_console_queries"."params") = 'object')
);
--> statement-breakpoint
ALTER TABLE "dm_console_queries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dm_console_queries" ADD CONSTRAINT "dm_console_queries_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dm_console_queries_author_idx" ON "dm_console_queries" USING btree ("author_id","updated_at");--> statement-breakpoint
CREATE POLICY "dm_console_queries_own" ON "dm_console_queries" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("dm_console_queries"."author_id" = app.current_user_id() and app.current_org_id() is null and app.is_platform_admin()) WITH CHECK ("dm_console_queries"."author_id" = app.current_user_id() and app.current_org_id() is null and app.is_platform_admin());
--> statement-breakpoint
REVOKE ALL ON TABLE "dm_console_queries" FROM buhuchet_dm_org, buhuchet_dm_admin;--> statement-breakpoint
CREATE FUNCTION app.dm_console_log_cleanup()
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_count integer;
  BEGIN
    DELETE FROM public.platform_audit_log l
      WHERE l.entity = 'dm_console' AND l.at < clock_timestamp() - interval '1 year';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END
  $$;--> statement-breakpoint
CREATE FUNCTION app.dm_console_cancel()
  RETURNS integer
  LANGUAGE plpgsql VOLATILE
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_count integer := 0;
    v_pid integer;
  BEGIN
    IF app.current_org_id() IS NOT NULL OR NOT app.is_platform_admin() THEN
      RAISE EXCEPTION 'dm_console_cancel: только администратор платформы' USING ERRCODE = '42501';
    END IF;
    FOR v_pid IN
      SELECT a.pid FROM pg_stat_activity a
      WHERE a.application_name = 'buhuchet_dm_console:' || app.current_user_id()::text
        AND a.pid <> pg_backend_pid() AND a.datname = current_database() AND a.state = 'active'
    LOOP
      IF pg_cancel_backend(v_pid) THEN
        v_count := v_count + 1;
      END IF;
    END LOOP;
    RETURN v_count;
  END
  $$;--> statement-breakpoint
CREATE FUNCTION dm.explain_admin(p_sql text, p_params jsonb)
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  SET TimeZone TO 'Asia/Bishkek'
  SET lock_timeout TO '3s'
  AS $$
  DECLARE
    plan json;
    cur refcursor;
  BEGIN
    IF current_setting('transaction_read_only') <> 'on' THEN
      RAISE EXCEPTION 'dm.explain_admin: транзакция не только для чтения' USING ERRCODE = '25006';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM dm.runs r WHERE r.pid = pg_backend_pid()
        AND r.xid = pg_current_xact_id_if_assigned() AND r.admin) THEN
      RAISE EXCEPTION 'dm.explain_admin: запуск не начат' USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(p_params) IS DISTINCT FROM 'array' OR jsonb_array_length(p_params) > 20 THEN
      RAISE EXCEPTION 'dm.explain_admin: параметры — массив до 20 значений' USING ERRCODE = '22023';
    END IF;
    BEGIN
      -- Курсор, как у dm.run_admin: он принимает ровно один оператор («cannot open multi-query plan as
      -- cursor»), и «;» внутри текста второй оператор не выполнит.
      OPEN cur FOR EXECUTE 'EXPLAIN (FORMAT JSON) SELECT * FROM (' || p_sql || E'\n) dm_q'
        USING p_params->>0, p_params->>1, p_params->>2, p_params->>3, p_params->>4, p_params->>5, p_params->>6, p_params->>7, p_params->>8, p_params->>9, p_params->>10, p_params->>11, p_params->>12, p_params->>13, p_params->>14, p_params->>15, p_params->>16, p_params->>17, p_params->>18, p_params->>19;
      FETCH cur INTO plan;
      CLOSE cur;
    EXCEPTION WHEN query_canceled OR others THEN
      PERFORM pg_advisory_unlock_all();
      RAISE;
    END;
    PERFORM pg_advisory_unlock_all();
    RETURN plan;
  END
  $$;--> statement-breakpoint
GRANT CREATE ON SCHEMA dm TO buhuchet_dm_admin;--> statement-breakpoint
ALTER FUNCTION dm.explain_admin(text, jsonb) OWNER TO buhuchet_dm_admin;--> statement-breakpoint
REVOKE CREATE ON SCHEMA dm FROM buhuchet_dm_admin;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.dm_console_log_cleanup(), app.dm_console_cancel(), dm.explain_admin(text, jsonb)
  FROM PUBLIC, buhuchet_dm_org, buhuchet_dm_admin;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.dm_console_log_cleanup(), app.dm_console_cancel(), dm.explain_admin(text, jsonb)
  TO buhuchet_app;--> statement-breakpoint
SET LOCAL lock_timeout TO DEFAULT;
