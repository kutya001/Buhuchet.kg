-- Права, политики и функции повторяющихся задач и запросов администратору (доработки 28.11.2026; план
-- разработки 28.11, этап 0, П2; таблицы и перенос — миграция 0178; docs/decisions.md п. О-72).
--
-- Задачи серии ставит ночной запуск «Задачи: повторы» без пользователя: вставка задачи без вошедшего
-- разрешена только с серией этой организации, постановщик — постановщик серии, автор записи пустой.
-- «Эту и следующие» переносит задачу в серию — роль приложения меняет `series_id`, `series_date`.
-- Блокировки ждём не дольше 5 с, как в 0178 (та же транзакция выпуска); предел снимается в конце.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
GRANT UPDATE (series_id, series_date) ON TABLE tasks TO buhuchet_app;
--> statement-breakpoint
DROP POLICY tasks_insert_own ON tasks;
--> statement-breakpoint
CREATE POLICY tasks_insert_own ON tasks AS RESTRICTIVE FOR INSERT TO buhuchet_app
  WITH CHECK (
    (
      created_by = app.current_user_id()
      AND author_employee_id IN (SELECT e.id FROM employees e WHERE e.user_id = app.current_user_id())
    )
    OR (
      app.current_user_id() IS NULL
      AND created_by IS NULL
      AND series_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM task_series s
        WHERE s.id = tasks.series_id AND s.org_id = tasks.org_id AND s.state = 'active'
          AND s.author_employee_id = tasks.author_employee_id
          AND s.executor_employee_id = tasks.executor_employee_id
          AND s.contractor_id IS NOT DISTINCT FROM tasks.contractor_id
          AND s.project_id IS NOT DISTINCT FROM tasks.project_id
          AND tasks.series_date >= s.start_date
      )
    )
  );
--> statement-breakpoint
-- Серию ставит сотрудник от своего имени; серии не удаляются (их останавливают, вместе с контрагентом
-- удаляет каскад); организацию, постановщика и автора записи после вставки не меняет никто.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE task_series FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (
  title, description, category_code, contractor_id, project_id, executor_employee_id, term, need_file,
  confirm, every, unit, week_days, month_mode, start_date, end_kind, end_date, end_count, state,
  stop_reason, next_date, made, updated_by, updated_at, version
) ON TABLE task_series TO buhuchet_app;
--> statement-breakpoint
CREATE POLICY task_series_insert_own ON task_series AS RESTRICTIVE FOR INSERT TO buhuchet_app
  WITH CHECK (
    created_by = app.current_user_id()
    AND author_employee_id IN (SELECT e.id FROM employees e WHERE e.user_id = app.current_user_id())
  );
--> statement-breakpoint
-- Ночной запуск без пользователя меняет у серии только состояние, причину, следующую дату и счёт
-- поставленных (и служебные поля правки); поля задачи и правило — только сотрудник.
CREATE OR REPLACE FUNCTION app.task_series_job_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF app.current_user_id() IS NULL AND (
      NEW.title, NEW.description, NEW.category_code, NEW.contractor_id, NEW.project_id,
      NEW.executor_employee_id, NEW.term, NEW.need_file, NEW.confirm, NEW.every, NEW.unit,
      NEW.week_days, NEW.month_mode, NEW.start_date, NEW.end_kind, NEW.end_date, NEW.end_count,
      NEW.updated_by
    ) IS DISTINCT FROM (
      OLD.title, OLD.description, OLD.category_code, OLD.contractor_id, OLD.project_id,
      OLD.executor_employee_id, OLD.term, OLD.need_file, OLD.confirm, OLD.every, OLD.unit,
      OLD.week_days, OLD.month_mode, OLD.start_date, OLD.end_kind, OLD.end_date, OLD.end_count,
      OLD.updated_by
    ) THEN
      RAISE EXCEPTION 'task_series: без пользователя меняются только состояние и счёт'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.task_series_job_guard() FROM PUBLIC, buhuchet_app;
--> statement-breakpoint
CREATE TRIGGER task_series_job_guard BEFORE UPDATE ON task_series
  FOR EACH ROW EXECUTE FUNCTION app.task_series_job_guard();
