-- Сколько блокировок входа было за последние p_window_minutes (ревью безопасности Р-8 А,
-- docs/decisions.md п. О-32): для оповещения администратору платформы о массовых блокировках — похоже
-- на перебор паролей. Только числа, без логинов и адресов. Окно — по часам базы (now()), как и
-- отметки самих блокировок:
-- - logins — логины, закрытые на p_lock_minutes после 5 неверных паролей (login_attempts, миграция
--   0013), закрытие началось в окне. Строка логина одна: закрытый дважды за окно считается один раз. В
--   момент закрытия last_attempt_at = locked_until − p_lock_minutes, и пока вход закрыт, он не
--   меняется, поэтому отбор по last_attempt_at идёт по индексу;
-- - accounts — учётные записи, заблокированные после 10 неверных паролей подряд (users.login_locked_at,
--   миграция 0095);
-- - ip_blocks — сколько раз адреса исчерпали предел попыток входа (rate_limits вида p_ip_kind): адрес
--   в отрезке окна длиной p_ip_window_seconds, где была попытка, на которой за p_ip_window_seconds до
--   неё набралось p_ip_max попыток. Адрес на полной скорости даёт до 6 за час при окне 10 минут.
-- Эти таблицы роль приложения не видит, поэтому — функция от владельца схемы.
CREATE FUNCTION app.login_lock_stats(
    p_window_minutes integer, p_lock_minutes integer,
    p_ip_kind text, p_ip_max integer, p_ip_window_seconds integer)
  RETURNS TABLE (logins integer, accounts integer, ip_blocks integer)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH w AS (SELECT now() - make_interval(mins => p_window_minutes) AS since)
    SELECT
      (SELECT count(*)::integer FROM public.login_attempts a, w
        WHERE a.last_attempt_at > w.since
          AND a.locked_until IS NOT NULL
          AND a.locked_until > w.since + make_interval(mins => p_lock_minutes)),
      (SELECT count(*)::integer FROM public.users u, w
        WHERE u.login_locked_at > w.since),
      (SELECT count(DISTINCT (x.subject,
                floor(extract(epoch FROM x.at) / p_ip_window_seconds)))::integer
        FROM (
          SELECT r.subject, r.at, count(*) OVER (
              PARTITION BY r.subject ORDER BY r.at
              RANGE BETWEEN make_interval(secs => p_ip_window_seconds) PRECEDING AND CURRENT ROW
            ) AS n
          FROM public.rate_limits r, w
          WHERE r.kind = p_ip_kind
            AND r.at > w.since - make_interval(secs => p_ip_window_seconds)
        ) x, w
        WHERE x.n >= p_ip_max AND x.at > w.since)
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.login_lock_stats(integer, integer, text, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.login_lock_stats(integer, integer, text, integer, integer) TO buhuchet_app;
--> statement-breakpoint
-- Оповещение не чаще раза в p_every_seconds (Р-8 А, п. О-32): как app.platform_alert (миграция 0097),
-- но если за это время сообщение с тем же p_key уже ставилось — ничего (0). Проверка и постановка —
-- одним шагом: упади постановка — отметки нет, повтор задачи сообщит. Ключ сообщения —
-- `alert:<p_key>:<момент>:<администратор>`. p_key — только буквы, цифры и дефис (в LIKE).
CREATE FUNCTION app.platform_alert_throttled(
    p_text text, p_key text, p_now timestamptz, p_every_seconds integer)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF p_key !~ '^[A-Za-z0-9-]+$' THEN
      RAISE EXCEPTION 'platform_alert_throttled: ключ только из букв, цифр и дефиса';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('platform_alert:' || p_key, 0));
    IF EXISTS (
      SELECT 1 FROM public.telegram_outbox o
      WHERE o.org_id IS NULL AND o.kind = 'alert'
        AND o.created_at > clock_timestamp() - make_interval(secs => p_every_seconds)
        AND o.dedupe_key LIKE 'alert:' || p_key || ':%'
    ) THEN
      RETURN 0;
    END IF;
    RETURN app.platform_alert(p_text,
      p_key || ':' || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISSUS'), p_now);
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.platform_alert_throttled(text, text, timestamptz, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_alert_throttled(text, text, timestamptz, integer) TO buhuchet_app;
