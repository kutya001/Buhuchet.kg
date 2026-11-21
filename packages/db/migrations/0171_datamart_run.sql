-- «Витрина данных»: «Вывод» и общий путь запроса (доработки 20.11.2026: Витрина данных, блок 4; блок 8,
-- пункт 1; общий план 20.11, этап 2, П3–П4). Две функции без новых таблиц.
-- Откат: DROP FUNCTION обеих (сначала код перестаёт их звать); таблицы не меняются.
-- Текст запроса опубликованного шаблона для «Вывода» организации: dm_template_sql видна только
-- администратору платформы (0165), сам текст организации не показывается — его берёт сервер, чтобы
-- выполнить шаблон исполнителем Витрины (0166). Организации — только опубликованный шаблон «Для
-- организаций» с её доступом (как политика dm_templates_org_read, но без «Сломан»: сломанный не
-- выполняется); администратору платформы — любой. Чужой, черновик, отключённый — пусто.
CREATE FUNCTION app.dm_template_query(p_id uuid)
  RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT s.query
    FROM public.dm_template_sql s
    JOIN public.dm_templates d ON d.id = s.template_id
    WHERE s.template_id = p_id
      AND (
        app.is_platform_admin()
        OR (
          app.current_org_id() IS NOT NULL
          AND d.audience = 'org'
          AND d.state = 'published'
          AND (
            d.access = 'all'
            OR EXISTS (
              SELECT 1 FROM public.dm_template_orgs o
              WHERE o.template_id = d.id AND o.org_id = app.current_org_id()
            )
          )
        )
      )
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.dm_template_query(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.dm_template_query(uuid) TO buhuchet_app;
--> statement-breakpoint
-- Журнал запросов (блок 6, пункт 7; блок 8, пункт 1): одна функция записи для «Вывода» (via = 'screen')
-- и внешнего адреса по токену (via = 'api', поток Т); роль приложения в dm_requests не пишет (0165).
-- Организация и сотрудник — из контекста, а не из параметров. С экрана: без токена, от сотрудника, а
-- вне организации — только администратор платформы. По токену: токен этой организации (у токена Админки
-- — вне организации), «Последний запрос» токена — сейчас и с этого адреса. Шаблон в контексте
-- организации — только «Для организаций». Ошибка — до 300 знаков, адрес — до 64.
CREATE FUNCTION app.dm_request_log(
    p_via text,
    p_template uuid,
    p_token uuid,
    p_params jsonb,
    p_rows integer,
    p_ms integer,
    p_outcome text,
    p_error text,
    p_ip text
  )
  RETURNS bigint
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_org uuid := app.current_org_id();
    v_user uuid := app.current_user_id();
    v_id bigint;
  BEGIN
    IF p_via = 'screen' THEN
      IF p_token IS NOT NULL OR v_user IS NULL OR (v_org IS NULL AND NOT app.is_platform_admin()) THEN
        RAISE EXCEPTION 'dm_request_log: запрос с экрана — только от сотрудника или администратора платформы'
          USING ERRCODE = '42501';
      END IF;
    ELSIF p_via = 'api' THEN
      IF p_token IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.dm_tokens k
          WHERE k.id = p_token AND k.org_id IS NOT DISTINCT FROM v_org) THEN
        RAISE EXCEPTION 'dm_request_log: токен не этой организации' USING ERRCODE = '42501';
      END IF;
      UPDATE public.dm_tokens SET last_used_at = now(), last_ip = left(p_ip, 64) WHERE id = p_token;
    ELSE
      RAISE EXCEPTION 'dm_request_log: неизвестный путь запроса' USING ERRCODE = '22023';
    END IF;
    IF p_template IS NOT NULL AND v_org IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.dm_templates d WHERE d.id = p_template AND d.audience = 'org') THEN
      RAISE EXCEPTION 'dm_request_log: шаблон не для организаций' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.dm_requests
      (org_id, token_id, template_id, user_id, via, params, row_count, duration_ms, outcome, error, ip)
    VALUES
      (v_org, p_token, p_template, v_user, p_via, coalesce(p_params, '{}'::jsonb), p_rows, p_ms,
       p_outcome, left(p_error, 300), left(p_ip, 64))
    RETURNING id INTO v_id;
    RETURN v_id;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.dm_request_log(text, uuid, uuid, jsonb, integer, integer, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.dm_request_log(text, uuid, uuid, jsonb, integer, integer, text, text, text) TO buhuchet_app;
