-- Админка → «Организации» (ТЗ «Админка» → «Модуль организаций»): администратор платформы видит все
-- организации, создаёт их вместе с владельцем и блокирует. Роль приложения под RLS видит только
-- организацию из контекста, а у администратора организации нет. Поэтому список — представление от
-- владельца схемы, которое отдаёт строки, только если в контексте (app.user_id) — незаблокированный
-- администратор платформы; остальным оно пусто. Статус организации роль приложения не меняет
-- (миграция 0015) — его меняет функция с той же проверкой.
CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.users a
      WHERE a.id = app.current_user_id() AND a.is_platform_admin AND NOT a.blocked
    )
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.is_platform_admin() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_platform_admin() TO buhuchet_app;
--> statement-breakpoint
-- Строка списка: организация, логин владельца, активных сотрудников и кто создал и изменил (краткое
-- ФИО сотрудника; у администратора платформы сотрудника нет — пусто). security_barrier: условие
-- «администратор» проверяется раньше любых условий запроса.
CREATE VIEW app.admin_organizations WITH (security_barrier = true) AS
  SELECT
    o.id,
    o.name,
    o.inn,
    o.slug,
    o.status,
    o.blocked_reason,
    o.is_demo,
    o.created_at,
    o.updated_at,
    o.created_by,
    o.updated_by,
    o.version,
    (
      SELECT u.login::text
      FROM public.employees e
      JOIN public.roles r ON r.id = e.role_id AND r.is_owner
      JOIN public.users u ON u.id = e.user_id
      WHERE e.org_id = o.id
      ORDER BY e.created_at
      LIMIT 1
    ) AS owner_login,
    (
      SELECT count(*)::integer FROM public.employees e WHERE e.org_id = o.id AND e.active
    ) AS employees,
    (SELECT e.short_name FROM public.employees e WHERE e.user_id = o.created_by) AS created_by_name,
    (SELECT e.short_name FROM public.employees e WHERE e.user_id = o.updated_by) AS updated_by_name
  FROM public.organizations o
  WHERE app.is_platform_admin();
--> statement-breakpoint
REVOKE ALL ON TABLE app.admin_organizations FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON TABLE app.admin_organizations TO buhuchet_app;
--> statement-breakpoint
-- Плашки над списком: учётных записей организаций на платформе (без администраторов платформы).
CREATE OR REPLACE FUNCTION app.admin_platform_users() RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT count(*)::integer FROM public.users u
    WHERE NOT u.is_platform_admin AND app.is_platform_admin()
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_platform_users() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_platform_users() TO buhuchet_app;
--> statement-breakpoint
-- Блокировка и разблокировка организации: статус, причина (только у заблокированной), версия,
-- «Изменено» и «Изменил». Отвечает новой версией; пусто — нет такой организации, версия устарела или
-- в контексте не администратор платформы. Историю пишет API в той же транзакции.
CREATE OR REPLACE FUNCTION app.admin_set_org_status(
  p_org uuid, p_status text, p_reason text, p_version integer
)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.organizations
      SET status = p_status,
          blocked_reason = CASE WHEN p_status = 'blocked' THEN p_reason END,
          version = version + 1,
          updated_at = now(),
          updated_by = app.current_user_id()
      WHERE id = p_org AND version = p_version AND app.is_platform_admin()
      RETURNING version
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_set_org_status(uuid, text, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_set_org_status(uuid, text, text, integer) TO buhuchet_app;
