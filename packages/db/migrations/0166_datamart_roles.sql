-- «Витрина данных»: две роли базы только для чтения и исполнитель запросов шаблонов (этап 0, П6 общего
-- плана; ТЗ «Доработки 20.11.2026: Витрина данных», блок 8; docs/decisions.md п. О-62). Запрос пишет
-- человек, поэтому защита не зависит от того, правильно ли он написан:
--   - роли buhuchet_dm_org (шаблоны организаций) и buhuchet_dm_admin (шаблоны Админки) — без входа, без
--     обхода RLS, ни в одну роль не входят и ни одной роли не дают; читают только то, что выдано ниже
--     (по столбцам: новый столбец и новая таблица закрыты, пока их не откроет миграция);
--   - запрос идёт только внутри dm.run_org / dm.run_admin — функций с правами своей роли: внутри них
--     PostgreSQL не даёт сменить роль (SET ROLE, set_config('role'), session_authorization);
--   - номер организации — строка dm.runs текущей транзакции, которую ставит dm.begin_org из контекста
--     организации до запуска; транзакция к этому моменту только для чтения, поэтому изнутри запроса ни
--     строку, ни организацию не поменять (set_config('app.org_id') на роли Витрины не действует: их
--     политики смотрят на dm.runs, а не на настройки);
--   - транзакция исполнителя всегда откатывается, а зафиксировать её не даёт отложенный триггер dm.runs:
--     строка запуска не остаётся.
-- Блокировки: таблиц не перестраивает и данных не меняет, но CREATE POLICY берёт ACCESS EXCLUSIVE на
-- каждую открытую таблицу (115 из 135 в public) и держит до конца транзакции пачки `db:migrate`: всё это
-- время чтение и запись этих таблиц ждут. Сама работа — доли секунды (0,25 с на демо-базе); дольше —
-- ожидание долгих транзакций на каждой таблице, поэтому ждём не дольше 3 с на таблицу. Таблицы берутся по
-- алфавиту — запрос, который держит одну и ждёт другую, может взаимоблокироваться с миграцией: тогда
-- откатывается один из двух (запрос сайта — ошибкой, миграция — красным выпуском, повторить выпуск).
-- Поэтому 0166 — последней в своей пачке, на рабочий сайт — в тихое время (docs/decisions.md п. О-62).
-- Откат (если понадобится): DROP OWNED BY buhuchet_dm_org, buhuchet_dm_admin; DROP SCHEMA dm CASCADE —
-- снимает политики, права, функции и dm.runs; роли общие для сервера, DROP ROLE — не в миграции.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buhuchet_dm_org') THEN
    CREATE ROLE buhuchet_dm_org NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buhuchet_dm_admin') THEN
    CREATE ROLE buhuchet_dm_admin NOLOGIN NOINHERIT;
  END IF;
  -- Роли общие для сервера: заведённая раньше руками (стенд, свой сервер) могла получить вход, обход RLS
  -- или членство. Такую не правим молча — миграция останавливается, роль исправляет администратор базы.
  IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('buhuchet_dm_org', 'buhuchet_dm_admin')
      AND (r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolinherit OR r.rolreplication
        OR r.rolcreaterole OR r.rolcreatedb))
    OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
      WHERE r.rolname IN ('buhuchet_dm_org', 'buhuchet_dm_admin'))
    -- Член роли Витрины стал бы владельцем функций исполнителя (мог бы снять SECURITY DEFINER): кроме
    -- владельца схемы (он передаёт функции) и суперпользователей членов быть не должно.
    OR EXISTS (SELECT 1 FROM pg_auth_members m
      JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles r ON r.oid = m.member
      WHERE g.rolname IN ('buhuchet_dm_org', 'buhuchet_dm_admin') AND r.rolname <> current_user
        AND NOT r.rolsuper) THEN
    RAISE EXCEPTION 'dm: у роли Витрины лишние свойства или членство' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
