ALTER TABLE "authorities" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "banks" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "due_change_reasons" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ownership_forms" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "production_calendar" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_bases" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_types" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "single_tax_rates" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tax_benefits" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tax_offices" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tax_regimes" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
-- Админка → «Справочники платформы» (задача 2.36; ТЗ «Общие правила для всех справочников»): правка
-- справочников платформы администратором. Таблицы справочников роль приложения только читает
-- (миграции 0023, 0028): пишут функции ниже от владельца схемы и только если в контексте —
-- незаблокированный администратор платформы (app.is_platform_admin(), миграция 0024). Что можно
-- менять — перечень app.platform_dict_specs: справочник, его таблица и поля, которые правит
-- администратор. Следующий справочник (части 2–3, задачи 2.23 и 2.25) подключается строкой перечня,
-- без новых функций. «Было → стало» сервер пишет в platform_audit_log в той же транзакции.
--
-- «Создано» (created_at выше): когда администратор добавил значение; у значений из наполнения — пусто
-- (docs/deviations.md, п. 48).
-- ordered — «№» и «Выше»/«Ниже» (только короткие справочники, docs/deviations.md п. Д-2).
CREATE TABLE app.platform_dict_specs (
  dict text PRIMARY KEY,
  table_name text NOT NULL UNIQUE,
  columns text[] NOT NULL,
  ordered boolean NOT NULL
);
--> statement-breakpoint
-- Ссылки на код значения без внешнего ключа (массив кодов в столбце): их считает «Используется»
-- вместе со ссылками внешними ключами. Строки добавляет миграция справочника.
CREATE TABLE app.platform_dict_array_refs (
  dict text NOT NULL REFERENCES app.platform_dict_specs (dict),
  table_name text NOT NULL,
  column_name text NOT NULL,
  PRIMARY KEY (dict, table_name, column_name)
);
--> statement-breakpoint
-- Перечни читают только функции владельца схемы: у роли приложения прав на них нет.
REVOKE ALL ON TABLE app.platform_dict_specs, app.platform_dict_array_refs FROM PUBLIC;
--> statement-breakpoint
INSERT INTO app.platform_dict_specs (dict, table_name, columns, ordered) VALUES
  ('forms', 'ownership_forms', ARRAY['name', 'full_name', 'short_name', 'declaration_for', 'note'], true),
  ('organs', 'authorities', ARRAY['name', 'description', 'contacts', 'hours', 'site', 'contacts_note'], true),
  ('ugns', 'tax_offices', ARRAY['name', 'short_name', 'gns_code', 'region'], false),
  ('banks', 'banks', ARRAY['name', 'kind', 'by_phone', 'note'], true),
  ('reasons', 'due_change_reasons', ARRAY['name', 'note'], true);
--> statement-breakpoint
-- Банк в «Переводе по номеру телефона» реквизита организации и сотрудника (миграция 0034) — массив
-- кодов без внешнего ключа: такой банк тоже «Используется», удалить его нельзя.
INSERT INTO app.platform_dict_array_refs (dict, table_name, column_name) VALUES
  ('banks', 'org_accounts', 'phone_banks'),
  ('banks', 'employee_wallets', 'phone_banks');
