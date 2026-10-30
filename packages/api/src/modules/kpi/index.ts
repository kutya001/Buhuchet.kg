import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { cardHandler, cardRoute } from './card';
import {
  archiveIndicatorHandler,
  archiveIndicatorRoute,
  createIndicatorHandler,
  createIndicatorRoute,
  deleteIndicatorHandler,
  deleteIndicatorRoute,
  indicatorCardHandler,
  indicatorCardRoute,
  listIndicatorsHandler,
  listIndicatorsRoute,
  orderIndicatorsHandler,
  orderIndicatorsRoute,
  updateIndicatorHandler,
  updateIndicatorRoute,
} from './indicators';
import {
  importApplyHandler,
  importApplyRoute,
  importErrorsHandler,
  importErrorsRoute,
  importHistoryHandler,
  importHistoryRoute,
  importOptionsHandler,
  importOptionsRoute,
  importPreviewHandler,
  importPreviewRoute,
  templateHandler,
  templatePreviewHandler,
  templatePreviewRoute,
  templateRoute,
} from './import';
import {
  missingExportHandler,
  missingExportRoute,
  missingHandler,
  missingRoute,
  missingSummaryHandler,
  missingSummaryRoute,
  missingValuesHandler,
  missingValuesRoute,
  periodExportHandler,
  periodExportRoute,
  periodHandler,
  periodRoute,
  periodValuesHandler,
  periodValuesRoute,
} from './lists';
import {
  checkMonthHandler,
  checkMonthRoute,
  entryHandler,
  entryRoute,
  monthHandler,
  monthRoute,
  rollbackMonthHandler,
  rollbackMonthRoute,
  saveValuesHandler,
  saveValuesRoute,
} from './month';
import {
  whoFromHandler,
  whoFromRoute,
  whoHandler,
  whoRoute,
  whoSaveHandler,
  whoSaveRoute,
} from './who';

/**
 * Модуль «Показатели контрагентов» (поток В, задача 2.27): настройка показателей и «Кому вести», ввод за
 * месяц и окно значения со статусом месяца, «За период», «Не заполнено», индикатор незаполненных и
 * вкладка «Показатели» карточки контрагента; ввод из Excel (задача 2.28).
 */
export function kpiModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(listIndicatorsRoute, listIndicatorsHandler(deps))
    .openapi(createIndicatorRoute, createIndicatorHandler(deps))
    .openapi(orderIndicatorsRoute, orderIndicatorsHandler(deps))
    .openapi(indicatorCardRoute, indicatorCardHandler(deps))
    .openapi(updateIndicatorRoute, updateIndicatorHandler(deps))
    .openapi(archiveIndicatorRoute, archiveIndicatorHandler(deps))
    .openapi(deleteIndicatorRoute, deleteIndicatorHandler(deps))
    .openapi(whoRoute, whoHandler(deps))
    .openapi(whoSaveRoute, whoSaveHandler(deps))
    .openapi(whoFromRoute, whoFromHandler(deps))
    .openapi(monthRoute, monthHandler(deps))
    .openapi(saveValuesRoute, saveValuesHandler(deps))
    .openapi(entryRoute, entryHandler(deps))
    .openapi(checkMonthRoute, checkMonthHandler(deps))
    .openapi(rollbackMonthRoute, rollbackMonthHandler(deps))
    .openapi(periodRoute, periodHandler(deps))
    .openapi(periodValuesRoute, periodValuesHandler(deps))
    .openapi(periodExportRoute, periodExportHandler(deps))
    .openapi(missingRoute, missingHandler(deps))
    .openapi(missingValuesRoute, missingValuesHandler(deps))
    .openapi(missingExportRoute, missingExportHandler(deps))
    .openapi(missingSummaryRoute, missingSummaryHandler(deps))
    .openapi(importOptionsRoute, importOptionsHandler(deps))
    .openapi(templatePreviewRoute, templatePreviewHandler(deps))
    .openapi(templateRoute, templateHandler(deps))
    .openapi(importPreviewRoute, importPreviewHandler(deps))
    .openapi(importApplyRoute, importApplyHandler(deps))
    .openapi(importErrorsRoute, importErrorsHandler(deps))
    .openapi(importHistoryRoute, importHistoryHandler(deps))
    .openapi(cardRoute, cardHandler(deps));
}
