import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { employeeAccountHandler, employeeAccountRoute } from './account';
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
 * «Напомнить в WhatsApp» о налоге. Журнал операций и закрытие месяца — задача 2.22.
 */
export function financeModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(writeOffRoute, writeOffHandler(deps))
    .openapi(transferFormRoute, transferFormHandler(deps))
    .openapi(transferRoute, transferHandler(deps))
    .openapi(operationRoute, operationHandler(deps))
    .openapi(deleteOperationRoute, deleteOperationHandler(deps))
    .openapi(correctionRoute, correctionHandler(deps))
    .openapi(employeeAccountRoute, employeeAccountHandler(deps))
    .openapi(taxReminderRoute, taxReminderHandler(deps))
    .openapi(taxReminderSentRoute, taxReminderSentHandler(deps));
}
