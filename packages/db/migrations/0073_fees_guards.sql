-- Плата за обслуживание (задача 2.21): оплата и её распределение по месяцам после записи не меняются и
-- не удаляются ролью приложения — исправление и удаление ошибочной оплаты с причиной добавит окно оплаты
-- в «Финансовых операциях» (задача 2.22). TRUNCATE обходит политики RLS — его у роли приложения нет.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE fee_payments FROM buhuchet_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE fee_allocations FROM buhuchet_app;
