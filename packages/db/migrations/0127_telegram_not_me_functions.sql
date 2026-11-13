-- «Это не я» под сообщениями бота о безопасности (поток Т, задача Т4; пакет заказчика 13.11.2026,
-- идея 9; прототип v101 modules/tg-security.js; docs/decisions.md п. Т-4). Кнопка стоит под «Пароль
-- изменён» (в привязанный чат), «Привязан другой Telegram» и «Telegram отвязан» (оба — в прежний чат).
-- Нажатие завершает все сеансы и закрывает вход той же блокировкой, что 10 неверных паролей подряд, —
-- с причиной `login_lock_reason = 'not_me'`; открывает его новый пароль от владельца организации
-- (владельцу — от администратора платформы).

-- Журнал сеансов: новая причина закрытия «not_me» (остальное — как в 0112).
CREATE OR REPLACE FUNCTION app.session_log_sync() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_reason text;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.session_log (id, user_id, org_id, started_at, last_seen_at, expires_at, device)
        VALUES (NEW.id, NEW.user_id, NEW.org_id, NEW.created_at, NEW.last_seen_at, NEW.expires_at,
                nullif(left(current_setting('app.session_device', true), 80), ''))
        ON CONFLICT (id) DO NOTHING;
      RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
      UPDATE public.session_log
        SET last_seen_at = NEW.last_seen_at, expires_at = NEW.expires_at
        WHERE id = NEW.id AND ended_at IS NULL;
      RETURN NEW;
    END IF;
    v_reason := current_setting('app.session_end', true);
    UPDATE public.session_log
      SET ended_at = least(now(), OLD.expires_at),
          last_seen_at = OLD.last_seen_at,
          expires_at = OLD.expires_at,
          end_reason = CASE
            WHEN OLD.expires_at <= now() THEN 'expired'
            WHEN v_reason IN ('logout', 'admin', 'blocked', 'password', 'reset', 'not_me') THEN v_reason
            ELSE 'closed'
          END
      WHERE id = OLD.id AND ended_at IS NULL;
    RETURN OLD;
  END
  $$;
