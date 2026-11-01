-- Оплаты по проекту — транши (задача 2.26, часть 2): запись не стирается — «Удалить» ставит отметку с
-- автором, временем и причиной. Роль приложения меняет только поля окна транша, отметку «Изменён»,
-- отметку удаления и служебные столбцы; проект и автор после вставки не меняются. TRUNCATE обходит
-- политики RLS — его у роли приложения нет.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE project_payments FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (amount, paid_on, note, edited, deleted_at, deleted_by, delete_reason, updated_by,
  updated_at, version)
  ON TABLE project_payments TO buhuchet_app;
