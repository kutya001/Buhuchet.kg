import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { employeeAccountHandler, employeeAccountRoute } from './account';
import {
  feePaymentDeleteHandler,
  feePaymentDeleteRoute,
  feePaymentEditFormHandler,
  feePaymentEditFormRoute,
  feePaymentEditHandler,
  feePaymentEditRoute,
  feePaymentWindowHandler,
  feePaymentWindowRoute,
  operationEditFormHandler,
  operationEditFormRoute,
  operationEditHandler,
  operationEditRoute,
  receiptEditFormHandler,
  receiptEditFormRoute,
  receiptEditHandler,
  receiptEditRoute,
} from './edit';
import {
  bonusExportHandler,
  bonusExportRoute,
  bonusListHandler,
  bonusListRoute,
  bonusValuesHandler,
  bonusValuesRoute,
  closedMonthsHandler,
  closedMonthsRoute,
  closeMonthHandler,
  closeMonthRoute,
  finJournalExportHandler,
  finJournalExportRoute,
  finJournalHandler,
  finJournalRoute,
  finJournalValuesHandler,
  finJournalValuesRoute,
  finSummaryHandler,
  finSummaryRoute,
  receiptJournalExportHandler,
  receiptJournalExportRoute,
  receiptJournalHandler,
  receiptJournalRoute,
  receiptJournalValuesHandler,
  receiptJournalValuesRoute,
} from './journal';
import {
  correctionHandler,
  correctionRoute,
  deleteOperationHandler,
  deleteOperationRoute,
  operationHandler,
  operationRoute,
  transferFormHandler,
  transferFormRoute,
  transferHandler,
  transferRoute,
  writeOffHandler,
  writeOffRoute,
} from './ops';
import {
  taxReminderHandler,
  taxReminderRoute,
  taxReminderSentHandler,
  taxReminderSentRoute,
} from './reminder';

/**
 * Модуль «Финансовые операции» (поток В, задача 2.20): «Списать в бонус» и «Вернуть остаток», перевод
 * на счёт сотрудника, окно операции с удалением и обратной записью, вкладка «Счёт» сотрудника,
 * «Напомнить в WhatsApp» о налоге. Задача 2.22: журнал операций с вкладками и плашками, «Журнал
 * поступлений», «Изменить» операций, окно оплаты за обслуживание, «Списания в бонус» и закрытие месяца.
 */
export function financeModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(finSummaryRoute, finSummaryHandler(deps))
    .openapi(finJournalRoute, finJournalHandler(deps))
    .openapi(finJournalValuesRoute, finJournalValuesHandler(deps))
    .openapi(finJournalExportRoute, finJournalExportHandler(deps))
    .openapi(receiptJournalRoute, receiptJournalHandler(deps))
    .openapi(receiptJournalValuesRoute, receiptJournalValuesHandler(deps))
    .openapi(receiptJournalExportRoute, receiptJournalExportHandler(deps))
    .openapi(writeOffRoute, writeOffHandler(deps))
    .openapi(transferFormRoute, transferFormHandler(deps))
    .openapi(transferRoute, transferHandler(deps))
    .openapi(operationRoute, operationHandler(deps))
    .openapi(deleteOperationRoute, deleteOperationHandler(deps))
    .openapi(operationEditFormRoute, operationEditFormHandler(deps))
    .openapi(operationEditRoute, operationEditHandler(deps))
    .openapi(receiptEditFormRoute, receiptEditFormHandler(deps))
    .openapi(receiptEditRoute, receiptEditHandler(deps))
    .openapi(feePaymentWindowRoute, feePaymentWindowHandler(deps))
    .openapi(feePaymentEditFormRoute, feePaymentEditFormHandler(deps))
    .openapi(feePaymentEditRoute, feePaymentEditHandler(deps))
    .openapi(feePaymentDeleteRoute, feePaymentDeleteHandler(deps))
    .openapi(correctionRoute, correctionHandler(deps))
    .openapi(employeeAccountRoute, employeeAccountHandler(deps))
    .openapi(bonusListRoute, bonusListHandler(deps))
    .openapi(bonusValuesRoute, bonusValuesHandler(deps))
    .openapi(bonusExportRoute, bonusExportHandler(deps))
    .openapi(closedMonthsRoute, closedMonthsHandler(deps))
    .openapi(closeMonthRoute, closeMonthHandler(deps))
    .openapi(taxReminderRoute, taxReminderHandler(deps))
    .openapi(taxReminderSentRoute, taxReminderSentHandler(deps));
}
