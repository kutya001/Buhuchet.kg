import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { phoneCodesHandler, phoneCodesRoute } from './phone-codes';

/**
 * Справочники платформы для экранов организаций (только чтение): коды телефонов. Правка справочников —
 * Админка → «Справочники платформы» (поток Д).
 */
export function platformDictsModule(deps: ApiDeps) {
  return createModuleApp().openapi(phoneCodesRoute, phoneCodesHandler(deps));
}
