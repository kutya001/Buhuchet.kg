-- Регистрация организации по выписке и свидетельству (доработки 14.11.2026, блок 1; поток И; прототип
-- v114 modules/lead-docs.js): черновик документов формы заявки, перенос документов в заявку, «Одобрить»
-- (документы — в файлы организации), удаление файлов заявки по сроку, «ИНН и форма» организации только
-- у администратора платформы; ниже — ручная часть.
SET LOCAL lock_timeout = '10s';--> statement-breakpoint
-- Заявки — раньше истории заявок: так же их берут отправка заявки и смена статуса (иначе взаимная
-- блокировка с отправкой заявки во время выпуска).
LOCK TABLE public.platform_leads IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
CREATE TABLE "platform_lead_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"draft_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"doc" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_lead_uploads_kind_check" CHECK ("platform_lead_uploads"."kind" in ('gns_cert', 'extract', 'minjust_cert')),
	CONSTRAINT "platform_lead_uploads_name_check" CHECK (char_length("platform_lead_uploads"."name") between 1 and 255),
	CONSTRAINT "platform_lead_uploads_size_check" CHECK ("platform_lead_uploads"."size_bytes" between 1 and 20971520),
	CONSTRAINT "platform_lead_uploads_state_check" CHECK ("platform_lead_uploads"."state" in ('pending', 'ready', 'gone')),
	CONSTRAINT "platform_lead_uploads_doc_check" CHECK ("platform_lead_uploads"."doc" is null or ("platform_lead_uploads"."state" = 'ready' and pg_column_size("platform_lead_uploads"."doc") <= 65536))
);
--> statement-breakpoint
ALTER TABLE "platform_lead_uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_lead_events" DROP CONSTRAINT "platform_lead_events_kind_check";--> statement-breakpoint
CREATE UNIQUE INDEX "platform_lead_uploads_kind_key" ON "platform_lead_uploads" USING btree ("draft_id","kind") WHERE "platform_lead_uploads"."state" <> 'gone';--> statement-breakpoint
CREATE INDEX "platform_lead_uploads_created_idx" ON "platform_lead_uploads" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "platform_lead_events" ADD CONSTRAINT "platform_lead_events_kind_check" CHECK ("platform_lead_events"."kind" in ('created', 'repeat', 'status', 'rollback', 'note', 'org', 'tg', 'docs'));
--> statement-breakpoint
-- Ручная часть. Черновик документов роль приложения не видит и не меняет: только функции ниже.
REVOKE ALL ON TABLE public.platform_lead_uploads FROM buhuchet_app;--> statement-breakpoint
-- Начать загрузку документа формы: строка черновика с видом, именем и размером. Черновик — живой (есть
-- загрузка моложе p_draft_hours часов), иначе — новый номер: номер чужого старого черновика ничего не
-- даёт. Новый файл того же вида заменяет прежний — его номер возвращается, чтобы API удалило файл.
-- Убранная загрузка (`gone`) не удаляется: по её ссылке файл ещё могут положить, а задача по расписанию
-- через p_draft_hours часов удаляет по строке и такой файл (app.lead_purge_due).
CREATE FUNCTION app.lead_upload_start(
  p_draft uuid, p_id uuid, p_kind text, p_name text, p_size bigint, p_now timestamptz,
  p_draft_hours integer
)
  RETURNS TABLE (draft uuid, replaced uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_draft uuid := p_draft;
    v_old uuid;
  BEGIN
    IF v_draft IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('lead_draft:' || v_draft::text, 0));
      IF NOT EXISTS (
        SELECT 1 FROM public.platform_lead_uploads u
        WHERE u.draft_id = v_draft AND u.state <> 'gone'
          AND u.created_at > p_now - make_interval(hours => p_draft_hours)
      ) THEN
        v_draft := NULL;
      END IF;
    END IF;
    IF v_draft IS NULL THEN
      v_draft := gen_random_uuid();
    END IF;
    UPDATE public.platform_lead_uploads u SET state = 'gone', doc = NULL
      WHERE u.draft_id = v_draft AND u.kind = p_kind AND u.state <> 'gone'
      RETURNING u.id INTO v_old;
    INSERT INTO public.platform_lead_uploads (id, draft_id, kind, name, size_bytes, created_at)
      VALUES (p_id, v_draft, p_kind, p_name, p_size, p_now);
    RETURN QUERY SELECT v_draft, v_old;
  END
  $$;--> statement-breakpoint
