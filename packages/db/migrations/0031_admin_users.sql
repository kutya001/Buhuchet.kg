-- Админка → «Учётные записи» (ТЗ «Админка» → «Модуль учётных записей»): администратор платформы видит
-- всех пользователей платформы, сбрасывает им пароль, блокирует и разблокирует. Как у «Организаций»
-- (миграция 0024): список — представление от владельца схемы, которое отдаёт строки, только если в
-- контексте (app.user_id) — незаблокированный администратор платформы; блокировку ставит функция с той
-- же проверкой. Роль приложения сама `users.blocked` больше не меняет (права на столбцы ниже).
--
-- Строка списка: учётная запись, её организация, сотрудник (ФИО, роль, «активен» — блокировка
-- владельцем) и кто создал и изменил. «Создал» — автор записи сотрудника (у администратора платформы
-- сотрудника нет — пусто); «Изменено» и «Изменил» — последняя запись истории учётной записи или
-- сотрудника (сброс пароля, блокировка, смена роли…), без неё — «Изменено» учётной записи и создавший.
CREATE VIEW app.admin_users WITH (security_barrier = true) AS
  SELECT
    u.id,
    u.login::text AS login,
    u.org_id,
    o.name AS org_name,
    e.full_name,
    r.name AS role_name,
    u.is_platform_admin,
    u.last_login_at,
    u.blocked,
    coalesce(e.active, true) AS employee_active,
    u.created_at,
    coalesce(h.at, u.updated_at) AS updated_at,
    e.created_by,
    h.actor_user_id AS updated_by,
    (SELECT c.short_name FROM public.employees c WHERE c.user_id = e.created_by) AS created_by_name,
    (SELECT c.short_name FROM public.employees c WHERE c.user_id = h.actor_user_id) AS updated_by_name,
    u.version
  FROM public.users u
  LEFT JOIN public.organizations o ON o.id = u.org_id
  LEFT JOIN public.employees e ON e.user_id = u.id
  LEFT JOIN public.roles r ON r.id = e.role_id
  LEFT JOIN LATERAL (
    SELECT x.at, x.actor_user_id
    FROM (
      (
        SELECT a.at, a.id, a.actor_user_id FROM public.audit_log a
        WHERE a.org_id = u.org_id AND a.entity = 'user' AND a.entity_id = u.id::text
        ORDER BY a.at DESC, a.id DESC
        LIMIT 1
      )
      UNION ALL
      (
        SELECT a.at, a.id, a.actor_user_id FROM public.audit_log a
        WHERE a.org_id = u.org_id AND a.entity = 'employee' AND a.entity_id = e.id::text
        ORDER BY a.at DESC, a.id DESC
        LIMIT 1
      )
    ) x
    ORDER BY x.at DESC, x.id DESC
    LIMIT 1
  ) h ON true
  WHERE app.is_platform_admin();
--> statement-breakpoint
REVOKE ALL ON TABLE app.admin_users FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON TABLE app.admin_users TO buhuchet_app;
--> statement-breakpoint
-- Блокировка и разблокировка учётной записи пользователя организации: «заблокирован», версия,
-- «Изменено». Только в контексте его организации (там же API пишет историю и закрывает сеансы) и только
-- администратором платформы; учётную запись администратора платформы функция не меняет. Отвечает новой
-- версией; пусто — нет такой учётной записи в этой организации, версия устарела или в контексте не
-- администратор платформы.
CREATE OR REPLACE FUNCTION app.admin_set_user_blocked(p_user uuid, p_blocked boolean, p_version integer)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.users
      SET blocked = p_blocked,
          version = version + 1,
          updated_at = now()
      WHERE id = p_user
        AND version = p_version
        AND NOT is_platform_admin
        AND org_id = app.current_org_id()
        AND app.is_platform_admin()
      RETURNING version
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_set_user_blocked(uuid, boolean, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_set_user_blocked(uuid, boolean, integer) TO buhuchet_app;
--> statement-breakpoint
-- Роль приложения меняет у учётной записи только пароль (временный пароль от владельца или
-- администратора) и служебные поля правки. Блокировку ставит только функция выше; логин, организацию,
-- «администратор платформы» и «последний вход» приложение не меняет вовсе (вход и смена своего пароля —
-- функции app.auth_*). Права по умолчанию (миграция 0000) дали UPDATE на всю таблицу — забираем его и
-- выдаём на перечисленные столбцы, как у organizations (миграция 0015).
REVOKE UPDATE ON TABLE public.users FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (password_hash, must_change_password, version, updated_at)
  ON TABLE public.users TO buhuchet_app;
