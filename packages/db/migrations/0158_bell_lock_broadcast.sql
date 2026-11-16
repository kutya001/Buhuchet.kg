-- Колокольчик (доработки 16.11.2026, блок 3, этап 1; поток Т; прототип v122 `core/login.js`,
-- `admin/tg-cast.js`): строки «Вход заблокирован» и «Сообщение платформы» кладутся там же, где
-- сообщения Telegram, — функциями базы: до входа и в рассылке администратора платформы контекста
-- организации нет. Строки идут и без бота, и без привязанного Telegram. Новые варианты функций — с
-- текстами строк; прежние (без них) остаются на время выпуска: код прежней версии зовёт их между
-- шагами «миграции» и «публикация».
CREATE FUNCTION app.auth_lock_notify(
    p_user uuid, p_user_text text, p_unlocker_text text, p_now timestamptz,
    p_bell_text text, p_bell_staff_text text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_org uuid;
    v_org_name text;
    v_owner boolean;
    v_event bigint;
    v_employee uuid;
    v_name text;
  BEGIN
    SELECT u.org_id, o.name, coalesce(r.is_owner, false), e.id, e.short_name
      INTO v_org, v_org_name, v_owner, v_employee, v_name
      FROM public.users u
      JOIN public.organizations o ON o.id = u.org_id
      LEFT JOIN public.employees e ON e.user_id = u.id
      LEFT JOIN public.roles r ON r.id = e.role_id AND r.org_id = e.org_id
      WHERE u.id = p_user AND u.login_locked_at IS NOT NULL AND u.org_id IS NOT NULL;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    INSERT INTO public.audit_log (org_id, entity, entity_id, action, changes, actor_user_id)
      VALUES (v_org, 'user', p_user::text, 'login_lock', '[]'::jsonb, NULL)
      RETURNING id INTO v_event;
    -- Колокольчик: самому пользователю и — о сотруднике — владельцам его организации (прототип v122
    -- `bellPut` в `core/login.js`; о владельце — только ему самому). Ключ — по записи истории.
    IF p_bell_text IS NOT NULL AND btrim(p_bell_text) <> '' THEN
      INSERT INTO public.bell_notifications
        (org_id, user_id, kind, event, text, event_key, created_at)
        VALUES (v_org, p_user, 'other', 'login_locked', left(p_bell_text, 1000),
          'login_locked:' || v_event::text, p_now)
        ON CONFLICT (user_id, event_key) DO NOTHING;
    END IF;
    IF NOT v_owner AND p_bell_staff_text IS NOT NULL AND btrim(p_bell_staff_text) <> '' THEN
      INSERT INTO public.bell_notifications
        (org_id, user_id, kind, event, target_kind, target_id, text, event_key, created_at)
      SELECT v_org, u.id, 'other', 'login_locked',
        CASE WHEN v_employee IS NULL THEN NULL ELSE 'employee' END, v_employee::text,
        left(replace(p_bell_staff_text, '{name}', coalesce(v_name, '')), 1000),
        'login_locked:' || v_event::text, p_now
      FROM public.employees e
      JOIN public.roles r ON r.id = e.role_id AND r.org_id = e.org_id AND r.is_owner
      JOIN public.users u ON u.id = e.user_id AND NOT u.blocked
      WHERE e.org_id = v_org AND e.active AND u.id <> p_user
      ON CONFLICT (user_id, event_key) DO NOTHING;
    END IF;
    -- Дальше — как в 0095: тексты Telegram пусты — бот не подключён.
    IF p_user_text IS NOT NULL THEN
      INSERT INTO public.telegram_outbox
        (org_id, user_id, chat_id, kind, text, status, tries, next_at, dedupe_key)
      SELECT v_org, l.user_id, l.chat_id, 'login_locked',
        CASE WHEN EXISTS (SELECT 1 FROM public.telegram_links s
                         WHERE s.chat_id = l.chat_id AND s.user_id <> l.user_id)
             THEN v_org_name || chr(10) || p_user_text ELSE p_user_text END,
        'pending', 0, p_now,
        'login_lock:' || v_event::text || ':' || l.user_id::text
      FROM public.telegram_links l
      WHERE l.user_id = p_user;
    END IF;
    IF p_unlocker_text IS NULL THEN
      RETURN;
    END IF;
    IF v_owner THEN
      INSERT INTO public.telegram_outbox
        (org_id, user_id, chat_id, kind, text, status, tries, next_at, dedupe_key)
      SELECT NULL, u.id, l.chat_id, 'login_locked', p_unlocker_text, 'pending', 0, p_now,
        'login_lock:' || v_event::text || ':' || u.id::text
      FROM public.telegram_links l
      JOIN public.users u ON u.id = l.user_id AND u.is_platform_admin AND NOT u.blocked;
    ELSE
      INSERT INTO public.telegram_outbox
        (org_id, user_id, chat_id, kind, text, status, tries, next_at, dedupe_key)
      SELECT v_org, u.id, l.chat_id, 'login_locked',
        CASE WHEN EXISTS (SELECT 1 FROM public.telegram_links s
                         WHERE s.chat_id = l.chat_id AND s.user_id <> l.user_id)
             THEN v_org_name || chr(10) || p_unlocker_text ELSE p_unlocker_text END,
        'pending', 0, p_now,
        'login_lock:' || v_event::text || ':' || u.id::text
      FROM public.employees e
      JOIN public.roles r ON r.id = e.role_id AND r.org_id = e.org_id AND r.is_owner
      JOIN public.users u ON u.id = e.user_id AND NOT u.blocked
      JOIN public.telegram_links l ON l.user_id = u.id
      WHERE e.org_id = v_org AND e.active AND u.id <> p_user;
    END IF;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_lock_notify(uuid, text, text, timestamptz, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.auth_lock_notify(uuid, text, text, timestamptz, text, text) TO buhuchet_app;
--> statement-breakpoint
-- Рассылка администратора платформы: сообщения Telegram — как в 0140, и строка колокольчика каждому
-- действующему сотруднику действующих организаций — и без привязанного Telegram (прототип v122
-- `admin/tg-cast.js`). Ключ — один на рассылку.
CREATE FUNCTION app.admin_telegram_broadcast(
  p_org uuid, p_text text, p_payload jsonb, p_now timestamptz, p_bell_text text
)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    n integer;
    v_key text := 'broadcast:' || gen_random_uuid()::text;
  BEGIN
    n := app.admin_telegram_broadcast(p_org, p_text, p_payload, p_now);
    IF n IS NULL THEN
      RETURN NULL;
    END IF;
    IF p_bell_text IS NOT NULL AND btrim(p_bell_text) <> '' THEN
      INSERT INTO public.bell_notifications
        (org_id, user_id, kind, event, text, event_key, created_at)
      SELECT u.org_id, u.id, 'other', 'broadcast', left(p_bell_text, 1000), v_key, p_now
      FROM public.users u
      JOIN public.employees e ON e.user_id = u.id AND e.active
      JOIN public.organizations g ON g.id = u.org_id AND g.status = 'active'
      WHERE NOT u.blocked AND (p_org IS NULL OR u.org_id = p_org)
      ON CONFLICT (user_id, event_key) DO NOTHING;
    END IF;
    RETURN n;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_telegram_broadcast(uuid, text, jsonb, timestamptz, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_telegram_broadcast(uuid, text, jsonb, timestamptz, text) TO buhuchet_app;
