-- «Главная» → «Активность» (прототип v84, modules/activity.js; docs/decisions.md, п. О-43): входы и
-- выходы сотрудников берутся из журнала сеансов. Прав на session_log у роли приложения нет (0112),
-- поэтому организация читает свою часть журнала через представление: только сеансы своей организации
-- (app.current_org_id()) и только то, что нужно для подсчёта, — без номера сеанса, устройства и срока;
-- из причины конца сеанса — только «закрыт кнопкой «Выйти»».
-- Право «Смотреть аналитику по сотрудникам» проверяет API.
CREATE VIEW app.org_sessions WITH (security_barrier = true) AS
  SELECT l.user_id, l.started_at, l.last_seen_at, l.ended_at,
    (l.end_reason IS NOT DISTINCT FROM 'logout') AS logged_out
  FROM public.session_log l
  WHERE l.org_id = app.current_org_id();
--> statement-breakpoint
REVOKE ALL ON TABLE app.org_sessions FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON TABLE app.org_sessions TO buhuchet_app;
--> statement-breakpoint
-- Право «Смотреть аналитику по сотрудникам» (прототип v84, core/data.js: перенос данных v84). При выпуске
-- миграции идут раньше наполнения, поэтому строку каталога добавляет и миграция — там, где каталог уже
-- наполнен (в пустой базе его создаст наполнение). Порядок строк каталога выровняет наполнение.
INSERT INTO public.permissions (id, perm_group, name, description, sort_order)
  SELECT 'staffStats', 'staff', 'Смотреть аналитику по сотрудникам',
    'Вкладка «Активность» на Главной: входы и выходы, последняя активность, действия, сданные отчёты и контрагенты в ответственности каждого сотрудника за день, неделю, месяц и год.',
    p.sort_order + 1
  FROM public.permissions p
  WHERE p.id = 'staffView'
  ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- Шаблон «Главный бухгалтер»: право — сразу после «Просматривать сотрудников», даже если шаблон правили
-- в Админке (наполнение такой шаблон не трогает).
UPDATE public.role_templates t
  SET permissions = t.permissions[1:array_position(t.permissions, 'staffView')]
        || 'staffStats'::text
        || t.permissions[array_position(t.permissions, 'staffView') + 1:],
      version = t.version + 1,
      updated_at = now()
  WHERE t.code = 'chief'
    AND 'staffView' = ANY (t.permissions)
    AND NOT ('staffStats' = ANY (t.permissions));
--> statement-breakpoint
-- Роли «Главный бухгалтер» уже созданных организаций, у которых есть «Просматривать сотрудников»
-- (прототип: `r.id === 'chief' && r.perms.staffView`; владельцу право не нужно — у него все права):
-- право, новая версия роли и запись в истории роли от имени системы.
WITH target AS (
  SELECT r.id, r.org_id,
    (SELECT coalesce(jsonb_agg(c.id ORDER BY c.sort_order, c.id), '[]'::jsonb)
       FROM public.role_permissions rp
       JOIN public.permissions c ON c.id = rp.permission_id
       WHERE rp.role_id = r.id) AS before,
    (SELECT coalesce(jsonb_agg(c.id ORDER BY c.sort_order, c.id <> 'staffStats', c.id), '[]'::jsonb)
       FROM public.permissions c
       WHERE c.id = 'staffStats'
          OR EXISTS (SELECT 1 FROM public.role_permissions rp
                     WHERE rp.role_id = r.id AND rp.permission_id = c.id)) AS after
  FROM public.roles r
  WHERE r.template_code = 'chief'
    AND NOT r.is_owner
    AND EXISTS (SELECT 1 FROM public.permissions c WHERE c.id = 'staffStats')
    AND EXISTS (SELECT 1 FROM public.role_permissions rp
                WHERE rp.role_id = r.id AND rp.permission_id = 'staffView')
    AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.role_id = r.id AND rp.permission_id = 'staffStats')
), granted AS (
  INSERT INTO public.role_permissions (org_id, role_id, permission_id)
    SELECT t.org_id, t.id, 'staffStats' FROM target t
    ON CONFLICT DO NOTHING
    RETURNING role_id
), bumped AS (
  UPDATE public.roles r
    SET version = r.version + 1, updated_at = now()
    FROM granted g
    WHERE r.id = g.role_id
    RETURNING r.id
)
INSERT INTO public.audit_log (org_id, entity, entity_id, action, changes, actor_user_id)
  SELECT t.org_id, 'role', t.id::text, 'update',
    jsonb_build_array(jsonb_build_object('field', 'permissions', 'from', t.before, 'to', t.after)),
    NULL
  FROM target t
  JOIN bumped b ON b.id = t.id;
