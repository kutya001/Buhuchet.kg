-- Проекты контрагентов (задача 2.26): проект не удаляется (в прототипе удаления нет — «Отменить
-- проект»). Роль приложения меняет только поля окна проекта, статус и служебные столбцы; контрагент и
-- автор записи после вставки не меняются. TRUNCATE обходит политики RLS — его у роли приложения нет.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE projects FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (name, starts_on, ends_on, description, plan, status, lead_employee_id, updated_by,
  updated_at, version)
  ON TABLE projects TO buhuchet_app;
--> statement-breakpoint
-- Ответственные меняются в «Изменить проект»: строки удаляются и добавляются, сами не меняются.
REVOKE UPDATE, TRUNCATE ON TABLE project_members FROM buhuchet_app;
--> statement-breakpoint
-- Работа: меняются название, исполнитель, срок, «сделано» и порядок; проект и автор — нет. Удалить
-- можно только несделанную (политика project_works_delete_open).
REVOKE UPDATE, TRUNCATE ON TABLE project_works FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (name, executor_employee_id, due_date, done, position, updated_by, updated_at)
  ON TABLE project_works TO buhuchet_app;
--> statement-breakpoint
-- Задача по проекту (поле «Проект» формы задачи): проект — изменяемое поле задачи.
GRANT UPDATE (project_id) ON TABLE tasks TO buhuchet_app;
