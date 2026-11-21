-- Поток Т, общий план 20.11, этап 3, П5 (docs/decisions.md п. Т-21): новый вид очереди Telegram `dm_token` —
-- владельцам организации «API-токен создан», «отозван», «до конца срока 7 дней» (Витрина данных, блок 5,
-- пункт 10). Проверка видов проходит всю `telegram_outbox` под ACCESS EXCLUSIVE: у пилота — до 100 тыс. строк,
-- десятые доли секунды. Блокировки ждём не дольше 3 с, как в 0169: если выпуск совпал с долгой транзакцией,
-- миграция падает и задание выпуска перезапускают. После `pnpm db:generate` строку вернуть руками.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
ALTER TABLE "telegram_outbox" DROP CONSTRAINT "telegram_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_kind_check" CHECK ("telegram_outbox"."kind" in ('reminders', 'task_new', 'task_on_confirm', 'task_confirmed', 'task_rework', 'task_cancelled', 'report_fix', 'code', 'linked', 'relinked', 'unlinked', 'pass_changed', 'pass_reset', 'broadcast', 'lead', 'login_locked', 'alert', 'relink_code', 'page_closed', 'bot_test', 'cp_tg_request', 'task_started', 'task_done', 'bot_ask', 'nudge', 'not_me', 'bot_cmd', 'group', 'cp_file', 'setup_link', 'sub', 'sub_check', 'storage_check', 'dm_token'));