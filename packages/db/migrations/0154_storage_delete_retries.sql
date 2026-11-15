CREATE TABLE "storage_delete_retries" (
	"key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"tried_at" timestamp with time zone,
	CONSTRAINT "storage_delete_retries_key_check" CHECK ("storage_delete_retries"."key" ~ '^(leads/upload/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}|leads/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}|org/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/(sent/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}(\.up|\.chk-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})?|files/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}))$')
);
--> statement-breakpoint
ALTER TABLE "storage_delete_retries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "storage_delete_retries_created_idx" ON "storage_delete_retries" USING btree ("created_at");
--> statement-breakpoint
-- Ручная часть. Ключи на повторное удаление роль приложения не видит и не меняет: только функции ниже.
REVOKE ALL ON TABLE public.storage_delete_retries FROM buhuchet_app;--> statement-breakpoint
-- Запомнить ключи, которые не удалось удалить из хранилища (после «Одобрить» и «Удалить» заявки, после
-- «Принять» отправленного файла, после отказа загрузки): только ключи публичных загрузок — другой ключ
-- отклоняет ограничение storage_delete_retries_key_check; не больше 100 за раз. Уже записанный ключ не
-- меняется. Отвечает, сколько записано.
CREATE FUNCTION app.storage_retry_add(p_keys text[])
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    n integer;
  BEGIN
    IF coalesce(cardinality(p_keys), 0) > 100 THEN
      RAISE EXCEPTION 'storage_retry_add: больше 100 ключей' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.storage_delete_retries (key)
      SELECT DISTINCT k FROM unnest(p_keys) AS k WHERE k IS NOT NULL
      ON CONFLICT (key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END
  $$;--> statement-breakpoint
-- Что повторить (задача по расписанию): ключи, которые ещё не пробовали или пробовали не позже чем
-- p_every_minutes минут назад, старые первыми.
CREATE FUNCTION app.storage_retry_due(p_now timestamptz, p_every_minutes integer, p_limit integer)
  RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT r.key FROM public.storage_delete_retries r
    WHERE r.tried_at IS NULL OR r.tried_at <= p_now - make_interval(mins => p_every_minutes)
    ORDER BY r.created_at, r.key
    LIMIT p_limit
  $$;--> statement-breakpoint
-- Итог попытки: удалённые ключи убираются, у не удалённых — ещё одна попытка. Отвечает, сколько ключей
-- осталось и сколько из них не удаётся удалить уже p_stuck_attempts раз и больше (для оповещения).
CREATE FUNCTION app.storage_retry_done(
  p_now timestamptz, p_done text[], p_failed text[], p_stuck_attempts integer
)
  RETURNS TABLE (left_count integer, stuck_count integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    DELETE FROM public.storage_delete_retries r WHERE r.key = ANY (p_done);
    UPDATE public.storage_delete_retries r SET attempts = r.attempts + 1, tried_at = p_now
      WHERE r.key = ANY (p_failed);
    RETURN QUERY
      SELECT count(*)::integer, (count(*) FILTER (WHERE r.attempts >= p_stuck_attempts))::integer
      FROM public.storage_delete_retries r;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION
  app.storage_retry_add(text[]),
  app.storage_retry_due(timestamptz, integer, integer),
  app.storage_retry_done(timestamptz, text[], text[], integer)
  FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.storage_retry_add(text[]),
  app.storage_retry_due(timestamptz, integer, integer),
  app.storage_retry_done(timestamptz, text[], text[], integer)
  TO buhuchet_app;--> statement-breakpoint
-- Документы новой заявки — только из живого черновика: загрузки старше p_draft_hours часов не переходят
-- в заявку и при вставке, а не только при подсчёте (раньше это держал уникальный индекс вида в
-- черновике). Остальное — как в 0150.
CREATE OR REPLACE FUNCTION app.lead_submit_docs(
  p_lead uuid, p_now timestamptz, p_form text, p_inn text, p_okpo text, p_address text,
  p_head text, p_draft uuid, p_need text[], p_keep_days integer, p_draft_hours integer
)
  RETURNS TABLE (outcome text, upload_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_ready integer;
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.platform_leads l
      WHERE l.id = p_lead AND l.created_at = p_now AND l.legal_form IS NULL
        AND l.created_org_id IS NULL
    ) OR EXISTS (SELECT 1 FROM public.platform_lead_docs d WHERE d.lead_id = p_lead) THEN
      RETURN QUERY SELECT 'missing'::text, NULL::uuid;
      RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('lead_draft:' || p_draft::text, 0));
    SELECT count(*) INTO v_ready FROM public.platform_lead_uploads u
      WHERE u.draft_id = p_draft AND u.state = 'ready' AND u.kind = ANY (p_need)
        AND u.created_at > p_now - make_interval(hours => p_draft_hours);
    IF cardinality(p_need) = 0 OR v_ready <> cardinality(p_need) THEN
      RETURN QUERY SELECT 'missing'::text, NULL::uuid;
      RETURN;
    END IF;
    UPDATE public.platform_leads l
      SET legal_form = p_form,
          inn = p_inn,
          okpo = nullif(btrim(coalesce(p_okpo, '')), ''),
          address = nullif(btrim(coalesce(p_address, '')), ''),
          head = nullif(btrim(coalesce(p_head, '')), ''),
          docs_state = 'pending',
          docs_purge_at = p_now + make_interval(days => p_keep_days)
      WHERE l.id = p_lead;
    INSERT INTO public.platform_lead_docs
        (id, lead_id, kind, name, content_type, size_bytes, storage_key, state, created_at)
      SELECT u.id, p_lead, u.kind, u.name, 'application/pdf', u.size_bytes,
        'leads/' || p_lead::text || '/' || u.id::text, 'pending', p_now
      FROM public.platform_lead_uploads u
      WHERE u.draft_id = p_draft AND u.state = 'ready' AND u.kind = ANY (p_need)
        AND u.created_at > p_now - make_interval(hours => p_draft_hours);
    RETURN QUERY
      WITH cur AS (
        SELECT u.id, u.kind, u.state, u.created_at FROM public.platform_lead_uploads u
        WHERE u.draft_id = p_draft AND u.state <> 'gone'
      ), gone AS (
        UPDATE public.platform_lead_uploads u SET state = 'gone', doc = NULL
        FROM cur WHERE u.id = cur.id
        RETURNING u.id
      )
      SELECT CASE WHEN c.state = 'ready' AND c.kind = ANY (p_need)
          AND c.created_at > p_now - make_interval(hours => p_draft_hours) THEN 'doc' ELSE 'drop' END,
        c.id
      FROM cur c JOIN gone g ON g.id = c.id;
  END
  $$;
