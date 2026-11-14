-- Темы в чате с ботом (поток Т, задача Т7; docs/decisions.md п. Т-7). Номер темы у Telegram — про чат, а
-- не про организацию: роль приложения таблицу не видит (RLS без политик и без прав), читает и пишет её
-- только этими функциями. Вебхук и отправка очереди работают без входа и вне организации чата.
REVOKE ALL ON TABLE public.telegram_topics FROM buhuchet_app;
--> statement-breakpoint
CREATE FUNCTION app.telegram_topic_thread(p_chat bigint, p_key text)
  RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT t.thread_id FROM public.telegram_topics t WHERE t.chat_id = p_chat AND t.key = p_key
  $$;
--> statement-breakpoint
-- Тема, в которой человек нажал кнопку или написал команду: ответ идёт туда же, а в теме организации
-- команда отвечает по учётной записи этой организации.
CREATE FUNCTION app.telegram_topic_key(p_chat bigint, p_thread integer)
  RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT t.key FROM public.telegram_topics t WHERE t.chat_id = p_chat AND t.thread_id = p_thread
    ORDER BY t.created_at DESC LIMIT 1
  $$;
--> statement-breakpoint
CREATE FUNCTION app.telegram_topic_save(p_chat bigint, p_key text, p_thread integer)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    INSERT INTO public.telegram_topics (chat_id, key, thread_id) VALUES (p_chat, p_key, p_thread)
      ON CONFLICT (chat_id, key)
      DO UPDATE SET thread_id = excluded.thread_id, created_at = now()
  $$;
--> statement-breakpoint
-- Человек удалил тему: строку убирает только тот, кто знает её прежний номер (тему могли уже создать
-- заново другой отправкой).
CREATE FUNCTION app.telegram_topic_forget(p_chat bigint, p_key text, p_thread integer)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    DELETE FROM public.telegram_topics t
      WHERE t.chat_id = p_chat AND t.key = p_key AND t.thread_id = p_thread
  $$;
--> statement-breakpoint
-- «Сообщения с таблицами» больше не затирает другие настройки бота платформы (раздел `telegramBot`).
CREATE OR REPLACE FUNCTION app.admin_set_telegram_rich(p_rich boolean)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    was boolean;
    cur jsonb;
    body jsonb;
  BEGIN
    IF NOT app.is_platform_admin() OR p_rich IS NULL THEN
      RETURN NULL;
    END IF;
    SELECT r.payload INTO cur FROM public.platform_reference r WHERE r.key = 'telegramBot' FOR UPDATE;
    was := coalesce((cur ->> 'rich')::boolean, true);
    body := coalesce(cur, '{}'::jsonb) || jsonb_build_object('rich', p_rich);
    INSERT INTO public.platform_reference AS r (key, payload, checksum, source, updated_by)
      VALUES ('telegramBot', body, encode(sha256(convert_to(body::text, 'UTF8')), 'hex'), 'admin',
              app.current_user_id())
      ON CONFLICT (key) DO UPDATE
        SET payload = excluded.payload, checksum = excluded.checksum, version = r.version + 1,
            source = 'admin', updated_at = now(), updated_by = app.current_user_id();
    RETURN was;
  END
  $$;
--> statement-breakpoint
-- «Темы в чате с ботом» (по умолчанию выключено): только администратор платформы; прежнее значение.
CREATE FUNCTION app.admin_set_telegram_topics(p_on boolean)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    was boolean;
    cur jsonb;
    body jsonb;
  BEGIN
    IF NOT app.is_platform_admin() OR p_on IS NULL THEN
      RETURN NULL;
    END IF;
    SELECT r.payload INTO cur FROM public.platform_reference r WHERE r.key = 'telegramBot' FOR UPDATE;
    was := coalesce((cur ->> 'topics')::boolean, false);
    body := coalesce(cur, '{}'::jsonb) || jsonb_build_object('topics', p_on);
    INSERT INTO public.platform_reference AS r (key, payload, checksum, source, updated_by)
      VALUES ('telegramBot', body, encode(sha256(convert_to(body::text, 'UTF8')), 'hex'), 'admin',
              app.current_user_id())
      ON CONFLICT (key) DO UPDATE
        SET payload = excluded.payload, checksum = excluded.checksum, version = r.version + 1,
            source = 'admin', updated_at = now(), updated_by = app.current_user_id();
    RETURN was;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  app.telegram_topic_thread(bigint, text),
  app.telegram_topic_key(bigint, integer),
  app.telegram_topic_save(bigint, text, integer),
  app.telegram_topic_forget(bigint, text, integer),
  app.admin_set_telegram_topics(boolean)
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.telegram_topic_thread(bigint, text),
  app.telegram_topic_key(bigint, integer),
  app.telegram_topic_save(bigint, text, integer),
  app.telegram_topic_forget(bigint, text, integer),
  app.admin_set_telegram_topics(boolean)
  TO buhuchet_app;
