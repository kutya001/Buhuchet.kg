-- Основа бота Telegram (поток Т, задача Т1; пакет заказчика 13.11.2026; docs/decisions.md п. Т-1):
-- сообщения с таблицами и кнопками, нажатия кнопок, «Сообщения простым текстом», «Действия из Telegram»,
-- вид сообщений платформы. Вебхук бота работает без входа и без организации, поэтому сообщение по
-- нажатию находит функция SECURITY DEFINER; всё остальное идёт уже от имени нажавшего (RLS).

-- Очередь: после отправки запоминается номер сообщения в чате — по нему бот находит сообщение при
-- нажатии кнопки. Описание сообщения (payload) роль приложения сама не меняет — только функцией ниже.
GRANT UPDATE (message_id) ON TABLE telegram_outbox TO buhuchet_app;
--> statement-breakpoint
-- Сообщение, отправленное сразу (мимо очереди), — в журнал вместе с описанием сообщения и номером в
-- чате. Вид сообщения проверяет ограничение таблицы; у сообщений с кодом текст и описание не пишутся.
-- Возвращает идентификатор строки журнала.
CREATE FUNCTION app.telegram_log(
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
           CASE WHEN p_kind IN ('code', 'relink_code') OR NOT p_ok THEN NULL ELSE p_payload END,
           CASE WHEN p_ok THEN p_message END
    FROM public.users u
    WHERE u.id = p_user
    RETURNING id
  $$;
--> statement-breakpoint
-- Нажатие кнопки: отправленное сообщение с кнопками по чату и номеру сообщения, кому оно отправлено и
-- можно ли этому пользователю сейчас действовать. `linked` — чат всё ещё привязан к этой учётной
-- записи: один Telegram бывает привязан к нескольким логинам, и после замены Telegram прежний чат
-- действовать не должен.
CREATE FUNCTION app.telegram_press_target(p_chat bigint, p_message bigint)
  RETURNS TABLE (
    outbox_id uuid,
    user_id uuid,
    org_id uuid,
    employee_id uuid,
    login text,
    org_name text,
    payload jsonb,
    linked boolean,
    is_platform_admin boolean,
    user_blocked boolean,
    employee_active boolean,
    org_status text,
    telegram_actions boolean
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT m.id, u.id, u.org_id, e.id, u.login::text, o.name, m.payload,
           EXISTS (SELECT 1 FROM public.telegram_links l
                   WHERE l.user_id = u.id AND l.chat_id = p_chat),
           u.is_platform_admin, u.blocked, e.active, o.status,
           coalesce(s.telegram_actions, true)
    FROM public.telegram_outbox m
    JOIN public.users u ON u.id = m.user_id
    LEFT JOIN public.employees e ON e.user_id = u.id
    LEFT JOIN public.organizations o ON o.id = u.org_id
    LEFT JOIN public.org_settings s ON s.org_id = u.org_id
    WHERE m.chat_id = p_chat AND m.message_id = p_message
      AND m.payload IS NOT NULL AND m.status = 'sent'
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  $$;
--> statement-breakpoint
-- После нажатия: кнопка стала неактивной — запомнить описание сообщения. Только своё сообщение
-- (вызывается в транзакции от имени нажавшего) и только отправленное с кнопками.
CREATE FUNCTION app.telegram_press_save(p_id uuid, p_chat bigint, p_payload jsonb)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF p_payload IS NULL OR app.current_user_id() IS NULL THEN
      RETURN false;
    END IF;
    UPDATE public.telegram_outbox m
      SET payload = p_payload
      WHERE m.id = p_id AND m.chat_id = p_chat AND m.user_id = app.current_user_id()
        AND m.message_id IS NOT NULL AND m.payload IS NOT NULL;
    RETURN FOUND;
  END
  $$;
--> statement-breakpoint
-- «Сообщения простым текстом» пользователя (для отправки сразу: у администратора платформы нет
-- организации, и под RLS его привязка не видна). Telegram не привязан — пусто.
CREATE FUNCTION app.telegram_plain_text(p_user uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT l.plain_text FROM public.telegram_links l WHERE l.user_id = p_user
  $$;
--> statement-breakpoint
-- Включить или выключить свои «Сообщения простым текстом». Возвращает прежнее значение; пусто —
-- Telegram не привязан.
CREATE FUNCTION app.telegram_set_plain_text(p_plain boolean)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    was boolean;
  BEGIN
    SELECT l.plain_text INTO was FROM public.telegram_links l
      WHERE l.user_id = app.current_user_id() FOR UPDATE;
    IF NOT FOUND OR p_plain IS NULL THEN
      RETURN NULL;
    END IF;
    UPDATE public.telegram_links l SET plain_text = p_plain
      WHERE l.user_id = app.current_user_id();
    RETURN was;
  END
  $$;
--> statement-breakpoint
-- Новая привязка — снова вид по умолчанию: другое приложение Telegram может показывать таблицы.
-- (Строка привязки при замене чата обновляется, поэтому сброс — триггером на смену чата.)
CREATE FUNCTION app.telegram_links_reset_plain()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NEW.chat_id IS DISTINCT FROM OLD.chat_id THEN
      NEW.plain_text := false;
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
CREATE TRIGGER telegram_links_reset_plain BEFORE UPDATE OF chat_id ON public.telegram_links
  FOR EACH ROW EXECUTE FUNCTION app.telegram_links_reset_plain();
--> statement-breakpoint
-- Админка → «Телеграм» → «Бот платформы» → «Сообщения с таблицами»: настройка хранится разделом
-- `telegramBot` справочников платформы (`platform_reference`); пишет только администратор платформы.
-- Возвращает прежнее значение (раздела ещё нет — включено); пусто — в контексте не администратор.
CREATE FUNCTION app.admin_set_telegram_rich(p_rich boolean)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    was boolean;
    body jsonb := jsonb_build_object('rich', p_rich);
  BEGIN
    IF NOT app.is_platform_admin() OR p_rich IS NULL THEN
      RETURN NULL;
    END IF;
    SELECT coalesce((r.payload ->> 'rich')::boolean, true) INTO was
      FROM public.platform_reference r WHERE r.key = 'telegramBot' FOR UPDATE;
    INSERT INTO public.platform_reference AS r (key, payload, checksum, source, updated_by)
      VALUES ('telegramBot', body, encode(sha256(convert_to(body::text, 'UTF8')), 'hex'), 'admin',
              app.current_user_id())
      ON CONFLICT (key) DO UPDATE
        SET payload = excluded.payload, checksum = excluded.checksum, version = r.version + 1,
            source = 'admin', updated_at = now(), updated_by = app.current_user_id();
    RETURN coalesce(was, true);
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_log(uuid, bigint, text, text, boolean, text, jsonb, bigint)
  FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_press_target(bigint, bigint) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_press_save(uuid, bigint, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_plain_text(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_set_plain_text(boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_links_reset_plain() FROM PUBLIC, buhuchet_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_set_telegram_rich(boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.telegram_log(uuid, bigint, text, text, boolean, text, jsonb, bigint),
  app.telegram_press_target(bigint, bigint),
  app.telegram_press_save(uuid, bigint, jsonb),
  app.telegram_plain_text(uuid),
  app.telegram_set_plain_text(boolean),
  app.admin_set_telegram_rich(boolean)
  TO buhuchet_app;
