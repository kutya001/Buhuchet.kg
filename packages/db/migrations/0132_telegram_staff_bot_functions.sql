-- Действия сотрудника из чата бота (поток Т, задача Т2; пакет заказчика 13.11.2026, идеи 1, 3 и 7;
-- прототип v97 modules/tg-chat.js — `m.ask`, `tgAskOpen`, `tgReply`): «ответ боту». Бот просит файл или
-- причину отдельным сообщением; что он ждёт, записано в описании этого сообщения (`payload.ask`).
-- Человек отвечает на сообщение или просто присылает файл в чат — тогда ответ относится к последней
-- открытой просьбе этого чата за сегодня. Вебхук бота работает без входа и без организации, поэтому
-- открытые просьбы чата находит функция SECURITY DEFINER: она отдаёт только номер сообщения и что бот
-- ждёт. Чей это чат и можно ли действовать, дальше проверяет `app.telegram_press_target`, а действие
-- идёт от имени получателя сообщения (RLS).

-- Просьб мало, сообщений с кнопками много: свой маленький индекс только по сообщениям-просьбам.
CREATE INDEX "telegram_outbox_ask_idx" ON "telegram_outbox" USING btree ("chat_id", "created_at" DESC)
  WHERE "message_id" IS NOT NULL AND ("payload" -> 'ask') IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION app.telegram_open_asks(p_chat bigint, p_day text)
  RETURNS TABLE (message_id bigint, ask jsonb)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT m.message_id, m.payload -> 'ask'
    FROM public.telegram_outbox m
    WHERE m.chat_id = p_chat AND m.message_id IS NOT NULL AND (m.payload -> 'ask') IS NOT NULL
      AND m.status = 'sent'
      AND m.payload -> 'ask' ->> 'day' = p_day
      AND coalesce(m.payload -> 'ask' ->> 'off', 'false') <> 'true'
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 20
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_open_asks(bigint, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.telegram_open_asks(bigint, text) TO buhuchet_app;
