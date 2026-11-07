-- ОТКЛОНЕНИЕ: docs/deviations.md#О-11
-- Блокировка входа после 10 неверных паролей подряд (решение заказчика 07.11.2026, ревью безопасности
-- 06.11.2026, п. Р-4). Счёт ведётся у настоящей учётной записи (а не по набранному логину, как
-- login_attempts) и со временем не забывается; его снимают верный пароль и новый пароль. На
-- p_max-м неверном пароле вход закрывается (login_locked_at), пока владелец (сотруднику) или
-- администратор платформы (владельцу) не выдаст временный пароль. У администраторов платформы счёта
-- нет — снять блокировку было бы некому. О блокировке входящий узнаёт только после верного пароля
-- (docs/deviations.md, п. 4, решение Б); открытые сеансы она не закрывает.
-- Новый вид сообщения очереди: «Вход заблокирован».
ALTER TABLE "telegram_outbox" DROP CONSTRAINT "telegram_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "login_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "login_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_kind_check" CHECK ("telegram_outbox"."kind" in ('reminders', 'task_new', 'task_on_confirm', 'task_confirmed', 'task_rework', 'task_cancelled', 'report_fix', 'code', 'linked', 'relinked', 'unlinked', 'pass_changed', 'pass_reset', 'broadcast', 'lead', 'login_locked'));--> statement-breakpoint
-- Поиск логина при входе: ещё «вход закрыт» и «владелец организации» (кто снимает блокировку). Новые
-- столбцы — в конце: прежний код во время выкладки читает свои столбцы по именам.
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
    is_owner boolean
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT u.id, u.org_id, u.login::text, u.password_hash, u.is_platform_admin, u.blocked,
           u.must_change_password, e.id, e.active, o.status, o.name,
           u.login_locked_at IS NOT NULL, coalesce(r.is_owner, false)
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
-- Неверный пароль у учётной записи: счёт +1, на p_max-м подряд вход закрывается; locked_now — эта
-- попытка закрыла вход (ровно одна из одновременных: строка блокируется на время UPDATE, а закрытую
-- учётную запись счёт уже не трогает). p_user пусто (такого логина нет) — ничего не меняется, но
-- запрос к базе тот же: по времени ответа не видно, есть ли логин.
CREATE FUNCTION app.auth_login_failed(p_user uuid, p_max integer)
  RETURNS TABLE (locked_now boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_failures integer;
  BEGIN
    UPDATE public.users u SET login_failures = u.login_failures + 1
      WHERE u.id = p_user AND NOT u.is_platform_admin AND u.login_locked_at IS NULL
      RETURNING u.login_failures INTO v_failures;
    IF v_failures IS NOT NULL AND v_failures >= p_max THEN
      UPDATE public.users SET login_locked_at = clock_timestamp() WHERE id = p_user;
      RETURN QUERY SELECT true;
      RETURN;
    END IF;
    RETURN QUERY SELECT false;
  END
  $$;
--> statement-breakpoint
-- Вход только что закрыт: запись в историю организации (от имени системы) и сообщения в очередь
-- Telegram — самому пользователю (p_user_text) и тем, кто снимает блокировку (p_unlocker_text):
-- сотруднику — владельцам его организации, владельцу — администраторам платформы; только
-- незаблокированным и с привязанным Telegram. Очередь, а не отправка сразу: ответ на попытку входа
-- не ждёт Telegram. Ключ сообщения — по записи истории: у каждой блокировки свои сообщения. Если
-- Telegram привязан к нескольким логинам, в начале сообщения — организация (как withOrganization в
-- @buhuchet/domain и app.telegram_chat); администраторам — без неё: организации у них нет, а её
-- название и так в тексте.
CREATE FUNCTION app.auth_lock_notify(
    p_user uuid, p_user_text text, p_unlocker_text text, p_now timestamptz)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_org uuid;
    v_org_name text;
    v_owner boolean;
    v_event bigint;
  BEGIN
    SELECT u.org_id, o.name, coalesce(r.is_owner, false) INTO v_org, v_org_name, v_owner
      FROM public.users u
      JOIN public.organizations o ON o.id = u.org_id
      LEFT JOIN public.employees e ON e.user_id = u.id
      LEFT JOIN public.roles r ON r.id = e.role_id AND r.org_id = e.org_id
      WHERE u.id = p_user AND u.login_locked_at IS NOT NULL AND u.org_id IS NOT NULL;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    INSERT INTO public.audit_log (org_id, entity, entity_id, action, changes, actor_user_id)
      VALUES (v_org, 'user', p_user::text, 'login_lock', '[]'::jsonb, NULL)
      RETURNING id INTO v_event;
    -- Тексты пусты — бот не подключён: только запись в историю.
    IF p_user_text IS NOT NULL THEN
      INSERT INTO public.telegram_outbox
        (org_id, user_id, chat_id, kind, text, status, tries, next_at, dedupe_key)
      SELECT v_org, l.user_id, l.chat_id, 'login_locked',
        CASE WHEN EXISTS (SELECT 1 FROM public.telegram_links s
                         WHERE s.chat_id = l.chat_id AND s.user_id <> l.user_id)
             THEN v_org_name || chr(10) || p_user_text ELSE p_user_text END,
        'pending', 0, p_now,
        'login_lock:' || v_event::text || ':' || l.user_id::text
      FROM public.telegram_links l
      WHERE l.user_id = p_user;
    END IF;
    IF p_unlocker_text IS NULL THEN
      RETURN;
    END IF;
    IF v_owner THEN
      INSERT INTO public.telegram_outbox
        (org_id, user_id, chat_id, kind, text, status, tries, next_at, dedupe_key)
      SELECT NULL, u.id, l.chat_id, 'login_locked', p_unlocker_text, 'pending', 0, p_now,
        'login_lock:' || v_event::text || ':' || u.id::text
      FROM public.telegram_links l
      JOIN public.users u ON u.id = l.user_id AND u.is_platform_admin AND NOT u.blocked;
    ELSE
      INSERT INTO public.telegram_outbox
        (org_id, user_id, chat_id, kind, text, status, tries, next_at, dedupe_key)
      SELECT v_org, u.id, l.chat_id, 'login_locked',
        CASE WHEN EXISTS (SELECT 1 FROM public.telegram_links s
                         WHERE s.chat_id = l.chat_id AND s.user_id <> l.user_id)
             THEN v_org_name || chr(10) || p_unlocker_text ELSE p_unlocker_text END,
        'pending', 0, p_now,
        'login_lock:' || v_event::text || ':' || u.id::text
      FROM public.employees e
      JOIN public.roles r ON r.id = e.role_id AND r.org_id = e.org_id AND r.is_owner
      JOIN public.users u ON u.id = e.user_id AND NOT u.blocked
      JOIN public.telegram_links l ON l.user_id = u.id
      WHERE e.org_id = v_org AND e.active AND u.id <> p_user;
    END IF;
  END
  $$;
--> statement-breakpoint
-- Новый пароль от владельца или администратора платформы (временный): блокировка входа и счёт
-- неверных паролей снимаются. Только у пользователя организации из контекста (app.org_id); true —
-- вход был закрыт.
CREATE FUNCTION app.auth_account_unlock(p_user uuid)
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
    UPDATE public.users SET login_failures = 0, login_locked_at = NULL WHERE id = p_user;
    RETURN v_was;
  END
  $$;
--> statement-breakpoint
-- Верный пароль, смена или сброс пароля: как в 0013, и ещё снимается счёт неверных паролей учётной
-- записи, если вход не закрыт (закрытый вход снимает только новый пароль, app.auth_account_unlock).
CREATE OR REPLACE FUNCTION app.auth_login_clear(p_login text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    DELETE FROM public.login_attempts WHERE login = lower(btrim(p_login));
    UPDATE public.users SET login_failures = 0
      WHERE lower(login::text) = lower(btrim(p_login)) AND login_failures > 0
        AND login_locked_at IS NULL;
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_login_failed(uuid, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_lock_notify(uuid, text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_account_unlock(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.auth_login_failed(uuid, integer),
  app.auth_lock_notify(uuid, text, text, timestamptz), app.auth_account_unlock(uuid) TO buhuchet_app;
