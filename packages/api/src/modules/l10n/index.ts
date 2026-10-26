import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { dictionaryHandler, dictionaryRoute } from './dictionary';

/**
 * Модуль «Локализация»: словарь текстов интерфейса для экранов. Правка текстов (экран «Локализация»
 * в Админке, загрузка из Excel) — поток Д.
 */
export function l10nModule(deps: ApiDeps) {
  return createModuleApp().openapi(dictionaryRoute, dictionaryHandler(deps));
}
