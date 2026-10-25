-- Список всех организаций для задач по расписанию: задача обходит организации по одной и для каждой
-- открывает транзакцию withOrgContext. Роль приложения сама видит только организацию из контекста,
-- поэтому функция работает от владельца схемы (SECURITY DEFINER) и отдаёт только номера организаций.
CREATE OR REPLACE FUNCTION app.org_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$ SELECT id FROM public.organizations ORDER BY id $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.org_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.org_ids() TO buhuchet_app;
