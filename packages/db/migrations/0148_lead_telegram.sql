-- Доработки 14.11.2026, блок 1 (поток Т; прототип v113 modules/tg-lead.js): Telegram заявителя до
-- создания организации. У заявки — имя из Telegram подключившего (после «Одобрить» переходит в привязку
-- Telegram владельца) и отметка, какую причину отказа бот уже прислал заявителю; в истории заявки — запись
-- «Telegram подключён» (вид tg); вид очереди setup_link — «Организация создана» и «Задать пароль» с
-- одноразовой ссылкой: как код, без текста и кнопок в журнале. Функции — в 0149.
ALTER TABLE "platform_lead_events" DROP CONSTRAINT "platform_lead_events_kind_check";--> statement-breakpoint
ALTER TABLE "telegram_outbox" DROP CONSTRAINT "telegram_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "telegram_outbox" DROP CONSTRAINT "telegram_outbox_code_text_check";--> statement-breakpoint
ALTER TABLE "telegram_outbox" DROP CONSTRAINT "telegram_outbox_code_payload_check";--> statement-breakpoint
ALTER TABLE "platform_leads" ADD COLUMN "tg_username" text;--> statement-breakpoint
ALTER TABLE "platform_leads" ADD COLUMN "tg_first_name" text;--> statement-breakpoint
ALTER TABLE "platform_leads" ADD COLUMN "tg_refusal_event" bigint;--> statement-breakpoint
ALTER TABLE "platform_lead_events" ADD CONSTRAINT "platform_lead_events_kind_check" CHECK ("platform_lead_events"."kind" in ('created', 'repeat', 'status', 'rollback', 'note', 'org', 'tg'));--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_kind_check" CHECK ("telegram_outbox"."kind" in ('reminders', 'task_new', 'task_on_confirm', 'task_confirmed', 'task_rework', 'task_cancelled', 'report_fix', 'code', 'linked', 'relinked', 'unlinked', 'pass_changed', 'pass_reset', 'broadcast', 'lead', 'login_locked', 'alert', 'relink_code', 'page_closed', 'bot_test', 'cp_tg_request', 'task_started', 'task_done', 'bot_ask', 'nudge', 'not_me', 'bot_cmd', 'group', 'cp_file', 'setup_link'));--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_code_text_check" CHECK ("telegram_outbox"."kind" not in ('code', 'relink_code', 'setup_link') or "telegram_outbox"."text" is null);--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_code_payload_check" CHECK ("telegram_outbox"."kind" not in ('code', 'relink_code', 'setup_link') or "telegram_outbox"."payload" is null);