-- Загрузка черновика для разбора (по номеру загрузки и черновика вместе).
CREATE FUNCTION app.lead_upload_of(p_id uuid, p_draft uuid)
  RETURNS TABLE (kind text, name text, size_bytes bigint, state text, created_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT u.kind, u.name, u.size_bytes, u.state, u.created_at
    FROM public.platform_lead_uploads u
    WHERE u.id = p_id AND u.draft_id = p_draft AND u.state <> 'gone'
  $$;--> statement-breakpoint
-- Файл проверен (PDF нужного размера) и разобран: найденное — в черновик.
CREATE FUNCTION app.lead_upload_read(p_id uuid, p_draft uuid, p_doc jsonb)
  RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH x AS (
      UPDATE public.platform_lead_uploads u SET state = 'ready', doc = p_doc
      WHERE u.id = p_id AND u.draft_id = p_draft AND u.state <> 'gone'
      RETURNING 1
    )
    SELECT count(*) > 0 FROM x
  $$;--> statement-breakpoint
-- Файл не PDF или больше 20 МБ: загрузка убирается (`gone`; файл в хранилище удаляет API).
CREATE FUNCTION app.lead_upload_drop(p_id uuid, p_draft uuid)
  RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH x AS (
      UPDATE public.platform_lead_uploads u SET state = 'gone', doc = NULL
      WHERE u.id = p_id AND u.draft_id = p_draft AND u.state <> 'gone'
      RETURNING 1
    )
    SELECT count(*) > 0 FROM x
  $$;--> statement-breakpoint
-- Документы живого черновика: что выбрано и что нашёл разбор.
CREATE FUNCTION app.lead_upload_docs(p_draft uuid, p_now timestamptz, p_draft_hours integer)
  RETURNS TABLE (id uuid, kind text, name text, size_bytes bigint, state text, doc jsonb)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT u.id, u.kind, u.name, u.size_bytes, u.state, u.doc
    FROM public.platform_lead_uploads u
    WHERE u.draft_id = p_draft AND u.state <> 'gone'
      AND u.created_at > p_now - make_interval(hours => p_draft_hours)
    ORDER BY u.created_at, u.id
  $$;--> statement-breakpoint
-- Черновик не стал документами заявки (повтор с того же телефона, ловушка): загрузки убираются
-- (`gone`), номера — чтобы API удалило файлы.
CREATE FUNCTION app.lead_upload_discard(p_draft uuid)
  RETURNS SETOF uuid
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.platform_lead_uploads u SET state = 'gone', doc = NULL
    WHERE u.draft_id = p_draft AND u.state <> 'gone'
    RETURNING u.id
  $$;--> statement-breakpoint
-- Новая заявка с документами: вызывается сразу после app.lead_submit в той же транзакции и только для
-- заявки, созданной в этот же момент p_now (как app.lead_notify). Все документы формы p_need должны быть
-- в черновике проверенными — иначе 'missing' и ничего не меняется (API откатывает заявку). Заявка
-- получает форму, ИНН, ОКПО, адрес и руководителя, документы — строки `pending` под ключами заявки (файлы
-- копирует API после транзакции), срок хранения — p_keep_days дней; загрузки черновика убираются
-- (`gone`): 'doc' — документ заявки, 'drop' — лишний файл черновика (другой формы).
CREATE FUNCTION app.lead_submit_docs(
  p_lead uuid, p_now timestamptz, p_form text, p_inn text, p_okpo text, p_address text,
  p_head text, p_draft uuid, p_need text[], p_keep_days integer, p_draft_hours integer
)
  RETURNS TABLE (outcome text, upload_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_ready integer;
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.platform_leads l
      WHERE l.id = p_lead AND l.created_at = p_now AND l.legal_form IS NULL
        AND l.created_org_id IS NULL
    ) OR EXISTS (SELECT 1 FROM public.platform_lead_docs d WHERE d.lead_id = p_lead) THEN
      RETURN QUERY SELECT 'missing'::text, NULL::uuid;
      RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('lead_draft:' || p_draft::text, 0));
    SELECT count(*) INTO v_ready FROM public.platform_lead_uploads u
      WHERE u.draft_id = p_draft AND u.state = 'ready' AND u.kind = ANY (p_need)
        AND u.created_at > p_now - make_interval(hours => p_draft_hours);
    IF cardinality(p_need) = 0 OR v_ready <> cardinality(p_need) THEN
      RETURN QUERY SELECT 'missing'::text, NULL::uuid;
      RETURN;
    END IF;
    UPDATE public.platform_leads l
      SET legal_form = p_form,
          inn = p_inn,
          okpo = nullif(btrim(coalesce(p_okpo, '')), ''),
          address = nullif(btrim(coalesce(p_address, '')), ''),
          head = nullif(btrim(coalesce(p_head, '')), ''),
          docs_state = 'pending',
          docs_purge_at = p_now + make_interval(days => p_keep_days)
      WHERE l.id = p_lead;
    INSERT INTO public.platform_lead_docs
        (id, lead_id, kind, name, content_type, size_bytes, storage_key, state, created_at)
      SELECT u.id, p_lead, u.kind, u.name, 'application/pdf', u.size_bytes,
        'leads/' || p_lead::text || '/' || u.id::text, 'pending', p_now
      FROM public.platform_lead_uploads u
      WHERE u.draft_id = p_draft AND u.state = 'ready' AND u.kind = ANY (p_need);
    RETURN QUERY
      WITH cur AS (
        SELECT u.id, u.kind, u.state FROM public.platform_lead_uploads u
        WHERE u.draft_id = p_draft AND u.state <> 'gone'
      ), gone AS (
        UPDATE public.platform_lead_uploads u SET state = 'gone', doc = NULL
        FROM cur WHERE u.id = cur.id
        RETURNING u.id
      )
      SELECT CASE WHEN c.state = 'ready' AND c.kind = ANY (p_need) THEN 'doc' ELSE 'drop' END, c.id
      FROM cur c JOIN gone g ON g.id = c.id;
  END
  $$;--> statement-breakpoint
