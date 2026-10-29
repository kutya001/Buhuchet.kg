-- «История загрузок» ввода показателей из Excel (миграция 0049) только пополняется: запись о загрузке
-- не меняется и не удаляется (TRUNCATE обходит политики RLS — его у роли приложения тоже нет).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE indicator_imports FROM buhuchet_app;
--> statement-breakpoint
-- Загрузку записывает сотрудник от своего имени: «Кто» — текущий пользователь, подменить его нельзя.
CREATE POLICY indicator_imports_insert_own ON indicator_imports AS RESTRICTIVE FOR INSERT TO buhuchet_app
  WITH CHECK (created_by = app.current_user_id());
