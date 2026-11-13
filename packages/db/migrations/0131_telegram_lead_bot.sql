-- Заявка с сайта — сообщение с кнопками администраторам платформы (поток Т, задача Т6; пакет заказчика
-- 13.11.2026, идея 14; прототип v103 admin/tg-leads.js; docs/decisions.md п. Т-6). Под сообщением о
-- заявке — «В работу», «Отказ» и «Открыть в Админке»; статус из чата меняется той же функцией, что на
-- сайте (app.admin_lead_status), запись истории получает отметку «через Telegram» (столбец via, 0130).

-- История заявки для окна Админки — с отметкой «через Telegram».
CREATE OR REPLACE VIEW app.admin_lead_events WITH (security_barrier = true) AS
  SELECT
    e.id,
    e.lead_id,
    e.at,
    e.actor_user_id,
    u.login::text AS actor_login,
    e.kind,
    e.from_status,
    e.to_status,
    e.text,
    e.via
  FROM public.platform_lead_events e
  LEFT JOIN public.users u ON u.id = e.actor_user_id
  WHERE (SELECT app.is_platform_admin());
--> statement-breakpoint
-- app.lead_submit (0092) теперь отвечает ещё записью истории и полями сохранённой заявки: сообщение с
-- таблицей и кнопками собирает API (фирма, имя и «клиентов» в сообщении о повторе — сохранённой заявки,
-- а не второй формы) и ставит в очередь функцией app.lead_notify в той же транзакции. Параметры
-- p_tg_text и p_tg_rep_text остаются, чтобы прежняя версия сайта работала, пока выходит новая: она
-- передаёт тексты, и сообщения уходят как раньше; новая передаёт NULL. Остальное — как в 0092.
DROP FUNCTION app.lead_submit(text, text, text, text, text, text, text, boolean, boolean, text, text, timestamptz, integer, integer, integer, integer);
--> statement-breakpoint
CREATE FUNCTION app.lead_submit(
  p_ip text, p_name text, p_firm text, p_phone text, p_size text, p_telegram text, p_note text,
  p_stand boolean, p_trap boolean, p_tg_text text, p_tg_rep_text text, p_now timestamptz,
  p_ip_limit integer, p_ip_window integer, p_repeat_hours integer, p_note_max integer
)
  RETURNS TABLE (
    outcome text, lead_id uuid, event_id bigint, firm text, name text, size text, status text
  )
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_take text;
    v_id uuid;
    v_event bigint;
    v_rep text;
    v_note text := nullif(btrim(coalesce(p_note, '')), '');
  BEGIN
    SELECT t.outcome INTO v_take FROM app.rate_limit_take('lead', p_ip, p_ip_limit, p_ip_window, NULL) t;
    IF v_take IS DISTINCT FROM 'ok' THEN
      RETURN QUERY SELECT 'limited'::text, NULL::uuid, NULL::bigint, NULL::text, NULL::text,
        NULL::text, NULL::text;
      RETURN;
    END IF;
    IF p_trap THEN
      RETURN QUERY SELECT 'trap'::text, NULL::uuid, NULL::bigint, NULL::text, NULL::text,
        NULL::text, NULL::text;
      RETURN;
    END IF;
    -- Две заявки с одного телефона одновременно: вторая ждёт первую и становится повторной.
    PERFORM pg_advisory_xact_lock(hashtextextended('lead:' || p_phone, 0));
    SELECT l.id INTO v_id FROM public.platform_leads l
      WHERE l.phone = p_phone AND l.created_at > p_now - make_interval(hours => p_repeat_hours)
      ORDER BY l.created_at
      LIMIT 1;
    IF v_id IS NOT NULL THEN
      UPDATE public.platform_leads l
        SET note = CASE WHEN v_note IS NULL THEN l.note
                        ELSE left(concat_ws(E'\n', nullif(l.note, ''), v_note), p_note_max) END,
            version = l.version + 1,
            updated_at = p_now,
            updated_by = NULL
        WHERE l.id = v_id;
      INSERT INTO public.platform_lead_events (lead_id, at, actor_user_id, kind, text)
        VALUES (v_id, p_now, NULL, 'repeat', v_note)
        RETURNING id INTO v_event;
      IF p_tg_rep_text IS NOT NULL THEN
        SELECT replace(replace(replace(p_tg_rep_text,
                 chr(1) || 'фирма' || chr(1), l.firm),
                 chr(1) || 'имя' || chr(1), l.name),
                 chr(1) || 'клиентов' || chr(1), l.size)
          INTO v_rep
          FROM public.platform_leads l
          WHERE l.id = v_id;
        INSERT INTO public.telegram_outbox
          (org_id, user_id, chat_id, kind, text, status, tries, next_at, dedupe_key)
        SELECT NULL, u.id, l.chat_id, 'lead', v_rep, 'pending', 0, p_now,
          'lead:' || v_id::text || ':' || u.id::text || ':' || v_event::text
        FROM public.telegram_links l
        JOIN public.users u ON u.id = l.user_id AND u.is_platform_admin AND NOT u.blocked;
      END IF;
      RETURN QUERY SELECT 'repeat'::text, l.id, v_event, l.firm, l.name, l.size, l.status
        FROM public.platform_leads l WHERE l.id = v_id;
      RETURN;
    END IF;
    INSERT INTO public.platform_leads
        (created_at, name, firm, phone, size, telegram, note, status, from_stand, updated_at)
      VALUES (p_now, p_name, p_firm, p_phone, p_size, nullif(btrim(coalesce(p_telegram, '')), ''),
              v_note, 'new', p_stand, p_now)
      RETURNING id INTO v_id;
    INSERT INTO public.platform_lead_events (lead_id, at, actor_user_id, kind, to_status)
      VALUES (v_id, p_now, NULL, 'created', 'new');
    IF p_tg_text IS NOT NULL THEN
      -- Ключ `lead:<заявка>:<администратор>` связывает сообщение с заявкой: в тексте имя и телефон,
      -- поэтому удаление заявки стирает и его запись в журнале Telegram.
      INSERT INTO public.telegram_outbox
        (org_id, user_id, chat_id, kind, text, status, tries, next_at, dedupe_key)
      SELECT NULL, u.id, l.chat_id, 'lead', p_tg_text, 'pending', 0, p_now,
        'lead:' || v_id::text || ':' || u.id::text
      FROM public.telegram_links l
      JOIN public.users u ON u.id = l.user_id AND u.is_platform_admin AND NOT u.blocked;
    END IF;
    RETURN QUERY SELECT 'created'::text, v_id, NULL::bigint, p_firm, p_name, p_size, 'new'::text;
  END
  $$;
