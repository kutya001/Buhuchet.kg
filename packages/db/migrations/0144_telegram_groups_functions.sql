-- Общий рабочий чат фирмы (поток Т, задача Т8; docs/decisions.md п. Т-8). Вебхук получает из группы
-- ключ ссылки подключения, нажатие «Мои», «бота удалили» и смену номера группы — до контекста
-- организации. Эти функции только находят организацию; всё остальное вебхук делает в
-- `withOrgContext` этой организации (RLS).
--
-- Ссылка подключения по хешу ключа: организация, кто её создал, истекла ли, использована ли и
-- действует ли организация.
CREATE FUNCTION app.telegram_group_token(p_hash text)
  RETURNS TABLE (org_id uuid, created_by uuid, expired boolean, used boolean, org_active boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT t.org_id, t.created_by, t.expires_at <= now(), t.used_at IS NOT NULL, o.status = 'active'
    FROM public.telegram_group_tokens t
    JOIN public.organizations o ON o.id = t.org_id
    WHERE t.token_hash = p_hash
  $$;
--> statement-breakpoint
-- Организация, чей общий чат — эта группа, и удалён ли из неё бот.
CREATE FUNCTION app.telegram_group_org(p_chat bigint)
  RETURNS TABLE (org_id uuid, gone boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT g.org_id, g.gone_at IS NOT NULL FROM public.telegram_groups g WHERE g.chat_id = p_chat
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_group_token(text), app.telegram_group_org(bigint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.telegram_group_token(text), app.telegram_group_org(bigint)
  TO buhuchet_app;
--> statement-breakpoint
-- Сводка дня в общий чат фирмы собирается вместе с напоминаниями за день: организация с подключённой
-- группой и включённой сводкой получает сбор, даже если ни у кого из сотрудников нет привязанного
-- Telegram.
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
      AND (
        EXISTS (SELECT 1 FROM public.telegram_links l WHERE l.org_id = s.org_id)
        OR EXISTS (
          SELECT 1 FROM public.telegram_groups tg
          WHERE tg.org_id = s.org_id AND tg.gone_at IS NULL AND tg.summary
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.telegram_digest_days d
        WHERE d.org_id = s.org_id AND d.day = (p_now AT TIME ZONE s.timezone)::date
      )
    ORDER BY s.org_id
  $$;