-- Владелец функций исполнителя — сама роль Витрины: владельцем схемы нужно уметь стать этой ролью
-- (на Supabase владелец схемы — не суперпользователь).
GRANT buhuchet_dm_org TO CURRENT_USER;--> statement-breakpoint
GRANT buhuchet_dm_admin TO CURRENT_USER;--> statement-breakpoint
CREATE SCHEMA dm;--> statement-breakpoint
REVOKE ALL ON SCHEMA dm FROM PUBLIC;--> statement-breakpoint
-- Запуск исполнителя: строка на транзакцию (процесс и номер транзакции). Видна только своей транзакции —
-- она никогда не фиксируется.
CREATE TABLE dm.runs (
  pid integer NOT NULL,
  xid xid8 NOT NULL,
  org_id uuid,
  user_id uuid,
  admin boolean NOT NULL,
  PRIMARY KEY (pid, xid),
  CHECK (admin = (org_id IS NULL))
);--> statement-breakpoint
-- Транзакция с запуском не фиксируется никогда: строка с организацией и сотрудником не остаётся, даже
-- если вызывающий код забудет откатить (проверка — при COMMIT).
CREATE FUNCTION dm.runs_no_commit()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    RAISE EXCEPTION 'dm: транзакция запуска Витрины не фиксируется' USING ERRCODE = '25000';
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION dm.runs_no_commit() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER runs_no_commit AFTER INSERT ON dm.runs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dm.runs_no_commit();--> statement-breakpoint
GRANT USAGE ON SCHEMA dm TO buhuchet_app, buhuchet_dm_org, buhuchet_dm_admin;--> statement-breakpoint
GRANT SELECT ON TABLE dm.runs TO buhuchet_dm_org, buhuchet_dm_admin;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO buhuchet_dm_org, buhuchet_dm_admin;--> statement-breakpoint
-- Права, выданные ролям раньше руками, не остаются: ниже — только то, что в списках.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM buhuchet_dm_org, buhuchet_dm_admin;--> statement-breakpoint
-- Разбор таблиц ниже — один оператор: пока он идёт, взятые таблицы сайту недоступны, поэтому всё вместе —
-- не дольше 15 с (ожидание каждой таблицы — не дольше 3 с, но они складываются).
SET LOCAL statement_timeout = '15s';--> statement-breakpoint
-- Что видят роли Витрины (блок 8, пункт 3). Списки повторяют DM_CLOSED_TABLES, DM_ADMIN_ONLY_TABLES,
-- DM_PLATFORM_TABLES и DM_SECRET_COLUMNS в src/datamart-roles.ts — тест сверяет их с правами базы и не
-- даёт новой таблице остаться неразобранной.
--   closed — секреты (пароли, сеансы, ключи и коды Telegram и страниц, хеши токенов, счётчики попыток
--     входа, частота) и служебное хранилища — закрыты обеим ролям;
--   admin_only — данные платформы (организации целиком, заявки, подписки и чеки, журналы платформы,
--     черновики новостей и видео, шаблоны Витрины) и личные строки пользователя, которые приложение
--     показывает только ему самому (колокольчик, настройки вида, прочитанное, сообщения бота и виджет),
--     — только роли Админки;
--   platform — справочники платформы без организации — обеим ролям целиком;
--   остальные таблицы с org_id — роли организаций только свои строки, Админки — все; организация видит
--     только свою строку organizations. Таблица без org_id, которой нет в списках, — только Админке.
--   secret_columns — столбцы, закрытые обеим ролям (ключи хранилища, номера чатов, коды страниц,
--     описания сообщений бота с кнопками, счётчики попыток).
DO $$
DECLARE
  closed text[] := ARRAY['admin_login_codes', 'contractor_page_grants', 'contractor_telegram_tokens',
    'dm_template_sql', 'dm_tokens', 'dues_recalcs', 'login_attempts', 'password_reset_codes',
    'password_setup_tokens', 'platform_lead_tg_tokens', 'rate_limits', 'sessions', 'storage_check_items',
    'storage_check_runs', 'storage_delete_retries', 'telegram_group_tokens', 'telegram_inbox',
    'telegram_link_guards', 'telegram_link_tokens', 'telegram_relink_codes'];
  admin_only text[] := ARRAY['bell_notifications', 'dict_loads', 'dm_requests', 'dm_template_orgs',
    'dm_templates', 'file_trash', 'kb_known', 'news', 'news_admin_texts', 'news_reads',
    'org_subscriptions', 'platform_audit_log', 'platform_lead_docs', 'platform_lead_events',
    'platform_lead_uploads', 'platform_leads', 'scheduler_jobs', 'scheduler_runs', 'session_log',
    'subscription_payments', 'subscription_plans', 'subscription_settings', 'telegram_outbox',
    'telegram_widgets', 'video_guest_stats', 'video_uploads', 'videos', 'view_settings',
    'welcome_seen'];
  platform text[] := ARRAY['authorities', 'banks', 'due_change_reasons', 'gked_items',
    'message_templates', 'ownership_forms', 'permissions', 'phone_codes', 'platform_reference',
    'production_calendar', 'report_bases', 'report_type_bases', 'report_type_regimes', 'report_types',
    'role_templates', 'single_tax_rates', 'status_tones', 'task_categories', 'tax_benefit_due_rules',
    'tax_benefit_offices', 'tax_benefit_report_types', 'tax_benefits', 'tax_offices', 'tax_regimes',
    'ui_texts'];
  secret_columns text[] := ARRAY['contractor_pages.code', 'contractor_pages.code_version',
    'contractor_pages.failures', 'contractor_pages.locked_until', 'contractor_sent_files.storage_key',
    'contractor_sent_files.tg_chat_id', 'contractor_telegram_links.chat_id',
    'contractor_telegram_messages.chat_id', 'contractor_telegram_messages.payload',
    'dm_requests.ip', 'file_trash.storage_key', 'files.storage_key', 'organizations.logo_key',
    'platform_lead_docs.storage_key', 'platform_leads.tg_chat_id', 'subscription_payments.receipt_key',
    'telegram_groups.chat_id', 'telegram_links.chat_id', 'telegram_outbox.chat_id',
    'telegram_outbox.last_error', 'telegram_outbox.payload', 'telegram_widgets.chat_id',
    'users.login_failures', 'users.login_lock_reason', 'users.login_locked_at', 'users.password_hash',
    'video_uploads.s3_upload_id', 'video_uploads.storage_key', 'videos.cover_key', 'videos.file_key'];
  run_admin text := 'EXISTS (SELECT 1 FROM dm.runs r WHERE r.pid = pg_catalog.pg_backend_pid() AND '
    || 'r.xid = pg_catalog.pg_current_xact_id_if_assigned() AND r.admin)';
  run_org text := '(SELECT r.org_id FROM dm.runs r WHERE r.pid = pg_catalog.pg_backend_pid() AND '
    || 'r.xid = pg_catalog.pg_current_xact_id_if_assigned())';
  t record;
  cols text;