--> statement-breakpoint
-- Сообщение о заявке с таблицей и кнопками — в очередь каждому незаблокированному администратору
-- платформы с привязанным Telegram. Вызывается сразу после app.lead_submit в той же транзакции: заявка
-- (p_event пусто) создана или её повтор (p_event — запись истории «повтор») записан в этот же момент
-- p_now — по другой заявке и позже функция сообщений не ставит. Ключи строк — те же, что в 0092:
-- «Удалить» заявку стирает из журнала Telegram и эти сообщения (в описании — имя и телефон).
-- Отвечает числом поставленных сообщений.
CREATE FUNCTION app.lead_notify(
  p_lead uuid, p_event bigint, p_text text, p_payload jsonb, p_now timestamptz
)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    n integer;
  BEGIN
    IF p_text IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
      RETURN 0;
    END IF;
    IF p_event IS NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.platform_leads l WHERE l.id = p_lead AND l.created_at = p_now
      ) THEN
        RETURN 0;
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.platform_lead_events e
      WHERE e.id = p_event AND e.lead_id = p_lead AND e.kind = 'repeat' AND e.at = p_now
    ) THEN
      RETURN 0;
    END IF;
    INSERT INTO public.telegram_outbox
      (org_id, user_id, chat_id, kind, text, status, tries, next_at, dedupe_key, payload)
    SELECT NULL, u.id, l.chat_id, 'lead', p_text, 'pending', 0, p_now,
      'lead:' || p_lead::text || ':' || u.id::text || coalesce(':' || p_event::text, ''),
      p_payload
    FROM public.telegram_links l
    JOIN public.users u ON u.id = l.user_id AND u.is_platform_admin AND NOT u.blocked
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END
  $$;
--> statement-breakpoint
-- Очередь без организации (0084) умеет сообщения с кнопками: строка отдаётся с описанием сообщения и
-- выбором получателя «Сообщения простым текстом», после отправки запоминается номер сообщения в чате —
-- по нему бот находит сообщение при нажатии кнопки (app.telegram_press_target, 0122). Остальное — как
-- в 0084; прежняя версия сайта читает те же столбцы и вызывает finish без номера.
DROP FUNCTION app.telegram_platform_claim(timestamptz, integer, integer);
--> statement-breakpoint
CREATE FUNCTION app.telegram_platform_claim(
  p_now timestamptz, p_limit integer, p_lease_seconds integer
)
  RETURNS TABLE (
    id uuid, chat_id bigint, kind text, text text, tries integer, payload jsonb, plain boolean
  )
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
      RETURNING o.id, o.chat_id, o.kind, coalesce(o.text, ''), o.tries, o.payload,
        coalesce((SELECT u.telegram_plain FROM public.users u WHERE u.id = o.user_id), false)
  $$;
--> statement-breakpoint
DROP FUNCTION app.telegram_platform_finish(uuid, text, timestamptz, text, timestamptz);
--> statement-breakpoint
CREATE FUNCTION app.telegram_platform_finish(
  p_id uuid, p_status text, p_next_at timestamptz, p_error text, p_sent_at timestamptz,
  p_message bigint DEFAULT NULL
)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.telegram_outbox
      SET status = p_status,
          next_at = coalesce(p_next_at, next_at),
          last_error = CASE WHEN p_status = 'sent' THEN NULL ELSE left(coalesce(p_error, ''), 300) END,
          sent_at = CASE WHEN p_status = 'sent' THEN p_sent_at END,
          message_id = CASE WHEN p_status = 'sent' AND payload IS NOT NULL
                            THEN coalesce(p_message, message_id) ELSE message_id END
      WHERE id = p_id AND org_id IS NULL AND status = 'pending'
        AND p_status IN ('sent', 'pending', 'error')
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.lead_submit(text, text, text, text, text, text, text, boolean, boolean, text, text, timestamptz, integer, integer, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.lead_notify(uuid, bigint, text, jsonb, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_platform_claim(timestamptz, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_platform_finish(uuid, text, timestamptz, text, timestamptz, bigint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.lead_submit(text, text, text, text, text, text, text, boolean, boolean, text, text, timestamptz, integer, integer, integer, integer),
  app.lead_notify(uuid, bigint, text, jsonb, timestamptz),
  app.telegram_platform_claim(timestamptz, integer, integer),
  app.telegram_platform_finish(uuid, text, timestamptz, text, timestamptz, bigint)
  TO buhuchet_app;
