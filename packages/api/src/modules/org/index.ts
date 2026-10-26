import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  deleteLogoHandler,
  deleteLogoRoute,
  getLogoHandler,
  getLogoRoute,
  uploadLogoHandler,
  uploadLogoRoute,
} from './logo';
import {
  getOrgPolicyHandler,
  getOrgPolicyRoute,
  orgPolicyHistoryHandler,
  orgPolicyHistoryRoute,
  updateOrgPolicyHandler,
  updateOrgPolicyRoute,
} from './policy';
import {
  getOrgProfileHandler,
  getOrgProfileRoute,
  updateOrgProfileHandler,
  updateOrgProfileRoute,
} from './profile';

/**
 * Модуль «Моя организация»: «Основное» с логотипом и адресом страницы, учётная политика и настройки,
 * история учётной политики. Видят все сотрудники, меняет владелец (право «Настройки и учётная
 * политика»). Реквизиты для приёма денег, приветствие и опросник — свои задачи.
 */
export function orgModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(getOrgProfileRoute, getOrgProfileHandler(deps))
    .openapi(updateOrgProfileRoute, updateOrgProfileHandler(deps))
    .openapi(getLogoRoute, getLogoHandler(deps))
    .openapi(uploadLogoRoute, uploadLogoHandler(deps))
    .openapi(deleteLogoRoute, deleteLogoHandler(deps))
    .openapi(getOrgPolicyRoute, getOrgPolicyHandler(deps))
    .openapi(updateOrgPolicyRoute, updateOrgPolicyHandler(deps))
    .openapi(orgPolicyHistoryRoute, orgPolicyHistoryHandler(deps));
}