BEGIN
  FOR t IN
    SELECT c.relname AS name, c.relrowsecurity AS rls,
      EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id'
        AND NOT a.attisdropped) AS has_org
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    CONTINUE WHEN t.name = ANY (closed);
    -- Без RLS политики не действуют: такая таблица открылась бы ролям целиком.
    IF NOT t.rls THEN
      RAISE EXCEPTION 'dm: у таблицы % нет RLS', t.name USING ERRCODE = '55000';
    END IF;
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO cols
    FROM pg_attribute a
    WHERE a.attrelid = format('public.%I', t.name)::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND NOT (t.name || '.' || a.attname) = ANY (secret_columns);
    EXECUTE format('GRANT SELECT (%s) ON TABLE public.%I TO buhuchet_dm_admin', cols, t.name);
    EXECUTE format('CREATE POLICY dm_admin_read ON public.%I AS PERMISSIVE FOR SELECT '
      'TO buhuchet_dm_admin USING (%s)', t.name, run_admin);
    CONTINUE WHEN t.name = ANY (admin_only);
    IF t.name = 'organizations' THEN
      EXECUTE format('CREATE POLICY dm_org_read ON public.%I AS PERMISSIVE FOR SELECT '
        'TO buhuchet_dm_org USING (id = %s)', t.name, run_org);
    ELSIF t.has_org THEN
      EXECUTE format('CREATE POLICY dm_org_read ON public.%I AS PERMISSIVE FOR SELECT '
        'TO buhuchet_dm_org USING (org_id = %s)', t.name, run_org);
    ELSIF t.name = ANY (platform) THEN
      EXECUTE format('CREATE POLICY dm_org_read ON public.%I AS PERMISSIVE FOR SELECT '
        'TO buhuchet_dm_org USING (%s IS NOT NULL)', t.name, run_org);
    ELSE
      CONTINUE;
    END IF;
    EXECUTE format('GRANT SELECT (%s) ON TABLE public.%I TO buhuchet_dm_org', cols, t.name);
  END LOOP;
