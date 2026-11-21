-- Проверка шаблонов «Витрины данных» системой (доработки 20.11.2026: Витрина данных, блок 8, пункт 7;
-- общий план 20.11, этап 2, П4): строка истории без автора — «Система»; у запроса шаблона — когда его
-- последний раз проверила система и при каком числе применённых миграций. Функции — миграция 0173.
ALTER TABLE "platform_audit_log" ALTER COLUMN "actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dm_template_sql" ADD COLUMN "auto_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dm_template_sql" ADD COLUMN "auto_checked_schema" integer;