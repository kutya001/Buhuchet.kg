-- Вход: одинаковый ответ для любого логина (docs/deviations.md, п. 4, решение Б). Неверные пароли
-- считаются по набранному логину в login_attempts, есть такой логин или нет: «вход закрыт» наступает
-- одинаково и не выдаёт, какие логины есть на платформе. Счёт и блокировка уходят из users, поэтому
-- функции входа из миграций 0009 и 0011 заменяются. Как и там, это узкие функции от владельца схемы
-- (SECURITY DEFINER), которые выполняет только роль приложения; саму таблицу роль приложения не видит.

DROP FUNCTION app.auth_find_login(text);
--> statement-breakpoint
-- Учётная запись по логину: хеш пароля для проверки, блокировки и состояние организации.
CREATE FUNCTION app.auth_find_login(p_login text)
  RETURNS TABLE (
    user_id uuid,
    org_id uuid,
    login text,
    password_hash text,
    is_platform_admin boolean,
    user_blocked boolean,
    must_change_password boolean,
    employee_id uuid,
    employee_active boolean,
    org_status text,
    org_name text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT u.id, u.org_id, u.login::text, u.password_hash, u.is_platform_admin, u.blocked,
           u.must_change_password, e.id, e.active, o.status, o.name
    FROM public.users u
    LEFT JOIN public.employees e ON e.user_id = u.id
    LEFT JOIN public.organizations o ON o.id = u.org_id
    WHERE lower(u.login::text) = lower(p_login)
  $$;
--> statement-breakpoint
DROP FUNCTION app.auth_login_attempt(uuid, integer, integer);
--> statement-breakpoint
-- Попытка входа по набранному логину занимается до проверки пароля: счёт +1, на p_max-й подряд вход
-- закрывается на p_lock_minutes, и счёт начинается с нуля. Через p_memory_hours после последней
-- попытки счёт забывается. Пока вход закрыт, попытка не занимается (allowed = false) и пароль не
-- проверяется. Строка логина блокируется до конца функции, поэтому одновременные запросы проверят не
-- больше p_max паролей. locked = true: после этой попытки вход закрыт, если пароль окажется неверным.
CREATE FUNCTION app.auth_login_attempt(
    p_login text, p_max integer, p_lock_minutes integer, p_memory_hours integer)
  RETURNS TABLE (allowed boolean, locked boolean, locked_until timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_login text := lower(btrim(p_login));
    v_failures integer;
    v_until timestamptz;
    v_last timestamptz;
  BEGIN
    INSERT INTO public.login_attempts (login) VALUES (v_login) ON CONFLICT DO NOTHING;
    SELECT a.failures, a.locked_until, a.last_attempt_at INTO v_failures, v_until, v_last
      FROM public.login_attempts a
      WHERE a.login = v_login
      FOR UPDATE;
    IF v_until > now() THEN
      RETURN QUERY SELECT false, true, v_until;
      RETURN;
    END IF;
    IF v_last <= now() - make_interval(hours => p_memory_hours) THEN
      v_failures := 0;
    END IF;
    v_failures := v_failures + 1;
    v_until := CASE WHEN v_failures >= p_max THEN now() + make_interval(mins => p_lock_minutes) END;
    UPDATE public.login_attempts a
      SET failures = CASE WHEN v_until IS NULL THEN v_failures ELSE 0 END,
          locked_until = v_until,
          last_attempt_at = now()
      WHERE a.login = v_login;
    RETURN QUERY SELECT true, v_until IS NOT NULL, v_until;
  END
  $$;
--> statement-breakpoint
-- Верный пароль, смена или сброс пароля: счёт неверных паролей и блокировка входа по логину снимаются.
CREATE FUNCTION app.auth_login_clear(p_login text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ DELETE FROM public.login_attempts WHERE login = lower(btrim(p_login)) $$;
--> statement-breakpoint
-- Очистка по расписанию: строки, чей счёт уже забыт и вход не закрыт. Удаление такой строки ничего
-- не меняет для входа: попытка по ней и так начала бы счёт с нуля.
CREATE FUNCTION app.auth_login_cleanup(p_memory_hours integer)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH gone AS (
      DELETE FROM public.login_attempts
      WHERE last_attempt_at <= now() - make_interval(hours => p_memory_hours)
        AND (locked_until IS NULL OR locked_until <= now())
      RETURNING 1
    )
    SELECT count(*)::integer FROM gone
  $$;
--> statement-breakpoint
-- Верный пароль: создаётся сеанс; возвращает номер сеанса. Счёт неверных паролей снимает
-- app.auth_login_clear сразу после проверки пароля.
CREATE OR REPLACE FUNCTION app.auth_start_session(p_user uuid, p_token_hash text, p_ttl_days integer)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_org uuid;
    v_session uuid;
  BEGIN
    UPDATE public.users SET last_login_at = now()
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
-- Смена своего пароля: только пользователь из контекста транзакции (app.user_id). Остальные сеансы
-- удаляются, у текущего меняется токен — старая cookie больше не действует нигде. Блокировка входа
-- по его логину снимается.
CREATE OR REPLACE FUNCTION app.auth_change_own_password(
    p_session uuid, p_password_hash text, p_new_token_hash text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_user uuid := app.current_user_id();
    v_login text;
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
          version = version + 1, updated_at = now()
      WHERE id = v_user
      RETURNING users.login::text INTO v_login;
    DELETE FROM public.sessions WHERE user_id = v_user AND id <> p_session;
    DELETE FROM public.login_attempts a WHERE a.login = lower(v_login);
  END
  $$;
--> statement-breakpoint
-- Верный код: новый пароль пользователю из контекста, код использован, все его сеансы завершаются,
-- блокировка входа по его логину снимается. false — код уже не действует.
CREATE OR REPLACE FUNCTION app.auth_reset_complete(p_reset uuid, p_password_hash text)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_user uuid := app.current_user_id();
    v_login text;
  BEGIN
    UPDATE public.password_reset_codes SET used_at = now()
      WHERE id = p_reset AND user_id = v_user AND used_at IS NULL AND expires_at > now();
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    UPDATE public.users
      SET password_hash = p_password_hash, must_change_password = false,
          version = version + 1, updated_at = now()
      WHERE id = v_user
      RETURNING users.login::text INTO v_login;
    DELETE FROM public.sessions WHERE user_id = v_user;
    DELETE FROM public.login_attempts a WHERE a.login = lower(v_login);
    RETURN true;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_find_login(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_login_attempt(text, integer, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_login_clear(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_login_cleanup(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.auth_find_login(text),
  app.auth_login_attempt(text, integer, integer, integer), app.auth_login_clear(text),
  app.auth_login_cleanup(integer) TO buhuchet_app;
--> statement-breakpoint
-- Счёт неверных паролей роль приложения не читает и не меняет напрямую — только функциями выше.
REVOKE ALL ON TABLE public.login_attempts FROM buhuchet_app;