END
$$;--> statement-breakpoint
SET LOCAL statement_timeout TO DEFAULT;--> statement-breakpoint
-- Начать запуск шаблона организации: организация и сотрудник — из контекста withOrgContext (сеанс или
-- токен), а не из параметров запроса. Зовёт только роль приложения, до перевода транзакции в «только
-- чтение».
CREATE FUNCTION dm.begin_org()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF app.current_org_id() IS NULL THEN
      RAISE EXCEPTION 'dm.begin_org: нет организации' USING ERRCODE = '42501';
    END IF;
    INSERT INTO dm.runs (pid, xid, org_id, user_id, admin)
    VALUES (pg_backend_pid(), pg_current_xact_id(), app.current_org_id(), app.current_user_id(), false);
  END
  $$;--> statement-breakpoint
-- Начать запуск шаблона Админки: только администратор платформы вне контекста организации.
CREATE FUNCTION dm.begin_admin()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF app.current_org_id() IS NOT NULL OR NOT app.is_platform_admin() THEN
      RAISE EXCEPTION 'dm.begin_admin: только администратор платформы' USING ERRCODE = '42501';
    END IF;
    INSERT INTO dm.runs (pid, xid, org_id, user_id, admin)
    VALUES (pg_backend_pid(), pg_current_xact_id(), NULL, app.current_user_id(), true);
  END
  $$;--> statement-breakpoint
