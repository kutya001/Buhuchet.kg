-- Админка → «Запуски» и «Телеграм» → «Журнал» с перепиской в обе стороны и текстом (решение заказчика
-- 17.11.2026; прототип v132 admin/runs.js, admin/tg-log.js; docs/decisions.md п. Т-15, Т-16).
--
-- Полученные сообщения (telegram_inbox, миграция 0162) роль приложения не видит и не меняет: строку
-- пишет вебхук функцией до разбора обновления, итог — после; читает только администратор платформы
-- через представление журнала.
REVOKE ALL ON TABLE public.telegram_inbox FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE public.telegram_inbox FROM buhuchet_app;
--> statement-breakpoint
-- Записать полученное сообщение. Чей чат — по привязкам на этот момент: сообщение бота, к которому
-- относится нажатие или ответ (сотруднику — telegram_outbox, клиенту — contractor_telegram_messages),
-- иначе общий чат фирмы, единственный привязанный сотрудник или единственный подключённый контрагент.
-- Подпись нажатой кнопки — из отправленного сообщения, пока разбор её не погасил. Код и ссылка
-- привязки (p_hide) пишутся без текста, какой бы текст ни передали. Повторная доставка того же
-- обновления (p_update_id) второй строки не даёт — ответ NULL.
CREATE FUNCTION app.telegram_inbox_begin(
  p_update_id bigint, p_chat_id bigint, p_group boolean, p_sender text, p_kind text, p_text text,
  p_hide text, p_data text, p_reply bigint, p_file_name text, p_file_size bigint, p_now timestamptz
)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_id uuid;
    v_kind text := CASE WHEN p_group THEN 'group' ELSE 'private' END;
    v_org uuid;
    v_user uuid;
    v_contractor uuid;
    v_payload jsonb;
    v_button text;
    v_hide text := CASE WHEN p_kind IN ('code', 'link') THEN coalesce(p_hide, p_kind) ELSE p_hide END;
  BEGIN
    IF p_chat_id IS NULL OR p_kind IS NULL THEN
      RETURN NULL;
    END IF;
    IF p_reply IS NOT NULL THEN
      SELECT o.org_id, o.user_id, o.payload INTO v_org, v_user, v_payload
        FROM public.telegram_outbox o
        WHERE o.chat_id = p_chat_id AND o.message_id = p_reply
        ORDER BY o.created_at DESC LIMIT 1;
      IF NOT FOUND THEN
        SELECT m.org_id, m.contractor_id, m.payload INTO v_org, v_contractor, v_payload
          FROM public.contractor_telegram_messages m
          WHERE m.chat_id = p_chat_id AND m.message_id = p_reply;
        IF FOUND THEN
          v_kind := 'client';
        END IF;
      END IF;
    END IF;
    IF p_group THEN
      v_user := NULL;
      IF v_org IS NULL THEN
        SELECT g.org_id INTO v_org FROM public.telegram_groups g WHERE g.chat_id = p_chat_id;
      END IF;
    ELSIF v_org IS NULL AND v_user IS NULL AND v_contractor IS NULL THEN
      -- Один Telegram бывает привязан к нескольким логинам: тогда чей это текст, по чату не узнать.
      IF (SELECT count(*) FROM public.telegram_links l WHERE l.chat_id = p_chat_id) = 1 THEN
        SELECT l.user_id, l.org_id INTO v_user, v_org
          FROM public.telegram_links l WHERE l.chat_id = p_chat_id;
      ELSIF NOT EXISTS (SELECT 1 FROM public.telegram_links l WHERE l.chat_id = p_chat_id) THEN
        IF (SELECT count(*) FROM public.contractor_telegram_links c
              WHERE c.chat_id = p_chat_id AND c.status = 'on') = 1 THEN
          SELECT c.org_id, c.contractor_id INTO v_org, v_contractor
            FROM public.contractor_telegram_links c
            WHERE c.chat_id = p_chat_id AND c.status = 'on';
          v_kind := 'client';
        ELSIF EXISTS (SELECT 1 FROM public.contractor_telegram_links c
                        WHERE c.chat_id = p_chat_id AND c.status IN ('wait', 'on')) THEN
          v_kind := 'client';
        END IF;
      END IF;
    END IF;
    IF p_kind = 'press' AND p_data IS NOT NULL AND jsonb_typeof(v_payload -> 'buttons') = 'array' THEN
      SELECT left(b ->> 'text', 64) INTO v_button
        FROM jsonb_array_elements(v_payload -> 'buttons') AS r(line)
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(r.line) = 'array' THEN r.line ELSE '[]'::jsonb END
        ) AS b
        WHERE (b ->> 'action') || coalesce(':' || nullif(b ->> 'arg', ''), '') = p_data
        LIMIT 1;
    END IF;
    INSERT INTO public.telegram_inbox (
      created_at, update_id, chat_id, chat_kind, org_id, user_id, contractor_id, sender, kind, text,
      hide, button, reply_message_id, file_name, file_size
    ) VALUES (
      p_now, p_update_id, p_chat_id, v_kind, v_org, v_user, v_contractor,
      nullif(left(btrim(coalesce(p_sender, '')), 100), ''), p_kind,
      CASE WHEN v_hide IS NULL THEN nullif(left(coalesce(p_text, ''), 4096), '') END,
      v_hide, v_button, p_reply, nullif(left(coalesce(p_file_name, ''), 200), ''), p_file_size
    )
    ON CONFLICT ON CONSTRAINT telegram_inbox_update_key DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
  END
  $$;
