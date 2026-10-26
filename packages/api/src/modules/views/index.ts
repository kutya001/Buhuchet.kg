import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  listViewSettingsHandler,
  listViewSettingsRoute,
  resetViewSettingsHandler,
  resetViewSettingsRoute,
  saveViewSettingsHandler,
  saveViewSettingsRoute,
} from './settings';

/**
 * Настройки вида списков пользователя (ТЗ «Общие элементы интерфейса» → «Списки записей» →
 * «Настройки вида»): у сотрудника и у администратора платформы — свои, по каждому списку.
 */
export function viewsModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(listViewSettingsRoute, listViewSettingsHandler(deps))
    .openapi(saveViewSettingsRoute, saveViewSettingsHandler(deps))
    .openapi(resetViewSettingsRoute, resetViewSettingsHandler(deps));
}
