import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
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
 * переключатели и настройки вида. Справочники платформы для чтения — модуль `platform-dicts`.
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
  );
}
