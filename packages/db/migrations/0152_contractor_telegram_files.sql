-- Файл без просьбы бота из чата нескольких контрагентов (доработки 14.11.2026, блок 2, пункт 1, этап 2,
-- поток К): строка вида `file` ждёт ответа «От какой компании?».
ALTER TABLE "contractor_telegram_messages" DROP CONSTRAINT "contractor_telegram_messages_kind_check";--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" ADD CONSTRAINT "contractor_telegram_messages_kind_check" CHECK ("contractor_telegram_messages"."kind" in ('pay', 'ask', 'debt', 'fee', 'receipt', 'file'));