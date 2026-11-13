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
-- Описание и номер (по ним принимаются нажатия кнопок) пишутся, только если чат привязан к этому
-- пользователю: по сообщению в чужой чат нажатие принять нельзя. Возвращает идентификатор строки.
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
           CASE WHEN p_kind IN ('code', 'relink_code') OR NOT p_ok OR l.user_id IS NULL
                THEN NULL ELSE p_payload END,
           CASE WHEN p_ok AND l.user_id IS NOT NULL THEN p_message END
    FROM public.users u
    LEFT JOIN public.telegram_links l ON l.user_id = u.id AND l.chat_id = p_chat
    WHERE u.id = p_user
    RETURNING id
  $$;
--> statement-breakpoint
-- Нажатие кнопки: отправленное сообщение с кнопками по чату и номеру сообщения, кому оно отправлено и
-- можно ли этому пользователю сейчас действовать. `linked` — чат всё ещё привязан к этой учётной
-- записи: один Telegram бывает привязан к нескольким логинам, и после замены Telegram прежний чат
-- действовать не должен. `must_change_password` — пароль сброшен (временный): на сайте с ним доступна
-- только смена пароля, кнопки тоже не действуют; `relink_free` — после сброса пароля разрешено
-- привязать другой Telegram без кода (привязку могли захватить, п. О-20) — кнопки тоже не действуют.
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
    must_change_password boolean,
    relink_free boolean,
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
           u.must_change_password,
           EXISTS (SELECT 1 FROM public.telegram_link_guards g
                   WHERE g.user_id = u.id AND g.free_until > now()),
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
-- Нажатие обрабатывается по одному на сообщение: строка журнала блокируется до конца транзакции
-- действия, и возвращается её описание на этот момент — по нему кнопка сверяется ещё раз (два быстрых
-- нажатия, повторная доставка от Telegram). Только своё сообщение; пусто — не найдено.
CREATE FUNCTION app.telegram_press_lock(p_id uuid, p_chat bigint)
  RETURNS jsonb
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT m.payload FROM public.telegram_outbox m
    WHERE m.id = p_id AND m.chat_id = p_chat AND m.user_id = app.current_user_id()
      AND m.message_id IS NOT NULL AND m.payload IS NOT NULL AND m.status = 'sent'
    FOR UPDATE
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
-- организации, и под RLS его строка не видна). Хранится у пользователя, как в прототипе: отвязка и
-- другой Telegram выбор не сбрасывают.
CREATE FUNCTION app.telegram_plain_text(p_user uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT u.telegram_plain FROM public.users u WHERE u.id = p_user
  $$;
--> statement-breakpoint
-- Включить или выключить свои «Сообщения простым текстом». Возвращает прежнее значение; пусто —
-- Telegram не привязан (переключатель есть только у привязанного Telegram).
CREATE FUNCTION app.telegram_set_plain_text(p_plain boolean)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    was boolean;
  BEGIN
    IF p_plain IS NULL THEN
      RETURN NULL;
    END IF;
    SELECT u.telegram_plain INTO was FROM public.users u
      WHERE u.id = app.current_user_id()
        AND EXISTS (SELECT 1 FROM public.telegram_links l WHERE l.user_id = u.id)
      FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    UPDATE public.users u SET telegram_plain = p_plain WHERE u.id = app.current_user_id();
    RETURN was;
  END
  $$;
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
REVOKE ALL ON FUNCTION app.telegram_press_lock(uuid, bigint) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_press_save(uuid, bigint, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_plain_text(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_set_plain_text(boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_set_telegram_rich(boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.telegram_log(uuid, bigint, text, text, boolean, text, jsonb, bigint),
  app.telegram_press_target(bigint, bigint),
  app.telegram_press_lock(uuid, bigint),
  app.telegram_press_save(uuid, bigint, jsonb),
  app.telegram_plain_text(uuid),
  app.telegram_set_plain_text(boolean),
  app.admin_set_telegram_rich(boolean)
  TO buhuchet_app;
