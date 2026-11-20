-- «Ждут удаления» и модуль «Файлы» Админки (доработки 20.11.2026, пакет 2, блоки 3–5; этап 1, П4–П6,
-- поток И; docs/decisions.md п. И-11). Таблицы — из 0165; здесь — функции стирания и «Вернуть» и
-- представления Админки. Ключей хранилища роль приложения из представлений не получает, кроме пути
-- «лишнего» файла сверки (его и показывает список «Проверки хранилища»).
--
-- Нужен ли ключ хранилища живой записи: файл (не удалённый), присланный контрагентом и не принятый (и его
-- загрузка со страницы, пока она идёт), чек подписки, документ и загрузка заявки, видео, обложка,
-- загрузка видео, логотип. Такой объект задача стирания не трогает, а «Удалить» лишнего — не ставит.
--
-- Откат — новой миграцией: DROP VIEW трёх представлений Админки, DROP FUNCTION функций этой миграции,
-- DROP INDEX file_trash_key_idx, DROP CONSTRAINT file_trash_contractor_check; столбец contractor_bound —
-- по правилу двух PR (сначала код перестаёт его читать).
-- Был ли файл файлом контрагента: контрагента удалили — ключ контрагента стал пустым (ON DELETE SET
-- NULL), и «Вернуть» такой файл не возвращает, иначе он вернулся бы общим файлом организации.
ALTER TABLE "file_trash" ADD COLUMN "contractor_bound" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "file_trash" SET "contractor_bound" = true WHERE "contractor_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "file_trash" ADD CONSTRAINT "file_trash_contractor_check" CHECK ("file_trash"."contractor_bound" or "file_trash"."contractor_id" is null);--> statement-breakpoint
-- Новый столбец — роли Админки «Витрины данных», как остальные столбцы file_trash (0166, п. О-62).
GRANT SELECT ("contractor_bound") ON TABLE "file_trash" TO buhuchet_dm_admin;--> statement-breakpoint
-- «Проверка хранилища» ищет строку по ключу и среди стёртых: строки file_trash не удаляются, а частичный
-- file_trash_live_key ей не подходит. Таблица на стенде и рабочей базе пустая — индекс строится сразу.
CREATE INDEX "file_trash_key_idx" ON "file_trash" USING btree ("storage_key");--> statement-breakpoint
CREATE FUNCTION app.storage_key_in_use(p_key text)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT EXISTS (SELECT 1 FROM public.files f WHERE f.storage_key = p_key AND f.state <> 'deleted')
      OR EXISTS (SELECT 1 FROM public.contractor_sent_files s
        WHERE s.storage_key = p_key AND s.status <> 'accepted')
      OR EXISTS (SELECT 1 FROM public.contractor_sent_files s
        WHERE p_key LIKE '%.up' AND s.storage_key = left(p_key, -3) AND s.state = 'pending')
      OR EXISTS (SELECT 1 FROM public.subscription_payments p WHERE p.receipt_key = p_key)
      OR EXISTS (SELECT 1 FROM public.platform_lead_docs d WHERE d.storage_key = p_key)
      OR EXISTS (SELECT 1 FROM public.platform_lead_uploads u
        WHERE p_key ~ '^leads/upload/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          AND u.id = substr(p_key, 14)::uuid AND u.state <> 'gone')
      OR EXISTS (SELECT 1 FROM public.videos v WHERE v.file_key = p_key OR v.cover_key = p_key)
      OR EXISTS (SELECT 1 FROM public.video_uploads u WHERE u.storage_key = p_key)
      OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.logo_key = p_key)
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.storage_key_in_use(text) FROM PUBLIC, buhuchet_app;--> statement-breakpoint
-- Задача «Файлы: стирание удалённых» (раз в час): что стереть. Только без вошедшего пользователя и без
-- организации (задача по расписанию): транзакции бота и страницы контрагента ключей не получат. Срок —
-- по часам базы: раньше суток после удаления строку не получить никак. Ключ, который снова нужен живой
-- записи, не стирается — строка закрывается с отметкой «in_use». Строки
-- берутся с блокировкой: «Вернуть», начатое до срока, задача дождётся и строку уже не получит.
CREATE FUNCTION app.file_trash_due(p_limit integer)
  RETURNS TABLE (id uuid, storage_key text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF app.current_user_id() IS NOT NULL OR app.current_org_id() IS NOT NULL THEN
      RETURN;
    END IF;
    UPDATE public.file_trash t SET erased_at = now(), last_error = 'in_use'
      WHERE t.erased_at IS NULL AND t.restored_at IS NULL AND t.erase_at <= now()
        AND app.storage_key_in_use(t.storage_key);
    RETURN QUERY
      SELECT t.id, t.storage_key FROM public.file_trash t
      WHERE t.erased_at IS NULL AND t.restored_at IS NULL AND t.erase_at <= now()
      ORDER BY t.erase_at, t.id
      LIMIT greatest(least(p_limit, 1000), 0)
      FOR UPDATE;
  END
  $$;--> statement-breakpoint
-- Итог попытки: стёртые получают «стёрт», у не стёртых — ещё одна попытка и ошибка «storage» (своим
-- кодом, без текста хранилища и ключей). Отмечаются только строки, срок которых наступил. Отвечает,
-- сколько строк ещё ждёт стирания после срока и сколько из них не стёрто p_stuck раз и больше.
CREATE FUNCTION app.file_trash_done(p_done uuid[], p_failed uuid[], p_stuck integer)
  RETURNS TABLE (left_count integer, stuck_count integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF app.current_user_id() IS NOT NULL OR app.current_org_id() IS NOT NULL THEN
      RETURN;
    END IF;
    UPDATE public.file_trash t SET erased_at = now(), last_error = NULL
      WHERE t.id = ANY (p_done) AND t.erased_at IS NULL AND t.restored_at IS NULL
        AND t.erase_at <= now();
    UPDATE public.file_trash t SET attempts = t.attempts + 1, last_error = 'storage'
      WHERE t.id = ANY (p_failed) AND t.erased_at IS NULL AND t.restored_at IS NULL
        AND t.erase_at <= now();
    RETURN QUERY
      SELECT count(*)::integer, (count(*) FILTER (WHERE t.attempts >= p_stuck))::integer
      FROM public.file_trash t
      WHERE t.erased_at IS NULL AND t.restored_at IS NULL AND t.erase_at <= now();
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.file_trash_due(integer), app.file_trash_done(uuid[], uuid[], integer)
  FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.file_trash_due(integer), app.file_trash_done(uuid[], uuid[], integer)
  TO buhuchet_app;--> statement-breakpoint
-- «Вернуть» (блок 5, пункт 4; прототип ftRestore): только администратор платформы, до срока стирания,
-- только удалённый сотрудником (del) и лишний файл хранилища (extra). Удалённый файл — в контексте его
-- организации (историю пишет сервер в той же транзакции): файл снова «загружен», и снова — те его
-- ссылки на записи, которые были до удаления и которые сервер проверил (p_links — [{kind, id}], запись
-- жива, того же контрагента); автор и время ссылки — прежние. Лишний файл — снова в списке «лишних»
-- сверки. Отвечает: ok, denied, missing (нет строки или файла), gone (срок прошёл, стёрт или уже
-- возвращён), kind (вернуть нельзя: прежняя версия или непринятый от контрагента).
CREATE FUNCTION app.file_trash_restore(p_id uuid, p_links jsonb)
  RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    t public.file_trash%ROWTYPE;
    v_user uuid := app.current_user_id();
  BEGIN
    IF v_user IS NULL OR NOT app.is_platform_admin() THEN
      RETURN 'denied';
    END IF;
    SELECT * INTO t FROM public.file_trash x WHERE x.id = p_id FOR UPDATE;
    IF NOT FOUND OR t.org_id IS DISTINCT FROM coalesce(app.current_org_id(), t.org_id) THEN
      RETURN 'missing';
    END IF;
    -- Срок — по часам на этот момент, а не на начало транзакции: задача стирания могла взять строку,
    -- пока «Вернуть» ждало её блокировку.
    IF t.erased_at IS NOT NULL OR t.restored_at IS NOT NULL OR t.erase_at <= clock_timestamp() THEN
      RETURN 'gone';
    END IF;
    IF t.why NOT IN ('del', 'extra') THEN
      RETURN 'kind';
    END IF;
    IF t.why = 'del' THEN
      IF app.current_org_id() IS NULL THEN
        RETURN 'missing';
      END IF;
      -- Файл контрагента, которого уже удалили: вернуть его общим файлом организации нельзя.
      IF t.contractor_bound AND t.contractor_id IS NULL THEN
        RETURN 'record';
      END IF;
      UPDATE public.files f
        SET state = 'ready', deleted_at = NULL, deleted_by = NULL, version = f.version + 1,
            updated_at = now(), updated_by = v_user
        WHERE f.id = t.file_id AND f.org_id = t.org_id AND f.state = 'deleted'
          AND f.storage_key = t.storage_key;
      IF NOT FOUND THEN
        RETURN 'missing';
      END IF;
      INSERT INTO public.file_links (org_id, file_id, source_kind, source_id, created_by, created_at)
        SELECT t.org_id, t.file_id, l."sourceKind", l."sourceId", l."createdBy", l."createdAt"
        FROM jsonb_to_recordset(t.links)
          AS l("sourceKind" text, "sourceId" uuid, "createdBy" uuid, "createdAt" timestamptz)
        WHERE l."createdBy" IS NOT NULL AND l."createdAt" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM jsonb_to_recordset(coalesce(p_links, '[]'::jsonb)) AS p(kind text, id uuid)
            WHERE p.kind = l."sourceKind" AND p.id = l."sourceId")
          AND EXISTS (
            SELECT 1 FROM public.files f
            WHERE f.id = t.file_id AND f.contractor_id IS NOT NULL
              AND f.source_kind IN ('manual', 'contractor', 'sent_file'))
        ON CONFLICT DO NOTHING;
    ELSE
      -- Лишний файл — вне организации, как и «Удалить» его.
      IF app.current_org_id() IS NOT NULL THEN
        RETURN 'missing';
      END IF;
      INSERT INTO public.storage_check_items (kind, key, key_org_id, size_bytes, object_at,
          first_run_id, last_run_id, first_seen_at, last_seen_at)
        SELECT 'extra', i.key, i.key_org_id, i.size_bytes, i.object_at, i.first_run_id, i.last_run_id,
          i.first_seen_at, i.last_seen_at
        FROM public.storage_check_items i
        WHERE i.kind = 'extra' AND i.key = t.storage_key
        ORDER BY i.id DESC
        LIMIT 1
        ON CONFLICT DO NOTHING;
    END IF;
    UPDATE public.file_trash x SET restored_at = now(), restored_by = v_user WHERE x.id = t.id;
    RETURN 'ok';
  END
  $$;--> statement-breakpoint
-- «Удалить» лишний файл хранилища (решение заказчика 20.11.2026, вопрос 7 плана; прототип afExtraDel):
-- только администратор платформы вне организации, по одной открытой строке «лишних» сверки, только
-- объект старше p_hours часов (загрузка может идти прямо сейчас) и только в папках организаций и заявок
-- (у картинок новостей и рассылок платформы строк в базе нет). Перед удалением — ещё одна проверка базы:
-- у ключа появилась запись — строка сверки закрывается, удаления нет (in_use). Удалённый — сутки в «Ждут
-- удаления». Отвечает: ok и номер строки «Ждут удаления», denied, missing, platform, young, in_use,
-- waiting (уже ждёт стирания).
CREATE FUNCTION app.admin_storage_extra_delete(p_item bigint, p_hours integer)
  RETURNS TABLE (outcome text, trash_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    i public.storage_check_items%ROWTYPE;
    v_user uuid := app.current_user_id();
    v_org uuid;
    v_id uuid;
    v_name text;
  BEGIN
    IF v_user IS NULL OR NOT app.is_platform_admin() OR app.current_org_id() IS NOT NULL THEN
      RETURN QUERY SELECT 'denied'::text, NULL::uuid;
      RETURN;
    END IF;
    SELECT * INTO i FROM public.storage_check_items x
      WHERE x.id = p_item AND x.kind = 'extra' AND x.resolved_at IS NULL
      FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'missing'::text, NULL::uuid;
      RETURN;
    END IF;
    IF i.key !~ '^(org|leads)/' OR i.key ~ '(^|/)[.]{1,2}(/|$)' OR char_length(i.key) > 300 THEN
      RETURN QUERY SELECT 'platform'::text, NULL::uuid;
      RETURN;
    END IF;
    IF i.object_at IS NULL OR i.object_at > now() - make_interval(hours => greatest(p_hours, 24)) THEN
      RETURN QUERY SELECT 'young'::text, NULL::uuid;
      RETURN;
    END IF;
    IF app.storage_key_in_use(i.key) THEN
      UPDATE public.storage_check_items x SET resolved_at = now() WHERE x.id = i.id;
      RETURN QUERY SELECT 'in_use'::text, NULL::uuid;
      RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.file_trash t
        WHERE t.storage_key = i.key AND t.erased_at IS NULL AND t.restored_at IS NULL) THEN
      RETURN QUERY SELECT 'waiting'::text, NULL::uuid;
      RETURN;
    END IF;
    IF i.key ~ '^org/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/' THEN
      SELECT o.id INTO v_org FROM public.organizations o WHERE o.id = substr(i.key, 5, 36)::uuid;
    END IF;
    v_name := left(coalesce(nullif(regexp_replace(i.key, '^.*/', ''), ''), i.key), 255);
    INSERT INTO public.file_trash (org_id, why, storage_key, name, size_bytes, source, deleted_by,
        deleted_at)
      VALUES (v_org, 'extra', i.key, v_name, coalesce(i.size_bytes, 0), 'extra', v_user, now())
      RETURNING id INTO v_id;
    UPDATE public.storage_check_items x SET resolved_at = now() WHERE x.id = i.id;
    RETURN QUERY SELECT 'ok'::text, v_id;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.file_trash_restore(uuid, jsonb),
  app.admin_storage_extra_delete(bigint, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.file_trash_restore(uuid, jsonb),
  app.admin_storage_extra_delete(bigint, integer) TO buhuchet_app;--> statement-breakpoint
-- «Все файлы» Админки и «Файлы» карточки организации (блок 3, пункт 4; блок 4; прототип afAll): файлы
-- организаций (загруженные; документы заявки, перешедшие в организацию, — «lead»), присланные
-- контрагентами и не принятые, чеки подписок, документы заявок без организации и удалённые, которые ждут
-- стирания (кроме лишних файлов хранилища — их показывает «Ждут удаления»). Без ключей хранилища: файл
-- открывается подписанной ссылкой API. mem — входит ли в память организации (как app.org_usage).
CREATE VIEW app.admin_storage_files WITH (security_barrier = true) AS
  SELECT
    x.kind,
    x.id,
    x.org_id,
    o.name AS org_name,
    x.lead_id,
    x.lead_firm,
    x.contractor_id,
    c.name AS cp_name,
    c.inn AS cp_inn,
    x.cat,
    x.src,
    x.link_kinds,
    x.source_kind,
    x.source_id,
    x.name,
    x.content_type,
    x.size_bytes,
    x.note,
    x.by_user,
    (SELECT e.short_name FROM public.employees e WHERE e.user_id = x.by_user) AS by_name,
    x.via,
    x.at,
    x.state,
    x.mem,
    x.erase_at,
    x.why
  FROM (
    SELECT 'file'::text AS kind, f.id, f.org_id, NULL::uuid AS lead_id, NULL::text AS lead_firm,
      f.contractor_id,
      CASE WHEN f.source_kind = 'lead' THEN 'lead' ELSE 'org' END AS cat,
      CASE f.source_kind WHEN 'contractor' THEN 'card' WHEN 'sent_file' THEN 'sent'
        ELSE f.source_kind END AS src,
      coalesce((SELECT array_agg(DISTINCT l.source_kind ORDER BY l.source_kind)
        FROM public.file_links l WHERE l.file_id = f.id AND l.org_id = f.org_id), '{}'::text[])
        AS link_kinds,
      f.source_kind, f.source_id, f.name, f.content_type, f.size_bytes, f.note,
      f.created_by AS by_user, NULL::text AS via, f.created_at AS at, 'ready'::text AS state,
      f.source_kind <> 'lead' AS mem, NULL::timestamptz AS erase_at, NULL::text AS why
    FROM public.files f
    WHERE f.state = 'ready'
    UNION ALL
    SELECT 'sent', s.id, s.org_id, NULL, NULL, s.contractor_id, 'sent', 'sent', '{}'::text[],
      'sent_file', NULL, s.name, s.content_type, s.size_bytes, s.comment, NULL, s.source,
      s.created_at, CASE WHEN s.status = 'rejected' THEN 'rejected' ELSE 'new' END, true, NULL, NULL
    FROM public.contractor_sent_files s
    WHERE s.state = 'ready' AND s.status <> 'accepted'
    UNION ALL
    SELECT 'receipt', p.id, p.org_id, NULL, NULL, NULL, 'rcpt', 'subscription', '{}'::text[], NULL,
      NULL, p.receipt_name, p.receipt_type, p.receipt_bytes, NULL, p.created_by, NULL, p.created_at,
      'ready', false, NULL, NULL
    FROM public.subscription_payments p
    WHERE p.receipt_key IS NOT NULL
    UNION ALL
    SELECT 'lead', d.id, NULL, l.id, l.firm, NULL, 'lead', 'lead', '{}'::text[], NULL, NULL, d.name,
      d.content_type, d.size_bytes, NULL, NULL, NULL, d.created_at, 'ready', false, NULL, NULL
    FROM public.platform_lead_docs d
    JOIN public.platform_leads l ON l.id = d.lead_id
    WHERE l.created_org_id IS NULL AND d.state = 'ready'
    UNION ALL
    SELECT 'trash', t.id, t.org_id, NULL, NULL, t.contractor_id, 'trash', coalesce(t.source, ''),
      '{}'::text[], NULL, t.file_id, t.name, NULL, t.size_bytes, NULL, t.deleted_by, NULL,
      t.deleted_at, 'trash', false, t.erase_at, t.why
    FROM public.file_trash t
    WHERE t.erased_at IS NULL AND t.restored_at IS NULL AND t.why <> 'extra'
  ) x
  LEFT JOIN public.organizations o ON o.id = x.org_id
  LEFT JOIN public.contractors c ON c.id = x.contractor_id AND c.org_id = x.org_id
  WHERE app.is_platform_admin();
--> statement-breakpoint
-- «Ждут удаления» (блок 5, пункты 3–4; прототип afTrashDlg): живые строки file_trash всех организаций и
-- лишние файлы хранилища, с названием организации и контрагента и тем, кто удалил. Ключа нет: путь
-- лишнего файла — его название (последняя часть ключа).
CREATE VIEW app.admin_file_trash WITH (security_barrier = true) AS
  SELECT
    t.id,
    t.org_id,
    o.name AS org_name,
    t.why,
    t.file_id,
    t.contractor_id,
    c.name AS cp_name,
    t.name,
    t.size_bytes,
    t.source,
    jsonb_array_length(t.links) AS links,
    t.attempts,
    t.last_error,
    t.deleted_by,
    (SELECT e.short_name FROM public.employees e WHERE e.user_id = t.deleted_by) AS deleted_by_name,
    t.deleted_at,
    t.erase_at
  FROM public.file_trash t
  LEFT JOIN public.organizations o ON o.id = t.org_id
  LEFT JOIN public.contractors c ON c.id = t.contractor_id AND c.org_id = t.org_id
  WHERE app.is_platform_admin() AND t.erased_at IS NULL AND t.restored_at IS NULL;
--> statement-breakpoint
-- «Проверка хранилища» (блок 3, пункт 6; прототип renderAFCheck): открытые строки сверки с тем, что о
-- ключе знает база — название, организация, контрагент, кто загружал, попытки стирания. Путь (ключ) —
-- только у лишних: по нему администратор решает «Удалить». Лишний файл, который уже ждёт стирания,
-- расхождением не считается.
CREATE VIEW app.admin_storage_check WITH (security_barrier = true) AS
  SELECT
    i.id,
    i.kind,
    CASE WHEN i.kind = 'extra' THEN i.key END AS path,
    coalesce(f.org_id, s.org_id, t.org_id, i.key_org_id) AS org_id,
    o.name AS org_name,
    coalesce(f.name, s.name, t.name, d.name) AS name,
    coalesce(f.contractor_id, s.contractor_id, t.contractor_id) AS contractor_id,
    c.name AS cp_name,
    CASE
      WHEN f.id IS NOT NULL THEN CASE f.source_kind WHEN 'contractor' THEN 'card'
        WHEN 'sent_file' THEN 'sent' ELSE f.source_kind END
      WHEN s.id IS NOT NULL THEN 'sent'
      WHEN d.id IS NOT NULL THEN 'lead'
      ELSE t.source
    END AS src,
    coalesce(f.created_by, t.deleted_by) AS by_user,
    (SELECT e.short_name FROM public.employees e
      WHERE e.user_id = coalesce(f.created_by, t.deleted_by)) AS by_name,
    s.source AS via,
    coalesce(i.size_bytes, f.size_bytes, s.size_bytes, t.size_bytes, d.size_bytes) AS size_bytes,
    coalesce(i.object_at, f.created_at, s.created_at, t.deleted_at, d.created_at) AS at,
    t.attempts,
    t.last_error,
    i.first_seen_at,
    i.last_seen_at
  FROM public.storage_check_items i
  LEFT JOIN public.files f ON f.storage_key = i.key
  LEFT JOIN public.contractor_sent_files s ON s.storage_key = i.key
  LEFT JOIN public.platform_lead_docs d ON d.storage_key = i.key
  LEFT JOIN LATERAL (
    SELECT x.org_id, x.name, x.contractor_id, x.source, x.deleted_by, x.size_bytes, x.deleted_at,
      x.attempts, x.last_error
    FROM public.file_trash x WHERE x.storage_key = i.key
    ORDER BY x.erased_at IS NULL DESC, x.deleted_at DESC
    LIMIT 1
  ) t ON true
  LEFT JOIN public.organizations o ON o.id = coalesce(f.org_id, s.org_id, t.org_id, i.key_org_id)
  LEFT JOIN public.contractors c ON c.id = coalesce(f.contractor_id, s.contractor_id, t.contractor_id)
  WHERE app.is_platform_admin() AND i.resolved_at IS NULL
    AND NOT (i.kind = 'extra' AND EXISTS (SELECT 1 FROM public.file_trash w
      WHERE w.storage_key = i.key AND w.erased_at IS NULL AND w.restored_at IS NULL));
--> statement-breakpoint
-- Ключ хранилища строки «Все файлы» — только для подписанной ссылки «Открыть» и «Скачать» (сам ключ API
-- наружу не отдаёт): только администратору платформы и только того, что показывает список.
CREATE FUNCTION app.admin_storage_file_key(p_kind text, p_id uuid)
  RETURNS TABLE (storage_key text, name text, content_type text, org_id uuid, cat text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT k.storage_key, v.name, v.content_type, v.org_id, v.cat
    FROM app.admin_storage_files v
    JOIN LATERAL (
      SELECT f.storage_key FROM public.files f WHERE p_kind = 'file' AND f.id = v.id
      UNION ALL
      SELECT s.storage_key FROM public.contractor_sent_files s WHERE p_kind = 'sent' AND s.id = v.id
      UNION ALL
      SELECT p.receipt_key FROM public.subscription_payments p WHERE p_kind = 'receipt' AND p.id = v.id
      UNION ALL
      SELECT d.storage_key FROM public.platform_lead_docs d WHERE p_kind = 'lead' AND d.id = v.id
      UNION ALL
      SELECT t.storage_key FROM public.file_trash t WHERE p_kind = 'trash' AND t.id = v.id
    ) k ON true
    WHERE app.is_platform_admin() AND v.kind = p_kind AND v.id = p_id
    LIMIT 1
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_storage_file_key(text, uuid) FROM PUBLIC;--> statement-breakpoint
-- Плашка «Платформа» «Хранилища» (прототип afPlatform): видео, обложки и логотипы организаций — в
-- память организаций не входят. Байты — только у файлов видео (размер обложки и логотипа не хранится).
CREATE FUNCTION app.admin_platform_storage()
  RETURNS TABLE (files integer, bytes bigint)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT
      ((SELECT count(*) FROM public.videos v WHERE v.deleted_at IS NULL AND v.file_key IS NOT NULL)
        + (SELECT count(*) FROM public.videos v WHERE v.deleted_at IS NULL AND v.cover_key IS NOT NULL)
        + (SELECT count(*) FROM public.organizations o WHERE o.logo_key IS NOT NULL))::integer,
      coalesce((SELECT sum(v.file_size) FROM public.videos v
        WHERE v.deleted_at IS NULL AND v.file_key IS NOT NULL), 0)::bigint
    WHERE app.is_platform_admin()
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_platform_storage() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_platform_storage() TO buhuchet_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_storage_file_key(text, uuid) TO buhuchet_app;--> statement-breakpoint
REVOKE ALL ON TABLE app.admin_storage_files, app.admin_file_trash, app.admin_storage_check
  FROM PUBLIC;--> statement-breakpoint
GRANT SELECT ON TABLE app.admin_storage_files, app.admin_file_trash, app.admin_storage_check
  TO buhuchet_app;
