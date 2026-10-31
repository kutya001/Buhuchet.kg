import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  banksHandler,
  banksRoute,
  createOrgAccountHandler,
  createOrgAccountRoute,
  createWalletHandler,
  createWalletRoute,
  deleteOrgAccountHandler,
  deleteOrgAccountRoute,
  deleteWalletHandler,
  deleteWalletRoute,
  employeeWalletsHandler,
  employeeWalletsRoute,
  myWalletsHandler,
  myWalletsRoute,
  orgAccountsHandler,
  orgAccountsRoute,
  updateOrgAccountHandler,
  updateOrgAccountRoute,
  updateWalletHandler,
  updateWalletRoute,
} from './requisites';
import {
  cancelPaymentHandler,
  cancelPaymentRoute,
  contractorMoneyHandler,
  contractorMoneyRoute,
  createReceiptHandler,
  createReceiptRoute,
  moneySettingsHandler,
  moneySettingsRoute,
  payReportHandler,
  payReportRoute,
  receiptFormHandler,
  receiptFormRoute,
} from './tax';

/**
 * Модуль «Деньги» (поток В): справочник «Банковские провайдеры», счета организации для приёма денег
 * от контрагентов и реквизиты сотрудников для переводов (задача 2.18); поступления от контрагентов,
 * оплата налогов в бюджет, вкладка «Деньги» контрагента (задача 2.19).
 */
export function moneyModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(banksRoute, banksHandler(deps))
    .openapi(orgAccountsRoute, orgAccountsHandler(deps))
    .openapi(createOrgAccountRoute, createOrgAccountHandler(deps))
    .openapi(updateOrgAccountRoute, updateOrgAccountHandler(deps))
    .openapi(deleteOrgAccountRoute, deleteOrgAccountHandler(deps))
    .openapi(myWalletsRoute, myWalletsHandler(deps))
    .openapi(createWalletRoute, createWalletHandler(deps))
    .openapi(updateWalletRoute, updateWalletHandler(deps))
    .openapi(deleteWalletRoute, deleteWalletHandler(deps))
    .openapi(employeeWalletsRoute, employeeWalletsHandler(deps))
    .openapi(contractorMoneyRoute, contractorMoneyHandler(deps))
    .openapi(receiptFormRoute, receiptFormHandler(deps))
    .openapi(createReceiptRoute, createReceiptHandler(deps))
    .openapi(moneySettingsRoute, moneySettingsHandler(deps))
    .openapi(payReportRoute, payReportHandler(deps))
    .openapi(cancelPaymentRoute, cancelPaymentHandler(deps));
}
