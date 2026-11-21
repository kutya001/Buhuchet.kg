-- Проверка шаблонов «Витрины данных» системой (доработки 20.11.2026: Витрина данных, блок 8, пункт 7;
-- общий план 20.11, этап 2, П4; docs/decisions.md п. О-66): после выпуска с миграциями и каждую ночь
-- каждый опубликованный и сломанный шаблон запускается — шаблон организаций на демо-организации, шаблон
-- Админки от имени администратора платформы; запуск только читает и откатывается (исполнитель — миграция
-- 0166). Не выполнился — «Сломан», снова выполняется — «Опубликован». Обе функции — только задаче по
-- расписанию (без вошедшего и без организации): шаблоны, их запросы и история роли приложения иначе не
-- видны (только администратору платформы).

-- Шаблоны, которые пора проверить: не проверенные системой с `p_since` (последняя ночная проверка) или
-- при другом числе применённых миграций (был выпуск). Шаблоны организаций — только когда есть
-- демо-организация, шаблоны Админки — только когда есть незаблокированный администратор платформы: иначе
-- их не на чем запустить, и они не заслоняют остальные. Не больше `p_limit`, сначала давно не
-- проверенные. Ответ — {schema, demo, admin, items: [{id, code, name, audience, state, version, query,
-- params, columns}]}.
CREATE FUNCTION app.dm_check_due(p_since timestamptz, p_limit integer)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_schema integer;
    v_demo uuid;
    v_admin uuid;
  BEGIN
    IF app.current_user_id() IS NOT NULL OR app.current_org_id() IS NOT NULL THEN
      RAISE EXCEPTION 'dm_check_due: только задаче по расписанию' USING ERRCODE = '42501';
    END IF;
    SELECT count(*)::integer INTO v_schema FROM drizzle.__drizzle_migrations;
    SELECT o.id INTO v_demo FROM public.organizations o
      WHERE o.is_demo ORDER BY o.created_at, o.id LIMIT 1;
    SELECT u.id INTO v_admin FROM public.users u
      WHERE u.is_platform_admin AND NOT u.blocked ORDER BY u.created_at, u.id LIMIT 1;
    RETURN jsonb_build_object(
      'schema', v_schema,
      'demo', v_demo,
      'admin', v_admin,
      'items', coalesce((
        SELECT jsonb_agg(q.item ORDER BY q.n)
        FROM (
          SELECT row_number() OVER (ORDER BY s.auto_checked_at NULLS FIRST, d.code) AS n,
            jsonb_build_object(
              'id', d.id, 'code', d.code, 'name', d.name, 'audience', d.audience,
              'state', d.state, 'version', d.version, 'query', s.query,
              'params', d.params, 'columns', d.columns) AS item
          FROM public.dm_templates d
          JOIN public.dm_template_sql s ON s.template_id = d.id
          WHERE d.state IN ('published', 'broken')
            AND ((d.audience = 'org' AND v_demo IS NOT NULL)
              OR (d.audience = 'admin' AND v_admin IS NOT NULL))
            AND (s.auto_checked_at IS NULL OR s.auto_checked_at < p_since
              OR s.auto_checked_schema IS DISTINCT FROM v_schema)
          ORDER BY s.auto_checked_at NULLS FIRST, d.code
          LIMIT greatest(coalesce(p_limit, 0), 0)
        ) q
      ), '[]'::jsonb));
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.dm_check_due(timestamptz, integer) FROM PUBLIC, buhuchet_dm_org, buhuchet_dm_admin;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.dm_check_due(timestamptz, integer) TO buhuchet_app;
--> statement-breakpoint
-- Итог проверки одного шаблона. Шаблон, который с выдачи списка изменили (другая версия) или отключили,
-- не трогается — 'skip'. Иначе у запроса — «Проверен» (момент, организация проверки, текст ошибки у
-- неудачной) и отметка проверки системой; опубликованный, который не выполнился, становится «Сломан»,
-- сломанный, который выполнился, — снова «Опубликован» (версия +1, строка истории без автора —
-- «Система»). `p_now` — момент проверки по часам приложения. Ответ — новое состояние ('broken',
-- 'published') или 'same'.
CREATE FUNCTION app.dm_check_mark(
  p_id uuid,
  p_version integer,
  p_ok boolean,
  p_error text,
  p_org uuid,
  p_schema integer,
  p_now timestamptz
)
  RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_state text;
    v_version integer;
    v_to text;
  BEGIN
    IF app.current_user_id() IS NOT NULL OR app.current_org_id() IS NOT NULL THEN
      RAISE EXCEPTION 'dm_check_mark: только задаче по расписанию' USING ERRCODE = '42501';
    END IF;
    IF p_ok IS NULL OR p_schema IS NULL OR p_now IS NULL THEN
      RAISE EXCEPTION 'dm_check_mark: нет итога проверки';
    END IF;
    SELECT d.state, d.version INTO v_state, v_version
      FROM public.dm_templates d WHERE d.id = p_id FOR UPDATE;
    IF NOT FOUND OR v_version IS DISTINCT FROM p_version OR v_state NOT IN ('published', 'broken') THEN
      RETURN 'skip';
    END IF;
    UPDATE public.dm_template_sql
      SET checked_at = p_now,
        checked_org_id = p_org,
        check_error = CASE WHEN p_ok THEN NULL
          ELSE left(coalesce(nullif(btrim(p_error), ''), '—'), 2000) END,
        auto_checked_at = p_now,
        auto_checked_schema = p_schema
      WHERE template_id = p_id;
    v_to := CASE
      WHEN NOT p_ok AND v_state = 'published' THEN 'broken'
      WHEN p_ok AND v_state = 'broken' THEN 'published'
    END;
    IF v_to IS NULL THEN
      RETURN 'same';
    END IF;
    UPDATE public.dm_templates
      SET state = v_to, version = version + 1, updated_at = p_now
      WHERE id = p_id;
    INSERT INTO public.platform_audit_log (entity, entity_id, action, changes, actor_user_id)
    VALUES ('dm_template', p_id::text, 'dm_state',
      jsonb_build_array(jsonb_build_object('field', 'state', 'from', v_state, 'to', v_to)), NULL);
    RETURN v_to;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.dm_check_mark(uuid, integer, boolean, text, uuid, integer, timestamptz) FROM PUBLIC, buhuchet_dm_org, buhuchet_dm_admin;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.dm_check_mark(uuid, integer, boolean, text, uuid, integer, timestamptz) TO buhuchet_app;
