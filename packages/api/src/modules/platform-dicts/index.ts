import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  authoritiesHandler,
  authoritiesRoute,
  dueChangeReasonsHandler,
  dueChangeReasonsRoute,
  ownershipFormsHandler,
  ownershipFormsRoute,
  productionCalendarHandler,
  productionCalendarRoute,
  reportBasesHandler,
  reportBasesRoute,
  reportTypesHandler,
  reportTypesRoute,
  singleTaxRatesHandler,
  singleTaxRatesRoute,
  taxBenefitsHandler,
  taxBenefitsRoute,
  taxesHandler,
  taxesRoute,
  taxOfficesHandler,
  taxOfficesRoute,
  taxRegimesHandler,
  taxRegimesRoute,
} from './dicts';
import {
  adminDictDuesPreviewHandler,
  adminDictDuesPreviewRoute,
  adminDictGroupsHandler,
  adminDictGroupsRoute,
  adminDictHistoryHandler,
  adminDictHistoryRoute,
  adminDictValuesHandler,
  adminDictValuesRoute,
  createAdminDictValueHandler,
  createAdminDictValueRoute,
  deleteAdminDictValueHandler,
  deleteAdminDictValueRoute,
  exportAdminDictHandler,
  exportAdminDictRoute,
  getAdminDictValueHandler,
  getAdminDictValueRoute,
  listAdminDictHandler,
  listAdminDictRoute,
  moveAdminDictValueHandler,
  moveAdminDictValueRoute,
  pdictsTabCountsHandler,
  pdictsTabCountsRoute,
  reportTypeOptionsHandler,
  reportTypeOptionsRoute,
  setAdminDictActiveHandler,
  setAdminDictActiveRoute,
  updateAdminDictValueHandler,
  updateAdminDictValueRoute,
} from './admin';
import {
  adminDictRequestValuesHandler,
  adminDictRequestValuesRoute,
  answerDictRequestHandler,
  answerDictRequestRoute,
  exportAdminDictRequestsHandler,
  exportAdminDictRequestsRoute,
  listAdminDictRequestsHandler,
  listAdminDictRequestsRoute,
} from './admin-requests';
import {
  addAdminCalendarDayHandler,
  addAdminCalendarDayRoute,
  adminCalendarCopyHandler,
  adminCalendarCopyPlanHandler,
  adminCalendarCopyPlanRoute,
  adminCalendarCopyRoute,
  adminCalendarHistoryHandler,
  adminCalendarHistoryRoute,
  adminCalendarValuesHandler,
  adminCalendarValuesRoute,
  deleteAdminCalendarDayHandler,
  deleteAdminCalendarDayRoute,
  exportAdminCalendarHandler,
  exportAdminCalendarRoute,
  listAdminCalendarHandler,
  listAdminCalendarRoute,
} from './admin-calendar';
import {
  adminCalendarAddDuesHandler,
  adminCalendarAddDuesRoute,
  adminCalendarDeleteDuesHandler,
  adminCalendarDeleteDuesRoute,
} from './admin-dues';
import {
  adminTaxInfoHandler,
  adminTaxInfoRoute,
  adminTaxValuesHandler,
  adminTaxValuesRoute,
  exportAdminTaxesHandler,
  exportAdminTaxesRoute,
  listAdminTaxesHandler,
  listAdminTaxesRoute,
} from './admin-taxes';
import {
  adminMessageTemplatesHandler,
  adminMessageTemplatesRoute,
  adminPermissionsHandler,
  adminPermissionsRoute,
  adminPermissionValuesHandler,
  adminPermissionValuesRoute,
  adminRoleTemplatesHandler,
  adminRoleTemplatesRoute,
  adminStatusesHandler,
  adminStatusesRoute,
  exportAdminPermissionsHandler,
  exportAdminPermissionsRoute,
  permsHistoryRoute,
  roletplHistoryRoute,
  saveMessageTemplatesHandler,
  saveMessageTemplatesRoute,
  setPeriodNameHandler,
  setPeriodNameRoute,
  setPermissionHandler,
  setPermissionRoute,
  setRoleTemplateHandler,
  setRoleTemplateRoute,
  setStatusNameHandler,
  setStatusNameRoute,
  setStatusToneHandler,
  setStatusToneRoute,
  statusesHistoryRoute,
  systemHistoryHandler,
  templatesHistoryRoute,
} from './admin-system';
import {
  adminDictImportApplyHandler,
  adminDictImportApplyRoute,
  adminDictImportPreviewHandler,
  adminDictImportPreviewRoute,
  adminDictIoFileHandler,
  adminDictIoFileRoute,
  adminDictIoXlsxHandler,
  adminDictIoXlsxRoute,
  dictLoadValuesHandler,
  dictLoadValuesRoute,
  exportDictLoadsHandler,
  exportDictLoadsRoute,
  listDictLoadsHandler,
  listDictLoadsRoute,
  rollbackDictLoadHandler,
  rollbackDictLoadRoute,
} from './admin-io';
import { phoneCodesHandler, phoneCodesRoute } from './phone-codes';

