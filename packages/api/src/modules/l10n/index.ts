import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  exportUiTextsHandler,
  exportUiTextsRoute,
  getUiTextHandler,
  getUiTextRoute,
  listUiTextsHandler,
  listUiTextsRoute,
  uiLanguagesHandler,
  uiLanguagesRoute,
  uiTextValuesHandler,
  uiTextValuesRoute,
  updateUiTextHandler,
  updateUiTextRoute,
} from './admin-texts';
import { dictionaryHandler, dictionaryRoute } from './dictionary';

/**
 * Модуль «Локализация»: словарь текстов интерфейса для экранов (без входа) и Админка → «Локализация»
 * (только администратору платформы): список словаря, значения фильтра, «В Excel», языки и правка
 * текста (docs/decisions.md, п. Д-1).
 */
export function l10nModule(deps: ApiDeps) {
  return (
    createModuleApp()
      .openapi(dictionaryRoute, dictionaryHandler(deps))
      .openapi(listUiTextsRoute, listUiTextsHandler(deps))
      .openapi(uiTextValuesRoute, uiTextValuesHandler(deps))
      .openapi(exportUiTextsRoute, exportUiTextsHandler(deps))
      .openapi(uiLanguagesRoute, uiLanguagesHandler(deps))
      // После «values» и «export»: адрес с ключом их не перехватывает.
      .openapi(getUiTextRoute, getUiTextHandler(deps))
      .openapi(updateUiTextRoute, updateUiTextHandler(deps))
  );
}
