-- Общая основа пакета доработок 16.11.2026 (этап 0, ТЗ «Доработки 16.11.2026» → «Порядок работ и стыки
-- блоков»; docs/decisions.md п. О-57): колокольчик уведомлений (блок 3, стык потока Т), текст «Для
-- администратора платформы» и модули новостей (блок 4), ссылки файла контрагента на его записи без копии
-- (блок 2) и функция переноса задвоенных чеков; ниже — ручная часть.
-- Блокировки таблиц ждём не дольше 10 с: если выпуск совпал с долгой транзакцией, миграция падает и
-- задание выпуска перезапускают, а не держит новости и файлы, пока ждёт.
SET LOCAL lock_timeout = '10s';--> statement-breakpoint
CREATE TABLE "bell_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id(),
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"event" text NOT NULL,
	"target_kind" text,
	"target_id" text,
	"contractor_id" uuid,
	"need" text,
	"text" text NOT NULL,
	"event_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	CONSTRAINT "bell_notifications_event_key" UNIQUE("user_id","event_key"),
	CONSTRAINT "bell_notifications_kind_check" CHECK ("bell_notifications"."kind" in ('reports', 'tasks', 'files', 'money', 'news', 'other')),
	CONSTRAINT "bell_notifications_event_check" CHECK ("bell_notifications"."event" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "bell_notifications_target_check" CHECK (("bell_notifications"."target_kind" is null) = ("bell_notifications"."target_id" is null) and ("bell_notifications"."target_kind" is null or ("bell_notifications"."target_kind" ~ '^[a-z][a-z0-9_]{0,39}$' and char_length("bell_notifications"."target_id") between 1 and 100))),
	CONSTRAINT "bell_notifications_need_check" CHECK ("bell_notifications"."need" is null or "bell_notifications"."need" ~ '^[a-zA-Z]{1,40}$'),
	CONSTRAINT "bell_notifications_text_check" CHECK (char_length("bell_notifications"."text") between 1 and 1000),
	CONSTRAINT "bell_notifications_event_key_check" CHECK (char_length("bell_notifications"."event_key") between 1 and 200),
	CONSTRAINT "bell_notifications_contractor_check" CHECK ("bell_notifications"."contractor_id" is null or "bell_notifications"."org_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "bell_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "news_admin_texts" (
	"news_id" text PRIMARY KEY NOT NULL,
	"md" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid DEFAULT app.current_user_id(),
	CONSTRAINT "news_admin_texts_md_check" CHECK (char_length("news_admin_texts"."md") between 1 and 50000)
);
--> statement-breakpoint
ALTER TABLE "news_admin_texts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "file_links" (
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"file_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"created_by" uuid DEFAULT app.current_user_id() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_links_pk" PRIMARY KEY("file_id","source_kind","source_id"),
	CONSTRAINT "file_links_source_kind_check" CHECK ("file_links"."source_kind" in ('report', 'receipt', 'tax_payment', 'fee_payment', 'money_operation', 'one_off_service', 'one_off_service_payment', 'project', 'project_payment'))
);
--> statement-breakpoint
ALTER TABLE "file_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bell_notifications" ADD CONSTRAINT "bell_notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bell_notifications" ADD CONSTRAINT "bell_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bell_notifications" ADD CONSTRAINT "bell_notifications_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bell_notifications" ADD CONSTRAINT "bell_notifications_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_admin_texts" ADD CONSTRAINT "news_admin_texts_news_id_news_id_fk" FOREIGN KEY ("news_id") REFERENCES "public"."news"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_admin_texts" ADD CONSTRAINT "news_admin_texts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_links" ADD CONSTRAINT "file_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_links" ADD CONSTRAINT "file_links_file_fk" FOREIGN KEY ("file_id","org_id") REFERENCES "public"."files"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_links" ADD CONSTRAINT "file_links_created_by_fk" FOREIGN KEY ("created_by","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bell_notifications_user_idx" ON "bell_notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bell_notifications_unseen_idx" ON "bell_notifications" USING btree ("user_id") WHERE "bell_notifications"."seen_at" is null;--> statement-breakpoint
CREATE INDEX "bell_notifications_org_created_idx" ON "bell_notifications" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "bell_notifications_contractor_idx" ON "bell_notifications" USING btree ("org_id","contractor_id") WHERE "bell_notifications"."contractor_id" is not null;--> statement-breakpoint
CREATE INDEX "file_links_source_idx" ON "file_links" USING btree ("org_id","source_kind","source_id");--> statement-breakpoint
CREATE POLICY "bell_notifications_isolation" ON "bell_notifications" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("bell_notifications"."org_id" = app.current_org_id()) WITH CHECK ("bell_notifications"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "bell_notifications_platform_admin" ON "bell_notifications" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("bell_notifications"."org_id" is null and app.current_org_id() is null and "bell_notifications"."user_id" = app.current_user_id() and app.is_platform_admin()) WITH CHECK ("bell_notifications"."org_id" is null and app.current_org_id() is null and "bell_notifications"."user_id" = app.current_user_id() and app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "bell_notifications_own_select" ON "bell_notifications" AS RESTRICTIVE FOR SELECT TO "buhuchet_app" USING ("bell_notifications"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "bell_notifications_own_update" ON "bell_notifications" AS RESTRICTIVE FOR UPDATE TO "buhuchet_app" USING ("bell_notifications"."user_id" = app.current_user_id()) WITH CHECK ("bell_notifications"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "bell_notifications_own_delete" ON "bell_notifications" AS RESTRICTIVE FOR DELETE TO "buhuchet_app" USING ("bell_notifications"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "news_admin_texts_admin" ON "news_admin_texts" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin() and "news_admin_texts"."updated_by" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "file_links_isolation" ON "file_links" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("file_links"."org_id" = app.current_org_id()) WITH CHECK ("file_links"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "file_links_insert_guard" ON "file_links" AS RESTRICTIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("file_links"."created_by" = app.current_user_id());--> statement-breakpoint
-- Новости — последними: ACCESS EXCLUSIVE на news берём после внешних ключей на чужие таблицы, чтобы лента
-- не ждала их блокировок (столбец с постоянным значением по умолчанию — без перезаписи таблицы).
ALTER TABLE "news" ADD COLUMN "modules" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "news" ADD CONSTRAINT "news_modules_check" CHECK (cardinality("news"."modules") = 0 or (cardinality("news"."modules") <= 30 and array_position("news"."modules", null) is null and array_to_string("news"."modules", ',') ~ '^[a-z][a-z0-9_-]{0,31}(,[a-z][a-z0-9_-]{0,31})*$' and cardinality(string_to_array(array_to_string("news"."modules", ','), ',')) = cardinality("news"."modules")));--> statement-breakpoint
-- Ручная часть миграции (общая основа пакета доработок 16.11.2026, этап 0).
-- Колокольчик: роль приложения меняет у строки только «просмотрено» и «прочитано» (чьи строки — решают
-- политики: только свои).
REVOKE UPDATE ON TABLE public.bell_notifications FROM buhuchet_app;--> statement-breakpoint
GRANT UPDATE (seen_at, read_at) ON TABLE public.bell_notifications TO buhuchet_app;--> statement-breakpoint
-- Уборка колокольчика (блок 3: хранение 90 дней; задача потока Т). Контекст без пользователя строк не
-- видит и не удаляет, поэтому строки старше 90 дней удаляет функция с правами владельца: в контексте
-- организации — только её строки, без организации — строки администраторов платформы. Удаляет лишь то,
-- что и так уходит по сроку; отвечает, сколько удалено.
CREATE FUNCTION app.bell_cleanup()
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    n integer;
  BEGIN
    DELETE FROM public.bell_notifications b
      WHERE b.created_at < now() - interval '90 days'
        AND (b.org_id = app.current_org_id()
          OR (b.org_id IS NULL AND app.current_org_id() IS NULL));
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.bell_cleanup() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.bell_cleanup() TO buhuchet_app;--> statement-breakpoint
-- Ссылка файла не меняется: «Открепить» — удаление ссылки.
REVOKE UPDATE ON TABLE public.file_links FROM buhuchet_app;--> statement-breakpoint
-- Ссылку ставят только на загруженный файл самого контрагента — «Загружен вручную» к контрагенту, «Из
-- свидетельства и выписки», «От контрагента» (FILE_LINKABLE_FILE_KINDS); файл чужой записи (задачи,
-- оплаты за обслуживание…) — нет, у него своя видимость. Иначе — ошибка ограничения file_links_file_check
-- (API отвечает «не найден»), а не тихий пропуск.
CREATE FUNCTION app.file_links_file_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.files f
      WHERE f.id = NEW.file_id AND f.org_id = NEW.org_id AND f.state = 'ready'
        AND f.contractor_id IS NOT NULL
        AND f.source_kind IN ('manual', 'contractor', 'sent_file')
    ) THEN
      RAISE EXCEPTION 'file_links: файл не загружен или не файл контрагента'
        USING ERRCODE = '23514', CONSTRAINT = 'file_links_file_check';
    END IF;
    RETURN NEW;
  END
  $$;--> statement-breakpoint
CREATE TRIGGER file_links_file_guard BEFORE INSERT ON public.file_links
  FOR EACH ROW EXECUTE FUNCTION app.file_links_file_guard();--> statement-breakpoint
REVOKE ALL ON FUNCTION app.file_links_file_guard() FROM PUBLIC, buhuchet_app;--> statement-breakpoint
-- Перенос задвоенных чеков (блок 2, пункт 8): с 15.11.2026 принятый чек прикреплялся к записи денег
-- копией (files/sent-attach.ts: название, тип — отправленного файла, размер — объекта, примечания нет).
-- Пара «оригинал — копия»: оригинал — файл принятого отправленного файла (не заменялся); копия —
-- загруженный файл того же контрагента у поступления или оплаты за обслуживание, с названием и типом
-- отправленного файла (у оригинала название могло стать «Имя (2)») и размером оригинала, без
-- примечания, не заменялась, создана после «Принять» и не раньше 15.11.2026 по Бишкеку, и подходит ровно
-- к одному оригиналу (иначе не трогается — например, один чек, присланный дважды). Копия становится
-- ссылкой оригинала (автор и время — копии), сама копия — «удалена» её автором (системного пользователя
-- нет; записи в истории нет — у записи денег тот же файл ссылкой), её объект хранилища удалит задача
-- повторного удаления (storage_delete_retries, п. И-7). Повтор ничего не меняет. Отвечает, сколько копий
-- объединено; NOTICE — ещё и сколько похожих копий осталось без пары. Зовёт миграция потока К вместе с
-- кодом, который читает ссылки (этап 1): до этого запись денег показывает только свои файлы, и копия ещё
-- нужна (docs/decisions.md п. О-57).
CREATE FUNCTION app.file_copies_merge()
  RETURNS integer
  LANGUAGE plpgsql VOLATILE
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    merged integer;
    left_over integer;
  BEGIN
    WITH originals AS (
      SELECT f.id, f.org_id, f.contractor_id, f.size_bytes, f.created_at, s.name AS sent_name,
        s.content_type AS sent_type, s.decided_at
      FROM public.contractor_sent_files s
      JOIN public.files f ON f.id = s.file_id AND f.org_id = s.org_id
        AND f.contractor_id = s.contractor_id
      WHERE s.status = 'accepted' AND s.decided_at IS NOT NULL AND f.state = 'ready'
        AND f.replaced_at IS NULL
    ),
    pairs AS (
      SELECT c.id AS copy_id, c.org_id, c.source_kind, c.source_id, c.created_by, c.created_at,
        (array_agg(o.id))[1] AS orig_id
      FROM public.files c
      JOIN originals o ON o.org_id = c.org_id AND o.contractor_id = c.contractor_id
        AND o.sent_name = c.name AND o.sent_type = c.content_type AND o.size_bytes = c.size_bytes
        AND o.id <> c.id AND c.created_at >= o.decided_at AND c.created_at >= o.created_at
      WHERE c.state = 'ready' AND c.source_kind IN ('receipt', 'fee_payment')
        AND c.source_id IS NOT NULL AND c.replaced_at IS NULL AND c.note IS NULL
        AND c.created_at >= timestamptz '2026-11-15 00:00:00+06'
      GROUP BY c.id, c.org_id, c.source_kind, c.source_id, c.created_by, c.created_at
      HAVING count(*) = 1
    ),
    linked AS (
      INSERT INTO public.file_links (org_id, file_id, source_kind, source_id, created_by, created_at)
        SELECT p.org_id, p.orig_id, p.source_kind, p.source_id, p.created_by, p.created_at FROM pairs p
        ON CONFLICT DO NOTHING
        RETURNING 1
    ),
    gone AS (
      UPDATE public.files f
        SET state = 'deleted', deleted_at = now(), deleted_by = p.created_by,
          updated_by = p.created_by, updated_at = now(), version = f.version + 1
        FROM pairs p
        WHERE f.id = p.copy_id
        RETURNING f.storage_key
    ),
    stored AS (
      INSERT INTO public.storage_delete_retries (key)
        SELECT g.storage_key FROM gone g
        ON CONFLICT (key) DO NOTHING
        RETURNING 1
    )
    SELECT count(*)::integer INTO merged FROM gone;
    -- Похожие копии без пары (подходят к нескольким оригиналам) — в журнал выпуска для отчёта.
    SELECT count(*)::integer INTO left_over
      FROM public.files c
      WHERE c.state = 'ready' AND c.source_kind IN ('receipt', 'fee_payment')
        AND c.source_id IS NOT NULL AND c.replaced_at IS NULL AND c.note IS NULL
        AND c.created_at >= timestamptz '2026-11-15 00:00:00+06'
        AND EXISTS (
          SELECT 1 FROM public.contractor_sent_files s
          JOIN public.files f ON f.id = s.file_id AND f.org_id = s.org_id
          WHERE s.org_id = c.org_id AND s.contractor_id = c.contractor_id AND s.status = 'accepted'
            AND f.state = 'ready' AND s.name = c.name AND s.content_type = c.content_type
            AND f.size_bytes = c.size_bytes
        );
    RAISE NOTICE 'file_copies_merge: объединено %, похожих копий без пары %', merged, left_over;
    RETURN merged;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.file_copies_merge() FROM PUBLIC, buhuchet_app;
