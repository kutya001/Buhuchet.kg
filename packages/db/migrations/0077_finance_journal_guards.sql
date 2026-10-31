-- Окно финансовой операции (задача 2.22): «Изменить» меняет сумму, общую сумму поступления, дату и
-- отметку «Изменена» (счёт и примечание роль приложения меняет с миграции 0071). Вид, контрагент, отчёт,
-- «Оплатил контрагент сам», обратная запись и автор после вставки по-прежнему не меняются.
GRANT UPDATE (amount, total, op_date, edited) ON TABLE money_operations TO buhuchet_app;
--> statement-breakpoint
-- Детализацию поступления при его изменении заменяют: строки удаляются и вставляются заново.
GRANT DELETE ON TABLE money_allocations TO buhuchet_app;
--> statement-breakpoint
-- Оплата за обслуживание в окне оплаты: сумма, дата, куда поступили, примечание, отметка «Изменена» и
-- распределение по месяцам. Сама оплата не стирается: «Удалить» — отметка с причиной (миграция 0075);
-- стираются только части общего поступления, когда его изменяют (ограничивающая политика
-- fee_payments_delete_receipt_part, миграция 0076).
GRANT UPDATE (amount, paid_on, to_kind, to_account_id, to_label, note, edited)
  ON TABLE fee_payments TO buhuchet_app;
--> statement-breakpoint
GRANT DELETE ON TABLE fee_payments TO buhuchet_app;
--> statement-breakpoint
GRANT DELETE ON TABLE fee_allocations TO buhuchet_app;
--> statement-breakpoint
-- Закрытый месяц не открывается снова и не стирается. TRUNCATE обходит политики RLS — его у роли
-- приложения нет.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE closed_months FROM buhuchet_app;
