import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  createDictRequestHandler,
  createDictRequestRoute,
  exportPlatformDictHandler,
  exportPlatformDictRoute,
  exportPlatformValuesHandler,
  exportPlatformValuesRoute,
  listDictRequestsHandler,
  listDictRequestsRoute,
  platformDictListHandler,
  platformDictListRoute,
  platformDictTilesHandler,
  platformDictTilesRoute,
  platformDictValuesHandler,
  platformDictValuesRoute,
  platformValuesHandler,
  platformValuesRoute,
  platformValueValuesHandler,
  platformValueValuesRoute,
} from './platform';
import {
  connectOrgReportTypesHandler,
  connectOrgReportTypesRoute,
  exportOrgReportTypesHandler,
  exportOrgReportTypesRoute,
  listOrgReportTypesHandler,
  listOrgReportTypesRoute,
  orgReportTypeSettingsHandler,
  orgReportTypeSettingsRoute,
  orgReportTypeValuesHandler,
  orgReportTypeValuesRoute,
  saveOrgReportTypeHandler,
  saveOrgReportTypeRoute,
} from './report-types';

/**
 * Модуль «Справочники» организации: вкладка «Виды отчётов» — список каталога с настройками
 * организации (значения для фильтра, выгрузка в Excel), подключение из каталога («Выбор налогов»),
 * переключатели и настройки вида; вкладка «Справочники платформы» — плитки, окна справочников,
 * «Поиск по всем значениям», «Попросить добавить» и «Мои запросы». Справочники платформы для форм —
 * модуль `platform-dicts`.
 */
export function dictsModule(deps: ApiDeps) {
  return (
    createModuleApp()
      .openapi(listOrgReportTypesRoute, listOrgReportTypesHandler(deps))
      // Раньше `/org-report-types/{code}`: иначе «values», «export», «settings» разбирались бы как код вида.
      .openapi(orgReportTypeValuesRoute, orgReportTypeValuesHandler(deps))
      .openapi(exportOrgReportTypesRoute, exportOrgReportTypesHandler(deps))
      .openapi(orgReportTypeSettingsRoute, orgReportTypeSettingsHandler(deps))
      .openapi(connectOrgReportTypesRoute, connectOrgReportTypesHandler(deps))
      .openapi(saveOrgReportTypeRoute, saveOrgReportTypeHandler(deps))
      .openapi(platformDictTilesRoute, platformDictTilesHandler(deps))
      .openapi(platformDictListRoute, platformDictListHandler(deps))
      .openapi(platformDictValuesRoute, platformDictValuesHandler(deps))
      .openapi(exportPlatformDictRoute, exportPlatformDictHandler(deps))
      .openapi(platformValueValuesRoute, platformValueValuesHandler(deps))
      .openapi(exportPlatformValuesRoute, exportPlatformValuesHandler(deps))
      .openapi(platformValuesRoute, platformValuesHandler(deps))
      .openapi(createDictRequestRoute, createDictRequestHandler(deps))
      .openapi(listDictRequestsRoute, listDictRequestsHandler(deps))
  );
}
