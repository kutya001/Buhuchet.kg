-- Сообщения администраторам платформы о подписках и сверке хранилища (доработки 20.11.2026, пакет 2,
-- блок 3, пункт 6; блок 6, пункт 3; поток Т, этап 1, П12–П13): «Новый чек на проверку» и повтор
-- «Чек ждёт проверки» каждый день в 09:00, «Сверка хранилища нашла расхождения» — первое появление.
-- Как app.platform_alert (0097): строка очереди Telegram без организации каждому незаблокированному
-- администратору платформы с привязанным Telegram, ключ — `<вид>:<p_key>:<администратор>` (повтор с тем
-- же ключом ничего не ставит). Виды — только эти два: сообщения о сбое по-прежнему идут видом `alert`.
CREATE FUNCTION app.platform_notice(p_kind text, p_text text, p_key text, p_now timestamptz)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_count integer;
  BEGIN
    IF p_kind IS NULL OR p_kind NOT IN ('sub_check', 'storage_check') THEN
      RAISE EXCEPTION 'platform_notice: неизвестный вид сообщения';
    END IF;
    IF nullif(btrim(coalesce(p_text, '')), '') IS NULL OR nullif(coalesce(p_key, ''), '') IS NULL THEN
      RAISE EXCEPTION 'platform_notice: пустой текст или ключ';
    END IF;
    INSERT INTO public.telegram_outbox
      (org_id, user_id, chat_id, kind, text, status, tries, next_at, dedupe_key)
    SELECT NULL, u.id, l.chat_id, p_kind, left(p_text, 4000), 'pending', 0, p_now,
      p_kind || ':' || left(p_key, 200) || ':' || u.id::text
    FROM public.telegram_links l
    JOIN public.users u ON u.id = l.user_id AND u.is_platform_admin AND NOT u.blocked
    ON CONFLICT ON CONSTRAINT telegram_outbox_dedupe_key DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.platform_notice(text, text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_notice(text, text, text, timestamptz) TO buhuchet_app;
--> statement-breakpoint
-- Знает ли база объект хранилища с этим ключом (пакет 2, блок 3, пункт 6): файл (кроме удалённого),
-- отправленный контрагентом файл (и, пока он загружается, его `.up` и проверочная копия `.chk-…`),
-- логотип организации, чек подписки, файл, ждущий стирания, ключ на повторном удалении. Так сверка
-- хранилища отличает «лишний» файл, и так же «Удалить» лишнего файла (поток И) ещё раз проверяет, что
-- записи о нём по-прежнему нет. Только администратору платформы и задаче (без вошедшего): сотруднику
-- организации о чужих ключах функция не отвечает.
CREATE FUNCTION app.storage_key_known(p_key text)
  RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF app.current_user_id() IS NOT NULL AND NOT app.is_platform_admin() THEN
      RAISE EXCEPTION 'storage_key_known: только администратору платформы';
    END IF;
    IF p_key IS NULL THEN
      RETURN false;
    END IF;
    RETURN EXISTS (SELECT 1 FROM public.files f WHERE f.storage_key = p_key AND f.state <> 'deleted')
      OR EXISTS (SELECT 1 FROM public.contractor_sent_files s WHERE s.storage_key = p_key)
      OR EXISTS (SELECT 1 FROM public.contractor_sent_files s
        WHERE s.state = 'pending' AND starts_with(p_key, s.storage_key || '.'))
      OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.logo_key = p_key)
      OR EXISTS (SELECT 1 FROM public.subscription_payments p WHERE p.receipt_key = p_key)
      OR EXISTS (SELECT 1 FROM public.file_trash t
        WHERE t.storage_key = p_key AND t.erased_at IS NULL AND t.restored_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.storage_delete_retries r WHERE r.key = p_key);
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.storage_key_known(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.storage_key_known(text) TO buhuchet_app;
--> statement-breakpoint
-- Итог сверки хранилища (пакет 2, блок 3, пункт 6; задача «Файлы: сверка хранилища»): задача читает
-- список объектов хранилища под `org/` (вне транзакции, страницами) и отдаёт его сюда одним массивом
-- `[{ "k": ключ, "s": байт, "t": когда положен }]`; `p_now` — момент начала чтения списка. Функция
-- пишет запуск и четыре списка расхождений; сама ничего не удаляет.
--   missing — файл есть в базе (загружен, отправленный контрагентом загружен, логотип, чек подписки), а в
--     хранилище его нет; записи моложе часа не проверяются: объект мог лечь после чтения списка;
--   extra — объект старше суток, о котором база не знает (`app.storage_key_known`; ждущие стирания —
--     не расхождение);
--   stuck — загрузка файла или отправленного файла не закончена больше суток;
--   failed — файл ждёт стирания, срок прошёл, а стереть не удалось (`file_trash.attempts`), и ключи на
--     повторном удалении, которые уже не удалось удалить.
-- Найденное прежде остаётся строкой с первым запуском (`first_run_id`), найденное снова продлевает её
-- (`last_run_id`), пропавшее — закрывается (`resolved_at`). Ответ — номер запуска, числа списков и сколько
-- в каждом новых (их — администраторам в Telegram и колокольчик). `p_error` — список прочитать не
-- удалось: запуск пишется с ошибкой, открытые строки не трогаются. Только задаче (без вошедшего и без
-- организации); два запуска сразу идут друг за другом.
CREATE FUNCTION app.storage_check_save(p_objects jsonb, p_now timestamptz, p_error text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_run bigint;
    v_objects integer;
    v_res jsonb;
  BEGIN
    IF app.current_user_id() IS NOT NULL OR app.current_org_id() IS NOT NULL THEN
      RAISE EXCEPTION 'storage_check_save: только задаче по расписанию';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('storage_check_save', 0));
    IF p_error IS NOT NULL THEN
      INSERT INTO public.storage_check_runs (started_at, finished_at, state, error)
      VALUES (p_now, p_now, 'failed', left(p_error, 500))
      RETURNING id INTO v_run;
      RETURN jsonb_build_object('run', v_run, 'state', 'failed');
    END IF;
    IF p_objects IS NULL OR jsonb_typeof(p_objects) <> 'array' THEN
      RAISE EXCEPTION 'storage_check_save: список объектов — массив';
    END IF;
    v_objects := jsonb_array_length(p_objects);
    INSERT INTO public.storage_check_runs (started_at, state) VALUES (p_now, 'running')
    RETURNING id INTO v_run;

    WITH obj AS MATERIALIZED (
      SELECT o->>'k' AS key,
        CASE WHEN jsonb_typeof(o->'s') = 'number' THEN greatest((o->>'s')::numeric, 0)::bigint END AS size,
        CASE WHEN jsonb_typeof(o->'t') = 'string' THEN (o->>'t')::timestamptz END AS at
      FROM jsonb_array_elements(p_objects) AS o
      WHERE jsonb_typeof(o) = 'object' AND starts_with(o->>'k', 'org/')
        AND char_length(o->>'k') <= 300
    ),
    known AS MATERIALIZED (
      SELECT f.storage_key AS key FROM public.files f WHERE f.state <> 'deleted'
      UNION ALL SELECT s.storage_key FROM public.contractor_sent_files s
      UNION ALL SELECT o.logo_key FROM public.organizations o WHERE o.logo_key IS NOT NULL
      UNION ALL SELECT p.receipt_key FROM public.subscription_payments p WHERE p.receipt_key IS NOT NULL
      UNION ALL SELECT t.storage_key FROM public.file_trash t
        WHERE t.erased_at IS NULL AND t.restored_at IS NULL
      UNION ALL SELECT r.key FROM public.storage_delete_retries r
    ),
    found AS (
      SELECT 'extra' AS kind, o.key, o.size, o.at
      FROM obj o
      WHERE (o.at IS NULL OR o.at < p_now - interval '24 hours')
        AND NOT EXISTS (SELECT 1 FROM known k WHERE k.key = o.key)
        AND NOT EXISTS (SELECT 1 FROM public.contractor_sent_files s
          WHERE s.state = 'pending' AND starts_with(o.key, s.storage_key || '.'))
      UNION ALL
      SELECT 'missing', x.key, x.size, NULL::timestamptz
      FROM (
        SELECT f.storage_key AS key, f.size_bytes AS size FROM public.files f
        WHERE f.state = 'ready' AND f.created_at < p_now - interval '1 hour'
        UNION ALL SELECT s.storage_key, s.size_bytes FROM public.contractor_sent_files s
        WHERE s.state = 'ready' AND s.created_at < p_now - interval '1 hour'
        UNION ALL SELECT o.logo_key, NULL::bigint FROM public.organizations o
        WHERE o.logo_key IS NOT NULL
        UNION ALL SELECT p.receipt_key, p.receipt_bytes FROM public.subscription_payments p
        WHERE p.receipt_key IS NOT NULL AND p.created_at < p_now - interval '1 hour'
      ) x
      WHERE starts_with(x.key, 'org/') AND char_length(x.key) <= 300
        AND NOT EXISTS (SELECT 1 FROM obj o WHERE o.key = x.key)
      UNION ALL
      SELECT 'stuck', y.key, y.size, NULL::timestamptz
      FROM (
        SELECT f.storage_key AS key, f.size_bytes AS size FROM public.files f
        WHERE f.state = 'pending' AND f.created_at < p_now - interval '24 hours'
        UNION ALL SELECT s.storage_key, s.size_bytes FROM public.contractor_sent_files s
        WHERE s.state = 'pending' AND s.created_at < p_now - interval '24 hours'
      ) y
      WHERE char_length(y.key) <= 300
      UNION ALL
      SELECT 'failed', z.key, z.size, (SELECT o.at FROM obj o WHERE o.key = z.key LIMIT 1)
      FROM (
        SELECT t.storage_key AS key, t.size_bytes AS size FROM public.file_trash t
        WHERE t.erased_at IS NULL AND t.restored_at IS NULL AND t.attempts > 0 AND t.erase_at < p_now
        UNION ALL SELECT r.key, NULL::bigint FROM public.storage_delete_retries r
        WHERE r.attempts > 0 AND starts_with(r.key, 'org/')
      ) z
      WHERE char_length(z.key) <= 300
    )
    INSERT INTO public.storage_check_items AS i
      (kind, key, key_org_id, size_bytes, object_at, first_run_id, last_run_id, first_seen_at, last_seen_at)
    SELECT DISTINCT ON (fd.kind, fd.key) fd.kind, fd.key,
      (substring(fd.key FROM '^org/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/'))::uuid,
      fd.size, fd.at, v_run, v_run, p_now, p_now
    FROM found fd
    ORDER BY fd.kind, fd.key
    ON CONFLICT (kind, key) WHERE resolved_at IS NULL DO UPDATE
      SET last_run_id = excluded.last_run_id, last_seen_at = excluded.last_seen_at,
        size_bytes = coalesce(excluded.size_bytes, i.size_bytes),
        object_at = coalesce(excluded.object_at, i.object_at);

    UPDATE public.storage_check_items SET resolved_at = p_now
    WHERE resolved_at IS NULL AND last_run_id <> v_run;

    SELECT jsonb_build_object(
      'run', v_run,
      'state', 'done',
      'objects', v_objects,
      'missing', count(*) FILTER (WHERE kind = 'missing'),
      'extra', count(*) FILTER (WHERE kind = 'extra'),
      'stuck', count(*) FILTER (WHERE kind = 'stuck'),
      'failed', count(*) FILTER (WHERE kind = 'failed'),
      'new_missing', count(*) FILTER (WHERE kind = 'missing' AND first_run_id = v_run),
      'new_extra', count(*) FILTER (WHERE kind = 'extra' AND first_run_id = v_run),
      'new_stuck', count(*) FILTER (WHERE kind = 'stuck' AND first_run_id = v_run),
      'new_failed', count(*) FILTER (WHERE kind = 'failed' AND first_run_id = v_run))
    INTO v_res
    FROM public.storage_check_items
    WHERE resolved_at IS NULL AND last_run_id = v_run;

    UPDATE public.storage_check_runs SET
      state = 'done', finished_at = greatest(p_now, now()), objects = v_objects,
      missing = (v_res->>'missing')::integer, extra = (v_res->>'extra')::integer,
      stuck = (v_res->>'stuck')::integer, failed = (v_res->>'failed')::integer
    WHERE id = v_run;
    RETURN v_res;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.storage_check_save(jsonb, timestamptz, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.storage_check_save(jsonb, timestamptz, text) TO buhuchet_app;