--> statement-breakpoint
-- Сколько раз используется каждое значение справочника: ссылки внешними ключами на его код из любых
-- таблиц, в том числе таблиц организаций (RLS функции владельца схемы не мешает) — ссылки следующих
-- задач считаются сами, — и массивы кодов из app.platform_dict_array_refs. ref — таблица ссылки
-- (у УГНС столбец «Контрагентов» считает только контрагентов). Не администратору — пусто.
CREATE OR REPLACE FUNCTION app.admin_dict_usage(p_dict text)
  RETURNS TABLE (code text, ref text, n bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    spec app.platform_dict_specs;
    link record;
    parts text[] := ARRAY[]::text[];
  BEGIN
    IF NOT app.is_platform_admin() THEN
      RETURN;
    END IF;
    SELECT * INTO spec FROM app.platform_dict_specs s WHERE s.dict = p_dict;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    FOR link IN
      SELECT ns.nspname AS schema, a.attname AS col, cl.relname AS name
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = c.confkey[1]
      WHERE c.contype = 'f'
        AND c.confrelid = format('public.%I', spec.table_name)::regclass
        AND cardinality(c.conkey) = 1
        AND fa.attname = 'code'
    LOOP
      parts := parts || format(
        'SELECT %1$I::text AS code, %2$L::text AS ref FROM %3$I.%2$I WHERE %1$I IS NOT NULL',
        link.col, link.name, link.schema);
    END LOOP;
    FOR link IN
      SELECT r.table_name, r.column_name FROM app.platform_dict_array_refs r WHERE r.dict = p_dict
    LOOP
      parts := parts || format(
        'SELECT unnest(%1$I)::text AS code, %2$L::text AS ref FROM public.%2$I',
        link.column_name, link.table_name);
    END LOOP;
    IF cardinality(parts) = 0 THEN
      RETURN;
    END IF;
    RETURN QUERY EXECUTE format(
      'SELECT x.code, x.ref, count(*) FROM (%s) x GROUP BY x.code, x.ref',
      array_to_string(parts, ' UNION ALL '));
  END
  $$;
--> statement-breakpoint
-- Новое значение: поля из p_row (ключи — имена столбцов перечня; столбцы не из перечня не берутся),
-- код — от сервера (`nextDictCode`), действующее, в конце порядка; «Создано», «Создал», «Изменил» —
-- администратор из контекста. Повтор названия или кода не даёт уникальный индекс таблицы. Отвечает
-- версией; пусто — справочника нет в перечне или в контексте не администратор платформы.
CREATE OR REPLACE FUNCTION app.admin_dict_insert(p_dict text, p_code text, p_row jsonb)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    spec app.platform_dict_specs;
    cols text;
    vals text;
    result integer;
  BEGIN
    IF NOT app.is_platform_admin() THEN
      RETURN NULL;
    END IF;
    SELECT * INTO spec FROM app.platform_dict_specs s WHERE s.dict = p_dict;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    SELECT string_agg(format('%I', c), ', '), string_agg(format('r.%I', c), ', ')
      INTO cols, vals FROM unnest(spec.columns) AS c;
    EXECUTE format(
      'INSERT INTO public.%1$I AS t (code, %2$s, active, sort_order, created_at, created_by, updated_by, updated_at)
       SELECT $2, %3$s, true, (SELECT coalesce(max(o.sort_order), 0) + 1 FROM public.%1$I o), now(),
              app.current_user_id(), app.current_user_id(), now()
       FROM jsonb_populate_record(NULL::public.%1$I, $1) AS r
       RETURNING t.version',
      spec.table_name, cols, vals)
      INTO result USING p_row, p_code;
    RETURN result;
  END
  $$;
--> statement-breakpoint
-- Правка полей значения (все поля перечня из p_row), версия +1, «Изменено» и «Изменил» —
-- администратор из контекста (заданный «Изменил» не даёт наполнению `db:seed --update` затереть
-- правку). Отвечает новой версией; пусто — нет такого значения, версия устарела или в контексте не
-- администратор платформы.
CREATE OR REPLACE FUNCTION app.admin_dict_update(p_dict text, p_code text, p_row jsonb, p_version integer)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    spec app.platform_dict_specs;
    sets text;
    result integer;
  BEGIN
    IF NOT app.is_platform_admin() THEN
      RETURN NULL;
    END IF;
    SELECT * INTO spec FROM app.platform_dict_specs s WHERE s.dict = p_dict;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    SELECT string_agg(format('%1$I = r.%1$I', c), ', ') INTO sets FROM unnest(spec.columns) AS c;
    EXECUTE format(
      'UPDATE public.%1$I AS t
       SET %2$s, version = t.version + 1, updated_at = now(), updated_by = app.current_user_id()
       FROM jsonb_populate_record(NULL::public.%1$I, $1) AS r
       WHERE t.code = $2 AND t.version = $3
       RETURNING t.version',
      spec.table_name, sets)
      INTO result USING p_row, p_code, p_version;
    RETURN result;
  END
  $$;
--> statement-breakpoint
-- «Отключить» и «Включить»: отключённое значение не предлагается в новых записях, в старых
-- остаётся. Отвечает новой версией; пусто — как у правки.
CREATE OR REPLACE FUNCTION app.admin_dict_set_active(p_dict text, p_code text, p_active boolean, p_version integer)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    spec app.platform_dict_specs;
    result integer;
  BEGIN
    IF NOT app.is_platform_admin() OR p_active IS NULL THEN
      RETURN NULL;
    END IF;
    SELECT * INTO spec FROM app.platform_dict_specs s WHERE s.dict = p_dict;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    EXECUTE format(
      'UPDATE public.%I AS t
       SET active = $1, version = t.version + 1, updated_at = now(), updated_by = app.current_user_id()
       WHERE t.code = $2 AND t.version = $3
       RETURNING t.version',
      spec.table_name)
      INTO result USING p_active, p_code, p_version;
    RETURN result;
  END
  $$;
--> statement-breakpoint
-- «Выше» (p_step = -1) и «Ниже» (1): значение меняется местами с соседним в порядке справочника
-- (sort_order, при равных — код). Равные номера (наполнение после правки порядка) сначала
-- выравниваются подряд. Таблица на время перестановки закрыта для других правок. У обоих значений
-- «Изменил» — администратор (наполнение не вернёт им прежний порядок), версия +1 — у перемещённого.
-- Отвечает его новой версией; пусто — нет значения, версия устарела, двигать некуда, у справочника
-- нет порядка (ordered) или в контексте не администратор платформы.
CREATE OR REPLACE FUNCTION app.admin_dict_move(p_dict text, p_code text, p_step integer, p_version integer)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    spec app.platform_dict_specs;
    codes text[];
    orders integer[];
    i integer;
    j integer;
    result integer;
  BEGIN
    IF NOT app.is_platform_admin() OR p_step IS NULL OR p_step NOT IN (-1, 1) THEN
      RETURN NULL;
    END IF;
    SELECT * INTO spec FROM app.platform_dict_specs s WHERE s.dict = p_dict AND s.ordered;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', spec.table_name);
    EXECUTE format(
      'SELECT array_agg(t.code ORDER BY t.sort_order, t.code), array_agg(t.sort_order ORDER BY t.sort_order, t.code)
       FROM public.%I t',
      spec.table_name)
      INTO codes, orders;
    i := array_position(codes, p_code);
    IF i IS NULL THEN
      RETURN NULL;
    END IF;
    j := i + p_step;
    IF j < 1 OR j > cardinality(codes) THEN
      RETURN NULL;
    END IF;
    IF (SELECT count(DISTINCT o) FROM unnest(orders) AS o) < cardinality(orders) THEN
      EXECUTE format(
        'UPDATE public.%I AS t SET sort_order = n.i FROM unnest($1) WITH ORDINALITY AS n(code, i)
         WHERE t.code = n.code AND t.sort_order IS DISTINCT FROM n.i',
        spec.table_name)
        USING codes;
      SELECT array_agg(g ORDER BY g) INTO orders FROM generate_series(1, cardinality(codes)) AS g;
    END IF;
    EXECUTE format(
      'UPDATE public.%I AS t
       SET sort_order = $1, version = t.version + 1, updated_at = now(), updated_by = app.current_user_id()
       WHERE t.code = $2 AND t.version = $3
       RETURNING t.version',
      spec.table_name)
      INTO result USING orders[j], p_code, p_version;
    IF result IS NULL THEN
      RETURN NULL;
    END IF;
    EXECUTE format(
      'UPDATE public.%I AS t SET sort_order = $1, updated_at = now(), updated_by = app.current_user_id()
       WHERE t.code = $2',
      spec.table_name)
      USING orders[i], codes[j];
    RETURN result;
  END
  $$;
--> statement-breakpoint
-- «Удалить»: только значение, которое нигде не используется (ТЗ «Значение, которое уже используется,
-- нельзя удалить — только отключить»). Используется — ошибка foreign_key_violation, как у внешнего
-- ключа. Отвечает true — удалено; false — нет значения или версия устарела; пусто — не администратор.
-- Пока идёт удаление, ссылку не добавить: таблицы со ссылками массивом кодов закрыты для записи
-- (у массива нет внешнего ключа, который подождал бы удаления), а строка значения — для ссылок
-- внешними ключами; проверка «Используется» — после блокировок и видит всё, что успели сохранить.
CREATE OR REPLACE FUNCTION app.admin_dict_delete(p_dict text, p_code text, p_version integer)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    spec app.platform_dict_specs;
    link record;
    deleted integer;
  BEGIN
    IF NOT app.is_platform_admin() THEN
      RETURN NULL;
    END IF;
    SELECT * INTO spec FROM app.platform_dict_specs s WHERE s.dict = p_dict;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    FOR link IN
      SELECT r.table_name FROM app.platform_dict_array_refs r WHERE r.dict = p_dict ORDER BY r.table_name
    LOOP
      EXECUTE format('LOCK TABLE public.%I IN SHARE MODE', link.table_name);
    END LOOP;
    EXECUTE format('SELECT 1 FROM public.%I t WHERE t.code = $1 FOR UPDATE', spec.table_name)
      USING p_code;
    IF EXISTS (SELECT 1 FROM app.admin_dict_usage(p_dict) u WHERE u.code = p_code) THEN
      RAISE EXCEPTION 'platform dict value % is in use', p_code USING ERRCODE = 'foreign_key_violation';
    END IF;
    EXECUTE format('DELETE FROM public.%I AS t WHERE t.code = $1 AND t.version = $2', spec.table_name)
      USING p_code, p_version;
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted > 0;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_dict_usage(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_dict_insert(text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_dict_update(text, text, jsonb, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_dict_set_active(text, text, boolean, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_dict_move(text, text, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_dict_delete(text, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_dict_usage(text) TO buhuchet_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_dict_insert(text, text, jsonb) TO buhuchet_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_dict_update(text, text, jsonb, integer) TO buhuchet_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_dict_set_active(text, text, boolean, integer) TO buhuchet_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_dict_move(text, text, integer, integer) TO buhuchet_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_dict_delete(text, text, integer) TO buhuchet_app;
--> statement-breakpoint
-- Админка → «Справочники платформы» → «Запросы» (прототип v59 renderPDicts0, решение заказчика по
-- docs/deviations.md п. 46): запросы «Попросить добавить» всех организаций. Под RLS их видно только
-- своей организации, поэтому — представление от владельца схемы, как app.admin_users (миграция 0033):
-- строки только администратору платформы. Название организации и ФИО отправившего (ТЗ «ФИО из
-- учётной записи»).
CREATE VIEW app.admin_dict_change_requests WITH (security_barrier = true) AS
  SELECT
    r.id,
    r.org_id,
    o.name AS org_name,
    r.dict,
    r.what,
    r.comment,
    r.status,
    r.answer,
    r.created_at,
    r.created_by,
    e.full_name AS created_by_name,
    r.decided_at,
    r.decided_by,
    r.updated_at,
    r.version
  FROM public.dict_change_requests r
  JOIN public.organizations o ON o.id = r.org_id
  LEFT JOIN public.employees e ON e.user_id = r.created_by
  WHERE app.is_platform_admin();
--> statement-breakpoint
REVOKE ALL ON TABLE app.admin_dict_change_requests FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON TABLE app.admin_dict_change_requests TO buhuchet_app;
--> statement-breakpoint
-- Ответ на запрос: «Добавлено» (ответ по желанию) или «Отклонено» (ответ обязателен — «Напишите,
-- почему запрос отклонён»), не длиннее 2000 знаков (DICT_REQUEST_ANSWER_MAX); кто и когда ответил —
-- администратор из контекста. Организация видит статус и ответ в «Мои запросы». Отвечает новой
-- версией; пусто — нет запроса, версия устарела, ответ не подходит или не администратор платформы.
CREATE OR REPLACE FUNCTION app.admin_answer_dict_request(p_id uuid, p_status text, p_answer text, p_version integer)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.dict_change_requests
      SET status = p_status,
          answer = btrim(p_answer),
          decided_by = app.current_user_id(),
          decided_at = now(),
          version = version + 1,
          updated_at = now()
      WHERE id = p_id
        AND version = p_version
        AND p_status IN ('added', 'rejected')
        AND (p_status = 'added' OR length(btrim(p_answer)) > 0)
        AND length(p_answer) <= 2000
        AND app.is_platform_admin()
      RETURNING version
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_answer_dict_request(uuid, text, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_answer_dict_request(uuid, text, text, integer) TO buhuchet_app;
