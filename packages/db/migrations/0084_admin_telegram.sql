-- Админка → «Телеграм» (ТЗ «Админка» → «Модуль Телеграмм»; прототип admin/telegram.js; задача 2.41,
-- docs/decisions.md п. Д-13). Журнал отправок (telegram_outbox, миграции 0078–0079) роль приложения
-- под RLS видит только в своей организации, а у администратора платформы организации нет. Поэтому
-- журнал всех организаций — представление от владельца схемы: строки отдаются, только если в контексте
-- (app.user_id) — незаблокированный администратор платформы, как у app.admin_organizations (0024).
-- Получатель — краткое ФИО сотрудника (у администратора платформы — логин) и имя в Telegram, если
-- строка ушла в нынешний чат. Текст сообщения и номер чата журнал не показывает.
CREATE VIEW app.admin_telegram_log WITH (security_barrier = true) AS
  SELECT
    o.id,
    o.org_id,
    g.name AS org_name,
    o.user_id,
    coalesce(e.short_name, u.login::text) AS recipient,
    l.username AS tg_username,
    o.kind,
    o.status,
    o.tries,
    o.last_error,
    o.created_at,
    o.sent_at
  FROM public.telegram_outbox o
  JOIN public.users u ON u.id = o.user_id
  LEFT JOIN public.employees e ON e.user_id = o.user_id
  LEFT JOIN public.organizations g ON g.id = o.org_id
  LEFT JOIN public.telegram_links l ON l.user_id = o.user_id AND l.chat_id = o.chat_id
  WHERE (SELECT app.is_platform_admin());
--> statement-breakpoint
REVOKE ALL ON TABLE app.admin_telegram_log FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON TABLE app.admin_telegram_log TO buhuchet_app;
--> statement-breakpoint
-- «Повторить отправку» и «Повторить ошибки» (прототип admin/telegram.js: строка снова «Ожидает», попыток
-- 0): только строки с «Ошибкой» и не код восстановления — код повторно не отправляется (решение
-- заказчика 30.10.2026). Отвечает, сколько строк снова в очереди; не администратору — 0. p_now — часы
-- приложения (на демо-стенде и в тестах они стоят на месте).
CREATE OR REPLACE FUNCTION app.admin_telegram_retry(p_ids uuid[], p_now timestamptz)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH queued AS (
      UPDATE public.telegram_outbox
        SET status = 'pending', tries = 0, last_error = NULL, sent_at = NULL, next_at = p_now
        WHERE id = ANY (p_ids) AND status = 'error' AND kind <> 'code'
          AND (SELECT app.is_platform_admin())
        RETURNING 1
    )
    SELECT count(*)::integer FROM queued
  $$;
--> statement-breakpoint
-- «Рассылка» (прототип: «Поставить в очередь»): объявление каждому сотруднику действующей организации
-- (всем или одной), у которого привязан Telegram, учётная запись не заблокирована и сотрудник активен.
-- Строки уходят обычной очередью организации. Отвечает числом сообщений в очереди; null — в контексте
-- не администратор платформы или организация не найдена или заблокирована.
CREATE OR REPLACE FUNCTION app.admin_telegram_broadcast(p_org uuid, p_text text, p_now timestamptz)
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
    IF p_org IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.organizations g WHERE g.id = p_org AND g.status = 'active'
    ) THEN
      RETURN NULL;
    END IF;
    INSERT INTO public.telegram_outbox (org_id, user_id, chat_id, kind, text, status, tries, next_at)
    SELECT u.org_id, u.id, l.chat_id, 'broadcast', p_text, 'pending', 0, p_now
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
-- Строки без организации (служебные сообщения администраторов платформы, которые снова поставили в
-- очередь «Повторить отправку») задача отправки берёт и отмечает этими функциями: под RLS их не видно
-- ни в одной организации. Как claimOutbox: получатель отвязал или сменил Telegram или заблокирован —
-- строка не уходит в прежний чат (код recipient_unlinked); попытка засчитывается сразу, и строку до
-- p_lease_seconds не берёт другой запуск.
CREATE OR REPLACE FUNCTION app.telegram_platform_claim(
  p_now timestamptz, p_limit integer, p_lease_seconds integer
)
  RETURNS TABLE (id uuid, chat_id bigint, kind text, text text, tries integer)
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.telegram_outbox o
      SET status = 'error', last_error = 'recipient_unlinked'
      WHERE o.org_id IS NULL AND o.status = 'pending' AND o.next_at <= p_now
        AND NOT EXISTS (
          SELECT 1 FROM public.telegram_links l
          JOIN public.users u ON u.id = l.user_id
          WHERE l.user_id = o.user_id AND l.chat_id = o.chat_id AND NOT u.blocked
        );
    WITH due AS (
      SELECT d.id FROM public.telegram_outbox d
      WHERE d.org_id IS NULL AND d.status = 'pending' AND d.next_at <= p_now
      ORDER BY d.next_at, d.created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.telegram_outbox o
      SET tries = o.tries + 1, next_at = p_now + make_interval(secs => p_lease_seconds)
      FROM due
      WHERE o.id = due.id
      RETURNING o.id, o.chat_id, o.kind, coalesce(o.text, ''), o.tries
  $$;
--> statement-breakpoint
-- Итог попытки строки без организации: отправлено, повторить в p_next_at или окончательная «Ошибка».
CREATE OR REPLACE FUNCTION app.telegram_platform_finish(
  p_id uuid, p_status text, p_next_at timestamptz, p_error text, p_sent_at timestamptz
)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.telegram_outbox
      SET status = p_status,
          next_at = coalesce(p_next_at, next_at),
          last_error = CASE WHEN p_status = 'sent' THEN NULL ELSE left(coalesce(p_error, ''), 300) END,
          sent_at = CASE WHEN p_status = 'sent' THEN p_sent_at END
      WHERE id = p_id AND org_id IS NULL AND status = 'pending'
        AND p_status IN ('sent', 'pending', 'error')
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_telegram_retry(uuid[], timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_telegram_broadcast(uuid, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_platform_claim(timestamptz, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_platform_finish(uuid, text, timestamptz, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_telegram_retry(uuid[], timestamptz),
  app.admin_telegram_broadcast(uuid, text, timestamptz),
  app.telegram_platform_claim(timestamptz, integer, integer),
  app.telegram_platform_finish(uuid, text, timestamptz, text, timestamptz) TO buhuchet_app;
