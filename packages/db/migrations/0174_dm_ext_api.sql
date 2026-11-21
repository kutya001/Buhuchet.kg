-- Внешний адрес «Витрины данных» GET /api/ext/v1/<код шаблона> (доработки 20.11.2026: Витрина данных,
-- блок 6; блок 8, пункты 1, 5, 6; поток Т, этап 2, П11; docs/decisions.md п. Т-20). Запрос приходит без
-- входа: токен в заголовке. Роль приложения не видит токены без контекста организации и не пишет в
-- rate_limits и dm_requests — поэтому три узкие функции от владельца схемы (SECURITY DEFINER), как
-- rate_limit_take (0026) и страница контрагента по ссылке (0059). Шаблон, его текст (app.dm_template_query)
-- и строку журнала (app.dm_request_log) API берёт из 0171 уже в контексте токена: путь запроса один для
-- «Вывода» и для токена.
--
-- Найти токен по хешу SHA-256 (hex). Адрес p_ip (SHA-256 адреса с приставкой, его считает API) ждёт,
-- если за p_bad_window секунд с него пришло p_bad_max неизвестных токенов (блок 8, пункт 6: 20 за 10
-- минут): ответ ip_wait и через сколько секунд можно снова. Неизвестный токен — строка счёта
-- (rate_limits, вид «dm_ext_bad») и ответ unknown. Известный — ok: токен, организация, кто создал, шаблон
-- токена и его код (код в адресе сверяет API). Отозван ли токен, истёк ли, закрыт ли доступ — решает API
-- правилом `dmTokenState` по фактам app.dm_token_facts в контексте токена: один источник состояния с
-- вкладкой «API Токены». Отозванный и истёкший токен известен: в счёт адреса он не идёт, чтобы старая
-- программа, которую забыли перенастроить, не закрыла адрес для новых токенов.
CREATE FUNCTION app.dm_ext_target(p_hash text, p_ip text, p_bad_max integer, p_bad_window integer)
  RETURNS TABLE (
    outcome text,
    wait_seconds integer,
    token_id uuid,
    org_id uuid,
    created_by uuid,
    template_id uuid,
    template_code text
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
        NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text;
      RETURN;
    END IF;
    RETURN QUERY
      SELECT 'ok'::text, NULL::integer, t.id, t.org_id, t.created_by, d.id, d.code
      FROM public.dm_tokens t
      JOIN public.dm_templates d ON d.id = t.template_id
      WHERE p_hash ~ '^[0-9a-f]{64}$' AND t.token_hash = p_hash;
    IF NOT FOUND THEN
      INSERT INTO public.rate_limits (kind, subject, at) VALUES ('dm_ext_bad', p_ip, clock_timestamp());
      RETURN QUERY SELECT 'unknown'::text, NULL::integer,
        NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text;
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
REVOKE ALL ON FUNCTION app.dm_ext_target(text, text, integer, integer),
  app.dm_ext_take(uuid, integer, integer, integer), app.dm_requests_cleanup(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.dm_ext_target(text, text, integer, integer),
  app.dm_ext_take(uuid, integer, integer, integer), app.dm_requests_cleanup(integer) TO buhuchet_app;
