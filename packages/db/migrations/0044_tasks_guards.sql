-- «Категории задач» (миграция 0043) роль приложения только читает, как остальные справочники платформы
-- (0023, 0028, 0035): права на запись по умолчанию (0000) у неё забираются. Правку из Админки (поток Д)
-- сделает узкая функция для администратора платформы.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE task_categories FROM buhuchet_app;
--> statement-breakpoint
-- Задачи не удаляются — их отменяют (ТЗ «Отменена» ставит постановщик или владелец); вместе с
-- контрагентом их удаляет каскад внешнего ключа. Организацию, постановщика и автора записи после
-- вставки не меняет никто, кроме миграций: UPDATE — только на изменяемые столбцы. TRUNCATE обходит
-- политики RLS — его у роли приложения нет.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE tasks FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (
  title, description, category_code, contractor_id, executor_employee_id, term, due_date, need_file,
  confirm, status, done_at, fail_reason, rework_reason, rework_by_employee_id,
  confirmed_by_employee_id, confirmed_at, confirm_note, updated_by, updated_at, version
) ON TABLE tasks TO buhuchet_app;
--> statement-breakpoint
-- Задачу ставит сотрудник от своего имени: постановщик — сотрудник текущего пользователя, автор записи —
-- он же (ТЗ «Ставить задачи могут только старшие» проверяет API, подменить постановщика не даёт база).
CREATE POLICY tasks_insert_own ON tasks AS RESTRICTIVE FOR INSERT TO buhuchet_app
  WITH CHECK (
    created_by = app.current_user_id()
    AND author_employee_id IN (SELECT e.id FROM employees e WHERE e.user_id = app.current_user_id())
  );
--> statement-breakpoint
-- Комментарии не меняются и не удаляются (вместе с задачей их удаляет каскад).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE task_comments FROM buhuchet_app;
