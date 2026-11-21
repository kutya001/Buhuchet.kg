-- Внешний адрес «Витрины данных» GET /api/ext/v1/<код шаблона> (доработки 20.11.2026: Витрина данных,
-- блок 6; блок 8, пункты 1, 5, 6; поток Т, этап 2, П11; docs/decisions.md п. Т-20). Запрос приходит без
-- входа: токен в заголовке. Роль приложения не видит токены без контекста организации и не пишет в
-- rate_limits и dm_requests — поэтому три узкие функции от владельца схемы (SECURITY DEFINER), как
-- rate_limit_take (0026) и страница контрагента по ссылке (0059). Строку журнала пишет общая функция
-- app.dm_request_log потока «Ядро» (этап 2, П4): путь запроса один для «Вывода» и для токена.
--
-- Найти токен по хешу SHA-256 (hex) для шаблона с кодом p_code. Адрес p_ip (SHA-256 адреса с приставкой,
-- его считает API) ждёт, если за p_bad_window секунд с него пришло p_bad_max неизвестных токенов (блок 8,
-- пункт 6: 20 за 10 минут): ответ ip_wait и через сколько секунд можно снова. Неизвестный токен — строка
-- счёта (rate_limits, вид «dm_ext_bad») и ответ unknown. Известный — ok: организация, кто создал, шаблон
-- токена, его код, модуль и право (для функций организации); запрос, параметры и столбцы — только если код шаблона совпал (иначе пусто — API
-- отвечает «Токен не подходит или истёк»). Отозван ли токен, истёк ли, закрыт ли доступ — решает API
-- правилом `dmTokenState` по фактам app.dm_token_facts в контексте токена: один источник состояния
-- с вкладкой «API Токены». Отозванный и истёкший токен известен: в счёт адреса он не идёт, чтобы старая
-- программа, которую забыли перенастроить, не закрыла адрес для новых токенов.
CREATE FUNCTION app.dm_ext_target(
    p_hash text, p_code text, p_ip text, p_bad_max integer, p_bad_window integer)
  RETURNS TABLE (
    outcome text,
    wait_seconds integer,
    token_id uuid,
    org_id uuid,
    created_by uuid,
    template_id uuid,
    template_code text,
    module text,
    need_permission text,
    query text,
    params jsonb,
    columns jsonb
  )
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_count integer;
    v_oldest timestamptz;
  BEGIN
    IF p_ip IS NULL OR p_bad_max IS NULL OR p_bad_max < 1 OR p_bad_window IS NULL OR p_bad_window < 1 THEN
      RAISE EXCEPTION 'dm_ext_target: неверный предел адреса';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('rate_limit:dm_ext_bad:' || p_ip, 0));
    SELECT count(*), min(r.at) INTO v_count, v_oldest FROM public.rate_limits r
      WHERE r.kind = 'dm_ext_bad' AND r.subject = p_ip
        AND r.at > clock_timestamp() - make_interval(secs => p_bad_window);
    IF v_count >= p_bad_max THEN
      RETURN QUERY SELECT 'ip_wait'::text,
        greatest(1, ceil(extract(epoch FROM
          v_oldest + make_interval(secs => p_bad_window) - clock_timestamp())))::integer,
        NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text,
        NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
    RETURN QUERY
      SELECT 'ok'::text, NULL::integer, t.id, t.org_id, t.created_by, d.id, d.code, d.module,
        d.need_permission,
        CASE WHEN d.code = p_code THEN s.query END,
        CASE WHEN d.code = p_code THEN d.params END,
        CASE WHEN d.code = p_code THEN d.columns END
      FROM public.dm_tokens t
      JOIN public.dm_templates d ON d.id = t.template_id
      LEFT JOIN public.dm_template_sql s ON s.template_id = d.id
      WHERE p_hash ~ '^[0-9a-f]{64}$' AND t.token_hash = p_hash;
    IF NOT FOUND THEN
      INSERT INTO public.rate_limits (kind, subject, at) VALUES ('dm_ext_bad', p_ip, clock_timestamp());
      RETURN QUERY SELECT 'unknown'::text, NULL::integer,
        NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text,
        NULL::jsonb, NULL::jsonb;
    END IF;
  END
  $$;
