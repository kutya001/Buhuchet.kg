import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  revenueExportHandler,
  revenueExportRoute,
  revenueListHandler,
  revenueListRoute,
  revenueOverviewHandler,
  revenueOverviewRoute,
  revenueValuesHandler,
  revenueValuesRoute,
} from './analytics';
import { homeSummaryHandler, homeSummaryRoute } from './summary';

/**
 * Модуль «Главная» (поток Г, задача 2.34): «Сводка» — плашки и блоки по данным модулей в области
 * сотрудника; «Аналитика» — выручка по контрагентам (право «Видеть плату за обслуживание»).
 */
export function homeModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(homeSummaryRoute, homeSummaryHandler(deps))
    .openapi(revenueOverviewRoute, revenueOverviewHandler(deps))
    .openapi(revenueListRoute, revenueListHandler(deps))
    .openapi(revenueValuesRoute, revenueValuesHandler(deps))
    .openapi(revenueExportRoute, revenueExportHandler(deps));
}
