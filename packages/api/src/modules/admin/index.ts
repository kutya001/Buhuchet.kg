import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  blockOrganizationRoute,
  createOrganizationHandler,
  createOrganizationRoute,
  exportOrganizationsHandler,
  exportOrganizationsRoute,
  listOrganizationsHandler,
  listOrganizationsRoute,
  organizationStatusHandler,
  organizationSummaryHandler,
  organizationSummaryRoute,
  organizationValuesHandler,
  organizationValuesRoute,
  unblockOrganizationRoute,
} from './organizations';
import {
  orgActivityExportHandler,
  orgActivityExportRoute,
  orgActivityListHandler,
  orgActivityListRoute,
  orgActivityOverviewHandler,
  orgActivityOverviewRoute,
  orgActivityValuesHandler,
  orgActivityValuesRoute,
} from './org-activity';
import { submitLeadHandler, submitLeadRoute } from './leads';
import {
  deleteLeadHandler,
  deleteLeadRoute,
  exportLeadsHandler,
  exportLeadsRoute,
  leadCardHandler,
  leadCardRoute,
  leadNoteHandler,
  leadNoteRoute,
  leadStatusHandler,
  leadStatusRoute,
  leadSummaryHandler,
  leadSummaryRoute,
  leadValuesHandler,
  leadValuesRoute,
  listLeadsHandler,
  listLeadsRoute,
} from './leads-admin';
import { adminResetPasswordHandler, adminResetPasswordRoute } from './password-reset';
import {
  telegramBotHandler,
  telegramBotRoute,
  telegramBotViewHandler,
  telegramBotViewRoute,
  telegramBroadcastHandler,
  telegramBroadcastRoute,
  telegramLogExportHandler,
  telegramLogExportRoute,
  telegramLogHandler,
  telegramLogRoute,
  telegramLogValuesHandler,
  telegramLogValuesRoute,
  telegramOrgsHandler,
  telegramOrgsRoute,
  telegramRetryHandler,
  telegramRetryRoute,
  telegramSummaryHandler,
  telegramSummaryRoute,
} from './telegram';
import {
  telegramCastCountHandler,
  telegramCastCountRoute,
  telegramCastImageHandler,
  telegramCastImageRoute,
  telegramCastOptionsHandler,
  telegramCastOptionsRoute,
} from './telegram-cast';
import {
  blockUserRoute,
  exportUsersHandler,
  exportUsersRoute,
  listUsersHandler,
  listUsersRoute,
  unblockUserRoute,
  userBlockHandler,
  userValuesHandler,
  userValuesRoute,
} from './users';
import { orgCardHandler, orgCardRoute, orgLookupHandler, orgLookupRoute } from './org-card';
import {
  apiMethodCardHandler,
  apiMethodCardRoute,
  apiMethodValuesHandler,
  apiMethodValuesRoute,
  apiSchemaFieldsHandler,
  apiSchemaFieldsRoute,
  exportApiMethodsHandler,
  exportApiMethodsRoute,
  listApiMethodsHandler,
  listApiMethodsRoute,
  schemaPageHandler,
  schemaPageRoute,
  techDocsMetaHandler,
  techDocsMetaRoute,
  techDocsOpenApiHandler,
  techDocsOpenApiRoute,
} from './techdocs';
import {
  endUserSessionsHandler,
  endUserSessionsRoute,
  userCardHandler,
  userCardRoute,
  userLookupHandler,
  userLookupRoute,
} from './user-card';

/**
 * Модуль «Админка»: «Учётные записи» — список всех пользователей платформы, сброс пароля (#6),
 * блокировка; «Организации» — список, создание вместе с владельцем, блокировка; «Телеграм» — журнал
 * отправок с повтором, вебхук бота платформы, рассылка (задача 2.41); «Оставить заявку» с лендинга —
 * единственный метод без входа на нём, и вкладка «Заявки» в «Организациях» (задача #165).
 */
