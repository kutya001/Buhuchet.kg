-- «Осталось попыток» после неверного кода — меньший из двух остатков: по ссылке (5 подряд) и по адресу
-- (3 за час), иначе с одного адреса третий неверный код неожиданно закрывал бы ввод на час
-- (docs/deviations.md п. О-1, решение заказчика 30.10.2026). Остальное — как в 0059. Права на
-- функцию CREATE OR REPLACE сохраняет.
CREATE OR REPLACE FUNCTION app.contractor_page_try_code(
    p_slug text, p_inn text, p_code text, p_ip_hash text, p_token_hash text, p_tries integer,
    p_lock_minutes integer, p_ip_max integer, p_ip_window_minutes integer, p_ip_lock_minutes integer,
    p_remember_days integer, p_max_grants integer)
  RETURNS TABLE (outcome text, tries_left integer, locked_until timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_page record;
    v_ip_until timestamptz;
    v_failures integer;
    v_ip_failures integer;
    v_until timestamptz;
  BEGIN
    SELECT p.org_id, p.contractor_id, p.code, p.code_version, p.failures, p.locked_until INTO v_page
      FROM public.organizations o
      JOIN public.org_settings s ON s.org_id = o.id
      JOIN public.contractors c ON c.org_id = o.id AND c.inn = p_inn
      JOIN public.contractor_pages p ON p.contractor_id = c.id AND p.org_id = o.id
      WHERE o.slug = p_slug AND o.status = 'active' AND (s.features ->> 'cppage') = 'true'
        AND c.service_status <> 'archived' AND p.enabled
      FOR UPDATE OF p;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'unavailable'::text, NULL::integer, NULL::timestamptz;
      RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('cp_page_ip:' || p_ip_hash, 0));
    SELECT max(r.busy_until) INTO v_ip_until FROM public.rate_limits r
      WHERE r.kind = 'cp_page_ip_lock' AND r.subject = p_ip_hash AND r.busy_until > now();
    IF v_ip_until IS NOT NULL THEN
      RETURN QUERY SELECT 'ip_locked'::text, NULL::integer, v_ip_until;
      RETURN;
    END IF;
    IF v_page.locked_until > now() THEN
      RETURN QUERY SELECT 'locked'::text, NULL::integer, v_page.locked_until;
      RETURN;
    END IF;
    IF p_code = v_page.code THEN
      UPDATE public.contractor_pages p
        SET failures = 0, locked_until = NULL
        WHERE p.contractor_id = v_page.contractor_id;
      INSERT INTO public.contractor_page_grants (token_hash, org_id, contractor_id, code_version,
          expires_at)
        VALUES (p_token_hash, v_page.org_id, v_page.contractor_id, v_page.code_version,
          now() + make_interval(days => p_remember_days));
      DELETE FROM public.contractor_page_grants g
        WHERE g.contractor_id = v_page.contractor_id
          AND g.token_hash IN (
            SELECT x.token_hash FROM public.contractor_page_grants x
              WHERE x.contractor_id = v_page.contractor_id
              ORDER BY x.created_at DESC, x.token_hash
              OFFSET p_max_grants
          );
      RETURN QUERY SELECT 'ok'::text, NULL::integer, NULL::timestamptz;
      RETURN;
    END IF;
    v_failures := v_page.failures + 1;
    v_until := CASE WHEN v_failures >= p_tries THEN now() + make_interval(mins => p_lock_minutes) END;
    UPDATE public.contractor_pages p
      SET failures = CASE WHEN v_until IS NULL THEN v_failures ELSE 0 END,
          locked_until = v_until
      WHERE p.contractor_id = v_page.contractor_id;
    IF v_until IS NOT NULL THEN
      INSERT INTO public.audit_log (org_id, entity, entity_id, action, changes, contractor_id,
          actor_user_id)
        VALUES (v_page.org_id, 'contractor_page', v_page.contractor_id::text, 'page_lock',
          '[]'::jsonb, v_page.contractor_id, NULL);
    END IF;
    INSERT INTO public.rate_limits (kind, subject) VALUES ('cp_page_ip', p_ip_hash);
    SELECT count(*) INTO v_ip_failures FROM public.rate_limits r
      WHERE r.kind = 'cp_page_ip' AND r.subject = p_ip_hash
        AND r.at > now() - make_interval(mins => p_ip_window_minutes);
    IF v_ip_failures >= p_ip_max THEN
      v_ip_until := now() + make_interval(mins => p_ip_lock_minutes);
      INSERT INTO public.rate_limits (kind, subject, busy_until)
        VALUES ('cp_page_ip_lock', p_ip_hash, v_ip_until);
    END IF;
    IF v_until IS NOT NULL THEN
      RETURN QUERY SELECT 'locked'::text, NULL::integer, v_until;
    ELSIF v_ip_until IS NOT NULL THEN
      RETURN QUERY SELECT 'ip_locked'::text, NULL::integer, v_ip_until;
    ELSE
      RETURN QUERY SELECT 'wrong'::text, least(p_tries - v_failures, p_ip_max - v_ip_failures),
        NULL::timestamptz;
    END IF;
  END
  $$;
