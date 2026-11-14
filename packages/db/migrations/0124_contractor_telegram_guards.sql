-- Telegram контрагента (доработки 13.11.2026, задача К3; прототип v92): права роли приложения и функции.
-- Строку подключения создаёт только функция по одноразовой ссылке со страницы контрагента; роль
-- приложения меняет у строки только решение (подтвердить, отклонить, отключить) и не удаляет её.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE contractor_telegram_links FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (status, decided_by, by_client, decided_at, updated_by, updated_at, version)
  ON TABLE contractor_telegram_links TO buhuchet_app;
--> statement-breakpoint
-- Одноразовые ссылки роль приложения не видит и не меняет: только функции app.contractor_telegram_*.
REVOKE ALL ON TABLE contractor_telegram_tokens FROM buhuchet_app;
--> statement-breakpoint
-- Раздел «Telegram» страницы контрагента включён по умолчанию и у действующих организаций (прототип
-- v92: «у действующих организаций включается при обновлении»).
UPDATE org_settings SET page_sections = array_append(page_sections, 'tg')
  WHERE NOT ('tg' = ANY (page_sections));
--> statement-breakpoint
-- Можно ли подключать Telegram у контрагента: организация работает, включены «Страница контрагента по
-- ссылке» и «Напоминания в Telegram», раздел «Telegram» включён в учётной политике и не скрыт у
-- контрагента, страница включена и не закрыта, контрагент не в архиве. Только для функций ниже.
CREATE FUNCTION app.contractor_telegram_on(p_org_id uuid, p_contractor_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1
        FROM public.organizations o
        JOIN public.org_settings s ON s.org_id = o.id
        JOIN public.contractors c ON c.org_id = o.id AND c.id = p_contractor_id
        JOIN public.contractor_pages p ON p.contractor_id = c.id AND p.org_id = o.id
        WHERE o.id = p_org_id AND o.status = 'active'
          AND (s.features ->> 'cppage') = 'true' AND (s.features ->> 'telegram') = 'true'
          AND 'tg' = ANY (s.page_sections) AND NOT ('tg' = ANY (p.hidden_sections))
          AND c.service_status <> 'archived' AND p.enabled AND p.closed_at IS NULL
    )
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_telegram_on(uuid, uuid) FROM PUBLIC, buhuchet_app;
--> statement-breakpoint
-- Выдать одноразовую ссылку «Подключить Telegram»: только браузеру, где запомнен код страницы (то же
-- условие, что у открытой страницы, — app.contractor_page_state), и только пока есть свободное место
-- (подключённые и ждущие подтверждения — вместе не больше p_max_links). Неиспользованных ссылок у
-- контрагента — не больше p_max_tokens: самая старая заменяется новой. Итог: ok, full, unavailable.
CREATE FUNCTION app.contractor_telegram_issue(
    p_slug text, p_inn text, p_grant_hash text, p_token_hash text,
    p_ttl_hours integer, p_max_links integer, p_max_tokens integer)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_org uuid;
    v_cp uuid;
  BEGIN
    IF p_grant_hash IS NULL OR p_token_hash IS NULL OR length(p_token_hash) < 32 THEN
      RETURN 'unavailable';
    END IF;
    SELECT s.org_id, s.contractor_id INTO v_org, v_cp
      FROM app.contractor_page_state(p_slug, p_inn, p_grant_hash) s
      WHERE s.state = 'open';
    IF v_cp IS NULL OR NOT app.contractor_telegram_on(v_org, v_cp) THEN
      RETURN 'unavailable';
    END IF;
    -- Запросы и ссылки одного контрагента — по одному: строка страницы блокируется.
    PERFORM 1 FROM public.contractor_pages p WHERE p.contractor_id = v_cp FOR UPDATE;
    DELETE FROM public.contractor_telegram_tokens t
      WHERE t.contractor_id = v_cp AND t.expires_at <= now();
    IF (SELECT count(*) FROM public.contractor_telegram_links l
          WHERE l.contractor_id = v_cp AND l.status IN ('wait', 'on')) >= p_max_links THEN
      RETURN 'full';
    END IF;
    DELETE FROM public.contractor_telegram_tokens t
      WHERE t.token_hash IN (
        SELECT x.token_hash FROM public.contractor_telegram_tokens x
          WHERE x.contractor_id = v_cp AND x.used_at IS NULL
          ORDER BY x.created_at DESC, x.token_hash
          OFFSET greatest(p_max_tokens - 1, 0)
      );
    INSERT INTO public.contractor_telegram_tokens (token_hash, org_id, contractor_id, expires_at)
      VALUES (p_token_hash, v_org, v_cp, now() + make_interval(hours => p_ttl_hours));
    RETURN 'ok';
  END
  $$;
