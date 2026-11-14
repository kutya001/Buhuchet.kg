-- Общая основа пакета доработок 14.11.2026 (этап 0, ТЗ «Доработки 14.11.2026» → «Порядок работ и стыки
-- блоков»): все новые таблицы и поля пакета одной миграцией — документы и Telegram заявки, ссылка «задать
-- пароль», «Форма» и «ОКПО» организации, отправленные файлы контрагентов, «Я оплатил», строки блока
-- «Telegram-уведомления»; ниже — ручная часть.
CREATE TABLE "platform_lead_docs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_lead_docs_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "platform_lead_docs_kind_key" UNIQUE("lead_id","kind"),
	CONSTRAINT "platform_lead_docs_kind_check" CHECK ("platform_lead_docs"."kind" in ('gns_cert', 'extract', 'minjust_cert')),
	CONSTRAINT "platform_lead_docs_name_check" CHECK (char_length("platform_lead_docs"."name") between 1 and 255),
	CONSTRAINT "platform_lead_docs_type_check" CHECK ("platform_lead_docs"."content_type" = 'application/pdf'),
	CONSTRAINT "platform_lead_docs_size_check" CHECK ("platform_lead_docs"."size_bytes" between 0 and 20971520),
	CONSTRAINT "platform_lead_docs_state_check" CHECK ("platform_lead_docs"."state" in ('pending', 'ready')),
	CONSTRAINT "platform_lead_docs_key_check" CHECK ("platform_lead_docs"."storage_key" = ('leads/' || "platform_lead_docs"."lead_id"::text || '/' || "platform_lead_docs"."id"::text))
);
--> statement-breakpoint
ALTER TABLE "platform_lead_docs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_lead_tg_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_chat_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_lead_tg_tokens_used_check" CHECK ("platform_lead_tg_tokens"."used_chat_id" is null or "platform_lead_tg_tokens"."used_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "platform_lead_tg_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contractor_pay_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"source" text NOT NULL,
	"purpose" text NOT NULL,
	"month" text,
	"amount" bigint,
	"comment" text,
	"sent_file_id" uuid,
	"tg_message_id" uuid,
	"status" text DEFAULT 'wait' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contractor_pay_claims_source_check" CHECK ("contractor_pay_claims"."source" in ('page', 'telegram')),
	CONSTRAINT "contractor_pay_claims_purpose_check" CHECK ("contractor_pay_claims"."purpose" in ('tax', 'fee')),
	CONSTRAINT "contractor_pay_claims_status_check" CHECK ("contractor_pay_claims"."status" in ('wait', 'done', 'rejected')),
	CONSTRAINT "contractor_pay_claims_month_check" CHECK ("contractor_pay_claims"."month" is null or "contractor_pay_claims"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "contractor_pay_claims_amount_check" CHECK ("contractor_pay_claims"."amount" is null or ("contractor_pay_claims"."amount" > 0 and "contractor_pay_claims"."amount" <= 1000000000000)),
	CONSTRAINT "contractor_pay_claims_comment_check" CHECK (char_length(coalesce("contractor_pay_claims"."comment", '')) <= 300),
	CONSTRAINT "contractor_pay_claims_message_check" CHECK ("contractor_pay_claims"."source" = 'telegram' or "contractor_pay_claims"."tg_message_id" is null),
	CONSTRAINT "contractor_pay_claims_decided_check" CHECK (("contractor_pay_claims"."status" = 'wait') = ("contractor_pay_claims"."decided_at" is null) and ("contractor_pay_claims"."decided_by" is null or "contractor_pay_claims"."decided_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "contractor_pay_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "password_setup_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_setup_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "org_telegram_notices" (
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"days" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"weekday" smallint,
	"at_time" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "org_telegram_notices_pk" PRIMARY KEY("org_id","code"),
	CONSTRAINT "org_telegram_notices_code_check" CHECK ("org_telegram_notices"."code" in ('staff_week', 'cp_pay', 'cp_fee')),
	CONSTRAINT "org_telegram_notices_days_check" CHECK ("org_telegram_notices"."days" <@ '{1,2,3,4,5}'::smallint[] and ("org_telegram_notices"."code" <> 'staff_week' or cardinality("org_telegram_notices"."days") = 0)),
	CONSTRAINT "org_telegram_notices_weekday_check" CHECK (("org_telegram_notices"."weekday" is null or "org_telegram_notices"."weekday" between 1 and 7) and ("org_telegram_notices"."code" <> 'cp_pay' or "org_telegram_notices"."weekday" is null)),
	CONSTRAINT "org_telegram_notices_time_check" CHECK ("org_telegram_notices"."code" = 'staff_week' or "org_telegram_notices"."at_time" is not null)
);
--> statement-breakpoint
ALTER TABLE "org_telegram_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contractor_sent_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"source" text NOT NULL,
	"sender_name" text,
	"tg_chat_id" bigint,
	"comment" text,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"reject_reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contractor_sent_files_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "contractor_sent_files_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "contractor_sent_files_source_check" CHECK ("contractor_sent_files"."source" in ('page', 'telegram')),
	CONSTRAINT "contractor_sent_files_tg_check" CHECK (("contractor_sent_files"."source" = 'telegram') = ("contractor_sent_files"."tg_chat_id" is not null) and char_length(coalesce("contractor_sent_files"."sender_name", '')) <= 64),
	CONSTRAINT "contractor_sent_files_comment_check" CHECK (char_length(coalesce("contractor_sent_files"."comment", '')) <= 300),
	CONSTRAINT "contractor_sent_files_name_check" CHECK (char_length("contractor_sent_files"."name") between 1 and 255),
	CONSTRAINT "contractor_sent_files_size_check" CHECK ("contractor_sent_files"."size_bytes" between 0 and 20971520),
	CONSTRAINT "contractor_sent_files_key_check" CHECK ("contractor_sent_files"."storage_key" = ('org/' || "contractor_sent_files"."org_id"::text || '/sent/' || "contractor_sent_files"."id"::text)),
	CONSTRAINT "contractor_sent_files_state_check" CHECK ("contractor_sent_files"."state" in ('pending', 'ready')),
	CONSTRAINT "contractor_sent_files_status_check" CHECK ("contractor_sent_files"."status" in ('new', 'accepted', 'rejected') and ("contractor_sent_files"."status" = 'new' or "contractor_sent_files"."state" = 'ready')),
	CONSTRAINT "contractor_sent_files_reason_check" CHECK (("contractor_sent_files"."status" = 'rejected') = ("contractor_sent_files"."reject_reason" is not null) and ("contractor_sent_files"."reject_reason" is null or char_length("contractor_sent_files"."reject_reason") between 1 and 300)),
	CONSTRAINT "contractor_sent_files_decided_check" CHECK (("contractor_sent_files"."status" = 'new') = ("contractor_sent_files"."decided_at" is null) and ("contractor_sent_files"."decided_at" is null) = ("contractor_sent_files"."decided_by" is null)),
	CONSTRAINT "contractor_sent_files_accepted_check" CHECK (("contractor_sent_files"."status" = 'accepted') = ("contractor_sent_files"."file_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "contractor_sent_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" DROP CONSTRAINT "contractor_telegram_messages_kind_check";--> statement-breakpoint
ALTER TABLE "telegram_outbox" DROP CONSTRAINT "telegram_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "contractors" ALTER COLUMN "fee_day" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "legal_form" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "okpo" text;--> statement-breakpoint
ALTER TABLE "platform_leads" ADD COLUMN "legal_form" text;--> statement-breakpoint
ALTER TABLE "platform_leads" ADD COLUMN "inn" text;--> statement-breakpoint
ALTER TABLE "platform_leads" ADD COLUMN "okpo" text;--> statement-breakpoint
ALTER TABLE "platform_leads" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "platform_leads" ADD COLUMN "head" text;--> statement-breakpoint
ALTER TABLE "platform_leads" ADD COLUMN "docs_state" text;--> statement-breakpoint
ALTER TABLE "platform_leads" ADD COLUMN "docs_purge_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_leads" ADD COLUMN "tg_chat_id" bigint;--> statement-breakpoint
ALTER TABLE "platform_leads" ADD COLUMN "tg_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contractor_pages" ADD COLUMN "files_upload" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" ADD COLUMN "day" date;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "cp_files_upload" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_lead_docs" ADD CONSTRAINT "platform_lead_docs_lead_id_platform_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."platform_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_lead_tg_tokens" ADD CONSTRAINT "platform_lead_tg_tokens_lead_id_platform_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."platform_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_pay_claims" ADD CONSTRAINT "contractor_pay_claims_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_pay_claims" ADD CONSTRAINT "contractor_pay_claims_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Уникальный ключ — до составной ссылки «Я оплатил» на сообщение.
CREATE UNIQUE INDEX "contractor_telegram_messages_scope_key" ON "contractor_telegram_messages" USING btree ("id","org_id","contractor_id");--> statement-breakpoint
ALTER TABLE "contractor_pay_claims" ADD CONSTRAINT "contractor_pay_claims_message_fk" FOREIGN KEY ("tg_message_id","org_id","contractor_id") REFERENCES "public"."contractor_telegram_messages"("id","org_id","contractor_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_pay_claims" ADD CONSTRAINT "contractor_pay_claims_decided_by_fk" FOREIGN KEY ("decided_by","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_setup_tokens" ADD CONSTRAINT "password_setup_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_setup_tokens" ADD CONSTRAINT "password_setup_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_setup_tokens" ADD CONSTRAINT "password_setup_tokens_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_telegram_notices" ADD CONSTRAINT "org_telegram_notices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_telegram_notices" ADD CONSTRAINT "org_telegram_notices_updated_by_fk" FOREIGN KEY ("updated_by","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_sent_files" ADD CONSTRAINT "contractor_sent_files_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_sent_files" ADD CONSTRAINT "contractor_sent_files_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_sent_files" ADD CONSTRAINT "contractor_sent_files_decided_by_fk" FOREIGN KEY ("decided_by","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_sent_files" ADD CONSTRAINT "contractor_sent_files_file_fk" FOREIGN KEY ("file_id","org_id") REFERENCES "public"."files"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_lead_tg_tokens_lead_idx" ON "platform_lead_tg_tokens" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "platform_lead_tg_tokens_expires_idx" ON "platform_lead_tg_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "contractor_pay_claims_contractor_idx" ON "contractor_pay_claims" USING btree ("org_id","contractor_id","created_at");--> statement-breakpoint
CREATE INDEX "contractor_pay_claims_wait_idx" ON "contractor_pay_claims" USING btree ("org_id","contractor_id","month") WHERE "contractor_pay_claims"."status" = 'wait';--> statement-breakpoint
CREATE INDEX "contractor_pay_claims_file_idx" ON "contractor_pay_claims" USING btree ("sent_file_id") WHERE "contractor_pay_claims"."sent_file_id" is not null;--> statement-breakpoint
CREATE INDEX "password_setup_tokens_user_idx" ON "password_setup_tokens" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "password_setup_tokens_expires_idx" ON "password_setup_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "contractor_sent_files_contractor_idx" ON "contractor_sent_files" USING btree ("org_id","contractor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contractor_sent_files_purge_idx" ON "contractor_sent_files" USING btree ("org_id","created_at") WHERE "contractor_sent_files"."status" <> 'accepted';--> statement-breakpoint
CREATE INDEX "platform_leads_docs_purge_idx" ON "platform_leads" USING btree ("docs_purge_at") WHERE "platform_leads"."docs_purge_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contractor_telegram_messages_fee_key" ON "contractor_telegram_messages" USING btree ("link_id","day") WHERE "contractor_telegram_messages"."kind" = 'fee';--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_legal_form_check" CHECK ("organizations"."legal_form" is null or "organizations"."legal_form" in ('osoo', 'ip'));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_okpo_check" CHECK ("organizations"."okpo" is null or "organizations"."okpo" ~ '^[0-9]{8}$');--> statement-breakpoint
ALTER TABLE "platform_leads" ADD CONSTRAINT "platform_leads_legal_form_check" CHECK ("platform_leads"."legal_form" is null or "platform_leads"."legal_form" in ('osoo', 'ip'));--> statement-breakpoint
ALTER TABLE "platform_leads" ADD CONSTRAINT "platform_leads_inn_check" CHECK ("platform_leads"."inn" is null or "platform_leads"."inn" ~ '^[0-9]{14}$');--> statement-breakpoint
ALTER TABLE "platform_leads" ADD CONSTRAINT "platform_leads_okpo_check" CHECK ("platform_leads"."okpo" is null or "platform_leads"."okpo" ~ '^[0-9]{8}$');--> statement-breakpoint
ALTER TABLE "platform_leads" ADD CONSTRAINT "platform_leads_doc_fields_check" CHECK (char_length(coalesce("platform_leads"."address", '')) <= 300 and char_length(coalesce("platform_leads"."head", '')) <= 200);--> statement-breakpoint
ALTER TABLE "platform_leads" ADD CONSTRAINT "platform_leads_docs_state_check" CHECK ("platform_leads"."docs_state" is null or ("platform_leads"."docs_state" in ('pending', 'ready') and "platform_leads"."legal_form" is not null));--> statement-breakpoint
ALTER TABLE "platform_leads" ADD CONSTRAINT "platform_leads_tg_check" CHECK (("platform_leads"."tg_chat_id" is null) = ("platform_leads"."tg_linked_at" is null) and ("platform_leads"."tg_chat_id" is null or "platform_leads"."tg_chat_id" > 0));--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" ADD CONSTRAINT "contractor_telegram_messages_fee_check" CHECK ("contractor_telegram_messages"."kind" <> 'fee' or ("contractor_telegram_messages"."day" is not null and "contractor_telegram_messages"."total" is not null and "contractor_telegram_messages"."total" > 0));--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" ADD CONSTRAINT "contractor_telegram_messages_kind_check" CHECK ("contractor_telegram_messages"."kind" in ('pay', 'ask', 'debt', 'fee'));--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_kind_check" CHECK ("telegram_outbox"."kind" in ('reminders', 'task_new', 'task_on_confirm', 'task_confirmed', 'task_rework', 'task_cancelled', 'report_fix', 'code', 'linked', 'relinked', 'unlinked', 'pass_changed', 'pass_reset', 'broadcast', 'lead', 'login_locked', 'alert', 'relink_code', 'page_closed', 'bot_test', 'cp_tg_request', 'task_started', 'task_done', 'bot_ask', 'nudge', 'not_me', 'bot_cmd', 'group', 'cp_pay_noreq', 'cp_file'));--> statement-breakpoint
CREATE POLICY "contractor_pay_claims_isolation" ON "contractor_pay_claims" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("contractor_pay_claims"."org_id" = app.current_org_id()) WITH CHECK ("contractor_pay_claims"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "contractor_pay_claims_insert_guard" ON "contractor_pay_claims" AS RESTRICTIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("contractor_pay_claims"."status" = 'wait');--> statement-breakpoint
CREATE POLICY "org_telegram_notices_isolation" ON "org_telegram_notices" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("org_telegram_notices"."org_id" = app.current_org_id()) WITH CHECK ("org_telegram_notices"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "contractor_sent_files_isolation" ON "contractor_sent_files" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("contractor_sent_files"."org_id" = app.current_org_id()) WITH CHECK ("contractor_sent_files"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "contractor_sent_files_insert_guard" ON "contractor_sent_files" AS RESTRICTIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("contractor_sent_files"."state" = 'pending' and "contractor_sent_files"."status" = 'new');--> statement-breakpoint
CREATE POLICY "contractor_sent_files_update_guard" ON "contractor_sent_files" AS RESTRICTIVE FOR UPDATE TO "buhuchet_app" USING ("contractor_sent_files"."status" <> 'accepted') WITH CHECK ("contractor_sent_files"."status" = 'new' or "contractor_sent_files"."decided_by" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "contractor_sent_files_delete_guard" ON "contractor_sent_files" AS RESTRICTIVE FOR DELETE TO "buhuchet_app" USING ("contractor_sent_files"."status" <> 'accepted');
--> statement-breakpoint
-- Ручная часть миграции (общая основа пакета доработок 14.11.2026, этап 0): права роли приложения,
-- ключ, которого Drizzle не умеет, и удаление тем в чате с ботом.
--
-- «ОКПО» меняет владелец в «Моя организация» → «Основное»; «Форму», как и ИНН, — только администратор
-- платформы (функциями Админки), поэтому права на столбец legal_form у роли приложения нет.
GRANT UPDATE (okpo) ON TABLE public.organizations TO buhuchet_app;--> statement-breakpoint
-- «Контрагент может отправлять файлы» у контрагента — сотрудник в блоке «Страница контрагента».
GRANT UPDATE (files_upload) ON TABLE public.contractor_pages TO buhuchet_app;--> statement-breakpoint
-- Отправленные файлы: роль приложения меняет только загрузку и решение по файлу (политики — в схеме:
-- вставка только начатой новой загрузки, принятый не меняется и не удаляется).
REVOKE UPDATE ON TABLE public.contractor_sent_files FROM buhuchet_app;--> statement-breakpoint
GRANT UPDATE (state, status, reject_reason, decided_by, decided_at, file_id, updated_at, version)
  ON TABLE public.contractor_sent_files TO buhuchet_app;--> statement-breakpoint
-- «Я оплатил»: роль приложения меняет только решение и не удаляет (строки стираются только вместе с
-- контрагентом).
REVOKE UPDATE, DELETE ON TABLE public.contractor_pay_claims FROM buhuchet_app;--> statement-breakpoint
GRANT UPDATE (status, decided_by, decided_at, updated_at, version)
  ON TABLE public.contractor_pay_claims TO buhuchet_app;--> statement-breakpoint
-- Чек «Я оплатил» — отправленный файл своей организации; непринятый чек через 30 дней удаляется, а
-- сообщение об оплате остаётся без чека (Drizzle не умеет SET NULL части составного ключа).
ALTER TABLE public.contractor_pay_claims ADD CONSTRAINT contractor_pay_claims_sent_file_fk
  FOREIGN KEY (sent_file_id, org_id)
  REFERENCES public.contractor_sent_files (id, org_id) ON DELETE SET NULL (sent_file_id);--> statement-breakpoint
-- Документы и Telegram заявки, ссылки «задать пароль»: роль приложения таблиц не видит и не меняет
-- (RLS без политик и без прав); работают с ними только функции базы задач блока 1.
REVOKE ALL ON TABLE public.platform_lead_docs, public.platform_lead_tg_tokens, public.password_setup_tokens
  FROM buhuchet_app;--> statement-breakpoint
-- Темы в чате с ботом убраны (решение заказчика 14.11.2026; docs/decisions.md п. Т-10): код их не
-- читает и не пишет с PR #251 (выпуск 14.11.2026), здесь удаляются функции, таблица и настройка бота
-- платформы `topics` (правило двух PR).
DROP FUNCTION app.telegram_topic_thread(bigint, text);--> statement-breakpoint
DROP FUNCTION app.telegram_topic_key(bigint, integer);--> statement-breakpoint
DROP FUNCTION app.telegram_topic_save(bigint, text, integer);--> statement-breakpoint
DROP FUNCTION app.telegram_topic_forget(bigint, text, integer);--> statement-breakpoint
DROP FUNCTION app.admin_set_telegram_topics(boolean);--> statement-breakpoint
DROP TABLE public.telegram_topics;--> statement-breakpoint
UPDATE public.platform_reference
  SET payload = payload - 'topics',
      checksum = encode(sha256(convert_to((payload - 'topics')::text, 'UTF8')), 'hex'),
      version = version + 1,
      updated_at = now()
  WHERE key = 'telegramBot' AND payload ? 'topics';