--> statement-breakpoint
-- Номер запроса — сквозной по платформе, с 1201 (прежние получили номера в 0178 по дате отправки).
-- Ставит его триггер при вставке: свой номер организация не задаёт и чужой не займёт.
CREATE SEQUENCE public.request_no_seq AS integer START WITH 1201 MINVALUE 1201;
--> statement-breakpoint
SELECT CASE WHEN max(no) IS NULL THEN setval('public.request_no_seq', 1201, false)
  ELSE setval('public.request_no_seq', max(no), true) END
FROM public.dict_change_requests;
--> statement-breakpoint
-- Роли приложения последовательность не выдаётся: номер берёт только триггер (SECURITY DEFINER), так что
-- организация не «сжигает» общие номера платформы прямым nextval.
REVOKE ALL ON SEQUENCE public.request_no_seq FROM buhuchet_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.dict_change_requests_no() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    NEW.no := nextval('public.request_no_seq');
    -- Прежний код «Попросить добавить» (окно выпуска, откат только кода) темы и формы не передаёт.
    IF NEW.kind = 'dict' AND btrim(NEW.topic) = '' AND NEW.what IS NOT NULL THEN
      NEW.topic := btrim(NEW.what);
    END IF;
    IF NEW.kind = 'dict' AND NEW.form_id IS NULL THEN
      NEW.form_id := CASE NEW.dict
        WHEN 'types' THEN 'type' WHEN 'regimes' THEN 'tax' WHEN 'organs' THEN 'organ' WHEN 'benefits' THEN 'ben'
        WHEN 'banks' THEN 'bank' WHEN 'cats' THEN 'cat' WHEN 'reasons' THEN 'reason' WHEN 'ugns' THEN 'ugns'
        WHEN 'bases' THEN 'base' WHEN 'dm' THEN 'dm' ELSE 'other' END;
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.dict_change_requests_no() FROM PUBLIC, buhuchet_app;
--> statement-breakpoint
CREATE TRIGGER dict_change_requests_no BEFORE INSERT ON dict_change_requests
  FOR EACH ROW EXECUTE FUNCTION app.dict_change_requests_no();
--> statement-breakpoint
-- Действия организации на запросе (блок 4): «Отозвать запрос» (автор, пока «Новый»), «прочитано» (автор),
-- ответ в открытый или закрытый не дольше 30 дней (возвращает «В работе», снимает «Ждёт вашего ответа»).
-- Роль приложения меняет только эти столбцы; что именно можно — проверяет триггер. Остальное (статусы
-- администратора, «Ведёт», ответ) — только администратор платформы: функция `app.admin_answer_dict_request`
-- и методы Админки этапа 2 в контексте организации запроса.
GRANT UPDATE (status, wait, read_author, closed_at, last_at, updated_at, version)
  ON TABLE dict_change_requests TO buhuchet_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.dict_change_requests_org_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    me uuid := app.current_user_id();
  BEGIN
    IF app.is_platform_admin() THEN
      RETURN NEW;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
        (OLD.status = 'new' AND NEW.status = 'withdrawn' AND OLD.created_by = me)
        -- Ответ в закрытый — не позже 30 дней с дня закрытия по Бишкеку (правило `requestReplyEffect`
        -- считает днями, здесь — с запасом в сутки); вопрос, ошибку и опечатку — автор или владелец
        -- (кто их видит), «Добавить в справочник» — проверяет API по праву «Справочники».
        OR (NEW.status = 'in_work' AND OLD.status IN ('solved', 'added', 'rejected')
          AND OLD.closed_at > now() - interval '31 days'
          AND (OLD.kind = 'dict' OR OLD.created_by = me OR EXISTS (
            SELECT 1 FROM public.employees e JOIN public.roles ro ON ro.id = e.role_id
            WHERE e.user_id = me AND e.org_id = OLD.org_id AND ro.is_owner)))
      ) THEN
        RAISE EXCEPTION 'dict_change_requests: такой статус ставит администратор платформы'
          USING ERRCODE = '42501';
      END IF;
      NEW.closed_at := CASE WHEN NEW.status IN ('new', 'in_work') THEN NULL ELSE now() END;
      NEW.wait := false;
    ELSE
      NEW.closed_at := OLD.closed_at;
    END IF;
    -- «Ждёт вашего ответа» организация только снимает (ответом).
    IF NEW.wait AND NOT OLD.wait THEN
      RAISE EXCEPTION 'dict_change_requests: «Ждёт ответа» ставит администратор платформы'
        USING ERRCODE = '42501';
    END IF;
    -- «Прочитано» — только своё, не дальше последнего сообщения ленты.
    IF NEW.read_author IS DISTINCT FROM OLD.read_author AND (
      OLD.created_by IS DISTINCT FROM me
      OR NEW.read_author < 0
      OR NEW.read_author > (
        SELECT coalesce(max(m.n), 0) FROM public.request_messages m WHERE m.request_id = OLD.id
      )
    ) THEN
      RAISE EXCEPTION 'dict_change_requests: прочитано отмечает только автор'
        USING ERRCODE = '42501';
    END IF;
    NEW.last_at := greatest(OLD.last_at, least(NEW.last_at, now()));
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.dict_change_requests_org_guard() FROM PUBLIC, buhuchet_app;
--> statement-breakpoint
CREATE TRIGGER dict_change_requests_org_guard BEFORE UPDATE ON dict_change_requests
  FOR EACH ROW EXECUTE FUNCTION app.dict_change_requests_org_guard();
