import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  addTariffHandler,
  addTariffRoute,
  contractorFeesHandler,
  contractorFeesRoute,
  createFeePaymentHandler,
  createFeePaymentRoute,
  feePaymentFormHandler,
  feePaymentFormRoute,
  feeReminderHandler,
  feeReminderRoute,
  feeReminderSentHandler,
  feeReminderSentRoute,
} from './fees';

/**
 * Модуль «Плата за обслуживание» (поток В, задача 2.21): вкладка «Обслуживание» карточки контрагента,
 * журнал тарифов, «Принять оплату за обслуживание», напоминание о долге в WhatsApp. Долг и «Должники» в
 * списке контрагентов — модуль «Контрагенты», часть за обслуживание в поступлении — модуль «Деньги».
 */
export function feesModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(contractorFeesRoute, contractorFeesHandler(deps))
    .openapi(addTariffRoute, addTariffHandler(deps))
    .openapi(feePaymentFormRoute, feePaymentFormHandler(deps))
    .openapi(createFeePaymentRoute, createFeePaymentHandler(deps))
    .openapi(feeReminderRoute, feeReminderHandler(deps))
    .openapi(feeReminderSentRoute, feeReminderSentHandler(deps));
}
