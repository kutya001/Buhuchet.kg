-- Повторяющиеся задачи и запросы пользователей администратору (доработки 28.11.2026; план разработки 28.11,
-- этап 0, П2; docs/decisions.md п. О-72): серии задач `task_series`, у задачи — серия и дата по правилу,
-- запросы — новые поля прежней `dict_change_requests` (номер, вид, тема, форма, «Где», «Ведёт», прочитано,
-- статусы «В работе», «Решён», «Отозван») и таблицы переписки, снимков и «Заметок». Только добавляет: прежние
-- `what`, `answer`, `decided_*` остаются (на них до этапа 2 работают «Мои запросы» и Админка), снимаются
-- только NOT NULL у `dict` и `what`. Перенос прежних запросов — здесь, до проверок: номер с 1201 по дате
-- отправки, вид «Добавить в справочник», тема — «Что добавить», ответ — первым сообщением администратора.
-- Политики, функции, триггеры и права — миграция 0179. Таблица запросов маленькая (десятки строк у пилота),
-- `tasks` — тысячи: ADD COLUMN без значения по умолчанию и ограничения берут ACCESS EXCLUSIVE на доли
-- секунды. Блокировки ждём не дольше 5 с; после `pnpm db:generate` строку SET LOCAL и перенос вернуть руками.
-- Откат: новая миграция, которая убирает новые таблицы и столбцы, — только после отката кода этапов.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "task_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_code" text NOT NULL,
	"contractor_id" uuid,
	"project_id" uuid,
	"executor_employee_id" uuid NOT NULL,
	"author_employee_id" uuid NOT NULL,
	"term" text DEFAULT 'day' NOT NULL,
	"need_file" boolean DEFAULT false NOT NULL,
	"confirm" boolean NOT NULL,
	"every" smallint DEFAULT 1 NOT NULL,
	"unit" text NOT NULL,
	"week_days" smallint[],
	"month_mode" text,
	"start_date" date NOT NULL,
	"end_kind" text DEFAULT 'never' NOT NULL,
	"end_date" date,
	"end_count" smallint,
	"state" text DEFAULT 'active' NOT NULL,
	"stop_reason" text,
	"next_date" date,
	"made" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "task_series_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "task_series_title_check" CHECK (char_length(btrim("task_series"."title")) > 0),
	CONSTRAINT "task_series_project_check" CHECK ("task_series"."project_id" is null or "task_series"."contractor_id" is not null),
	CONSTRAINT "task_series_term_check" CHECK ("task_series"."term" in ('day', 'month')),
	CONSTRAINT "task_series_every_check" CHECK ("task_series"."every" between 1 and 99),
	CONSTRAINT "task_series_unit_check" CHECK ("task_series"."unit" in ('day', 'week', 'month', 'year')),
	CONSTRAINT "task_series_month_term_check" CHECK ("task_series"."term" <> 'month' or ("task_series"."unit" in ('month', 'year') and "task_series"."month_mode" is null and "task_series"."start_date" = (date_trunc('month', "task_series"."start_date") + interval '1 month - 1 day')::date)),
	CONSTRAINT "task_series_week_days_check" CHECK (case when "task_series"."unit" = 'week' then cardinality("task_series"."week_days") between 1 and 7 and "task_series"."week_days" <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[] else "task_series"."week_days" is null end),
	CONSTRAINT "task_series_month_mode_check" CHECK (case when "task_series"."unit" = 'month' and "task_series"."term" <> 'month' then "task_series"."month_mode" is not null and "task_series"."month_mode" in ('date', 'nth', 'last') else "task_series"."month_mode" is null end),
	CONSTRAINT "task_series_end_kind_check" CHECK ("task_series"."end_kind" in ('never', 'date', 'count')),
	CONSTRAINT "task_series_end_check" CHECK (case "task_series"."end_kind" when 'date' then "task_series"."end_date" >= "task_series"."start_date" and "task_series"."end_count" is null when 'count' then "task_series"."end_count" between 1 and 999 and "task_series"."end_date" is null else "task_series"."end_date" is null and "task_series"."end_count" is null end),
	CONSTRAINT "task_series_state_check" CHECK ("task_series"."state" in ('active', 'stopped', 'finished')),
	CONSTRAINT "task_series_stop_check" CHECK (case when "task_series"."state" = 'stopped' then "task_series"."stop_reason" in ('executor', 'contractor', 'archive', 'project', 'manual') else "task_series"."stop_reason" is null end),
	CONSTRAINT "task_series_made_check" CHECK ("task_series"."made" >= 0)
);
--> statement-breakpoint
ALTER TABLE "task_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "request_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"kind" text NOT NULL,
	"by_admin" boolean DEFAULT false NOT NULL,
	"author_user_id" uuid DEFAULT app.current_user_id() NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"from_status" text,
	"to_status" text,
	"why" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_messages_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "request_messages_n_unique" UNIQUE("request_id","n"),
	CONSTRAINT "request_messages_kind_check" CHECK ("request_messages"."kind" in ('msg', 'ask', 'st')),
	CONSTRAINT "request_messages_n_check" CHECK ("request_messages"."n" >= 1),
	CONSTRAINT "request_messages_text_check" CHECK (length("request_messages"."text") <= 4000),
	CONSTRAINT "request_messages_why_check" CHECK (length("request_messages"."why") <= 4000),
	CONSTRAINT "request_messages_st_check" CHECK (case when "request_messages"."kind" = 'st' then "request_messages"."to_status" in ('new', 'in_work', 'solved', 'added', 'rejected', 'withdrawn') and "request_messages"."from_status" in ('new', 'in_work', 'solved', 'added', 'rejected', 'withdrawn') and "request_messages"."from_status" <> "request_messages"."to_status" else "request_messages"."to_status" is null and "request_messages"."from_status" is null and "request_messages"."why" = '' end),
	CONSTRAINT "request_messages_ask_check" CHECK ("request_messages"."kind" <> 'ask' or "request_messages"."by_admin")
);
--> statement-breakpoint
ALTER TABLE "request_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "request_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"author_user_id" uuid DEFAULT app.current_user_id() NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_notes_text_check" CHECK (length(btrim("request_notes"."text")) between 1 and 4000)
);
--> statement-breakpoint
ALTER TABLE "request_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "request_shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"message_id" uuid,
	"storage_key" text NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"mime" text NOT NULL,
	"created_by" uuid DEFAULT app.current_user_id() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_shots_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "request_shots_size_check" CHECK ("request_shots"."size" between 1 and 5242880),
	CONSTRAINT "request_shots_mime_check" CHECK ("request_shots"."mime" in ('image/png', 'image/jpeg')),
	CONSTRAINT "request_shots_name_check" CHECK (length(btrim("request_shots"."name")) between 1 and 200),
	CONSTRAINT "request_shots_key_check" CHECK (length("request_shots"."storage_key") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "request_shots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dict_change_requests" DROP CONSTRAINT "dict_change_requests_dict_check";--> statement-breakpoint
ALTER TABLE "dict_change_requests" DROP CONSTRAINT "dict_change_requests_status_check";--> statement-breakpoint
ALTER TABLE "dict_change_requests" DROP CONSTRAINT "dict_change_requests_what_check";--> statement-breakpoint
ALTER TABLE "dict_change_requests" ALTER COLUMN "dict" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ALTER COLUMN "what" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "series_date" date;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD COLUMN "no" integer;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD COLUMN "kind" text DEFAULT 'dict' NOT NULL;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD COLUMN "topic" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD COLUMN "form_id" text;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD COLUMN "form" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD COLUMN "where_info" jsonb;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD COLUMN "wait" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD COLUMN "lead_admin" uuid;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD COLUMN "read_author" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD COLUMN "read_admin" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD COLUMN "last_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_id_org_unique" UNIQUE("id","org_id");--> statement-breakpoint
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_category_code_task_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."task_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_project_fk" FOREIGN KEY ("project_id","contractor_id","org_id") REFERENCES "public"."projects"("id","contractor_id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_executor_fk" FOREIGN KEY ("executor_employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_author_fk" FOREIGN KEY ("author_employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_messages" ADD CONSTRAINT "request_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_messages" ADD CONSTRAINT "request_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_messages" ADD CONSTRAINT "request_messages_request_fk" FOREIGN KEY ("request_id","org_id") REFERENCES "public"."dict_change_requests"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_notes" ADD CONSTRAINT "request_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_notes" ADD CONSTRAINT "request_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_notes" ADD CONSTRAINT "request_notes_request_fk" FOREIGN KEY ("request_id","org_id") REFERENCES "public"."dict_change_requests"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_shots" ADD CONSTRAINT "request_shots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_shots" ADD CONSTRAINT "request_shots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_shots" ADD CONSTRAINT "request_shots_request_fk" FOREIGN KEY ("request_id","org_id") REFERENCES "public"."dict_change_requests"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_shots" ADD CONSTRAINT "request_shots_message_fk" FOREIGN KEY ("message_id","org_id") REFERENCES "public"."request_messages"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_series_author_idx" ON "task_series" USING btree ("org_id","author_employee_id","state");--> statement-breakpoint
CREATE INDEX "task_series_contractor_idx" ON "task_series" USING btree ("org_id","contractor_id");--> statement-breakpoint
CREATE INDEX "task_series_active_idx" ON "task_series" USING btree ("org_id","next_date") WHERE "task_series"."state" = 'active';--> statement-breakpoint
CREATE INDEX "request_messages_org_idx" ON "request_messages" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "request_notes_request_idx" ON "request_notes" USING btree ("org_id","request_id","created_at");--> statement-breakpoint
CREATE INDEX "request_shots_request_idx" ON "request_shots" USING btree ("org_id","request_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_series_fk" FOREIGN KEY ("series_id","org_id") REFERENCES "public"."task_series"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_lead_admin_users_id_fk" FOREIGN KEY ("lead_admin") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dict_change_requests_open_idx" ON "dict_change_requests" USING btree ("status","last_at") WHERE "dict_change_requests"."status" in ('new', 'in_work');--> statement-breakpoint
-- Перенос прежних запросов «Попросить добавить» (блок 4, пункт 1; прототип `reqNorm`): номер — с 1201 по
-- дате отправки, форма — по справочнику (как `reqFidOf`: «Налоговые режимы» — «Налог или ставка», «Формы
-- собственности» — «Другое»; REQUEST_FORM_OF_DICT домена), закрыт — когда ответили.
UPDATE "dict_change_requests" r SET
  "no" = 1200 + n.rn,
  "topic" = r."what",
  "form_id" = CASE r."dict"
    WHEN 'types' THEN 'type' WHEN 'regimes' THEN 'tax' WHEN 'forms' THEN 'other' WHEN 'organs' THEN 'organ'
    WHEN 'benefits' THEN 'ben' WHEN 'banks' THEN 'bank' WHEN 'cats' THEN 'cat' WHEN 'reasons' THEN 'reason'
    WHEN 'ugns' THEN 'ugns' WHEN 'bases' THEN 'base' WHEN 'dm' THEN 'dm' ELSE 'other' END,
  "form" = jsonb_strip_nulls(jsonb_build_object(
    'name', r."what",
    'note', nullif(btrim(r."comment"), ''),
    'dict', CASE WHEN r."dict" = 'forms' THEN 'Формы собственности' END)),
  "last_at" = coalesce(r."decided_at", r."created_at"),
  "closed_at" = CASE WHEN r."status" <> 'new' THEN coalesce(r."decided_at", r."updated_at") END,
  "lead_admin" = r."decided_by"
FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn FROM "dict_change_requests") n
WHERE n."id" = r."id";--> statement-breakpoint
-- Ответ администратора — первым сообщением ленты, решение — сменой статуса «Новый» → «Добавлено» / «Отклонён».
INSERT INTO "request_messages" ("org_id", "request_id", "n", "kind", "by_admin", "author_user_id", "text", "created_at")
SELECT r."org_id", r."id", 1, 'msg', true, r."decided_by", left(r."answer", 4000), coalesce(r."decided_at", r."updated_at")
FROM "dict_change_requests" r
WHERE r."answer" <> '' AND r."decided_by" IS NOT NULL;--> statement-breakpoint
INSERT INTO "request_messages" ("org_id", "request_id", "n", "kind", "by_admin", "author_user_id", "from_status", "to_status", "why", "created_at")
SELECT r."org_id", r."id",
  CASE WHEN r."answer" <> '' THEN 2 ELSE 1 END, 'st', true, r."decided_by", 'new', r."status",
  CASE WHEN r."status" = 'rejected' THEN left(r."answer", 4000) ELSE '' END,
  coalesce(r."decided_at", r."updated_at")
FROM "dict_change_requests" r
WHERE r."status" <> 'new' AND r."decided_by" IS NOT NULL;--> statement-breakpoint
-- Перенесённое прочитано и автором, и администраторами (как в прототипе).
UPDATE "dict_change_requests" r SET
  "read_author" = m.cnt,
  "read_admin" = m.cnt
FROM (SELECT "request_id", count(*)::integer AS cnt FROM "request_messages" GROUP BY "request_id") m
WHERE m."request_id" = r."id";--> statement-breakpoint
ALTER TABLE "dict_change_requests" ALTER COLUMN "no" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_series_date_unique" UNIQUE("org_id","series_id","series_date");--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_no_unique" UNIQUE("no");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_series_check" CHECK (("tasks"."series_id" is null) = ("tasks"."series_date" is null));--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_kind_check" CHECK ("dict_change_requests"."kind" in ('q', 'bug', 'typo', 'dict'));--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_form_id_check" CHECK (case when "dict_change_requests"."kind" = 'dict' then "dict_change_requests"."form_id" in ('type', 'tax', 'ben', 'base', 'gked', 'ugns', 'organ', 'bank', 'cat', 'reason', 'dm', 'other') else "dict_change_requests"."form_id" is null and "dict_change_requests"."dict" is null end);--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_no_check" CHECK ("dict_change_requests"."no" >= 1201);--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_topic_check" CHECK (length(btrim("dict_change_requests"."topic")) between 1 and 700);--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_form_check" CHECK (jsonb_typeof("dict_change_requests"."form") = 'object' and octet_length("dict_change_requests"."form"::text) <= 40000);--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_where_check" CHECK ("dict_change_requests"."where_info" is null or (jsonb_typeof("dict_change_requests"."where_info") = 'object' and octet_length("dict_change_requests"."where_info"::text) <= 2000));--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_wait_check" CHECK (not "dict_change_requests"."wait" or "dict_change_requests"."status" = 'in_work');--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_closed_check" CHECK (("dict_change_requests"."closed_at" is null) = ("dict_change_requests"."status" in ('new', 'in_work')));--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_read_check" CHECK ("dict_change_requests"."read_author" >= 0 and "dict_change_requests"."read_admin" >= 0);--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_dict_check" CHECK ("dict_change_requests"."dict" is null or "dict_change_requests"."dict" in ('types', 'regimes', 'forms', 'organs', 'benefits', 'banks', 'cats', 'reasons', 'ugns', 'bases', 'dm'));--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_status_check" CHECK ("dict_change_requests"."status" in ('new', 'in_work', 'solved', 'added', 'rejected', 'withdrawn'));--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_what_check" CHECK ("dict_change_requests"."what" is null or length(btrim("dict_change_requests"."what")) between 1 and 300);--> statement-breakpoint
CREATE POLICY "task_series_isolation" ON "task_series" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("task_series"."org_id" = app.current_org_id()) WITH CHECK ("task_series"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "request_messages_isolation" ON "request_messages" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("request_messages"."org_id" = app.current_org_id()) WITH CHECK ("request_messages"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "request_messages_insert_own" ON "request_messages" AS RESTRICTIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("request_messages"."author_user_id" = app.current_user_id() and "request_messages"."created_at" = now() and "request_messages"."by_admin" = app.is_platform_admin() and ("request_messages"."by_admin" or "request_messages"."kind" = 'msg' or ("request_messages"."kind" = 'st' and "request_messages"."to_status" in ('withdrawn', 'in_work'))));--> statement-breakpoint
CREATE POLICY "request_notes_isolation" ON "request_notes" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("request_notes"."org_id" = app.current_org_id()) WITH CHECK ("request_notes"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "request_notes_admin_only" ON "request_notes" AS RESTRICTIVE FOR ALL TO "buhuchet_app" USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin() and "request_notes"."author_user_id" = app.current_user_id() and "request_notes"."created_at" = now());--> statement-breakpoint
CREATE POLICY "request_shots_isolation" ON "request_shots" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("request_shots"."org_id" = app.current_org_id()) WITH CHECK ("request_shots"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "request_shots_insert_own" ON "request_shots" AS RESTRICTIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("request_shots"."created_by" = app.current_user_id() and "request_shots"."created_at" = now());--> statement-breakpoint
ALTER POLICY "dict_change_requests_insert_guard" ON "dict_change_requests" TO buhuchet_app WITH CHECK ("dict_change_requests"."created_by" = app.current_user_id() and "dict_change_requests"."status" = 'new' and "dict_change_requests"."answer" = '' and "dict_change_requests"."decided_by" is null and "dict_change_requests"."decided_at" is null and "dict_change_requests"."lead_admin" is null and not "dict_change_requests"."wait" and "dict_change_requests"."closed_at" is null and "dict_change_requests"."read_admin" = 0);--> statement-breakpoint
SET LOCAL lock_timeout TO DEFAULT;
