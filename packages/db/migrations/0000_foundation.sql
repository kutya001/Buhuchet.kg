-- Фундамент: расширения обычного PostgreSQL, схема app с функциями контекста RLS, групповая роль приложения.
-- Работает на любом PostgreSQL 16+ (локально, в CI, в Supabase, на VPS).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
-- Текущая организация и пользователь транзакции: задаёт API (`withOrgContext`), читают политики RLS.
CREATE OR REPLACE FUNCTION app.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
-- Групповая роль приложения: без входа и без обхода RLS. Роль входа из DATABASE_URL получает членство
-- в ней при `pnpm db:migrate` (ensureAppLoginRole).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buhuchet_app') THEN
    CREATE ROLE buhuchet_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO buhuchet_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO buhuchet_app;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO buhuchet_app;
--> statement-breakpoint
-- Права на таблицы и последовательности, которые создадут следующие миграции (от имени владельца схемы).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO buhuchet_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO buhuchet_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO buhuchet_app;
