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
import { getContractorHandler, getContractorRoute, gkedCheckHandler, gkedCheckRoute } from './card';
import {
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

/**
 * Модуль «Контрагенты»: список (значения для фильтра, выгрузка в Excel, счётчики вкладок), карточка,
 * сверка с ГКЭД и тариф Соцфонда для формы, создание одним целым, «Изменить», удаление, назначение
 * ответственного, передача дел, окно «Тариф Соцфонда» и «Подбор отчётов». Экраны — задачи 2.09–2.11;
 * приостановка и архив — свои задачи.
 */
export function contractorsModule(deps: ApiDeps) {
  return (
    createModuleApp()
      .openapi(listContractorsRoute, listContractorsHandler(deps))
      // Раньше `/contractors/{id}`: иначе «values», «export», «tab-counts», «transfer», «gked-check»,
      // «socfund-check» и «report-pick» разбирались бы как номер контрагента.
      .openapi(contractorValuesRoute, contractorValuesHandler(deps))
      .openapi(contractorTabCountsRoute, contractorTabCountsHandler(deps))
      .openapi(exportContractorsRoute, exportContractorsHandler(deps))
      .openapi(transferPreviewRoute, transferPreviewHandler(deps))
      .openapi(transferContractorsRoute, transferContractorsHandler(deps))
      .openapi(assignContractorsRoute, assignContractorsHandler(deps))
      .openapi(gkedCheckRoute, gkedCheckHandler(deps))
      .openapi(socfundCheckRoute, socfundCheckHandler(deps))
      .openapi(reportPickContextRoute, reportPickContextHandler(deps))
      .openapi(getContractorRoute, getContractorHandler(deps))
      .openapi(createContractorRoute, createContractorHandler(deps))
      .openapi(updateContractorRoute, updateContractorHandler(deps))
      .openapi(deleteContractorRoute, deleteContractorHandler(deps))
      .openapi(saveSocfundRoute, saveSocfundHandler(deps))
      .openapi(reportPickPreviewRoute, reportPickPreviewHandler(deps))
      .openapi(applyReportPickRoute, applyReportPickHandler(deps))
  );
}