--> statement-breakpoint
-- Пределы одного токена (блок 6, пункт 4): один запрос одновременно (строка «занята» p_lease_seconds или
-- до app.rate_limit_release с видом «dm_ext»), p_minute_max за минуту и p_day_max за сутки. Запросы
-- одного токена проверяются по очереди (блокировка до конца транзакции). outcome — ok (ticket — номер
-- строки для app.rate_limit_release), busy (идёт прежний запрос; повторить через секунду) или limited
-- (предел за минуту или за сутки; wait_seconds — когда выйдет из окна самый старый запрос окна).
-- Отказ в счёт не идёт: строку получает только запрос, который пошёл.
CREATE FUNCTION app.dm_ext_take(
    p_token uuid, p_minute_max integer, p_day_max integer, p_lease_seconds integer)
  RETURNS TABLE (outcome text, ticket bigint, wait_seconds integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_subject text := p_token::text;
    v_count integer;
    v_oldest timestamptz;
    v_id bigint;
  BEGIN
    IF p_token IS NULL OR p_minute_max IS NULL OR p_minute_max < 1 OR p_day_max IS NULL
      OR p_day_max < 1 OR p_lease_seconds IS NULL OR p_lease_seconds < 1 THEN
      RAISE EXCEPTION 'dm_ext_take: неверный предел токена';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('rate_limit:dm_ext:' || v_subject, 0));
    IF EXISTS (
      SELECT 1 FROM public.rate_limits r
      WHERE r.kind = 'dm_ext' AND r.subject = v_subject AND r.busy_until > clock_timestamp()
    ) THEN
      RETURN QUERY SELECT 'busy'::text, NULL::bigint, 1;
      RETURN;
    END IF;
    SELECT count(*), min(r.at) INTO v_count, v_oldest FROM public.rate_limits r
      WHERE r.kind = 'dm_ext' AND r.subject = v_subject AND r.at > clock_timestamp() - interval '1 minute';
    IF v_count >= p_minute_max THEN
      RETURN QUERY SELECT 'limited'::text, NULL::bigint,
        greatest(1, ceil(extract(epoch FROM v_oldest + interval '1 minute' - clock_timestamp())))::integer;
      RETURN;
    END IF;
    SELECT count(*), min(r.at) INTO v_count, v_oldest FROM public.rate_limits r
      WHERE r.kind = 'dm_ext' AND r.subject = v_subject AND r.at > clock_timestamp() - interval '1 day';
    IF v_count >= p_day_max THEN
      RETURN QUERY SELECT 'limited'::text, NULL::bigint,
        greatest(1, ceil(extract(epoch FROM v_oldest + interval '1 day' - clock_timestamp())))::integer;
      RETURN;
    END IF;
    INSERT INTO public.rate_limits (kind, subject, at, busy_until)
      VALUES ('dm_ext', v_subject, clock_timestamp(),
              clock_timestamp() + make_interval(secs => p_lease_seconds))
      RETURNING id INTO v_id;
    RETURN QUERY SELECT 'ok'::text, v_id, NULL::integer;
  END
  $$;
--> statement-breakpoint
-- Журнал запросов хранится p_days дней (блок 6, пункт 7: 90): задача по расписанию удаляет старые строки
-- всех организаций. Отвечает, сколько строк удалено.
CREATE FUNCTION app.dm_requests_cleanup(p_days integer)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_count integer;
  BEGIN
    IF p_days IS NULL OR p_days < 1 THEN
      RAISE EXCEPTION 'dm_requests_cleanup: неверный срок';
    END IF;
    DELETE FROM public.dm_requests r WHERE r.at < clock_timestamp() - make_interval(days => p_days);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.dm_ext_target(text, text, text, integer, integer),
  app.dm_ext_take(uuid, integer, integer, integer), app.dm_requests_cleanup(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.dm_ext_target(text, text, text, integer, integer),
  app.dm_ext_take(uuid, integer, integer, integer), app.dm_requests_cleanup(integer) TO buhuchet_app;
--> statement-breakpoint
-- ВРЕМЕННО, до слияния с веткой потока «Ядро» (этап 2, П4): там своя app.dm_request_log с той же
-- подписью и теми же правилами — при слиянии этот блок удаляется (договорено с тредом сборки 21.11.2026).
-- Строка журнала запросов: организация и сотрудник — из контекста; via='screen' — без токена, с
-- сотрудником, без организации — только администратор платформы; via='api' — токен этой организации
-- (вне организации — токен Админки), у токена ставятся «Последний запрос» и адрес. Ошибка — до 300
-- знаков, адрес — до 64.
CREATE FUNCTION app.dm_request_log(
    p_via text, p_template uuid, p_token uuid, p_params jsonb, p_rows integer, p_ms integer,
    p_outcome text, p_error text, p_ip text)
  RETURNS bigint
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_org uuid := app.current_org_id();
    v_user uuid := app.current_user_id();
    v_id bigint;
  BEGIN
    IF p_via = 'screen' THEN
      IF p_token IS NOT NULL OR v_user IS NULL OR (v_org IS NULL AND NOT app.is_platform_admin()) THEN
        RAISE EXCEPTION 'dm_request_log: запрос с экрана — только сотрудник или администратор платформы'
          USING ERRCODE = '42501';
      END IF;
    ELSIF p_via = 'api' THEN
      IF p_token IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.dm_tokens t
        WHERE t.id = p_token AND t.org_id IS NOT DISTINCT FROM v_org
      ) THEN
        RAISE EXCEPTION 'dm_request_log: токен не этой организации' USING ERRCODE = '42501';
      END IF;
      UPDATE public.dm_tokens SET last_used_at = clock_timestamp(), last_ip = left(p_ip, 64)
        WHERE id = p_token;
    ELSE
      RAISE EXCEPTION 'dm_request_log: неизвестный вид запроса';
    END IF;
    INSERT INTO public.dm_requests
      (org_id, token_id, template_id, user_id, via, params, row_count, duration_ms, outcome, error, ip, at)
    VALUES (v_org, p_token, p_template, v_user, p_via, coalesce(p_params, '{}'::jsonb), p_rows, p_ms,
      p_outcome, left(p_error, 300), left(p_ip, 64), clock_timestamp())
    RETURNING id INTO v_id;
    RETURN v_id;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.dm_request_log(text, uuid, uuid, jsonb, integer, integer, text, text, text)
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.dm_request_log(text, uuid, uuid, jsonb, integer, integer, text, text, text)
  TO buhuchet_app;
