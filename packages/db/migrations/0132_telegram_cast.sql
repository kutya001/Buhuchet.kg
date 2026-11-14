-- Оформленная рассылка (поток Т, задача Т6; пакет заказчика 13.11.2026, идея 15; прототип v103
-- admin/tg-cast.js). Объявление уходит с описанием сообщения (картинка, заголовок, текст, кнопки-ссылки):
-- новая функция постановки в очередь с описанием; прежняя (три параметра) остаётся для версии сайта,
-- которая ещё работает во время выпуска. Число получателей для окна подтверждения считает отдельная
-- функция — по тому же условию, что постановка в очередь.
CREATE FUNCTION app.admin_telegram_broadcast(
  p_org uuid, p_text text, p_payload jsonb, p_now timestamptz
)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    n integer;
  BEGIN
    IF NOT app.is_platform_admin() THEN
      RETURN NULL;
    END IF;
    IF p_payload IS NOT NULL AND jsonb_typeof(p_payload) <> 'object' THEN
      RETURN NULL;
    END IF;
    IF p_org IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.organizations g WHERE g.id = p_org AND g.status = 'active'
    ) THEN
      RETURN NULL;
    END IF;
    INSERT INTO public.telegram_outbox
      (org_id, user_id, chat_id, kind, text, status, tries, next_at, payload)
    SELECT u.org_id, u.id, l.chat_id, 'broadcast', p_text, 'pending', 0, p_now, p_payload
    FROM public.telegram_links l
    JOIN public.users u ON u.id = l.user_id AND NOT u.blocked
    JOIN public.employees e ON e.user_id = u.id AND e.active
    JOIN public.organizations g ON g.id = u.org_id AND g.status = 'active'
    WHERE p_org IS NULL OR u.org_id = p_org;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END
  $$;
--> statement-breakpoint
CREATE FUNCTION app.admin_telegram_broadcast_count(p_org uuid)
  RETURNS integer
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    n integer;
  BEGIN
    IF NOT app.is_platform_admin() THEN
      RETURN NULL;
    END IF;
    IF p_org IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.organizations g WHERE g.id = p_org AND g.status = 'active'
    ) THEN
      RETURN NULL;
    END IF;
    SELECT count(*)::integer INTO n
    FROM public.telegram_links l
    JOIN public.users u ON u.id = l.user_id AND NOT u.blocked
    JOIN public.employees e ON e.user_id = u.id AND e.active
    JOIN public.organizations g ON g.id = u.org_id AND g.status = 'active'
    WHERE p_org IS NULL OR u.org_id = p_org;
    RETURN n;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_telegram_broadcast(uuid, text, jsonb, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_telegram_broadcast_count(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_telegram_broadcast(uuid, text, jsonb, timestamptz),
  app.admin_telegram_broadcast_count(uuid) TO buhuchet_app;
