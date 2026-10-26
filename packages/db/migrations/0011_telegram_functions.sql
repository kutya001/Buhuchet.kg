-- Telegram и «Забыли пароль?» (ТЗ «Восстановление пароля через Telegram», «Телеграм бот для любых
-- уведомлений»). Вебхук бота и восстановление пароля работают без входа, когда организация ещё не
-- известна, а привязка и коды администратора платформы лежат без организации. Поэтому эти шаги —
-- узкие функции от владельца схемы (SECURITY DEFINER), которые выполняет только роль приложения, как
-- app.auth_* из миграции 0009. Изменение от имени пользователя (привязать, отвязать, задать пароль по
-- коду) делается только для app.current_user_id(): API вызывает его в withOrgContext и в той же
-- транзакции пишет историю.

-- Привязанный Telegram пользователя: куда писать и привязан ли этот же Telegram к другим логинам
-- (тогда в сообщениях указывается организация).
CREATE OR REPLACE FUNCTION app.telegram_chat(p_user uuid)
  RETURNS TABLE (chat_id bigint, username text, first_name text, linked_at timestamptz, shared boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT l.chat_id, l.username, l.first_name, l.linked_at,
           EXISTS (SELECT 1 FROM public.telegram_links o
                   WHERE o.chat_id = l.chat_id AND o.user_id <> l.user_id)
    FROM public.telegram_links l
    WHERE l.user_id = p_user
  $$;
--> statement-breakpoint
-- Новая ссылка привязки для пользователя из контекста: прежние его ссылки перестают действовать,
-- давно истёкшие ссылки всех пользователей удаляются. Возвращает срок действия.
CREATE OR REPLACE FUNCTION app.telegram_link_token(p_token_hash text, p_ttl_minutes integer)
  RETURNS timestamptz
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_user uuid := app.current_user_id();
    v_org uuid;
    v_until timestamptz := now() + make_interval(mins => p_ttl_minutes);
  BEGIN
    SELECT u.org_id INTO v_org FROM public.users u WHERE u.id = v_user;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'telegram_link_token: нет пользователя в контексте';
    END IF;
    DELETE FROM public.telegram_link_tokens
      WHERE user_id = v_user OR expires_at < now() - interval '1 day';
    INSERT INTO public.telegram_link_tokens (token_hash, user_id, org_id, expires_at)
      VALUES (p_token_hash, v_user, v_org, v_until);
    RETURN v_until;
  END
  $$;
--> statement-breakpoint
-- Чья ссылка пришла в бот (по хешу токена): пользователь, организация и состояние учётной записи,
-- чтобы API открыл транзакцию от его имени. Ничего не меняет.
CREATE OR REPLACE FUNCTION app.telegram_link_peek(p_token_hash text)
  RETURNS TABLE (
    user_id uuid,
    org_id uuid,
    login text,
    org_name text,
    used boolean,
    expired boolean,
    linked_chat_id bigint,
    is_platform_admin boolean,
    user_blocked boolean,
    employee_active boolean,
    org_status text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT t.user_id, t.org_id, u.login::text, o.name, t.used_at IS NOT NULL, t.expires_at <= now(),
           l.chat_id, u.is_platform_admin, u.blocked, e.active, o.status
    FROM public.telegram_link_tokens t
    JOIN public.users u ON u.id = t.user_id
    LEFT JOIN public.employees e ON e.user_id = u.id
    LEFT JOIN public.organizations o ON o.id = t.org_id
    LEFT JOIN public.telegram_links l ON l.user_id = t.user_id
    WHERE t.token_hash = p_token_hash
  $$;
--> statement-breakpoint
-- Привязать чат по ссылке — только пользователю из контекста и только неиспользованной, не истёкшей
-- ссылкой (строка ссылки блокируется: одновременный повтор привяжет один раз). Прежняя привязка
-- пользователя заменяется. Пусто — ссылка уже не действует.
CREATE OR REPLACE FUNCTION app.telegram_link_use(
    p_token_hash text, p_chat_id bigint, p_username text, p_first_name text)
  RETURNS TABLE (prev_username text, prev_first_name text, prev_chat_id bigint, shared boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_user uuid := app.current_user_id();
    v_org uuid;
    v_prev public.telegram_links%ROWTYPE;
  BEGIN
    SELECT t.org_id INTO v_org FROM public.telegram_link_tokens t
      WHERE t.token_hash = p_token_hash AND t.user_id = v_user
        AND t.used_at IS NULL AND t.expires_at > now()
      FOR UPDATE;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    UPDATE public.telegram_link_tokens SET used_at = now() WHERE token_hash = p_token_hash;
    SELECT * INTO v_prev FROM public.telegram_links l WHERE l.user_id = v_user;
    INSERT INTO public.telegram_links (user_id, org_id, chat_id, username, first_name)
      VALUES (v_user, v_org, p_chat_id, p_username, p_first_name)
      ON CONFLICT (user_id) DO UPDATE
        SET chat_id = EXCLUDED.chat_id, username = EXCLUDED.username,
            first_name = EXCLUDED.first_name, linked_at = now();
    RETURN QUERY SELECT v_prev.username, v_prev.first_name, v_prev.chat_id,
      EXISTS (SELECT 1 FROM public.telegram_links o
              WHERE o.chat_id = p_chat_id AND o.user_id <> v_user);
  END
  $$;
--> statement-breakpoint
-- Отвязать Telegram пользователя из контекста; возвращает, что было привязано (пусто — ничего).
CREATE OR REPLACE FUNCTION app.telegram_unlink()
  RETURNS TABLE (username text, first_name text)
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    DELETE FROM public.telegram_links l WHERE l.user_id = app.current_user_id()
      RETURNING l.username, l.first_name
  $$;
--> statement-breakpoint
-- Запрос кода «Забыли пароль?». Строка пользователя блокируется, поэтому одновременные запросы не
-- превысят p_max_per_hour. status: sent — код записан (прежние коды перестают действовать),
-- no_telegram — Telegram не привязан, limited — лимит за час исчерпан (retry_at — когда можно снова),
-- no_user — нет пользователя. Коды старше суток удаляются.
CREATE OR REPLACE FUNCTION app.auth_reset_request(
    p_user uuid, p_code_hash text, p_ttl_minutes integer, p_max_per_hour integer)
  RETURNS TABLE (
    status text,
    expires_at timestamptz,
    retry_at timestamptz,
    chat_id bigint,
    username text,
    first_name text,
    shared boolean
  )
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_org uuid;
    v_link record;
    v_count integer;
    v_first timestamptz;
    v_until timestamptz := now() + make_interval(mins => p_ttl_minutes);
  BEGIN
    SELECT u.org_id INTO v_org FROM public.users u WHERE u.id = p_user FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'no_user'::text, NULL::timestamptz, NULL::timestamptz, NULL::bigint,
        NULL::text, NULL::text, false;
      RETURN;
    END IF;
    SELECT * INTO v_link FROM app.telegram_chat(p_user);
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'no_telegram'::text, NULL::timestamptz, NULL::timestamptz, NULL::bigint,
        NULL::text, NULL::text, false;
      RETURN;
    END IF;
    SELECT count(*), min(c.created_at) INTO v_count, v_first FROM public.password_reset_codes c
      WHERE c.user_id = p_user AND c.created_at > now() - interval '1 hour';
    IF v_count >= p_max_per_hour THEN
      RETURN QUERY SELECT 'limited'::text, NULL::timestamptz, v_first + interval '1 hour',
        v_link.chat_id, v_link.username, v_link.first_name, v_link.shared;
      RETURN;
    END IF;
    UPDATE public.password_reset_codes c SET expires_at = now()
      WHERE c.user_id = p_user AND c.used_at IS NULL AND c.expires_at > now();
    DELETE FROM public.password_reset_codes c
      WHERE c.user_id = p_user AND c.created_at < now() - interval '1 day';
    INSERT INTO public.password_reset_codes (user_id, org_id, code_hash, expires_at)
      VALUES (p_user, v_org, p_code_hash, v_until);
    RETURN QUERY SELECT 'sent'::text, v_until, NULL::timestamptz,
      v_link.chat_id, v_link.username, v_link.first_name, v_link.shared;
  END
  $$;
--> statement-breakpoint
-- Ввод кода занимается до его проверки: у последнего действующего кода пользователя попытка +1, пока
-- их меньше p_max_attempts. Строка кода блокируется на время UPDATE, поэтому одновременные запросы
-- проверят не больше p_max_attempts вариантов. Пусто — действующего кода нет или попытки кончились.
CREATE OR REPLACE FUNCTION app.auth_reset_attempt(p_user uuid, p_max_attempts integer)
  RETURNS TABLE (reset_id uuid, code_hash text)
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.password_reset_codes c SET attempts = c.attempts + 1
    WHERE c.id = (SELECT l.id FROM public.password_reset_codes l
                  WHERE l.user_id = p_user AND l.used_at IS NULL AND l.expires_at > now()
                  ORDER BY l.created_at DESC LIMIT 1)
      AND c.used_at IS NULL AND c.expires_at > now() AND c.attempts < p_max_attempts
    RETURNING c.id, c.code_hash
  $$;
--> statement-breakpoint
-- Верный код: новый пароль пользователю из контекста, код использован, все его сеансы завершаются,
-- блокировка входа после неверных паролей снимается. false — код уже не действует.
CREATE OR REPLACE FUNCTION app.auth_reset_complete(p_reset uuid, p_password_hash text)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_user uuid := app.current_user_id();
  BEGIN
    UPDATE public.password_reset_codes SET used_at = now()
      WHERE id = p_reset AND user_id = v_user AND used_at IS NULL AND expires_at > now();
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    UPDATE public.users
      SET password_hash = p_password_hash, must_change_password = false,
          failed_logins = 0, locked_until = NULL, version = version + 1, updated_at = now()
      WHERE id = v_user;
    DELETE FROM public.sessions WHERE user_id = v_user;
    RETURN true;
  END
  $$;
--> statement-breakpoint
-- Учётная запись для администратора платформы (сброс пароля): организация и логин. Отвечает, только
-- если в контексте — незаблокированный администратор платформы; остальным — пусто.
CREATE OR REPLACE FUNCTION app.admin_find_user(p_user uuid)
  RETURNS TABLE (user_id uuid, org_id uuid, login text, is_platform_admin boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT u.id, u.org_id, u.login::text, u.is_platform_admin
    FROM public.users u
    WHERE u.id = p_user AND EXISTS (
      SELECT 1 FROM public.users a
      WHERE a.id = app.current_user_id() AND a.is_platform_admin AND NOT a.blocked
    )
  $$;
--> statement-breakpoint
-- Владелец ли организации пользователь: «Забыли пароль?» без Telegram подсказывает, кто сбросит
-- пароль (владельцу — администратор платформы, остальным — владелец).
CREATE OR REPLACE FUNCTION app.auth_is_owner(p_user uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT coalesce((SELECT r.is_owner FROM public.employees e
                     JOIN public.roles r ON r.id = e.role_id
                     WHERE e.user_id = p_user), false)
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_chat(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_link_token(text, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_link_peek(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_link_use(text, bigint, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_unlink() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_reset_request(uuid, text, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_reset_attempt(uuid, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_reset_complete(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_find_user(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_is_owner(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.telegram_chat(uuid), app.telegram_link_token(text, integer),
  app.telegram_link_peek(text), app.telegram_link_use(text, bigint, text, text),
  app.telegram_unlink(), app.auth_reset_request(uuid, text, integer, integer),
  app.auth_reset_attempt(uuid, integer), app.auth_reset_complete(uuid, text),
  app.admin_find_user(uuid), app.auth_is_owner(uuid) TO buhuchet_app;