/**
 * Справочники платформы для экранов организаций (только чтение): коды телефонов, виды отчётов, режимы,
 * налоги и ставки, льготы и статусы, основания, УГНС, органы, формы собственности, ставки единого налога, причины
 * изменения срока, производственный календарь. Правка справочников и ответы на запросы организаций —
 * Админка → «Справочники платформы» (задача 2.36, только администратору платформы).
 */
export function platformDictsModule(deps: ApiDeps) {
  return (
    createModuleApp()
      .openapi(phoneCodesRoute, phoneCodesHandler(deps))
      .openapi(reportTypesRoute, reportTypesHandler(deps))
      .openapi(taxRegimesRoute, taxRegimesHandler(deps))
      .openapi(taxBenefitsRoute, taxBenefitsHandler(deps))
      .openapi(reportBasesRoute, reportBasesHandler(deps))
      .openapi(taxOfficesRoute, taxOfficesHandler(deps))
      .openapi(authoritiesRoute, authoritiesHandler(deps))
      .openapi(ownershipFormsRoute, ownershipFormsHandler(deps))
      .openapi(singleTaxRatesRoute, singleTaxRatesHandler(deps))
      .openapi(dueChangeReasonsRoute, dueChangeReasonsHandler(deps))
      .openapi(taxesRoute, taxesHandler(deps))
      .openapi(productionCalendarRoute, productionCalendarHandler(deps))
      // Админка. Сначала адреса без кода значения: иначе «groups», «values» и «export» разбирались бы как
      // справочник или код.
      .openapi(adminDictGroupsRoute, adminDictGroupsHandler(deps))
      .openapi(pdictsTabCountsRoute, pdictsTabCountsHandler(deps))
      .openapi(reportTypeOptionsRoute, reportTypeOptionsHandler(deps))
      .openapi(listAdminDictRequestsRoute, listAdminDictRequestsHandler(deps))
      .openapi(adminDictRequestValuesRoute, adminDictRequestValuesHandler(deps))
      .openapi(exportAdminDictRequestsRoute, exportAdminDictRequestsHandler(deps))
      .openapi(answerDictRequestRoute, answerDictRequestHandler(deps))
      .openapi(adminTaxInfoRoute, adminTaxInfoHandler(deps))
      .openapi(listAdminTaxesRoute, listAdminTaxesHandler(deps))
      .openapi(adminTaxValuesRoute, adminTaxValuesHandler(deps))
      .openapi(exportAdminTaxesRoute, exportAdminTaxesHandler(deps))
      .openapi(listAdminCalendarRoute, listAdminCalendarHandler(deps))
      .openapi(adminCalendarValuesRoute, adminCalendarValuesHandler(deps))
      .openapi(exportAdminCalendarRoute, exportAdminCalendarHandler(deps))
      .openapi(adminCalendarCopyPlanRoute, adminCalendarCopyPlanHandler(deps))
      .openapi(adminCalendarCopyRoute, adminCalendarCopyHandler(deps))
      .openapi(adminCalendarHistoryRoute, adminCalendarHistoryHandler(deps))
      .openapi(addAdminCalendarDayRoute, addAdminCalendarDayHandler(deps))
      .openapi(deleteAdminCalendarDayRoute, deleteAdminCalendarDayHandler(deps))
      .openapi(adminCalendarAddDuesRoute, adminCalendarAddDuesHandler(deps))
      .openapi(adminCalendarDeleteDuesRoute, adminCalendarDeleteDuesHandler(deps))
      .openapi(adminStatusesRoute, adminStatusesHandler(deps))
      .openapi(statusesHistoryRoute, systemHistoryHandler(deps, 'statuses', statusesHistoryRoute))
      .openapi(setStatusNameRoute, setStatusNameHandler(deps))
      .openapi(setStatusToneRoute, setStatusToneHandler(deps))
      .openapi(setPeriodNameRoute, setPeriodNameHandler(deps))
      .openapi(adminPermissionsRoute, adminPermissionsHandler(deps))
      .openapi(adminPermissionValuesRoute, adminPermissionValuesHandler(deps))
      .openapi(exportAdminPermissionsRoute, exportAdminPermissionsHandler(deps))
      .openapi(permsHistoryRoute, systemHistoryHandler(deps, 'perms', permsHistoryRoute))
      .openapi(setPermissionRoute, setPermissionHandler(deps))
      .openapi(adminRoleTemplatesRoute, adminRoleTemplatesHandler(deps))
      .openapi(roletplHistoryRoute, systemHistoryHandler(deps, 'roletpl', roletplHistoryRoute))
      .openapi(setRoleTemplateRoute, setRoleTemplateHandler(deps))
      .openapi(adminMessageTemplatesRoute, adminMessageTemplatesHandler(deps))
      .openapi(
        templatesHistoryRoute,
        systemHistoryHandler(deps, 'templates', templatesHistoryRoute),
      )
      .openapi(saveMessageTemplatesRoute, saveMessageTemplatesHandler(deps))
      .openapi(adminDictIoFileRoute, adminDictIoFileHandler(deps))
      .openapi(adminDictIoXlsxRoute, adminDictIoXlsxHandler(deps))
      .openapi(adminDictImportPreviewRoute, adminDictImportPreviewHandler(deps))
      .openapi(adminDictImportApplyRoute, adminDictImportApplyHandler(deps))
      .openapi(listDictLoadsRoute, listDictLoadsHandler(deps))
      .openapi(dictLoadValuesRoute, dictLoadValuesHandler(deps))
      .openapi(exportDictLoadsRoute, exportDictLoadsHandler(deps))
      .openapi(rollbackDictLoadRoute, rollbackDictLoadHandler(deps))
      .openapi(listAdminDictRoute, listAdminDictHandler(deps))
      .openapi(adminDictValuesRoute, adminDictValuesHandler(deps))
      .openapi(exportAdminDictRoute, exportAdminDictHandler(deps))
      .openapi(adminDictHistoryRoute, adminDictHistoryHandler(deps))
      .openapi(createAdminDictValueRoute, createAdminDictValueHandler(deps))
      .openapi(getAdminDictValueRoute, getAdminDictValueHandler(deps))
      .openapi(updateAdminDictValueRoute, updateAdminDictValueHandler(deps))
      .openapi(adminDictDuesPreviewRoute, adminDictDuesPreviewHandler(deps))
      .openapi(moveAdminDictValueRoute, moveAdminDictValueHandler(deps))
      .openapi(setAdminDictActiveRoute, setAdminDictActiveHandler(deps))
      .openapi(deleteAdminDictValueRoute, deleteAdminDictValueHandler(deps))
  );
}
