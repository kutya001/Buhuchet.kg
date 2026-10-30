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
 * Модуль «Контрагенты»: список (значения для фильтра, выгрузка в Excel, счётчики вкладок), карточка,
 * сверка с ГКЭД и тариф Соцфонда для формы, создание одним целым, «Изменить», удаление, назначение
 * ответственного, передача дел, окно «Тариф Соцфонда» и обслуживание (приостановка, возобновление,
 * архив, перевод разового в постоянное — задача 2.12). Экраны — задачи 2.09–2.11; подбор отчётов —
 * своя задача.
 */
export function contractorsModule(deps: ApiDeps) {
  return (
    createModuleApp()
      .openapi(listContractorsRoute, listContractorsHandler(deps))
      // Раньше `/contractors/{id}`: иначе «values», «export», «tab-counts», «transfer», «gked-check» и
      // «socfund-check» разбирались бы как номер контрагента.
      .openapi(contractorValuesRoute, contractorValuesHandler(deps))
      .openapi(contractorTabCountsRoute, contractorTabCountsHandler(deps))
      .openapi(exportContractorsRoute, exportContractorsHandler(deps))
      .openapi(transferPreviewRoute, transferPreviewHandler(deps))
      .openapi(transferContractorsRoute, transferContractorsHandler(deps))
      .openapi(assignContractorsRoute, assignContractorsHandler(deps))
      .openapi(gkedCheckRoute, gkedCheckHandler(deps))
      .openapi(socfundCheckRoute, socfundCheckHandler(deps))
      .openapi(getContractorRoute, getContractorHandler(deps))
      .openapi(createContractorRoute, createContractorHandler(deps))
      .openapi(updateContractorRoute, updateContractorHandler(deps))
      .openapi(deleteContractorRoute, deleteContractorHandler(deps))
      .openapi(saveSocfundRoute, saveSocfundHandler(deps))
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