-- Файлы документов скопированы под ключи заявки и проверены: документы — `ready`, у заявки — `ready`,
-- когда загружены все. Отвечает состоянием документов заявки.
CREATE FUNCTION app.lead_docs_ready(p_lead uuid, p_ids uuid[])
  RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_state text;
  BEGIN
    UPDATE public.platform_lead_docs d SET state = 'ready'
      WHERE d.lead_id = p_lead AND d.id = ANY (p_ids) AND d.state = 'pending';
    UPDATE public.platform_leads l SET docs_state = 'ready'
      WHERE l.id = p_lead AND l.docs_state = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM public.platform_lead_docs d WHERE d.lead_id = l.id AND d.state <> 'ready'
        );
    SELECT l.docs_state INTO v_state FROM public.platform_leads l WHERE l.id = p_lead;
    RETURN v_state;
  END
  $$;--> statement-breakpoint
-- Срок хранения файлов заявки при смене статуса (прототип v114 ldTill): «Отказ» — 7 дней с момента
-- отказа (LEAD_DOCS_KEEP_REJECTED_DAYS), снят «Отказ» — снова 30 дней с отправки (LEAD_DOCS_KEEP_DAYS).
-- Срабатывает и при отказе на сайте, и кнопкой в Telegram; момент — `updated_at` смены статуса.
CREATE FUNCTION app.lead_docs_keep()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NEW.docs_state IS NOT NULL AND NEW.created_org_id IS NULL THEN
      IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
        NEW.docs_purge_at := NEW.updated_at + interval '7 days';
      ELSIF OLD.status = 'rejected' AND NEW.status IS DISTINCT FROM 'rejected' THEN
        NEW.docs_purge_at := NEW.created_at + interval '30 days';
      END IF;
    END IF;
    RETURN NEW;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.lead_docs_keep() FROM PUBLIC, buhuchet_app;--> statement-breakpoint
CREATE TRIGGER platform_leads_docs_keep
  BEFORE UPDATE OF status ON public.platform_leads
  FOR EACH ROW
  EXECUTE FUNCTION app.lead_docs_keep();--> statement-breakpoint
