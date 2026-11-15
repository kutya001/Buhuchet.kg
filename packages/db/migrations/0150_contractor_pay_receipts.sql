-- Чек к «Оплатил» через бота (доработки 14.11.2026, блок 4, пункт 4, этап 2, поток К; прототип v115
-- `tgAct('cp-receipt')`): чек становится чеком сообщения «ждёт подтверждения». Роль приложения ставит
-- его без пользователя (клиент — не сотрудник); политика `contractor_pay_claims_update_guard` уже
-- пускает только ждущее подтверждения.
GRANT UPDATE (sent_file_id) ON TABLE public.contractor_pay_claims TO buhuchet_app;--> statement-breakpoint
-- Чек, который уже стоит, другим не заменяется: второй чек — новое «Оплатил». Пусто можно: так
-- непринятый чек снимает удаление файла (внешний ключ с SET NULL).
CREATE FUNCTION app.contractor_pay_claim_receipt_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF OLD.sent_file_id IS NOT NULL AND NEW.sent_file_id IS NOT NULL
       AND NEW.sent_file_id IS DISTINCT FROM OLD.sent_file_id THEN
      RAISE EXCEPTION 'contractor_pay_claims: чек сообщения об оплате не заменяется'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_pay_claim_receipt_guard() FROM PUBLIC, buhuchet_app;--> statement-breakpoint
CREATE TRIGGER contractor_pay_claims_receipt_guard
  BEFORE UPDATE OF sent_file_id ON public.contractor_pay_claims
  FOR EACH ROW
  EXECUTE FUNCTION app.contractor_pay_claim_receipt_guard();--> statement-breakpoint
-- Открытая просьба «Пришлите чек» в чате клиента — до транзакции организации (файл приходит без
-- входа): та, на которую он ответил (p_reply_to), а без ответа — последняя за этот день по Бишкеку
-- (p_day). Отвеченная или отменённая не возвращается. linked — подключение ещё действует (как у
-- `app.contractor_telegram_ask`); message_id — номер просьбы в чате: её «Отмена» гаснет, когда чек принят.
CREATE FUNCTION app.contractor_telegram_receipt(p_chat_id bigint, p_reply_to bigint, p_day text)
  RETURNS TABLE (id uuid, org_id uuid, contractor_id uuid, link_id uuid, kind text, linked boolean,
                 message_id bigint)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT m.id, m.org_id, m.contractor_id, m.link_id, m.kind,
           (l.status = 'on' AND c.service_status <> 'archived' AND o.status = 'active'), m.message_id
      FROM public.contractor_telegram_messages m
      JOIN public.contractor_telegram_links l ON l.id = m.link_id
      JOIN public.contractors c ON c.id = m.contractor_id AND c.org_id = m.org_id
      JOIN public.organizations o ON o.id = m.org_id
      WHERE m.chat_id = p_chat_id AND m.kind = 'receipt'
        AND m.message_id IS NOT NULL AND m.answered_at IS NULL
        AND m.payload -> 'ask' ->> 'day' = p_day
        AND coalesce(m.payload -> 'ask' ->> 'off', 'false') <> 'true'
        AND (p_reply_to IS NULL OR m.message_id = p_reply_to)
      ORDER BY m.created_at DESC, m.id
      LIMIT 1
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_telegram_receipt(bigint, bigint, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.contractor_telegram_receipt(bigint, bigint, text) TO buhuchet_app;
