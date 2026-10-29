-- Страница контрагента по ссылке (задача 2.42, docs/decisions.md п. Е-1). Страницы роль приложения
-- создаёт и меняет только в своей организации (RLS, миграция contractor_page). Не удаляет никто, кроме
-- каскада с контрагентом; UPDATE — только на столбцы включения, кода, разделов и счёта неверных кодов
-- (его сбрасывают «Включить» и «Сменить код»). Страницу включает сотрудник от своего имени.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE contractor_pages FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (
  enabled, code, code_version, hidden_sections, failures, failed_at, locked_until, updated_by,
  updated_at, version
) ON TABLE contractor_pages TO buhuchet_app;
--> statement-breakpoint
CREATE POLICY contractor_pages_insert_own ON contractor_pages AS RESTRICTIVE FOR INSERT TO buhuchet_app
  WITH CHECK (created_by = app.current_user_id());
--> statement-breakpoint
-- Запомненные браузеры роль приложения не видит и не меняет: только функции ниже.
REVOKE ALL ON TABLE contractor_page_grants FROM buhuchet_app;
--> statement-breakpoint
-- Страница по ссылке без входа: открыта ли она и что показать. Выключенная страница, неизвестные адрес
-- организации и ИНН, архивный контрагент, выключенная в учётной политике функция «Страница контрагента
-- по ссылке» и заблокированная организация дают одно и то же — «unavailable» без данных (ТЗ «одна и
-- та же страница «Страница недоступна»»). Остальное: «open» — браузер с запомненным кодом текущего
-- номера (тогда — организация и контрагент, чтобы показать страницу), «locked» — ввод кода по ссылке
-- закрыт до locked_until, «code» — показать ввод кода. Код наружу не отдаётся никогда.
CREATE FUNCTION app.contractor_page_state(p_slug text, p_inn text, p_token_hash text)
  RETURNS TABLE (state text, org_id uuid, contractor_id uuid, locked_until timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_page record;
  BEGIN
    SELECT p.org_id, p.contractor_id, p.code_version, p.locked_until INTO v_page
      FROM public.organizations o
      JOIN public.org_settings s ON s.org_id = o.id
      JOIN public.contractors c ON c.org_id = o.id AND c.inn = p_inn
      JOIN public.contractor_pages p ON p.contractor_id = c.id AND p.org_id = o.id
      WHERE o.slug = p_slug AND o.status = 'active' AND (s.features ->> 'cppage') = 'true'
        AND c.service_status <> 'archived' AND p.enabled;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;
    IF p_token_hash IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.contractor_page_grants g
      WHERE g.token_hash = p_token_hash AND g.contractor_id = v_page.contractor_id
        AND g.code_version = v_page.code_version AND g.expires_at > now()
    ) THEN
      RETURN QUERY SELECT 'open'::text, v_page.org_id, v_page.contractor_id, NULL::timestamptz;
      RETURN;
    END IF;
    IF v_page.locked_until > now() THEN
      RETURN QUERY SELECT 'locked'::text, NULL::uuid, NULL::uuid, v_page.locked_until;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'code'::text, NULL::uuid, NULL::uuid, NULL::timestamptz;
  END
  $$;