--> statement-breakpoint
-- Чья это ссылка — до транзакции организации: ok (действует), repeat (Telegram повторил сообщение из
-- того же чата — отвечать второй раз не нужно), иначе строк нет — «Ссылка устарела».
CREATE FUNCTION app.contractor_telegram_peek(p_token_hash text, p_chat_id bigint)
  RETURNS TABLE (state text, org_id uuid, contractor_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT CASE WHEN t.used_at IS NULL THEN 'ok' ELSE 'repeat' END, t.org_id, t.contractor_id
      FROM public.contractor_telegram_tokens t
      WHERE t.token_hash = p_token_hash
        AND ((t.used_at IS NULL AND t.expires_at > now()
              AND app.contractor_telegram_on(t.org_id, t.contractor_id))
          OR (t.used_at IS NOT NULL AND t.used_chat_id = p_chat_id))
  $$;
--> statement-breakpoint
-- Клиент открыл ссылку и нажал «Старт»: ссылка использована (один раз), появляется запрос «ждёт
-- подтверждения». Итог: asked (запрос создан), pending (запрос этого чата уже ждёт), already (чат уже
-- подключён), limit (мест нет), invalid (ссылка не действует). Вызывается в транзакции организации
-- ссылки — историю контрагента сервер пишет в ней же.
CREATE FUNCTION app.contractor_telegram_start(
    p_token_hash text, p_chat_id bigint, p_name text, p_max_links integer)
  RETURNS TABLE (outcome text, link_id uuid, contractor_id uuid, contractor_name text)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_org uuid;
    v_cp uuid;
    v_used timestamptz;
    v_expires timestamptz;
    v_name text;
    v_link uuid;
    v_status text;
    v_tg text := left(coalesce(nullif(btrim(p_name), ''), 'Telegram'), 32);
  BEGIN
    SELECT t.contractor_id INTO v_cp
      FROM public.contractor_telegram_tokens t WHERE t.token_hash = p_token_hash;
    IF v_cp IS NULL OR p_chat_id IS NULL THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::text;
      RETURN;
    END IF;
    -- Тот же порядок блокировок, что у выдачи ссылки: сначала строка страницы, затем ссылка.
    PERFORM 1 FROM public.contractor_pages p WHERE p.contractor_id = v_cp FOR UPDATE;
    SELECT t.org_id, t.used_at, t.expires_at INTO v_org, v_used, v_expires
      FROM public.contractor_telegram_tokens t WHERE t.token_hash = p_token_hash FOR UPDATE;
    -- Организация ссылки — та же, в чьей транзакции идёт вызов: строка и история — в одной организации.
    IF NOT FOUND OR v_used IS NOT NULL OR v_expires <= now()
        OR v_org IS DISTINCT FROM app.current_org_id()
        OR NOT app.contractor_telegram_on(v_org, v_cp) THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::text;
      RETURN;
    END IF;
    UPDATE public.contractor_telegram_tokens t
      SET used_at = now(), used_chat_id = p_chat_id WHERE t.token_hash = p_token_hash;
    SELECT c.name INTO v_name FROM public.contractors c WHERE c.id = v_cp;
    SELECT l.id, l.status INTO v_link, v_status
      FROM public.contractor_telegram_links l
      WHERE l.contractor_id = v_cp AND l.chat_id = p_chat_id AND l.status IN ('wait', 'on');
    IF FOUND THEN
      RETURN QUERY SELECT CASE WHEN v_status = 'on' THEN 'already' ELSE 'pending' END,
        v_link, v_cp, v_name;
      RETURN;
    END IF;
    IF (SELECT count(*) FROM public.contractor_telegram_links l
          WHERE l.contractor_id = v_cp AND l.status IN ('wait', 'on')) >= p_max_links THEN
      RETURN QUERY SELECT 'limit'::text, NULL::uuid, v_cp, v_name;
      RETURN;
    END IF;
    INSERT INTO public.contractor_telegram_links (org_id, contractor_id, chat_id, name)
      VALUES (v_org, v_cp, p_chat_id, v_tg)
      RETURNING id INTO v_link;
    RETURN QUERY SELECT 'asked'::text, v_link, v_cp, v_name;
  END
  $$;
--> statement-breakpoint
-- К каким контрагентам подключён чат (команда клиента «Отключить»): без организации чат знает только
-- бот. Архивный контрагент тоже в списке — клиент может отключиться всегда.
CREATE FUNCTION app.contractor_telegram_chat(p_chat_id bigint)
  RETURNS TABLE (link_id uuid, org_id uuid, contractor_id uuid, contractor_name text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT l.id, l.org_id, l.contractor_id, c.name
      FROM public.contractor_telegram_links l
      JOIN public.contractors c ON c.id = l.contractor_id AND c.org_id = l.org_id
      WHERE l.chat_id = p_chat_id AND l.status = 'on'
      ORDER BY c.name, l.id
      LIMIT 20
  $$;
--> statement-breakpoint
-- Код страницы сменили («Сменить код», повторное включение), страницу выключили или закрыли — выданные
-- раньше неиспользованные ссылки больше не действуют: их получил браузер с прежним кодом. Использованные
-- остаются до уборки — по ним бот не отвечает второй раз на повтор сообщения.
CREATE FUNCTION app.contractor_telegram_revoke()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    DELETE FROM public.contractor_telegram_tokens t
      WHERE t.contractor_id = NEW.contractor_id AND t.used_at IS NULL;
    RETURN NULL;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_telegram_revoke() FROM PUBLIC, buhuchet_app;
--> statement-breakpoint
CREATE TRIGGER contractor_pages_telegram_revoke
  AFTER UPDATE ON contractor_pages
  FOR EACH ROW
  WHEN (NEW.code_version IS DISTINCT FROM OLD.code_version
    OR (OLD.enabled AND NOT NEW.enabled)
    OR (OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL))
  EXECUTE FUNCTION app.contractor_telegram_revoke();
--> statement-breakpoint
-- Удалить ссылки с истёкшим сроком (задача по расписанию вместе с запомненными браузерами страницы).
CREATE FUNCTION app.contractor_telegram_cleanup()
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_removed integer;
  BEGIN
    DELETE FROM public.contractor_telegram_tokens t WHERE t.expires_at <= now();
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    RETURN v_removed;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_telegram_issue(text, text, text, text, integer, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_telegram_peek(text, bigint) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_telegram_start(text, bigint, text, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_telegram_chat(bigint) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_telegram_cleanup() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.contractor_telegram_issue(text, text, text, text, integer, integer, integer),
  app.contractor_telegram_peek(text, bigint),
  app.contractor_telegram_start(text, bigint, text, integer),
  app.contractor_telegram_chat(bigint),
  app.contractor_telegram_cleanup() TO buhuchet_app;
