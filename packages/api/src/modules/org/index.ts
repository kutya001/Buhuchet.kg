import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { orgExtApiHandler, orgExtApiRoute } from './ext-api';
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
  orgRoleOptionsHandler,
  orgRoleOptionsRoute,
  orgWaitingReportsHandler,
  orgWaitingReportsRoute,
  updateOrgPolicyHandler,
  updateOrgPolicyRoute,
} from './policy';
import {
  getOrgProfileHandler,
  getOrgProfileRoute,
  updateOrgProfileHandler,
  updateOrgProfileRoute,
} from './profile';
import {
  orgSubscriptionHandler,
  orgSubscriptionRoute,
  subPayCompleteHandler,
  subPayCompleteRoute,
  subPayStartHandler,
  subPayStartRoute,
  subReceiptCompleteHandler,
  subReceiptCompleteRoute,
  subReceiptDownloadHandler,
  subReceiptDownloadRoute,
  subReceiptLinkHandler,
  subReceiptLinkRoute,
  subReceiptStartHandler,
  subReceiptStartRoute,
} from './subscription';

/**
 * Модуль «Моя организация»: «Основное» с логотипом и адресом страницы, учётная политика и настройки,
 * история учётной политики. Видят все сотрудники, меняет владелец (право «Настройки и учётная
 * политика»). Реквизиты для приёма денег, приветствие и опросник — свои задачи. «Подписка» — только
 * владелец (`subscription.ts`, доработки 20.11.2026, блок 5).
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
    .openapi(orgPolicyHistoryRoute, orgPolicyHistoryHandler(deps))
    .openapi(orgRoleOptionsRoute, orgRoleOptionsHandler(deps))
    .openapi(orgWaitingReportsRoute, orgWaitingReportsHandler(deps))
    .openapi(orgExtApiRoute, orgExtApiHandler(deps))
    .openapi(orgSubscriptionRoute, orgSubscriptionHandler(deps))
    .openapi(subPayStartRoute, subPayStartHandler(deps))
    .openapi(subPayCompleteRoute, subPayCompleteHandler(deps))
    .openapi(subReceiptStartRoute, subReceiptStartHandler(deps))
    .openapi(subReceiptCompleteRoute, subReceiptCompleteHandler(deps))
    .openapi(subReceiptLinkRoute, subReceiptLinkHandler(deps))
    .openapi(subReceiptDownloadRoute, subReceiptDownloadHandler(deps));
}
