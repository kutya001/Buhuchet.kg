import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  assignmentPreviewHandler,
  assignmentPreviewRoute,
  createAssignmentHandler,
  createAssignmentRoute,
  endAssignmentHandler,
  endAssignmentRoute,
  listAssignmentsHandler,
  listAssignmentsRoute,
  updateAssignmentHandler,
  updateAssignmentRoute,
} from './assignments';
import {
  changeReportDueHandler,
  changeReportDueRoute,
  createManualReportHandler,
  createManualReportRoute,
  createRevisionHandler,
  createRevisionRoute,
  getReportHandler,
  getReportRoute,
} from './card';
import {
  exportReportsHandler,
  exportReportsRoute,
  listReportsHandler,
  listReportsRoute,
  reportTabCountsHandler,
  reportTabCountsRoute,
  reportValuesHandler,
  reportValuesRoute,
} from './list';
import {
  confirmReportHandler,
  confirmReportRoute,
  confirmReportsHandler,
  confirmReportsRoute,
  fixReportHandler,
  fixReportRoute,
  notRequiredReportHandler,
  notRequiredReportRoute,
  rejectReportHandler,
  rejectReportRoute,
  reportAmountHandler,
  reportAmountRoute,
  rollbackReportHandler,
  rollbackReportRoute,
  startReportHandler,
  startReportRoute,
  submitReportHandler,
  submitReportRoute,
  submitReportsHandler,
  submitReportsRoute,
} from './status';
import {
  manualReportDueHandler,
  manualReportDueRoute,
  manualReportOptionsHandler,
  manualReportOptionsRoute,
} from './manual';

/**
 * Модуль «Отчеты для сдачи» (задачи 2.06, 2.13): назначения контрагентам (список в карточке
 * контрагента, предпросмотр прошлых периодов, назначить, «Изменить», «Снять»), список отчётов (значения
 * для фильтра, выгрузка в Excel, счётчики вкладок и плашек), карточка, «Изменить срок», «Разовый отчёт»
 * (со списками окна и сроком по дате события), «Создать уточнённый»; сдача, подтверждение, «На
 * исправление», шаги без окна, откат и «Указать сумму» — по одному и массово (задача 2.14). Экраны —
 * задачи 2.11, 2.13–2.15; деньги — 2.19.
 */
export function reportsModule(deps: ApiDeps) {
  return (
    createModuleApp()
      .openapi(listAssignmentsRoute, listAssignmentsHandler(deps))
      .openapi(assignmentPreviewRoute, assignmentPreviewHandler(deps))
      .openapi(createAssignmentRoute, createAssignmentHandler(deps))
      .openapi(updateAssignmentRoute, updateAssignmentHandler(deps))
      .openapi(endAssignmentRoute, endAssignmentHandler(deps))
      .openapi(listReportsRoute, listReportsHandler(deps))
      // Раньше `/reports/{id}`: иначе «values», «export», «tab-counts», «manual-options» и «manual-due»
      // разбирались бы как номер отчёта.
      .openapi(reportValuesRoute, reportValuesHandler(deps))
      .openapi(reportTabCountsRoute, reportTabCountsHandler(deps))
      .openapi(exportReportsRoute, exportReportsHandler(deps))
      .openapi(manualReportOptionsRoute, manualReportOptionsHandler(deps))
      .openapi(manualReportDueRoute, manualReportDueHandler(deps))
      .openapi(getReportRoute, getReportHandler(deps))
      .openapi(createManualReportRoute, createManualReportHandler(deps))
      .openapi(changeReportDueRoute, changeReportDueHandler(deps))
      .openapi(createRevisionRoute, createRevisionHandler(deps))
      .openapi(submitReportsRoute, submitReportsHandler(deps))
      .openapi(confirmReportsRoute, confirmReportsHandler(deps))
      .openapi(submitReportRoute, submitReportHandler(deps))
      .openapi(startReportRoute, startReportHandler(deps))
      .openapi(confirmReportRoute, confirmReportHandler(deps))
      .openapi(fixReportRoute, fixReportHandler(deps))
      .openapi(rejectReportRoute, rejectReportHandler(deps))
      .openapi(notRequiredReportRoute, notRequiredReportHandler(deps))
      .openapi(rollbackReportRoute, rollbackReportHandler(deps))
      .openapi(reportAmountRoute, reportAmountHandler(deps))
  );
}
