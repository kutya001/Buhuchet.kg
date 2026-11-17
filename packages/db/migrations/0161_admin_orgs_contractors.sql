-- Админка → «Организации»: число контрагентов организации (столбец «Контрагентов» и плашка
-- «Контрагентов на платформе»). С задачи #54 они показывали 0 — заглушку до модуля «Контрагенты»,
-- которую так и не заменили. Как в прототипе (admin/accounts-orgs.js, `cps`): контрагенты не в архиве.
-- Новый столбец — в конце, права представления (0024) остаются.
CREATE OR REPLACE VIEW app.admin_organizations WITH (security_barrier = true) AS
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
    (SELECT e.short_name FROM public.employees e WHERE e.user_id = o.updated_by) AS updated_by_name,
    o.legal_form,
    (
      SELECT count(*)::integer FROM public.contractors c
      WHERE c.org_id = o.id AND c.service_status <> 'archived'
    ) AS contractors
  FROM public.organizations o
  WHERE app.is_platform_admin();
