-- Журнал отправок Telegram (задача 2.25, docs/decisions.md, п. Б-5). Строки журнала роль приложения не
-- удаляет; у строки меняются только отметки отправки (состояние, попытки, когда повторить, ошибка,
-- когда отправлено), текст и получатель — нет. Отметки «напоминания за день собраны» не меняются и не
-- удаляются. TRUNCATE обходит политики RLS — его у роли приложения нет.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE telegram_outbox FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (status, tries, next_at, last_error, sent_at) ON TABLE telegram_outbox TO buhuchet_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE telegram_digest_days FROM buhuchet_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON TABLE telegram_notify_settings FROM buhuchet_app;
--> statement-breakpoint
-- Служебное сообщение бота (код восстановления, привязка, замена и отвязка Telegram, смена и сброс
-- пароля) уходит сразу и пишется в журнал после отправки (docs/deviations.md, п. 12): в том числе у
-- администратора платформы, у которого нет организации, и там, где организация ещё не известна
-- (вебхук бота, «Забыли пароль?»). Организацию строки функция берёт у пользователя; текст кода не
-- пишется никогда.
CREATE OR REPLACE FUNCTION app.telegram_log(
  p_user uuid, p_chat bigint, p_kind text, p_text text, p_ok boolean, p_error text
)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF p_kind NOT IN ('code', 'linked', 'relinked', 'unlinked', 'pass_changed', 'pass_reset') THEN
      RAISE EXCEPTION 'telegram_log: не служебное сообщение: %', p_kind;
    END IF;
    INSERT INTO public.telegram_outbox
      (org_id, user_id, chat_id, kind, text, status, tries, next_at, last_error, sent_at)
    SELECT u.org_id, u.id, p_chat, p_kind,
           CASE WHEN p_kind = 'code' THEN NULL ELSE p_text END,
           CASE WHEN p_ok THEN 'sent' ELSE 'error' END, 1, now(),
           CASE WHEN p_ok THEN NULL ELSE left(coalesce(p_error, ''), 300) END,
           CASE WHEN p_ok THEN now() END
    FROM public.users u
    WHERE u.id = p_user;
  END
  $$;
--> statement-breakpoint
-- Организации, у которых в очереди есть сообщения к отправке: задача отправки открывает для каждой
-- свою транзакцию withOrgContext. Отдаёт только номера организаций, как app.org_ids(); заблокированной
-- организации сообщения не отправляются.
CREATE OR REPLACE FUNCTION app.telegram_outbox_orgs(p_now timestamptz)
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT DISTINCT o.org_id
    FROM public.telegram_outbox o
    JOIN public.organizations g ON g.id = o.org_id AND g.status = 'active'
    WHERE o.status = 'pending' AND o.next_at <= p_now
    ORDER BY o.org_id
  $$;
--> statement-breakpoint
-- Организации, которым пора собрать напоминания за день: действующие, с включёнными «Напоминаниями в
-- Telegram» и хотя бы одним привязанным Telegram, время сводки по их часовому поясу наступило, а за
-- этот день (по их часовому поясу) напоминания ещё не собраны. Отдаёт номер организации и день.
CREATE OR REPLACE FUNCTION app.telegram_digest_orgs(p_now timestamptz)
  RETURNS TABLE (org_id uuid, day date)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT s.org_id, (p_now AT TIME ZONE s.timezone)::date
    FROM public.org_settings s
    JOIN public.organizations g ON g.id = s.org_id AND g.status = 'active'
    WHERE coalesce((s.features ->> 'telegram')::boolean, false)
      AND (p_now AT TIME ZONE s.timezone)::time >= s.digest_time
      AND EXISTS (SELECT 1 FROM public.telegram_links l WHERE l.org_id = s.org_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.telegram_digest_days d
        WHERE d.org_id = s.org_id AND d.day = (p_now AT TIME ZONE s.timezone)::date
      )
    ORDER BY s.org_id
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_log(uuid, bigint, text, text, boolean, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_outbox_orgs(timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_digest_orgs(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.telegram_log(uuid, bigint, text, text, boolean, text),
  app.telegram_outbox_orgs(timestamptz), app.telegram_digest_orgs(timestamptz) TO buhuchet_app;