--> statement-breakpoint
-- Ввод кода на странице без входа. Попытки по одной ссылке идут по очереди (строка страницы
-- блокируется), с одного адреса — тоже (блокировка по адресу), поэтому пределы не обойти
-- одновременными запросами. Порядок:
--   1) страница недоступна — «unavailable», счёт не ведётся;
--   2) с адреса за p_ip_window_minutes было p_ip_max неверных кодов по любым ссылкам — ввод с него
--      закрыт на p_ip_lock_minutes: «ip_locked» (адрес приходит хешем, сам адрес не хранится);
--   3) ввод по ссылке закрыт — «locked»;
--   4) верный код — счёт по ссылке снимается, браузер запоминается до p_remember_days (хеш токена из
--      cookie и номер кода): «ok»;
--   5) неверный — +1 по ссылке и по адресу; на p_tries-м подряд ввод по ссылке закрывается на
--      p_lock_minutes, счёт начинается заново («locked», link_locked — записать в историю); счёт по
--      ссылке забывается через p_memory_minutes после последнего неверного; иначе «wrong» и сколько
--      попыток осталось. Неверный код, после которого адрес набрал предел, — «ip_locked».
-- Организация и контрагент отдаются только при «ok» и закрытии по ссылке — для истории контрагента.
CREATE FUNCTION app.contractor_page_try_code(
    p_slug text, p_inn text, p_code text, p_ip_hash text, p_token_hash text, p_tries integer,
    p_lock_minutes integer, p_memory_minutes integer, p_ip_max integer, p_ip_window_minutes integer,
    p_ip_lock_minutes integer, p_remember_days integer)
  RETURNS TABLE (outcome text, tries_left integer, locked_until timestamptz, org_id uuid,
    contractor_id uuid, link_locked boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_page record;
    v_ip_until timestamptz;
    v_failures integer;
    v_until timestamptz;
  BEGIN
    SELECT p.org_id, p.contractor_id, p.code, p.code_version, p.failures, p.failed_at,
        p.locked_until INTO v_page
      FROM public.organizations o
      JOIN public.org_settings s ON s.org_id = o.id
      JOIN public.contractors c ON c.org_id = o.id AND c.inn = p_inn
      JOIN public.contractor_pages p ON p.contractor_id = c.id AND p.org_id = o.id
      WHERE o.slug = p_slug AND o.status = 'active' AND (s.features ->> 'cppage') = 'true'
        AND c.service_status <> 'archived' AND p.enabled
      FOR UPDATE OF p;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'unavailable'::text, NULL::integer, NULL::timestamptz, NULL::uuid,
        NULL::uuid, false;
      RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('cp_page_ip:' || p_ip_hash, 0));
    SELECT max(r.busy_until) INTO v_ip_until FROM public.rate_limits r
      WHERE r.kind = 'cp_page_ip_lock' AND r.subject = p_ip_hash AND r.busy_until > now();
    IF v_ip_until IS NOT NULL THEN
      RETURN QUERY SELECT 'ip_locked'::text, NULL::integer, v_ip_until, NULL::uuid, NULL::uuid, false;
      RETURN;
    END IF;
    IF v_page.locked_until > now() THEN
      RETURN QUERY SELECT 'locked'::text, NULL::integer, v_page.locked_until, NULL::uuid, NULL::uuid,
        false;
      RETURN;
    END IF;
    IF p_code = v_page.code THEN
      UPDATE public.contractor_pages p
        SET failures = 0, failed_at = NULL, locked_until = NULL
        WHERE p.contractor_id = v_page.contractor_id;
      INSERT INTO public.contractor_page_grants (token_hash, org_id, contractor_id, code_version,
          expires_at)
        VALUES (p_token_hash, v_page.org_id, v_page.contractor_id, v_page.code_version,
          now() + make_interval(days => p_remember_days));
      RETURN QUERY SELECT 'ok'::text, NULL::integer, NULL::timestamptz, v_page.org_id,
        v_page.contractor_id, false;
      RETURN;
    END IF;
    v_failures := CASE
      WHEN v_page.failed_at IS NULL OR v_page.failed_at <= now() - make_interval(mins => p_memory_minutes)
        THEN 1
      ELSE v_page.failures + 1
    END;
    v_until := CASE WHEN v_failures >= p_tries THEN now() + make_interval(mins => p_lock_minutes) END;
    UPDATE public.contractor_pages p
      SET failures = CASE WHEN v_until IS NULL THEN v_failures ELSE 0 END,
          failed_at = CASE WHEN v_until IS NULL THEN now() END,
          locked_until = v_until
      WHERE p.contractor_id = v_page.contractor_id;
    INSERT INTO public.rate_limits (kind, subject) VALUES ('cp_page_ip', p_ip_hash);
    IF (
      SELECT count(*) FROM public.rate_limits r
      WHERE r.kind = 'cp_page_ip' AND r.subject = p_ip_hash
        AND r.at > now() - make_interval(mins => p_ip_window_minutes)
    ) >= p_ip_max THEN
      v_ip_until := now() + make_interval(mins => p_ip_lock_minutes);
      INSERT INTO public.rate_limits (kind, subject, busy_until)
        VALUES ('cp_page_ip_lock', p_ip_hash, v_ip_until);
    END IF;
    IF v_until IS NOT NULL THEN
      RETURN QUERY SELECT 'locked'::text, NULL::integer, v_until, v_page.org_id, v_page.contractor_id,
        true;
    ELSIF v_ip_until IS NOT NULL THEN
      RETURN QUERY SELECT 'ip_locked'::text, NULL::integer, v_ip_until, NULL::uuid, NULL::uuid, false;
    ELSE
      RETURN QUERY SELECT 'wrong'::text, p_tries - v_failures, NULL::timestamptz, NULL::uuid,
        NULL::uuid, false;
    END IF;
  END
  $$;
--> statement-breakpoint
-- Очистка по расписанию: запомненные браузеры с истёкшим сроком, со старым номером кода и у
-- выключенных страниц (повторное включение даёт новый номер, такие браузеры доступа уже не получат).
CREATE FUNCTION app.contractor_page_grants_cleanup()
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH gone AS (
      DELETE FROM public.contractor_page_grants g
      USING public.contractor_pages p
      WHERE p.contractor_id = g.contractor_id
        AND (g.expires_at <= now() OR g.code_version <> p.code_version OR NOT p.enabled)
      RETURNING 1
    )
    SELECT count(*)::integer FROM gone
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_page_state(text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_page_try_code(text, text, text, text, text, integer, integer,
  integer, integer, integer, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_page_grants_cleanup() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.contractor_page_state(text, text, text),
  app.contractor_page_try_code(text, text, text, text, text, integer, integer, integer, integer,
    integer, integer, integer),
  app.contractor_page_grants_cleanup() TO buhuchet_app;
