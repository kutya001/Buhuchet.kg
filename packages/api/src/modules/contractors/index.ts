import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  assignContractorsHandler,
  assignContractorsRoute,
  transferContractorsHandler,
  transferContractorsRoute,
  transferPreviewHandler,
  transferPreviewRoute,
} from './assign';
import {
  getContractorHandler,
  getContractorRoute,
  gkedCheckHandler,
  gkedCheckRoute,
  formOptionsHandler,
  formOptionsRoute,
  gkedSearchHandler,
  gkedSearchRoute,
} from './card';
import { contractorHistoryHandler, contractorHistoryRoute } from './history';
import {
  importApplyHandler,
  importApplyRoute,
  importCheckHandler,
  importCheckRoute,
  importTemplateHandler,
  importTemplatePreviewHandler,
  importTemplatePreviewRoute,
  importTemplateRoute,
} from './import';
import {
  contractorSummaryHandler,
  contractorSummaryRoute,
  contractorTabCountsHandler,
  contractorTabCountsRoute,
  contractorValuesHandler,
  contractorValuesRoute,
  exportContractorsHandler,
  exportContractorsRoute,
  listContractorsHandler,
  listContractorsRoute,
} from './list';
import {
  applyReportPickHandler,
  applyReportPickRoute,
  reportPickContextHandler,
  reportPickContextRoute,
  reportPickPreviewHandler,
  reportPickPreviewRoute,
} from './report-pick';
import {
  createContractorHandler,
  createContractorRoute,
  deleteContractorHandler,
  deleteContractorRoute,
  updateContractorHandler,
  updateContractorRoute,
} from './save';
import {
  saveSocfundHandler,
  saveSocfundRoute,
  socfundCheckHandler,
  socfundCheckRoute,
} from './socfund';
import {
  archiveContractorsHandler,
  archiveContractorsRoute,
  cancelPauseHandler,
  cancelPauseRoute,
  getServiceHandler,
  getServiceRoute,
  pauseServiceHandler,
  pauseServiceRoute,
  resumeServiceHandler,
  resumeServiceRoute,
  rollbackPauseHandler,
  rollbackPauseRoute,
  toRegularHandler,
  toRegularRoute,
  unarchiveContractorHandler,
  unarchiveContractorRoute,
} from './service';

/**
 * Модуль «Контрагенты»: список (значения для фильтра, выгрузка в Excel, счётчики вкладок, итоги плашек),
 * карточка и её «История», значения формы, поиск и сверка с ГКЭД и тариф Соцфонда для формы, создание
 * одним целым вместе с отчётами, «Изменить», удаление, назначение ответственного, передача дел, окно «Тариф Соцфонда»,
 * «Подбор отчётов», обслуживание (приостановка, возобновление, архив, перевод разового в постоянное —
 * задача 2.12) и загрузка из Excel (задача 2.16). Экраны — задачи 2.09–2.11 и 2.16.
 */
export function contractorsModule(deps: ApiDeps) {
  return (
    createModuleApp()
      .openapi(listContractorsRoute, listContractorsHandler(deps))
      // Раньше `/contractors/{id}`: иначе «values», «export», «tab-counts», «summary», «transfer»,
      // «gked-check», «gked-search», «form-options», «socfund-check» и «report-pick» разбирались бы как
      // номер контрагента.
      .openapi(contractorValuesRoute, contractorValuesHandler(deps))
      .openapi(contractorTabCountsRoute, contractorTabCountsHandler(deps))
      .openapi(contractorSummaryRoute, contractorSummaryHandler(deps))
      .openapi(exportContractorsRoute, exportContractorsHandler(deps))
      .openapi(transferPreviewRoute, transferPreviewHandler(deps))
      .openapi(transferContractorsRoute, transferContractorsHandler(deps))
      .openapi(assignContractorsRoute, assignContractorsHandler(deps))
      .openapi(gkedCheckRoute, gkedCheckHandler(deps))
      .openapi(gkedSearchRoute, gkedSearchHandler(deps))
      .openapi(formOptionsRoute, formOptionsHandler(deps))
      .openapi(socfundCheckRoute, socfundCheckHandler(deps))
      .openapi(reportPickContextRoute, reportPickContextHandler(deps))
      .openapi(importTemplatePreviewRoute, importTemplatePreviewHandler(deps))
      .openapi(importTemplateRoute, importTemplateHandler(deps))
      .openapi(importCheckRoute, importCheckHandler(deps))
      .openapi(importApplyRoute, importApplyHandler(deps))
      .openapi(getContractorRoute, getContractorHandler(deps))
      .openapi(contractorHistoryRoute, contractorHistoryHandler(deps))
      .openapi(createContractorRoute, createContractorHandler(deps))
      .openapi(updateContractorRoute, updateContractorHandler(deps))
      .openapi(deleteContractorRoute, deleteContractorHandler(deps))
      .openapi(saveSocfundRoute, saveSocfundHandler(deps))
      .openapi(reportPickPreviewRoute, reportPickPreviewHandler(deps))
      .openapi(applyReportPickRoute, applyReportPickHandler(deps))
      // Обслуживание: приостановка, возобновление, архив, разовые (задача 2.12).
      .openapi(archiveContractorsRoute, archiveContractorsHandler(deps))
      .openapi(getServiceRoute, getServiceHandler(deps))
      .openapi(pauseServiceRoute, pauseServiceHandler(deps))
      .openapi(resumeServiceRoute, resumeServiceHandler(deps))
      .openapi(cancelPauseRoute, cancelPauseHandler(deps))
      .openapi(rollbackPauseRoute, rollbackPauseHandler(deps))
      .openapi(unarchiveContractorRoute, unarchiveContractorHandler(deps))
      .openapi(toRegularRoute, toRegularHandler(deps))
  );
}
