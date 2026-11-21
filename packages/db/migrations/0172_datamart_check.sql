-- Проверка шаблонов «Витрины данных» системой (доработки 20.11.2026: Витрина данных, блок 8, пункт 7;
-- общий план 20.11, этап 2, П4): строка истории без автора — «Система»; у запроса шаблона — когда его
-- последний раз проверила система и при каком числе применённых миграций. Функции — миграция 0173.
-- Предел ожидания блокировки — 3 с (как с 0162; после `pnpm db:generate` строки SET LOCAL вернуть руками):
-- ALTER TABLE platform_audit_log не ждёт долгую транзакцию бесконечно, задерживая за собой всю историю
-- платформы, — выпуск падает и повторяется.
-- Откат: столбцы — DROP COLUMN (теряются только отметки проверки, задача их восстановит); NOT NULL у
-- actor_user_id после первой строки «Система» (app.dm_check_mark) не вернуть: такие строки истории не
-- удаляются и не переписываются на чужое имя.
SET LOCAL lock_timeout = '3s';--> statement-breakpoint
ALTER TABLE "platform_audit_log" ALTER COLUMN "actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dm_template_sql" ADD COLUMN "auto_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dm_template_sql" ADD COLUMN "auto_checked_schema" integer;--> statement-breakpoint
SET LOCAL lock_timeout TO DEFAULT;
