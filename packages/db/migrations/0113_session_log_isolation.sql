-- Журнал сеансов: прав на таблицу у роли приложения нет (0112); политика изоляции — вторая преграда,
-- как у каждой таблицы со столбцом org_id.
CREATE POLICY "session_log_isolation" ON "session_log" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("session_log"."org_id" = app.current_org_id()) WITH CHECK ("session_log"."org_id" = app.current_org_id());