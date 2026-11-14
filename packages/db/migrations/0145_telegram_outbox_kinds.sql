-- Общая сборка доработок 13.11: виды сообщений очереди Telegram — объединение видов потока К
-- (cp_tg_request, миграция 0123) и потока Т (task_started … bot_cmd, group; миграции 0131–0143).
ALTER TABLE "telegram_outbox" DROP CONSTRAINT "telegram_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_kind_check" CHECK ("telegram_outbox"."kind" in ('reminders', 'task_new', 'task_on_confirm', 'task_confirmed', 'task_rework', 'task_cancelled', 'report_fix', 'code', 'linked', 'relinked', 'unlinked', 'pass_changed', 'pass_reset', 'broadcast', 'lead', 'login_locked', 'alert', 'relink_code', 'page_closed', 'bot_test', 'cp_tg_request', 'task_started', 'task_done', 'bot_ask', 'nudge', 'not_me', 'bot_cmd', 'group'));