--> statement-breakpoint
-- Ответ Админки на «Добавить в справочник» (прежняя функция миграции 0043, тот же вызов): теперь ещё и
-- лента — ответ сообщением администратора, решение — сменой статуса; запрос закрыт, «Ведёт» — ответивший,
-- прочитано администраторами. Отозванный и запрос другого вида так не закрываются.
CREATE OR REPLACE FUNCTION app.admin_answer_dict_request(p_id uuid, p_status text, p_answer text, p_version integer)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    r public.dict_change_requests%ROWTYPE;
    a text := btrim(coalesce(p_answer, ''));
    k integer;
    v integer;
  BEGIN
    IF NOT app.is_platform_admin() OR p_status NOT IN ('added', 'rejected')
      OR (p_status = 'rejected' AND length(a) = 0) OR length(coalesce(p_answer, '')) > 2000 THEN
      RETURN NULL;
    END IF;
    SELECT * INTO r FROM public.dict_change_requests WHERE id = p_id AND version = p_version FOR UPDATE;
    IF NOT FOUND OR r.kind <> 'dict' OR r.status = 'withdrawn' THEN
      RETURN NULL;
    END IF;
    SELECT coalesce(max(m.n), 0) INTO k FROM public.request_messages m WHERE m.request_id = r.id;
    IF a <> '' THEN
      k := k + 1;
      INSERT INTO public.request_messages (org_id, request_id, n, kind, by_admin, author_user_id, text)
        VALUES (r.org_id, r.id, k, 'msg', true, app.current_user_id(), a);
    END IF;
    IF r.status <> p_status THEN
      k := k + 1;
      INSERT INTO public.request_messages
          (org_id, request_id, n, kind, by_admin, author_user_id, from_status, to_status, why)
        VALUES (r.org_id, r.id, k, 'st', true, app.current_user_id(), r.status, p_status, '');
    END IF;
    UPDATE public.dict_change_requests
      SET status = p_status,
          answer = a,
          decided_by = app.current_user_id(),
          decided_at = now(),
          closed_at = CASE WHEN r.status = p_status THEN r.closed_at ELSE now() END,
          wait = false,
          lead_admin = coalesce(r.lead_admin, app.current_user_id()),
          read_admin = k,
          last_at = now(),
          version = version + 1,
          updated_at = now()
      WHERE id = r.id
      RETURNING version INTO v;
    RETURN v;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_answer_dict_request(uuid, text, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_answer_dict_request(uuid, text, text, integer) TO buhuchet_app;
--> statement-breakpoint
-- Прежний список Админки → «Запросы» и его плашка до этапа 2 пакета показывают только то, что показывали:
-- «Добавить в справочник» в статусах «Новый», «Добавлено», «Отклонён» (запросы других видов и статусов
-- появятся вместе с новым модулем «Запросы» Админки).
CREATE OR REPLACE VIEW app.admin_dict_change_requests WITH (security_barrier = true) AS
  SELECT
    r.id,
    r.org_id,
    o.name AS org_name,
    r.dict,
    r.what,
    r.comment,
    r.status,
    r.answer,
    r.created_at,
    r.created_by,
    e.full_name AS created_by_name,
    r.decided_at,
    r.decided_by,
    r.updated_at,
    r.version
  FROM public.dict_change_requests r
  JOIN public.organizations o ON o.id = r.org_id
  LEFT JOIN public.employees e ON e.user_id = r.created_by
  WHERE app.is_platform_admin() AND r.kind = 'dict' AND r.status IN ('new', 'added', 'rejected');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.admin_dict_requests() RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT count(*)::integer FROM public.dict_change_requests r
    WHERE app.is_platform_admin() AND r.kind = 'dict' AND r.status IN ('new', 'added', 'rejected')
  $$;
--> statement-breakpoint
-- Переписка, снимки и «Заметки» после записи не меняются и не удаляются (вместе с запросом — каскад).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE request_messages FROM buhuchet_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE request_shots FROM buhuchet_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE request_notes FROM buhuchet_app;
--> statement-breakpoint
-- Номер сообщения в ленте ставит база: следующий после последнего, под блокировкой строки запроса (свой
-- номер вставляющий не задаёт — ни дыр, ни переполнения, по которому Админка перестала бы отвечать).
CREATE OR REPLACE FUNCTION app.request_messages_n() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    -- SECURITY DEFINER: организацию проверяет сам (до политик вставки), чужой запрос не блокирует и не считает.
    PERFORM 1 FROM public.dict_change_requests r
      WHERE r.id = NEW.request_id AND r.org_id = NEW.org_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'request_messages: запрос не найден' USING ERRCODE = '42501';
    END IF;
    SELECT coalesce(max(m.n), 0) + 1 INTO NEW.n FROM public.request_messages m
      WHERE m.request_id = NEW.request_id AND m.org_id = NEW.org_id;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.request_messages_n() FROM PUBLIC, buhuchet_app;
--> statement-breakpoint
CREATE TRIGGER request_messages_n BEFORE INSERT ON request_messages
  FOR EACH ROW EXECUTE FUNCTION app.request_messages_n();
--> statement-breakpoint
-- Строку смены статуса организация пишет только о настоящей смене: запрос уже в этом статусе (метод сначала
-- меняет статус, потом пишет ленту), иначе в ленте была бы ложная история.
CREATE POLICY request_messages_st_current ON request_messages AS RESTRICTIVE FOR INSERT TO buhuchet_app
  WITH CHECK (
    by_admin OR kind <> 'st' OR EXISTS (
      SELECT 1 FROM dict_change_requests r
      WHERE r.id = request_messages.request_id AND r.org_id = request_messages.org_id
        AND r.status = request_messages.to_status
    )
  );
--> statement-breakpoint
-- Время последнего движения при отправке — не в будущем (иначе запрос закрепился бы наверху очереди Админки).
CREATE POLICY dict_change_requests_last_at ON dict_change_requests AS RESTRICTIVE FOR INSERT TO buhuchet_app
  WITH CHECK (last_at <= now());
--> statement-breakpoint
-- Снимок — к сообщению того же запроса и под ключом своей организации (вторая преграда после метода
-- загрузки этапа 3, как `files_key_check`; точный вид ключа задаёт этап 3).
CREATE POLICY request_shots_same_request ON request_shots AS RESTRICTIVE FOR INSERT TO buhuchet_app
  WITH CHECK (
    storage_key LIKE ('org/' || org_id::text || '/requests/%')
    AND (message_id IS NULL OR EXISTS (
      SELECT 1 FROM request_messages m
      WHERE m.id = request_shots.message_id AND m.request_id = request_shots.request_id
        AND m.org_id = request_shots.org_id
    ))
  );
--> statement-breakpoint
-- «Витрина данных» (миграция 0166, `src/datamart-roles.ts`): серии — как задачи, обеим ролям своими
-- строками; переписка и снимки — только Админке (без ключа хранилища); «Заметки» — никому; новые столбцы
-- задач и запросов — обеим ролям.
-- Права — по столбцам (п. О-62): новый столбец серии закрыт Витрине, пока миграция его не откроет.
GRANT SELECT (id, org_id, title, description, category_code, contractor_id, project_id, executor_employee_id,
  author_employee_id, term, need_file, confirm, every, unit, week_days, month_mode, start_date, end_kind, end_date,
  end_count, state, stop_reason, next_date, made, created_by, updated_by, created_at, updated_at, version)
  ON TABLE public.task_series TO buhuchet_dm_admin, buhuchet_dm_org;
--> statement-breakpoint
CREATE POLICY dm_admin_read ON public.task_series AS PERMISSIVE FOR SELECT TO buhuchet_dm_admin
  USING (EXISTS (SELECT 1 FROM dm.runs r WHERE r.pid = pg_catalog.pg_backend_pid()
    AND r.xid = pg_catalog.pg_current_xact_id_if_assigned() AND r.admin));
--> statement-breakpoint
CREATE POLICY dm_org_read ON public.task_series AS PERMISSIVE FOR SELECT TO buhuchet_dm_org
  USING (org_id = (SELECT r.org_id FROM dm.runs r WHERE r.pid = pg_catalog.pg_backend_pid()
    AND r.xid = pg_catalog.pg_current_xact_id_if_assigned()));
--> statement-breakpoint
GRANT SELECT (id, org_id, request_id, n, kind, by_admin, author_user_id, text, from_status, to_status, why, created_at)
  ON TABLE public.request_messages TO buhuchet_dm_admin;
--> statement-breakpoint
CREATE POLICY dm_admin_read ON public.request_messages AS PERMISSIVE FOR SELECT TO buhuchet_dm_admin
  USING (EXISTS (SELECT 1 FROM dm.runs r WHERE r.pid = pg_catalog.pg_backend_pid()
    AND r.xid = pg_catalog.pg_current_xact_id_if_assigned() AND r.admin));
--> statement-breakpoint
GRANT SELECT (id, org_id, request_id, message_id, name, size, mime, created_by, created_at)
  ON TABLE public.request_shots TO buhuchet_dm_admin;
--> statement-breakpoint
CREATE POLICY dm_admin_read ON public.request_shots AS PERMISSIVE FOR SELECT TO buhuchet_dm_admin
  USING (EXISTS (SELECT 1 FROM dm.runs r WHERE r.pid = pg_catalog.pg_backend_pid()
    AND r.xid = pg_catalog.pg_current_xact_id_if_assigned() AND r.admin));
--> statement-breakpoint
GRANT SELECT (series_id, series_date) ON TABLE public.tasks TO buhuchet_dm_admin, buhuchet_dm_org;
--> statement-breakpoint
GRANT SELECT (no, kind, topic, form_id, form, where_info, wait, lead_admin, read_author, read_admin, last_at, closed_at)
  ON TABLE public.dict_change_requests TO buhuchet_dm_admin, buhuchet_dm_org;
--> statement-breakpoint
-- Вопрос, ошибку и опечатку видят только автор и владелец (ТЗ, запросы, блок 4 п. 4; блок 7 п. 3): роль
-- Витрины организации видит только «Добавить в справочник», как до пакета; Админке — все.
DROP POLICY dm_org_read ON public.dict_change_requests;
--> statement-breakpoint
CREATE POLICY dm_org_read ON public.dict_change_requests AS PERMISSIVE FOR SELECT TO buhuchet_dm_org
  USING (kind = 'dict' AND org_id = (SELECT r.org_id FROM dm.runs r WHERE r.pid = pg_catalog.pg_backend_pid()
    AND r.xid = pg_catalog.pg_current_xact_id_if_assigned()));
--> statement-breakpoint
SET LOCAL lock_timeout TO DEFAULT;
