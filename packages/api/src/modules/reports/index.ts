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

/**
 * Модуль «Отчеты для сдачи» (задача 2.06): назначения контрагентам (список в карточке контрагента,
 * предпросмотр прошлых периодов, назначить, «Изменить», «Снять»), список отчётов (значения для
 * фильтра, выгрузка в Excel, счётчики вкладок), карточка, «Изменить срок», «Разовый отчёт», «Создать
 * уточнённый». Экраны — задачи 2.11, 2.13–2.15; сдача — 2.14; деньги — 2.19.
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
      // Раньше `/reports/{id}`: иначе «values», «export» и «tab-counts» разбирались бы как номер отчёта.
      .openapi(reportValuesRoute, reportValuesHandler(deps))
      .openapi(reportTabCountsRoute, reportTabCountsHandler(deps))
      .openapi(exportReportsRoute, exportReportsHandler(deps))
      .openapi(getReportRoute, getReportHandler(deps))
      .openapi(createManualReportRoute, createManualReportHandler(deps))
      .openapi(changeReportDueRoute, changeReportDueHandler(deps))
      .openapi(createRevisionRoute, createRevisionHandler(deps))
  );
}
