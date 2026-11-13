-- Меню команд бота (поток Т, задача Т5; прототип v102 modules/tg-menu.js): «Сегодня», «Неделя»,
-- «Просрочено», «Найти контрагента». Команда приходит обычным сообщением в чат: вебхук работает без
-- входа и без организации, поэтому учётные записи, к которым привязан чат, находит эта функция — только
-- то, что нужно для отказов ядра бота (как `app.telegram_press_target` у нажатия кнопки). Сами данные
-- читаются дальше от имени найденного пользователя в его организации (RLS).
-- Один чат может быть привязан к нескольким учётным записям: строка на каждую, по порядку привязки.
CREATE FUNCTION app.telegram_chat_users(p_chat bigint)
  RETURNS TABLE (
    user_id uuid,
    org_id uuid,
    employee_id uuid,
    login text,
    org_name text,
    must_change_password boolean,
    relink_free boolean,
    is_platform_admin boolean,
    user_blocked boolean,
    employee_active boolean,
    org_status text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT u.id, u.org_id, e.id, u.login::text, o.name,
           u.must_change_password,
           EXISTS (SELECT 1 FROM public.telegram_link_guards g
                   WHERE g.user_id = u.id AND g.free_until > now()),
           u.is_platform_admin, u.blocked, e.active, o.status
    FROM public.telegram_links l
    JOIN public.users u ON u.id = l.user_id
    LEFT JOIN public.employees e ON e.user_id = u.id
    LEFT JOIN public.organizations o ON o.id = u.org_id
    WHERE l.chat_id = p_chat
    ORDER BY l.linked_at, u.id
    LIMIT 20
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_chat_users(bigint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.telegram_chat_users(bigint) TO buhuchet_app;