-- Что пора удалить (задача по расписанию): загрузки черновиков старше p_draft_hours часов, в том числе
-- убранные (`gone`: по их ссылке файл могли положить и после удаления), и документы заявок,
-- у которых наступил срок хранения и по которым не создана организация. Ключи хранилища — чтобы задача
-- сначала удалила файлы, потом строки (сбой посередине — строки останутся и удалятся в следующий раз).
CREATE FUNCTION app.lead_purge_due(p_now timestamptz, p_draft_hours integer, p_limit integer)
  RETURNS TABLE (kind text, id uuid, storage_key text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    (SELECT 'upload'::text, u.id, 'leads/upload/' || u.id::text
      FROM public.platform_lead_uploads u
      WHERE u.created_at <= p_now - make_interval(hours => p_draft_hours)
      ORDER BY u.created_at
      LIMIT p_limit)
    UNION ALL
    (SELECT 'doc'::text, d.id, d.storage_key
      FROM public.platform_leads l
      JOIN public.platform_lead_docs d ON d.lead_id = l.id
      WHERE l.docs_purge_at <= p_now AND l.created_org_id IS NULL
      ORDER BY l.docs_purge_at, d.id
      LIMIT p_limit)
  $$;--> statement-breakpoint
-- Файлы удалены из хранилища: строки — тоже (только те, что действительно пора удалить). Заявка без
-- документов получает «файлы удалены» (docs_state пусто) и запись истории «docs»: отказ или срок.
-- Отвечает числом заявок, у которых удалены файлы.
CREATE FUNCTION app.lead_purge_done(
  p_now timestamptz, p_draft_hours integer, p_uploads uuid[], p_docs uuid[]
)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_leads uuid[];
    n integer;
  BEGIN
    DELETE FROM public.platform_lead_uploads u
      WHERE u.id = ANY (p_uploads) AND u.created_at <= p_now - make_interval(hours => p_draft_hours);
    WITH gone AS (
      DELETE FROM public.platform_lead_docs d
        USING public.platform_leads l
        WHERE d.id = ANY (p_docs) AND l.id = d.lead_id AND l.docs_purge_at <= p_now
          AND l.created_org_id IS NULL
        RETURNING d.lead_id
    )
    SELECT array_agg(DISTINCT g.lead_id) INTO v_leads FROM gone g;
    IF v_leads IS NULL THEN
      RETURN 0;
    END IF;
    UPDATE public.platform_leads l SET docs_state = NULL, docs_purge_at = NULL
      WHERE l.id = ANY (v_leads)
        AND NOT EXISTS (SELECT 1 FROM public.platform_lead_docs d WHERE d.lead_id = l.id);
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO public.platform_lead_events (lead_id, at, actor_user_id, kind, text)
      SELECT l.id, p_now, NULL, 'docs',
        CASE WHEN l.status = 'rejected' THEN 'rejected' ELSE 'kept' END
      FROM public.platform_leads l
      WHERE l.id = ANY (v_leads) AND l.docs_state IS NULL;
    RETURN n;
  END
  $$;--> statement-breakpoint
-- «Одобрить» (прототип v114 ldApproveDlg): документы заявки становятся файлами новой организации с
-- источником «Заявка на подключение» (`lead`). Вызывается в транзакции создания организации после
-- connectLeadToOrganization, только администратором платформы; файлы под новыми ключами API копирует до
-- транзакции, p_files — пары {doc, file}. Загрузил — владелец новой организации. Отвечает ключами
-- документов заявки — их файлы API удаляет после транзакции (строки остаются: в окне заявки видно, что
-- было приложено); не все документы перенесены — ошибка.
CREATE FUNCTION app.lead_docs_to_org(p_lead uuid, p_org uuid, p_owner uuid, p_files jsonb)
  RETURNS TABLE (doc_id uuid, storage_key text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    n integer;
    v_all integer;
  BEGIN
    IF NOT app.is_platform_admin()
      OR NOT EXISTS (
        SELECT 1 FROM public.platform_leads l
        WHERE l.id = p_lead AND l.created_org_id = p_org AND l.docs_state = 'ready'
      )
      OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_owner AND u.org_id = p_org)
      OR jsonb_typeof(p_files) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'lead_docs_to_org: заявка, организация или владелец не подходят'
        USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.files
        (id, org_id, source_kind, source_id, contractor_id, name, content_type, size_bytes,
         storage_key, state, created_by)
      SELECT x.file, p_org, 'lead', NULL, NULL, d.name, d.content_type, d.size_bytes,
        'org/' || p_org::text || '/files/' || x.file::text, 'ready', p_owner
      FROM jsonb_to_recordset(p_files) AS x(doc uuid, file uuid)
      JOIN public.platform_lead_docs d ON d.id = x.doc AND d.lead_id = p_lead AND d.state = 'ready';
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT count(*) INTO v_all FROM public.platform_lead_docs d WHERE d.lead_id = p_lead;
    IF n <> v_all OR n <> jsonb_array_length(p_files)
      OR (SELECT count(DISTINCT x.doc) FROM jsonb_to_recordset(p_files) AS x(doc uuid, file uuid))
        <> v_all THEN
      RAISE EXCEPTION 'lead_docs_to_org: перенесены не все документы заявки'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Строки документов остаются описанием заявки (что было приложено), срок хранения снимается.
    UPDATE public.platform_leads l SET docs_purge_at = NULL WHERE l.id = p_lead;
    RETURN QUERY
      SELECT d.id, d.storage_key FROM public.platform_lead_docs d WHERE d.lead_id = p_lead;
  END
  $$;--> statement-breakpoint
-- Документы заявок для Админки: только администратору платформы (ключ хранилища — для ссылки на 15 минут).
CREATE VIEW app.admin_lead_docs WITH (security_barrier = true) AS
  SELECT d.id, d.lead_id, d.kind, d.name, d.size_bytes, d.state, d.storage_key, d.created_at
  FROM public.platform_lead_docs d
  WHERE (SELECT app.is_platform_admin());--> statement-breakpoint
-- Заявки для Админки: прежние столбцы и данные из документов, Telegram заявителя, число документов,
-- имя заявителя в Telegram (0148 потока Т) — «подключён · @имя» в «Данных из документов».
CREATE OR REPLACE VIEW app.admin_leads WITH (security_barrier = true) AS
  SELECT
    l.id,
    l.created_at,
    l.name,
    l.firm,
    l.phone,
    l.size,
    l.telegram,
    l.note,
    l.status,
    l.status_before,
    l.created_org_id,
    g.name AS org_name,
    l.admin_note,
    l.from_stand,
    l.version,
    l.updated_at,
    l.updated_by,
    l.legal_form,
    l.inn,
    l.okpo,
    l.address,
    l.head,
    l.docs_state,
    l.docs_purge_at,
    l.tg_linked_at,
    (SELECT count(*)::integer FROM public.platform_lead_docs d WHERE d.lead_id = l.id) AS docs_count,
    l.tg_username,
    l.tg_first_name
  FROM public.platform_leads l
  LEFT JOIN public.organizations g ON g.id = l.created_org_id
  WHERE (SELECT app.is_platform_admin());--> statement-breakpoint
REVOKE ALL ON TABLE app.admin_lead_docs FROM PUBLIC;--> statement-breakpoint
GRANT SELECT ON TABLE app.admin_lead_docs TO buhuchet_app;--> statement-breakpoint
-- «ИНН и форма» организации (прототип v114 ldInnFormDlg): меняет только администратор платформы, с
-- версией записи; владелец ИНН больше не меняет (решение заказчика 14.11.2026, блок 1, пункт 4).
CREATE FUNCTION app.admin_set_org_inn_form(p_org uuid, p_inn text, p_form text, p_version integer)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.organizations
      SET inn = p_inn,
          legal_form = p_form,
          version = version + 1,
          updated_at = now(),
          updated_by = app.current_user_id()
      WHERE id = p_org AND version = p_version AND app.is_platform_admin()
      RETURNING version
  $$;--> statement-breakpoint
REVOKE UPDATE (inn) ON TABLE public.organizations FROM buhuchet_app;--> statement-breakpoint
REVOKE ALL ON FUNCTION
  app.lead_upload_start(uuid, uuid, text, text, bigint, timestamptz, integer),
  app.lead_upload_of(uuid, uuid),
  app.lead_upload_read(uuid, uuid, jsonb),
  app.lead_upload_drop(uuid, uuid),
  app.lead_upload_docs(uuid, timestamptz, integer),
  app.lead_upload_discard(uuid),
  app.lead_submit_docs(uuid, timestamptz, text, text, text, text, text, uuid, text[], integer, integer),
  app.lead_docs_ready(uuid, uuid[]),
  app.lead_purge_due(timestamptz, integer, integer),
  app.lead_purge_done(timestamptz, integer, uuid[], uuid[]),
  app.lead_docs_to_org(uuid, uuid, uuid, jsonb),
  app.admin_set_org_inn_form(uuid, text, text, integer)
  FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.lead_upload_start(uuid, uuid, text, text, bigint, timestamptz, integer),
  app.lead_upload_of(uuid, uuid),
  app.lead_upload_read(uuid, uuid, jsonb),
  app.lead_upload_drop(uuid, uuid),
  app.lead_upload_docs(uuid, timestamptz, integer),
  app.lead_upload_discard(uuid),
  app.lead_submit_docs(uuid, timestamptz, text, text, text, text, text, uuid, text[], integer, integer),
  app.lead_docs_ready(uuid, uuid[]),
  app.lead_purge_due(timestamptz, integer, integer),
  app.lead_purge_done(timestamptz, integer, uuid[], uuid[]),
  app.lead_docs_to_org(uuid, uuid, uuid, jsonb),
  app.admin_set_org_inn_form(uuid, text, text, integer)
  TO buhuchet_app;
--> statement-breakpoint
-- Список организаций Админки отдаёт ещё форму (ОсОО/ИП): окно «ИНН и форма» из меню строки
-- подставляет нынешнюю (прототип v114 orgActions → ldInnFormDlg). Новый столбец — в конце, права
-- представления (0024) остаются.
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
    o.legal_form
  FROM public.organizations o
  WHERE app.is_platform_admin();
