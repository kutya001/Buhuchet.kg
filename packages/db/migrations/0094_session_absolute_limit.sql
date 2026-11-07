-- Абсолютный срок сеанса (ревью безопасности 06.11.2026, п. Р-12; docs/deviations.md п. О-10): сеанс
-- действует не дольше p_max_hours с входа (created_at), даже если им пользуются; продление не уходит
-- дальше этого срока. Остальное — как в 0009: сеанс по токену и состояние пользователя.
CREATE FUNCTION app.auth_session(
    p_token_hash text, p_ttl_days integer, p_touch_minutes integer, p_max_hours integer)
  RETURNS TABLE (
    session_id uuid,
    user_id uuid,
    org_id uuid,
    login text,
    is_platform_admin boolean,
    must_change_password boolean,
    user_blocked boolean,
    employee_id uuid,
    employee_active boolean,
    org_status text,
    org_name text,
    touched boolean
  )
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH touched AS (
      UPDATE public.sessions
        SET last_seen_at = now(),
            expires_at = least(now() + make_interval(days => p_ttl_days),
                               created_at + make_interval(hours => p_max_hours))
        WHERE token_hash = p_token_hash AND expires_at > now()
          AND created_at > now() - make_interval(hours => p_max_hours)
          AND last_seen_at < now() - make_interval(mins => p_touch_minutes)
        RETURNING id
    )
    SELECT s.id, s.user_id, s.org_id, u.login::text, u.is_platform_admin, u.must_change_password,
           u.blocked, e.id, e.active, o.status, o.name, EXISTS (SELECT 1 FROM touched)
    FROM public.sessions s
    JOIN public.users u ON u.id = s.user_id
    LEFT JOIN public.employees e ON e.user_id = u.id
    LEFT JOIN public.organizations o ON o.id = s.org_id
    WHERE s.token_hash = p_token_hash AND s.expires_at > now()
      AND s.created_at > now() - make_interval(hours => p_max_hours)
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_session(text, integer, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.auth_session(text, integer, integer, integer) TO buhuchet_app;
--> statement-breakpoint
-- Прежний вызов с тремя параметрами остаётся, пока работает старая версия сайта: миграции идут до
-- выкладки. Он тоже соблюдает предел — 12 часов (SESSION_MAX_HOURS). Удалить следующей миграцией,
-- когда новая версия будет на стенде и рабочем сайте.
CREATE OR REPLACE FUNCTION app.auth_session(p_token_hash text, p_ttl_days integer, p_touch_minutes integer)
  RETURNS TABLE (
    session_id uuid,
    user_id uuid,
    org_id uuid,
    login text,
    is_platform_admin boolean,
    must_change_password boolean,
    user_blocked boolean,
    employee_id uuid,
    employee_active boolean,
    org_status text,
    org_name text,
    touched boolean
  )
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT * FROM app.auth_session(p_token_hash, p_ttl_days, p_touch_minutes, 12) $$;
