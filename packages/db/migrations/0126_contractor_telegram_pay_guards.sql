-- «К оплате» клиенту в Telegram (доработки 13.11.2026, задача К4; прототип v94): права роли приложения
-- и функции. Сообщение клиенту роль приложения записывает в своей организации и только от своего
-- имени (у задачи по расписанию и у клиента автора нет), дальше меняет только отметку отправки, кнопки,
-- отметку ответа и — пока сообщение не ушло — итог (повтор собирает сообщение заново); строки не удаляет.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE contractor_telegram_messages FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (message_id, payload, attempts, answered_at, total)
  ON TABLE contractor_telegram_messages TO buhuchet_app;
--> statement-breakpoint
CREATE POLICY "contractor_telegram_messages_insert_guard" ON "contractor_telegram_messages"
  AS RESTRICTIVE FOR INSERT TO "buhuchet_app"
  WITH CHECK ("sent_by" IS NOT DISTINCT FROM app.current_user_id());
--> statement-breakpoint
-- Итог меняется только у сообщения, которое ещё не ушло: у ушедшего по нему пишется «Оплатил».
CREATE FUNCTION app.contractor_telegram_message_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF OLD.message_id IS NOT NULL AND NEW.total IS DISTINCT FROM OLD.total THEN
      RAISE EXCEPTION 'contractor_telegram_messages: итог отправленного сообщения не меняется'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_telegram_message_guard() FROM PUBLIC, buhuchet_app;
--> statement-breakpoint
CREATE TRIGGER contractor_telegram_messages_total_guard
  BEFORE UPDATE OF total ON contractor_telegram_messages
  FOR EACH ROW
  EXECUTE FUNCTION app.contractor_telegram_message_guard();
--> statement-breakpoint
-- Чьё это сообщение бота — до транзакции организации (нажатие кнопки клиентом приходит без входа):
-- только сообщение клиенту в этом чате. linked — подключение ещё действует: строка «Подключён»,
-- контрагент не в архиве, организация работает (прототип pgTgLinked).
CREATE FUNCTION app.contractor_telegram_message(p_chat_id bigint, p_message_id bigint)
  RETURNS TABLE (id uuid, org_id uuid, contractor_id uuid, link_id uuid, kind text, linked boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT m.id, m.org_id, m.contractor_id, m.link_id, m.kind,
           (l.status = 'on' AND c.service_status <> 'archived' AND o.status = 'active')
      FROM public.contractor_telegram_messages m
      JOIN public.contractor_telegram_links l ON l.id = m.link_id
      JOIN public.contractors c ON c.id = m.contractor_id AND c.org_id = m.org_id
      JOIN public.organizations o ON o.id = m.org_id
      WHERE m.chat_id = p_chat_id AND m.message_id = p_message_id
        AND p_chat_id IS NOT NULL AND p_message_id IS NOT NULL
  $$;
--> statement-breakpoint
-- Открытая просьба «напишите ваш вопрос» в чате клиента: та, на которую он ответил (p_reply_to), а без
-- ответа — последняя за сутки; отвеченная просьба не возвращается. linked — подключение ещё действует
-- (как у нажатия): отключённому клиенту бот отвечает «Этот Telegram не подключён…».
CREATE FUNCTION app.contractor_telegram_ask(p_chat_id bigint, p_reply_to bigint)
  RETURNS TABLE (id uuid, org_id uuid, contractor_id uuid, link_id uuid, kind text, linked boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT m.id, m.org_id, m.contractor_id, m.link_id, m.kind,
           (l.status = 'on' AND c.service_status <> 'archived' AND o.status = 'active')
      FROM public.contractor_telegram_messages m
      JOIN public.contractor_telegram_links l ON l.id = m.link_id
      JOIN public.contractors c ON c.id = m.contractor_id AND c.org_id = m.org_id
      JOIN public.organizations o ON o.id = m.org_id
      WHERE m.chat_id = p_chat_id AND m.kind = 'ask'
        AND m.message_id IS NOT NULL AND m.answered_at IS NULL
        AND CASE WHEN p_reply_to IS NULL
              THEN m.created_at > now() - interval '24 hours'
              ELSE m.message_id = p_reply_to END
      ORDER BY m.created_at DESC, m.id
      LIMIT 1
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_telegram_message(bigint, bigint) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_telegram_ask(bigint, bigint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.contractor_telegram_message(bigint, bigint),
  app.contractor_telegram_ask(bigint, bigint) TO buhuchet_app;