--> statement-breakpoint
-- Поиск логина при входе: ещё и чем закрыт вход — от причины зависит текст отказа (после верного
-- пароля). Новый столбец — в конце: прежний код во время выкладки читает свои столбцы по именам.
DROP FUNCTION app.auth_find_login(text);
--> statement-breakpoint
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
    org_name text,
    login_locked boolean,
    is_owner boolean,
    login_lock_reason text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT u.id, u.org_id, u.login::text, u.password_hash, u.is_platform_admin, u.blocked,
           u.must_change_password, e.id, e.active, o.status, o.name,
           u.login_locked_at IS NOT NULL, coalesce(r.is_owner, false), u.login_lock_reason
    FROM public.users u
    LEFT JOIN public.employees e ON e.user_id = u.id
    LEFT JOIN public.roles r ON r.id = e.role_id AND r.org_id = e.org_id
    LEFT JOIN public.organizations o ON o.id = u.org_id
    WHERE lower(u.login::text) = lower(p_login)
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_find_login(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.auth_find_login(text) TO buhuchet_app;
--> statement-breakpoint
-- Новый пароль от владельца или администратора платформы снимает блокировку входа вместе с причиной
-- (остальное — как в 0095).
CREATE OR REPLACE FUNCTION app.auth_account_unlock(p_user uuid)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_was boolean;
  BEGIN
    SELECT u.login_locked_at IS NOT NULL INTO v_was
      FROM public.users u
      WHERE u.id = p_user AND u.org_id = app.current_org_id()
      FOR UPDATE;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    UPDATE public.users SET login_failures = 0, login_locked_at = NULL, login_lock_reason = NULL
      WHERE id = p_user;
    RETURN v_was;
  END
  $$;
--> statement-breakpoint
-- Сообщение, отправленное сразу, — в журнал (как в 0122). Описание и номер сообщения пишутся, если чат
-- привязан к получателю, и ещё у сообщений «Привязан другой Telegram» и «Telegram отвязан»: они уходят в
-- прежний чат, уже не привязанный, а кнопка «Это не я» под ними должна приниматься. Другие кнопки в
-- непривязанном чате бот не принимает (отказ ядра «Telegram не привязан»).
CREATE OR REPLACE FUNCTION app.telegram_log(
  p_user uuid, p_chat bigint, p_kind text, p_text text, p_ok boolean, p_error text,
  p_payload jsonb, p_message bigint
)
  RETURNS uuid
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    INSERT INTO public.telegram_outbox
      (org_id, user_id, chat_id, kind, text, status, tries, next_at, last_error, sent_at,
       payload, message_id)
    SELECT u.org_id, u.id, p_chat, p_kind,
           CASE WHEN p_kind IN ('code', 'relink_code') THEN NULL ELSE p_text END,
           CASE WHEN p_ok THEN 'sent' ELSE 'error' END, 1, now(),
           CASE WHEN p_ok THEN NULL ELSE left(coalesce(p_error, ''), 300) END,
           CASE WHEN p_ok THEN now() END,
           CASE WHEN p_kind IN ('code', 'relink_code') OR NOT p_ok
                  OR (l.user_id IS NULL AND p_kind NOT IN ('relinked', 'unlinked'))
                THEN NULL ELSE p_payload END,
           CASE WHEN p_ok AND (l.user_id IS NOT NULL OR p_kind IN ('relinked', 'unlinked'))
                THEN p_message END
    FROM public.users u
    LEFT JOIN public.telegram_links l ON l.user_id = u.id AND l.chat_id = p_chat
    WHERE u.id = p_user
    RETURNING id
  $$;
--> statement-breakpoint
-- Нажато «Это не я» в чате p_chat — только пользователем из контекста (транзакция нажатия идёт от имени
-- получателя сообщения) и только если бот отправлял ему в этот чат сообщение о безопасности с кнопкой.
-- Что делает:
--   — завершает все сеансы (в журнале сеансов — причина «not_me»);
--   — отвязывает Telegram, привязанный вместо этого чата; сам чат обратно не привязывается, но остаётся
--     «прежним»: он привяжется без кода, любой другой — только кодом из него; разрешение привязать
--     Telegram без кода после сброса пароля снимается;
--   — отменяет ожидающие коды замены Telegram, ссылки привязки и код «Забыли пароль?»;
--   — закрывает вход (login_locked_at, причина «not_me») и ставит в очередь сообщения тем, кто выдаёт
--     новый пароль: о сотруднике — владельцам его организации (p_staff_text), о владельце —
--     администраторам платформы (p_owner_text); только незаблокированным и с привязанным Telegram.
-- У администратора платформы вход не закрывается (новый пароль ему выдать некому) и сообщений нет.
-- status: done — выполнено; locked — вход уже закрыт (кнопка устарела); denied — учётная запись
-- заблокирована. Пусто — такого сообщения этому пользователю в этот чат бот не отправлял.
CREATE FUNCTION app.telegram_not_me(
    p_chat bigint, p_staff_text text, p_owner_text text, p_now timestamptz)
  RETURNS TABLE (
    status text,
    sessions integer,
    cut boolean,
    cut_username text,
    cut_first_name text,
    locked boolean,
    is_owner boolean,
    queued uuid[]
  )
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_user uuid := app.current_user_id();
    v_org uuid;
    v_admin boolean;
    v_blocked boolean;
    v_locked boolean;
    v_org_name text;
    v_owner boolean := false;
    v_sessions integer;
    v_cut public.telegram_links%ROWTYPE;
    v_event uuid := gen_random_uuid();
    v_queued uuid[] := '{}';
  BEGIN
    SELECT u.org_id, u.is_platform_admin, u.blocked, u.login_locked_at IS NOT NULL
      INTO v_org, v_admin, v_blocked, v_locked
      FROM public.users u WHERE u.id = v_user FOR UPDATE;
    IF NOT FOUND OR NOT EXISTS (
      SELECT 1 FROM public.telegram_outbox m
        WHERE m.user_id = v_user AND m.chat_id = p_chat AND m.status = 'sent'
          AND m.kind IN ('pass_changed', 'relinked', 'unlinked')
          AND m.payload IS NOT NULL AND m.message_id IS NOT NULL
    ) THEN
      RETURN;
    END IF;
    IF v_blocked THEN
      RETURN QUERY SELECT 'denied'::text, 0, false, NULL::text, NULL::text, false, false, v_queued;
      RETURN;
    END IF;
    IF v_locked AND NOT v_admin THEN
      RETURN QUERY SELECT 'locked'::text, 0, false, NULL::text, NULL::text, false, false, v_queued;
      RETURN;
    END IF;

    PERFORM set_config('app.session_end', 'not_me', true);
    WITH ended AS (DELETE FROM public.sessions s WHERE s.user_id = v_user RETURNING 1)
      SELECT count(*)::integer INTO v_sessions FROM ended;
    PERFORM set_config('app.session_end', '', true);

    DELETE FROM public.telegram_links l
      WHERE l.user_id = v_user AND l.chat_id <> p_chat RETURNING l.* INTO v_cut;
    IF NOT EXISTS (SELECT 1 FROM public.telegram_links l WHERE l.user_id = v_user) THEN
      -- Имя прежнего чата остаётся, только если «прежним» и был этот чат: имя чужого чата не переносится.
      INSERT INTO public.telegram_link_guards (user_id, org_id, chat_id)
        VALUES (v_user, v_org, p_chat)
        ON CONFLICT (user_id) DO UPDATE SET
          username = CASE WHEN telegram_link_guards.chat_id = EXCLUDED.chat_id
                          THEN telegram_link_guards.username END,
          first_name = CASE WHEN telegram_link_guards.chat_id = EXCLUDED.chat_id
                            THEN telegram_link_guards.first_name END,
          chat_id = EXCLUDED.chat_id, free_until = NULL, updated_at = now();
    ELSE
      UPDATE public.telegram_link_guards g SET free_until = NULL, updated_at = now()
        WHERE g.user_id = v_user AND g.free_until IS NOT NULL;
    END IF;
    UPDATE public.telegram_relink_codes c SET expires_at = now()
      WHERE c.user_id = v_user AND c.used_at IS NULL AND c.expires_at > now();
    UPDATE public.telegram_link_tokens t SET expires_at = now()
      WHERE t.user_id = v_user AND t.used_at IS NULL AND t.expires_at > now();
    PERFORM app.auth_reset_revoke(v_user);

    IF v_admin THEN
      RETURN QUERY SELECT 'done'::text, v_sessions, v_cut.user_id IS NOT NULL,
        v_cut.username, v_cut.first_name, false, false, v_queued;
      RETURN;
    END IF;

    UPDATE public.users SET login_locked_at = clock_timestamp(), login_lock_reason = 'not_me'
      WHERE id = v_user;
    SELECT o.name, coalesce(r.is_owner, false) INTO v_org_name, v_owner
      FROM public.organizations o
      LEFT JOIN public.employees e ON e.user_id = v_user AND e.org_id = o.id
      LEFT JOIN public.roles r ON r.id = e.role_id AND r.org_id = e.org_id
      WHERE o.id = v_org;
    IF v_owner AND p_owner_text IS NOT NULL THEN
      -- Администраторам платформы — без организации в начале: её название уже в тексте.
      WITH added AS (
        INSERT INTO public.telegram_outbox
          (org_id, user_id, chat_id, kind, text, status, tries, next_at, dedupe_key)
        SELECT NULL, u.id, l.chat_id, 'not_me', p_owner_text, 'pending', 0, p_now,
          'not_me:' || v_event::text || ':' || u.id::text
        FROM public.telegram_links l
        JOIN public.users u ON u.id = l.user_id AND u.is_platform_admin AND NOT u.blocked
        RETURNING id)
      SELECT coalesce(array_agg(id), '{}') INTO v_queued FROM added;
    ELSIF NOT v_owner AND p_staff_text IS NOT NULL THEN
      -- Telegram привязан к нескольким логинам — в начале сообщения организация (как app.auth_lock_notify).
      WITH added AS (
        INSERT INTO public.telegram_outbox
          (org_id, user_id, chat_id, kind, text, status, tries, next_at, dedupe_key)
        SELECT v_org, u.id, l.chat_id, 'not_me',
          CASE WHEN EXISTS (SELECT 1 FROM public.telegram_links s
                           WHERE s.chat_id = l.chat_id AND s.user_id <> l.user_id)
               THEN v_org_name || chr(10) || p_staff_text ELSE p_staff_text END,
          'pending', 0, p_now,
          'not_me:' || v_event::text || ':' || u.id::text
        FROM public.employees e
        JOIN public.roles r ON r.id = e.role_id AND r.org_id = e.org_id AND r.is_owner
        JOIN public.users u ON u.id = e.user_id AND NOT u.blocked
        JOIN public.telegram_links l ON l.user_id = u.id
        WHERE e.org_id = v_org AND e.active AND u.id <> v_user
        RETURNING id)
      SELECT coalesce(array_agg(id), '{}') INTO v_queued FROM added;
    END IF;
    RETURN QUERY SELECT 'done'::text, v_sessions, v_cut.user_id IS NOT NULL,
      v_cut.username, v_cut.first_name, true, v_owner, v_queued;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_not_me(bigint, text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.telegram_not_me(bigint, text, text, timestamptz) TO buhuchet_app;
