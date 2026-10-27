-- «Попросить добавить» (ТЗ «Справочники платформы — только просмотр»): организация только создаёт
-- запрос и видит свои; ответ ставит администратор платформы (Админка, задача 2.36). Поэтому у роли
-- приложения нет UPDATE и DELETE — запрос после отправки организация не меняет и не удаляет.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE dict_change_requests FROM buhuchet_app;
--> statement-breakpoint
-- Плашка «Запросы на добавление» в Админке → «Организации» (прототип renderOrgs): запросов всех
-- организаций. Под RLS их не видно, у администратора организации нет — счёт только для
-- администратора платформы.
CREATE OR REPLACE FUNCTION app.admin_dict_requests() RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT count(*)::integer FROM public.dict_change_requests r
    WHERE app.is_platform_admin()
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_dict_requests() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_dict_requests() TO buhuchet_app;
