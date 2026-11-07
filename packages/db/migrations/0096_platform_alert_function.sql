-- Оповещение администраторам платформы о сбое (ревью безопасности Р-8, docs/decisions.md п. О-30):
-- задача по расписанию падает или давно не запускалась, вебхук Telegram отвечает ошибкой. Сообщение
-- ставится в очередь Telegram без организации каждому незаблокированному администратору платформы с
-- привязанным Telegram — как сообщение о заявке с сайта (0092), и уходит сразу (API) или со следующей
-- отправкой очереди. Ключ сообщения — `alert:<p_key>:<администратор>`: тот же p_key второго сообщения
-- не ставит (повтор вызова безопасен). Возвращает, скольким поставлено: 0 — некому сообщить или уже
-- поставлено. Связи Telegram роль приложения под RLS видит только в своей организации, поэтому —
-- функция от владельца схемы.
CREATE FUNCTION app.platform_alert(p_text text, p_key text, p_now timestamptz)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_count integer;
  BEGIN
    IF nullif(btrim(coalesce(p_text, '')), '') IS NULL OR nullif(coalesce(p_key, ''), '') IS NULL THEN
      RAISE EXCEPTION 'platform_alert: пустой текст или ключ';
    END IF;
    INSERT INTO public.telegram_outbox
      (org_id, user_id, chat_id, kind, text, status, tries, next_at, dedupe_key)
    SELECT NULL, u.id, l.chat_id, 'alert', left(p_text, 4000), 'pending', 0, p_now,
      'alert:' || left(p_key, 200) || ':' || u.id::text
    FROM public.telegram_links l
    JOIN public.users u ON u.id = l.user_id AND u.is_platform_admin AND NOT u.blocked
    ON CONFLICT ON CONSTRAINT telegram_outbox_dedupe_key DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.platform_alert(text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_alert(text, text, timestamptz) TO buhuchet_app;
