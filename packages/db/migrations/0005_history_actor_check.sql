-- Автор записи истории — пользователь этой же организации или администратор платформы (он создаёт
-- организации и управляет ими). Роль приложения видит только пользователей своей организации (RLS),
-- поэтому проверка работает от владельца схемы (SECURITY DEFINER) и отвечает только «да» или «нет».
-- Её вызывает ограничивающая политика вставки в audit_log (следующая миграция).
CREATE OR REPLACE FUNCTION app.history_actor_allowed(actor uuid, org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT actor IS NULL OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = actor AND (u.org_id = org OR u.is_platform_admin)
    )
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.history_actor_allowed(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.history_actor_allowed(uuid, uuid) TO buhuchet_app;