-- Выполнить запрос шаблона (блок 8, пункты 1, 4, 5): транзакция только для чтения и начата dm.begin_*;
-- запрос становится подзапросом `SELECT * FROM (запрос) dm_q` — так проходит только SELECT (EXPLAIN,
-- SHOW, EXECUTE, DELETE … RETURNING и запись в WITH база отклоняет; EXPLAIN ANALYZE выдал бы число
-- строк чужих организаций, отброшенных политикой), а курсор принимает ровно один оператор; блокировку
-- строк и смену «только чтения» отклоняет транзакция. Строки забираются по одной, не больше p_max + 1
-- (на одну больше — чтобы сказать «строк больше»), поэтому предел не обойти скобками в тексте запроса;
-- ответ больше 32 МБ — отказ (54000): сайт не держит в памяти сотни мегабайт одного запроса.
-- Параметры — $1…$20 текстом (приводит к типу сам запрос, `$1::date`). Ответ — {columns, rows}: имена
-- столбцов в порядке запроса (и у пустого результата; одинаковые имена — ошибка) и строки массивами
-- значений. Сроки — по Бишкеку (`current_date`, `::date`), блокировку таблицы ждём не дольше 3 с.
-- Рекомендательные блокировки, которые запрос мог взять, снимаются: соединение уходит обратно в пул.
CREATE FUNCTION dm.run_org(p_sql text, p_params jsonb, p_max integer)
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  SET TimeZone TO 'Asia/Bishkek'
  SET lock_timeout TO '3s'
  AS $$
  DECLARE
    cur refcursor;
    rec record;
    got boolean;
    j json;
    line json;
    cols text[];
    vals json[] := '{}';
    n integer := 0;
    size bigint := 0;
  BEGIN
    IF current_setting('transaction_read_only') <> 'on' THEN
      RAISE EXCEPTION 'dm.run_org: транзакция не только для чтения' USING ERRCODE = '25006';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM dm.runs r WHERE r.pid = pg_backend_pid()
        AND r.xid = pg_current_xact_id_if_assigned() AND NOT r.admin) THEN
      RAISE EXCEPTION 'dm.run_org: запуск не начат' USING ERRCODE = '42501';
    END IF;
    IF p_max IS NULL OR p_max NOT BETWEEN 1 AND 50000 THEN
      RAISE EXCEPTION 'dm.run_org: предел строк от 1 до 50 000' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_params) IS DISTINCT FROM 'array' OR jsonb_array_length(p_params) > 20 THEN
      RAISE EXCEPTION 'dm.run_org: параметры — массив до 20 значений' USING ERRCODE = '22023';
    END IF;
    BEGIN
      OPEN cur FOR EXECUTE 'SELECT * FROM (' || p_sql || E'\n) dm_q'
        USING p_params->>0, p_params->>1, p_params->>2, p_params->>3, p_params->>4, p_params->>5,
          p_params->>6, p_params->>7, p_params->>8, p_params->>9, p_params->>10, p_params->>11,
          p_params->>12, p_params->>13, p_params->>14, p_params->>15, p_params->>16, p_params->>17,
          p_params->>18, p_params->>19;
      LOOP
        FETCH cur INTO rec;
        got := FOUND;
        j := row_to_json(rec);
        IF cols IS NULL THEN
          cols := ARRAY(SELECT x.k FROM json_object_keys(j) WITH ORDINALITY AS x(k, i) ORDER BY x.i);
          IF cardinality(cols) <> (SELECT count(DISTINCT c) FROM unnest(cols) c) THEN
            RAISE EXCEPTION 'dm.run_org: у столбцов одинаковые имена' USING ERRCODE = '42712';
          END IF;
        END IF;
        EXIT WHEN NOT got;
        line := (SELECT coalesce(json_agg(e.value ORDER BY e.i), '[]'::json)
          FROM json_each(j) WITH ORDINALITY AS e(key, value, i));
        -- array_append дополняет массив на месте; `vals || line` копировал бы его на каждой строке.
        vals := array_append(vals, line);
        n := n + 1;
        size := size + octet_length(j::text);
        IF size > 33554432 THEN
          RAISE EXCEPTION 'dm.run_org: ответ больше 32 МБ' USING ERRCODE = '54000';
        END IF;
        EXIT WHEN n > p_max;
      END LOOP;
      CLOSE cur;
    EXCEPTION WHEN query_canceled OR others THEN
      PERFORM pg_advisory_unlock_all();
      RAISE;
    END;
    PERFORM pg_advisory_unlock_all();
    RETURN json_build_object('columns', to_json(cols), 'rows', array_to_json(vals));
  END
  $$;--> statement-breakpoint