export function adminModule(deps: ApiDeps) {
  return (
    createModuleApp()
      .openapi(listUsersRoute, listUsersHandler(deps))
      .openapi(userValuesRoute, userValuesHandler(deps))
      .openapi(exportUsersRoute, exportUsersHandler(deps))
      .openapi(userLookupRoute, userLookupHandler(deps))
      .openapi(userCardRoute, userCardHandler(deps))
      .openapi(endUserSessionsRoute, endUserSessionsHandler(deps))
      .openapi(blockUserRoute, userBlockHandler(deps, 'block'))
      .openapi(unblockUserRoute, userBlockHandler(deps, 'unblock'))
      .openapi(adminResetPasswordRoute, adminResetPasswordHandler(deps))
      .openapi(listOrganizationsRoute, listOrganizationsHandler(deps))
      .openapi(organizationValuesRoute, organizationValuesHandler(deps))
      .openapi(exportOrganizationsRoute, exportOrganizationsHandler(deps))
      .openapi(organizationSummaryRoute, organizationSummaryHandler(deps))
      .openapi(orgActivityOverviewRoute, orgActivityOverviewHandler(deps))
      .openapi(orgActivityListRoute, orgActivityListHandler(deps))
      .openapi(orgActivityValuesRoute, orgActivityValuesHandler(deps))
      .openapi(orgActivityExportRoute, orgActivityExportHandler(deps))
      .openapi(orgLookupRoute, orgLookupHandler(deps))
      .openapi(orgCardRoute, orgCardHandler(deps))
      .openapi(techDocsMetaRoute, techDocsMetaHandler(deps))
      .openapi(apiMethodValuesRoute, apiMethodValuesHandler(deps))
      .openapi(exportApiMethodsRoute, exportApiMethodsHandler(deps))
      .openapi(listApiMethodsRoute, listApiMethodsHandler(deps))
      .openapi(apiMethodCardRoute, apiMethodCardHandler(deps))
      .openapi(apiSchemaFieldsRoute, apiSchemaFieldsHandler(deps))
      .openapi(schemaPageRoute, schemaPageHandler(deps))
      .openapi(techDocsOpenApiRoute, techDocsOpenApiHandler(deps))
      .openapi(createOrganizationRoute, createOrganizationHandler(deps))
      .openapi(blockOrganizationRoute, organizationStatusHandler(deps, 'block'))
      .openapi(unblockOrganizationRoute, organizationStatusHandler(deps, 'unblock'))
      .openapi(submitLeadRoute, submitLeadHandler(deps))
      // Вкладка «Заявки»: адреса без номера — раньше окна заявки `/admin/leads/{id}`.
      .openapi(listLeadsRoute, listLeadsHandler(deps))
      .openapi(leadValuesRoute, leadValuesHandler(deps))
      .openapi(exportLeadsRoute, exportLeadsHandler(deps))
      .openapi(leadSummaryRoute, leadSummaryHandler(deps))
      .openapi(leadCardRoute, leadCardHandler(deps))
      .openapi(leadStatusRoute, leadStatusHandler(deps))
      .openapi(leadNoteRoute, leadNoteHandler(deps))
      .openapi(deleteLeadRoute, deleteLeadHandler(deps))
      .openapi(telegramLogRoute, telegramLogHandler(deps))
      .openapi(telegramLogValuesRoute, telegramLogValuesHandler(deps))
      .openapi(telegramLogExportRoute, telegramLogExportHandler(deps))
      .openapi(telegramSummaryRoute, telegramSummaryHandler(deps))
      .openapi(telegramRetryRoute, telegramRetryHandler(deps))
      .openapi(telegramBotRoute, telegramBotHandler(deps))
      .openapi(telegramBotViewRoute, telegramBotViewHandler(deps))
      .openapi(telegramOrgsRoute, telegramOrgsHandler(deps))
      .openapi(telegramBroadcastRoute, telegramBroadcastHandler(deps))
      .openapi(telegramCastCountRoute, telegramCastCountHandler(deps))
      .openapi(telegramCastOptionsRoute, telegramCastOptionsHandler(deps))
      .openapi(telegramCastImageRoute, telegramCastImageHandler(deps))
  );
}
