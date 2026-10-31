-- Деньги по отчётам (задача 2.19): операция не удаляется — отмена оплаты помечает её отменённой с
-- причиной. Вид, сумма, дата, контрагент, отчёт и автор после вставки не меняет никто, кроме миграций;
-- роль приложения меняет только отмену, счёт (смена «Деньги на налоги переводит»), комментарий и
-- служебные поля правки. Детализация поступления только добавляется. TRUNCATE обходит политики RLS —
-- его у роли приложения нет.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE money_operations FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (holder_kind, holder_employee_id, note, cancelled_at, cancelled_by, cancel_reason, updated_by, updated_at, version)
  ON TABLE money_operations TO buhuchet_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE money_allocations FROM buhuchet_app;
