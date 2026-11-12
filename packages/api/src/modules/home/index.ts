import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  activityEmployeeHandler,
  activityEmployeeRoute,
  activityExportHandler,
  activityExportRoute,
  activityListHandler,
  activityListRoute,
  activityOverviewHandler,
  activityOverviewRoute,
  activityValuesHandler,
  activityValuesRoute,
} from './activity';
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
 * сотрудника; «Аналитика» — выручка по контрагентам (право «Видеть плату за обслуживание»);
 * «Активность» — входы, действия и сданные отчёты сотрудников (право «Смотреть аналитику по
 * сотрудникам», прототип v84).
 */
export function homeModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(homeSummaryRoute, homeSummaryHandler(deps))
    .openapi(revenueOverviewRoute, revenueOverviewHandler(deps))
    .openapi(revenueListRoute, revenueListHandler(deps))
    .openapi(revenueValuesRoute, revenueValuesHandler(deps))
    .openapi(revenueExportRoute, revenueExportHandler(deps))
    .openapi(activityOverviewRoute, activityOverviewHandler(deps))
    .openapi(activityListRoute, activityListHandler(deps))
    .openapi(activityValuesRoute, activityValuesHandler(deps))
    .openapi(activityExportRoute, activityExportHandler(deps))
    .openapi(activityEmployeeRoute, activityEmployeeHandler(deps));
}
