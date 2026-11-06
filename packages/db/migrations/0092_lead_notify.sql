-- Уведомление о заявке с лендинга обязательно (решение заказчика 06.11.2026, прототип v74 leadNotify;
-- ТЗ «Админка» → «Вкладка «Заявки»»): сообщение уходит сразу после сохранения заявки каждому
-- незаблокированному администратору платформы с привязанным Telegram — и на тестовом стенде (от бота
-- стенда его администраторам: база стенда своя, текст с пометкой «🧪 Тестовый стенд» собирает API), и
-- о повторной заявке с того же телефона за сутки — своим текстом p_tg_rep_text (шаблон «Telegram:
-- повторная заявка с сайта»). Ловушка и заявка сверх предела по адресу сообщений не дают, как раньше.
-- Остальное — как в 0089. Ключ сообщения о повторе — `lead:<заявка>:<администратор>:<запись истории>`:
-- начало то же, что у сообщения о заявке, поэтому «Удалить» заявку стирает из журнала Telegram и их.
-- Фирма, имя и «клиентов» в сообщении о повторе — сохранённой заявки, а не второй формы (прототип
-- leadTgPreview(o.dup ? o.lead : o)): API ставит на их места метки chr(1)||'фирма'||chr(1) и т. д.,
-- функция заменяет их значениями заявки. Управляющих символов в этих полях нет (проверка формы),
-- поэтому подставленное значение метку не образует.
DROP FUNCTION app.lead_submit(text, text, text, text, text, text, text, boolean, boolean, text, timestamptz, integer, integer, integer, integer);
--> statement-breakpoint
CREATE FUNCTION app.lead_submit(
  p_ip text, p_name text, p_firm text, p_phone text, p_size text, p_telegram text, p_note text,
  p_stand boolean, p_trap boolean, p_tg_text text, p_tg_rep_text text, p_now timestamptz,
  p_ip_limit integer, p_ip_window integer, p_repeat_hours integer, p_note_max integer
)
  RETURNS TABLE (outcome text, lead_id uuid)
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
      RETURN QUERY SELECT 'limited'::text, NULL::uuid;
      RETURN;
    END IF;
    IF p_trap THEN
      RETURN QUERY SELECT 'trap'::text, NULL::uuid;
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
      RETURN QUERY SELECT 'repeat'::text, v_id;
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
    RETURN QUERY SELECT 'created'::text, v_id;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.lead_submit(text, text, text, text, text, text, text, boolean, boolean, text, text, timestamptz, integer, integer, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.lead_submit(text, text, text, text, text, text, text, boolean, boolean, text, text, timestamptz, integer, integer, integer, integer) TO buhuchet_app;
--> statement-breakpoint
-- Предупреждение над вкладкой «Заявки» «О новых заявках некому сообщить…» (прототип v74 renderLeads):
-- сколько незаблокированных администраторов платформы с привязанным Telegram. Связи Telegram роль
-- приложения под RLS видит только в своей организации, поэтому — функция от владельца схемы; не
-- администратору — 0.
CREATE FUNCTION app.admin_lead_recipients()
  RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT CASE WHEN app.is_platform_admin() THEN (
      SELECT count(DISTINCT u.id)::integer
      FROM public.telegram_links l
      JOIN public.users u ON u.id = l.user_id AND u.is_platform_admin AND NOT u.blocked
    ) ELSE 0 END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_lead_recipients() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_lead_recipients() TO buhuchet_app;
