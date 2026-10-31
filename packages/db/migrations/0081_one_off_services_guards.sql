-- Разовые услуги и их оплаты (задача 2.22): запись не стирается — «Удалить» ставит отметку с автором,
-- временем и причиной. Роль приложения меняет только поля окна услуги и оплаты, отметку «Изменена»,
-- отметку удаления и служебные столбцы; контрагент, услуга оплаты и автор после вставки не меняются.
-- TRUNCATE обходит политики RLS — его у роли приложения нет.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE one_off_services FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (name, service_date, amount, performer_employee_id, description, edited, deleted_at,
  deleted_by, delete_reason, updated_by, updated_at, version)
  ON TABLE one_off_services TO buhuchet_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE one_off_service_payments FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (amount, paid_on, note, edited, deleted_at, deleted_by, delete_reason, updated_by,
  updated_at, version)
  ON TABLE one_off_service_payments TO buhuchet_app;
