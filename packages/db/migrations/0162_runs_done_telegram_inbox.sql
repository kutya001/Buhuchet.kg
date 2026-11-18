-- Админка → «Запуски» и переписка бота в обе стороны (решение заказчика 17.11.2026; прототип v132;
-- docs/decisions.md п. Т-15, Т-16): полученные сообщения telegram_inbox, итог запуска scheduler_runs.done
-- и прежние попытки scheduler_runs.prev, индексы журнала. Функции, права и представление — следующей миграцией.
-- Блокировки таблиц ждём не дольше 10 с (docs/decisions.md п. О-54, О-57): если выпуск совпал с долгой
-- транзакцией, миграция падает и задание выпуска перезапускают, а не держит задачи расписания, пользователей
-- и очередь Telegram, пока ждёт. После `pnpm db:generate` строку вернуть руками.
SET LOCAL lock_timeout = '10s';--> statement-breakpoint
CREATE TABLE "telegram_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"update_id" bigint,
	"chat_id" bigint NOT NULL,
	"chat_kind" text NOT NULL,
	"org_id" uuid,
	"user_id" uuid,
	"contractor_id" uuid,
	"sender" text,
	"kind" text NOT NULL,
	"text" text,
	"hide" text,
	"button" text,
	"reply_message_id" bigint,
	"file_name" text,
	"file_size" bigint,
	"status" text DEFAULT 'new' NOT NULL,
	"error" text,
	CONSTRAINT "telegram_inbox_update_key" UNIQUE("update_id"),
	CONSTRAINT "telegram_inbox_kind_check" CHECK ("telegram_inbox"."kind" in ('press', 'command', 'text', 'file', 'code', 'link', 'joined', 'left')),
	CONSTRAINT "telegram_inbox_status_check" CHECK ("telegram_inbox"."status" in ('new', 'done', 'unknown', 'error')),
	CONSTRAINT "telegram_inbox_chat_kind_check" CHECK ("telegram_inbox"."chat_kind" in ('private', 'client', 'group')),
	CONSTRAINT "telegram_inbox_hide_check" CHECK ("telegram_inbox"."hide" is null or ("telegram_inbox"."hide" in ('code', 'link') and "telegram_inbox"."text" is null)),
	CONSTRAINT "telegram_inbox_secret_check" CHECK ("telegram_inbox"."kind" not in ('code', 'link') or ("telegram_inbox"."hide" is not null and "telegram_inbox"."text" is null)),
	CONSTRAINT "telegram_inbox_size_check" CHECK (char_length(coalesce("text", '')) <= 4096 and char_length(coalesce("sender", '')) <= 100 and char_length(coalesce("error", '')) <= 300 and char_length(coalesce("file_name", '')) <= 200 and char_length(coalesce("button", '')) <= 64),
	CONSTRAINT "telegram_inbox_file_size_check" CHECK ("telegram_inbox"."file_size" is null or "telegram_inbox"."file_size" >= 0)
);
--> statement-breakpoint
ALTER TABLE "telegram_inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_inbox" ADD CONSTRAINT "telegram_inbox_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_inbox" ADD CONSTRAINT "telegram_inbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_inbox_created_idx" ON "telegram_inbox" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "telegram_inbox_chat_idx" ON "telegram_inbox" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "telegram_outbox_created_idx" ON "telegram_outbox" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "telegram_outbox_chat_created_idx" ON "telegram_outbox" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE POLICY "telegram_inbox_isolation" ON "telegram_inbox" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("telegram_inbox"."org_id" = app.current_org_id()) WITH CHECK ("telegram_inbox"."org_id" = app.current_org_id());--> statement-breakpoint
-- Правки scheduler_runs — последними: его блокировка (ACCESS EXCLUSIVE) держится до конца транзакции, и
-- пока миграция ждёт другие таблицы и строит индексы, задачи расписания не стоят. Столбцы добавляются без
-- перезаписи таблицы; две проверки — два прохода по журналу за 30 дней (до ~0,5 млн строк, доли секунды).
ALTER TABLE "scheduler_runs" ADD COLUMN "done" integer;--> statement-breakpoint
ALTER TABLE "scheduler_runs" ADD COLUMN "prev" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "scheduler_runs_started_idx" ON "scheduler_runs" USING btree ("started_at");--> statement-breakpoint
ALTER TABLE "scheduler_runs" ADD CONSTRAINT "scheduler_runs_done_check" CHECK ("scheduler_runs"."done" is null or "scheduler_runs"."done" >= 0);--> statement-breakpoint
ALTER TABLE "scheduler_runs" ADD CONSTRAINT "scheduler_runs_prev_check" CHECK (jsonb_typeof("scheduler_runs"."prev") = 'array');