CREATE FUNCTION dm.run_admin(p_sql text, p_params jsonb, p_max integer)
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  SET TimeZone TO 'Asia/Bishkek'
  SET lock_timeout TO '3s'
  AS $$
  DECLARE
    cur refcursor;
    rec record;
    got boolean;
    j json;
    line json;
    cols text[];
    vals json[] := '{}';
    n integer := 0;
    size bigint := 0;
  BEGIN
    IF current_setting('transaction_read_only') <> 'on' THEN
      RAISE EXCEPTION 'dm.run_admin: транзакция не только для чтения' USING ERRCODE = '25006';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM dm.runs r WHERE r.pid = pg_backend_pid()
        AND r.xid = pg_current_xact_id_if_assigned() AND r.admin) THEN
      RAISE EXCEPTION 'dm.run_admin: запуск не начат' USING ERRCODE = '42501';
    END IF;
    IF p_max IS NULL OR p_max NOT BETWEEN 1 AND 50000 THEN
      RAISE EXCEPTION 'dm.run_admin: предел строк от 1 до 50 000' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_params) IS DISTINCT FROM 'array' OR jsonb_array_length(p_params) > 20 THEN
      RAISE EXCEPTION 'dm.run_admin: параметры — массив до 20 значений' USING ERRCODE = '22023';
    END IF;
    BEGIN
      OPEN cur FOR EXECUTE 'SELECT * FROM (' || p_sql || E'\n) dm_q'
        USING p_params->>0, p_params->>1, p_params->>2, p_params->>3, p_params->>4, p_params->>5,
          p_params->>6, p_params->>7, p_params->>8, p_params->>9, p_params->>10, p_params->>11,
          p_params->>12, p_params->>13, p_params->>14, p_params->>15, p_params->>16, p_params->>17,
          p_params->>18, p_params->>19;
      LOOP
        FETCH cur INTO rec;
        got := FOUND;
        j := row_to_json(rec);
        IF cols IS NULL THEN
          cols := ARRAY(SELECT x.k FROM json_object_keys(j) WITH ORDINALITY AS x(k, i) ORDER BY x.i);
          IF cardinality(cols) <> (SELECT count(DISTINCT c) FROM unnest(cols) c) THEN
            RAISE EXCEPTION 'dm.run_admin: у столбцов одинаковые имена' USING ERRCODE = '42712';
          END IF;
        END IF;
        EXIT WHEN NOT got;
        line := (SELECT coalesce(json_agg(e.value ORDER BY e.i), '[]'::json)
          FROM json_each(j) WITH ORDINALITY AS e(key, value, i));
        -- array_append дополняет массив на месте; `vals || line` копировал бы его на каждой строке.
        vals := array_append(vals, line);
        n := n + 1;
        size := size + octet_length(j::text);
        IF size > 33554432 THEN
          RAISE EXCEPTION 'dm.run_admin: ответ больше 32 МБ' USING ERRCODE = '54000';
        END IF;
        EXIT WHEN n > p_max;
      END LOOP;
      CLOSE cur;
    EXCEPTION WHEN query_canceled OR others THEN
      PERFORM pg_advisory_unlock_all();
      RAISE;
    END;
    PERFORM pg_advisory_unlock_all();
    RETURN json_build_object('columns', to_json(cols), 'rows', array_to_json(vals));
  END
  $$;--> statement-breakpoint
-- Функции исполнителя выполняются с правами своей роли Витрины: передать их можно, только пока у роли
-- есть право создавать в схеме dm, — сразу после передачи оно отбирается.
GRANT CREATE ON SCHEMA dm TO buhuchet_dm_org, buhuchet_dm_admin;--> statement-breakpoint
ALTER FUNCTION dm.run_org(text, jsonb, integer) OWNER TO buhuchet_dm_org;--> statement-breakpoint
ALTER FUNCTION dm.run_admin(text, jsonb, integer) OWNER TO buhuchet_dm_admin;--> statement-breakpoint
REVOKE CREATE ON SCHEMA dm FROM buhuchet_dm_org, buhuchet_dm_admin;--> statement-breakpoint
-- Запрос шаблона не вызывает исполнителя снова (владельцу право выполнять функцию дано по умолчанию).
REVOKE ALL ON FUNCTION dm.begin_org(), dm.begin_admin(), dm.run_org(text, jsonb, integer),
  dm.run_admin(text, jsonb, integer) FROM PUBLIC, buhuchet_dm_org, buhuchet_dm_admin;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dm.begin_org(), dm.begin_admin(), dm.run_org(text, jsonb, integer),
  dm.run_admin(text, jsonb, integer) TO buhuchet_app;--> statement-breakpoint
-- Следующие миграции пачки ждут блокировок по своим правилам.
SET LOCAL lock_timeout TO DEFAULT;
