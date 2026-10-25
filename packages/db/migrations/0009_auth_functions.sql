-- Вход и сеансы до того, как известна организация (ТЗ «Вход и сеансы — свои»). Роль приложения видит
-- пользователей и сеансы только своей организации (RLS), а при входе и проверке cookie организация
-- ещё не известна. Поэтому эти шаги — узкие функции от владельца схемы (SECURITY DEFINER), которые
-- выполняет только роль приложения. Логины хранятся в нижнем регистре, сравнение — без citext,
-- чтобы не зависеть от схемы расширения.

-- Учётная запись по логину: хеш пароля для проверки, блокировки и состояние организации.
CREATE OR REPLACE FUNCTION app.auth_find_login(p_login text)
  RETURNS TABLE (
    user_id uuid,
    org_id uuid,
    login text,
    password_hash text,
    is_platform_admin boolean,
    user_blocked boolean,
    must_change_password boolean,
    locked_until timestamptz,
    locked boolean,
    employee_id uuid,
    employee_active boolean,
    org_status text,
    org_name text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT u.id, u.org_id, u.login::text, u.password_hash, u.is_platform_admin, u.blocked,
           u.must_change_password, u.locked_until, coalesce(u.locked_until > now(), false),
           e.id, e.active, o.status, o.name
    FROM public.users u
    LEFT JOIN public.employees e ON e.user_id = u.id
    LEFT JOIN public.organizations o ON o.id = u.org_id
    WHERE lower(u.login::text) = lower(p_login)
  $$;
--> statement-breakpoint
-- Попытка входа занимается до проверки пароля: счётчик +1, на p_max-й подряд вход закрывается на
-- p_lock_minutes (счётчик с нуля; верный пароль снимает блокировку в auth_start_session). Пока вход
-- закрыт, попытка не занимается (allowed = false) и пароль не проверяется. Строка пользователя
-- блокируется на время UPDATE, поэтому одновременные запросы проверят не больше p_max паролей.
-- locked = true: после этой попытки вход закрыт, если пароль окажется неверным.
CREATE OR REPLACE FUNCTION app.auth_login_attempt(p_user uuid, p_max integer, p_lock_minutes integer)
  RETURNS TABLE (allowed boolean, locked boolean, locked_until timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_until timestamptz;
  BEGIN
    UPDATE public.users u SET
      failed_logins = CASE WHEN u.failed_logins + 1 >= p_max THEN 0 ELSE u.failed_logins + 1 END,
      locked_until = CASE WHEN u.failed_logins + 1 >= p_max
                          THEN now() + make_interval(mins => p_lock_minutes) END
    WHERE u.id = p_user AND (u.locked_until IS NULL OR u.locked_until <= now())
    RETURNING u.locked_until INTO v_until;
    IF FOUND THEN
      RETURN QUERY SELECT true, v_until IS NOT NULL, v_until;
    ELSE
      RETURN QUERY SELECT false, true, u.locked_until FROM public.users u WHERE u.id = p_user;
    END IF;
  END
  $$;
--> statement-breakpoint
-- Верный пароль: счётчик сбрасывается, создаётся сеанс; возвращает номер сеанса.
CREATE OR REPLACE FUNCTION app.auth_start_session(p_user uuid, p_token_hash text, p_ttl_days integer)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_org uuid;
    v_session uuid;
  BEGIN
    UPDATE public.users SET failed_logins = 0, locked_until = NULL, last_login_at = now()
      WHERE id = p_user
      RETURNING org_id INTO v_org;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'auth_start_session: нет пользователя';
    END IF;
    INSERT INTO public.sessions (user_id, org_id, token_hash, expires_at)
      VALUES (p_user, v_org, p_token_hash, now() + make_interval(days => p_ttl_days))
      RETURNING id INTO v_session;
    RETURN v_session;
  END
  $$;
--> statement-breakpoint
-- Сеанс по токену из cookie (только не истёкший) и состояние пользователя; срок продлевается,
-- если с прошлого продления прошло больше p_touch_minutes (touched = true — обновить cookie).
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
  AS $$
    WITH touched AS (
      UPDATE public.sessions
        SET last_seen_at = now(), expires_at = now() + make_interval(days => p_ttl_days)
        WHERE token_hash = p_token_hash AND expires_at > now()
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
  $$;
--> statement-breakpoint
-- Выход: сеанс удаляется.
CREATE OR REPLACE FUNCTION app.auth_end_session(p_token_hash text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ DELETE FROM public.sessions WHERE token_hash = p_token_hash $$;
--> statement-breakpoint
-- Смена своего пароля: только пользователь из контекста транзакции (app.user_id). Остальные сеансы
-- удаляются, у текущего меняется токен — старая cookie больше не действует нигде.
CREATE OR REPLACE FUNCTION app.auth_change_own_password(
    p_session uuid, p_password_hash text, p_new_token_hash text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_user uuid := app.current_user_id();
  BEGIN
    IF v_user IS NULL THEN
      RAISE EXCEPTION 'auth_change_own_password: нет пользователя в контексте';
    END IF;
    UPDATE public.sessions SET token_hash = p_new_token_hash, last_seen_at = now()
      WHERE id = p_session AND user_id = v_user;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'auth_change_own_password: сеанс не найден';
    END IF;
    UPDATE public.users
      SET password_hash = p_password_hash, must_change_password = false,
          failed_logins = 0, locked_until = NULL, version = version + 1, updated_at = now()
      WHERE id = v_user;
    DELETE FROM public.sessions WHERE user_id = v_user AND id <> p_session;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_find_login(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_login_attempt(uuid, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_start_session(uuid, text, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_session(text, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_end_session(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_change_own_password(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.auth_find_login(text), app.auth_login_attempt(uuid, integer, integer),
  app.auth_start_session(uuid, text, integer), app.auth_session(text, integer, integer),
  app.auth_end_session(text), app.auth_change_own_password(uuid, text, text) TO buhuchet_app;