--> statement-breakpoint
-- Итог разбора: «Обработано», «Не распознано» или «Ошибка» с текстом; вид уточняется, если бот узнал
-- в тексте команду меню. Пишется один раз — только строке без итога.
CREATE FUNCTION app.telegram_inbox_finish(p_id uuid, p_status text, p_kind text, p_error text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.telegram_inbox
      SET status = p_status,
          kind = CASE WHEN p_kind = 'command' AND kind = 'text' THEN 'command' ELSE kind END,
          error = CASE WHEN p_status = 'error' THEN nullif(left(coalesce(p_error, ''), 300), '') END
      WHERE id = p_id AND status = 'new' AND p_status IN ('done', 'unknown', 'error')
  $$;
--> statement-breakpoint
-- Полученные сообщения хранятся 90 дней: старше p_before удаляет задача очистки. Отвечает, сколько удалено.
CREATE FUNCTION app.telegram_inbox_cleanup(p_before timestamptz)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH gone AS (
      DELETE FROM public.telegram_inbox WHERE created_at < p_before RETURNING 1
    )
    SELECT count(*)::integer FROM gone
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_inbox_begin(
  bigint, bigint, boolean, text, text, text, text, text, bigint, text, bigint, timestamptz
) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_inbox_finish(uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_inbox_cleanup(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.telegram_inbox_begin(
    bigint, bigint, boolean, text, text, text, text, text, bigint, text, bigint, timestamptz
  ),
  app.telegram_inbox_finish(uuid, text, text, text),
  app.telegram_inbox_cleanup(timestamptz) TO buhuchet_app;
--> statement-breakpoint
-- Журнал переписки бота для Админки: отправленное сотрудникам и в общий чат (telegram_outbox),
-- сообщения клиентам контрагентов с кнопками (contractor_telegram_messages) и всё полученное
-- (telegram_inbox). Как app.admin_telegram_log (0084): строки отдаются, только если в контексте —
-- незаблокированный администратор платформы. Текст сообщений показывается по решению заказчика
-- 17.11.2026; у кода и одноразовой ссылки текста в таблицах нет, причина — в столбце hide. Номер чата
-- нужен серверу для «Вся переписка» и «Раньше · Позже»; в ответах API его нет.
CREATE VIEW app.admin_telegram_journal WITH (security_barrier = true) AS
  SELECT
    'outbox'::text AS src,
    o.id,
    'out'::text AS dir,
    o.created_at,
    o.chat_id,
    CASE WHEN o.chat_id < 0 THEN 'group' ELSE 'private' END AS chat_kind,
    o.org_id,
    g.name AS org_name,
    o.user_id,
    NULL::uuid AS contractor_id,
    CASE
      WHEN o.chat_id < 0 THEN coalesce(tg.title, e.short_name, u.login::text)
      ELSE concat_ws(' ', coalesce(e.short_name, u.login::text), '@' || l.username)
    END AS recipient,
    o.kind,
    o.status,
    o.tries,
    o.last_error,
    o.text,
    CASE
      WHEN o.kind = 'setup_link' THEN 'link'
      WHEN o.kind IN ('code', 'relink_code') THEN 'code'
    END AS hide,
    o.payload,
    NULL::text AS button,
    o.message_id,
    NULL::bigint AS reply_message_id,
    NULL::text AS file_name,
    NULL::bigint AS file_size,
    o.sent_at,
    CASE WHEN o.kind = 'alert' AND o.dedupe_key LIKE 'alert:job:%'
      THEN split_part(o.dedupe_key, ':', 3) END AS alert_job
  FROM public.telegram_outbox o
  JOIN public.users u ON u.id = o.user_id
  LEFT JOIN public.employees e ON e.user_id = o.user_id
  LEFT JOIN public.organizations g ON g.id = o.org_id
  LEFT JOIN public.telegram_links l ON l.user_id = o.user_id AND l.chat_id = o.chat_id
  LEFT JOIN public.telegram_groups tg ON tg.chat_id = o.chat_id AND o.chat_id < 0
  WHERE (SELECT app.is_platform_admin())
  UNION ALL
  SELECT
    'client'::text,
    m.id,
    'out'::text,
    m.created_at,
    m.chat_id,
    'client'::text,
    m.org_id,
    g.name,
    NULL::uuid,
    m.contractor_id,
    concat_ws(' · ', c.name, k.name),
    'client_' || m.kind,
    CASE
      WHEN m.message_id IS NOT NULL THEN 'sent'
      WHEN m.attempts >= 3 THEN 'error'
      ELSE 'pending'
    END,
    m.attempts::integer,
    NULL::text,
    NULL::text,
    NULL::text,
    m.payload,
    NULL::text,
    m.message_id,
    NULL::bigint,
    NULL::text,
    NULL::bigint,
    CASE WHEN m.message_id IS NOT NULL THEN m.created_at END,
    NULL::text
  FROM public.contractor_telegram_messages m
  JOIN public.contractor_telegram_links k ON k.id = m.link_id
  JOIN public.contractors c ON c.id = m.contractor_id
  LEFT JOIN public.organizations g ON g.id = m.org_id
  WHERE (SELECT app.is_platform_admin())
  UNION ALL
  SELECT
    'inbox'::text,
    i.id,
    'in'::text,
    i.created_at,
    i.chat_id,
    i.chat_kind,
    i.org_id,
    g.name,
    i.user_id,
    i.contractor_id,
    coalesce(
      CASE
        WHEN i.user_id IS NOT NULL
          THEN concat_ws(' ', coalesce(e.short_name, u.login::text), '@' || l.username)
        WHEN i.contractor_id IS NOT NULL THEN concat_ws(' · ', c.name, i.sender)
        WHEN i.chat_kind = 'group' THEN coalesce(tg.title, i.sender)
      END,
      i.sender,
      ''
    ),
    'in_' || i.kind,
    i.status,
    0,
    i.error,
    i.text,
    i.hide,
    NULL::jsonb,
    i.button,
    NULL::bigint,
    i.reply_message_id,
    i.file_name,
    i.file_size,
    NULL::timestamptz,
    NULL::text
  FROM public.telegram_inbox i
  LEFT JOIN public.users u ON u.id = i.user_id
  LEFT JOIN public.employees e ON e.user_id = i.user_id
  LEFT JOIN public.organizations g ON g.id = i.org_id
  LEFT JOIN public.telegram_links l ON l.user_id = i.user_id AND l.chat_id = i.chat_id
  LEFT JOIN public.contractors c ON c.id = i.contractor_id
  LEFT JOIN public.telegram_groups tg ON tg.chat_id = i.chat_id AND i.chat_kind = 'group'
  WHERE (SELECT app.is_platform_admin());
--> statement-breakpoint
REVOKE ALL ON TABLE app.admin_telegram_journal FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON TABLE app.admin_telegram_journal TO buhuchet_app;
