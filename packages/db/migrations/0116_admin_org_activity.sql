-- Админка → «Организации» → «Активность» (прототип v84, modules/activity.js — `renderOrgAct`;
-- docs/decisions.md, п. О-44): администратор платформы видит по каждой организации только числа за
-- период — сколько пользователей работали, дни с активностью, входы, действия, сданные отчёты и новые
-- контрагенты. Сами записи организаций (кто что менял, какие отчёты и контрагенты) ему не отдаются.
-- Роль приложения без контекста организации данные организаций не читает (RLS), поэтому числа считают
-- функции SECURITY DEFINER от владельца схемы; всем, кроме незаблокированного администратора платформы
-- (app.is_platform_admin()), они отвечают пусто.

-- События организаций за период (дни — по Бишкеку, как на «Главной» → «Активность», п. О-43): действие —
-- запись истории изменений или смена статуса, которой та же операция не записала историю; вход, выход
-- кнопкой «Выйти» и последнее обращение сеанса. Только пользователи самой организации: открытие
-- карточки организации администратором платформы её активностью не считается. Служебная: её вызывают
-- две функции ниже; у роли приложения право на неё отнято (в схеме app оно выдаётся по умолчанию), и
-- не администратору платформы она тоже отвечает пусто.
CREATE FUNCTION app.admin_org_events(p_from date, p_to date)
  RETURNS TABLE (org_id uuid, user_id uuid, at timestamptz, kind text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH b AS (
      SELECT (p_from::timestamp AT TIME ZONE 'Asia/Bishkek') AS t_from,
             ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Bishkek') AS t_to
      WHERE app.is_platform_admin()
    )
    SELECT a.org_id, a.actor_user_id, a.at, 'act'::text
      FROM b, public.audit_log a
      JOIN public.users u ON u.id = a.actor_user_id AND u.org_id = a.org_id
      WHERE a.at >= b.t_from AND a.at < b.t_to
    UNION ALL
    SELECT s.org_id, s.actor_user_id, s.at, 'act'::text
      FROM b, public.status_history s
      JOIN public.users u ON u.id = s.actor_user_id AND u.org_id = s.org_id
      WHERE s.from_status IS NOT NULL AND s.at >= b.t_from AND s.at < b.t_to
        AND NOT EXISTS (
          SELECT 1 FROM public.audit_log sa
          WHERE sa.org_id = s.org_id AND sa.at = s.at AND sa.actor_user_id = s.actor_user_id
        )
    UNION ALL
    SELECT l.org_id, l.user_id, l.started_at, 'in'::text
      FROM b, public.session_log l
      WHERE l.org_id IS NOT NULL AND l.started_at >= b.t_from AND l.started_at < b.t_to
    UNION ALL
    SELECT l.org_id, l.user_id, l.ended_at, 'out'::text
      FROM b, public.session_log l
      WHERE l.org_id IS NOT NULL AND l.end_reason = 'logout'
        AND l.ended_at >= b.t_from AND l.ended_at < b.t_to
    UNION ALL
    SELECT l.org_id, l.user_id, l.last_seen_at, 'seen'::text
      FROM b, public.session_log l
      WHERE l.org_id IS NOT NULL AND l.last_seen_at >= b.t_from AND l.last_seen_at < b.t_to
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_org_events(date, date) FROM PUBLIC, buhuchet_app;
--> statement-breakpoint
-- Числа организаций за период: строка на организацию с активностью, сданными отчётами (по дню сдачи,
-- без вида «Уплата») или новыми контрагентами (по дню создания по Бишкеку).
CREATE FUNCTION app.admin_org_activity(p_from date, p_to date)
  RETURNS TABLE (
    org_id uuid,
    users integer,
    days integer,
    logins integer,
    actions integer,
    last_at timestamptz,
    submitted integer,
    contractors integer
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT
      o.id,
      coalesce(e.users, 0),
      coalesce(e.days, 0),
      coalesce(e.logins, 0),
      coalesce(e.actions, 0),
      e.last_at,
      coalesce(r.submitted, 0),
      coalesce(c.contractors, 0)
    FROM public.organizations o
    LEFT JOIN (
      SELECT
        ev.org_id,
        count(DISTINCT ev.user_id)::integer AS users,
        count(DISTINCT (ev.at AT TIME ZONE 'Asia/Bishkek')::date)::integer AS days,
        (count(*) FILTER (WHERE ev.kind = 'in'))::integer AS logins,
        (count(*) FILTER (WHERE ev.kind = 'act'))::integer AS actions,
        max(ev.at) AS last_at
      FROM app.admin_org_events(p_from, p_to) ev
      GROUP BY ev.org_id
    ) e ON e.org_id = o.id
    LEFT JOIN (
      SELECT rp.org_id, count(*)::integer AS submitted
      FROM public.reports rp
      WHERE rp.act <> 'pay' AND rp.submitted_on BETWEEN p_from AND p_to
      GROUP BY rp.org_id
    ) r ON r.org_id = o.id
    LEFT JOIN (
      SELECT cp.org_id, count(*)::integer AS contractors
      FROM public.contractors cp
      WHERE (cp.created_at AT TIME ZONE 'Asia/Bishkek')::date BETWEEN p_from AND p_to
      GROUP BY cp.org_id
    ) c ON c.org_id = o.id
    WHERE app.is_platform_admin()
      AND (e.org_id IS NOT NULL OR r.org_id IS NOT NULL OR c.org_id IS NOT NULL)
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_org_activity(date, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_org_activity(date, date) TO buhuchet_app;
--> statement-breakpoint
-- Действия всех организаций по дням — для столбиков «Действия по дням».
CREATE FUNCTION app.admin_activity_by_day(p_from date, p_to date)
  RETURNS TABLE (day date, actions integer)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT (ev.at AT TIME ZONE 'Asia/Bishkek')::date, count(*)::integer
    FROM app.admin_org_events(p_from, p_to) ev
    WHERE ev.kind = 'act' AND app.is_platform_admin()
    GROUP BY 1
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_activity_by_day(date, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_activity_by_day(date, date) TO buhuchet_app;
