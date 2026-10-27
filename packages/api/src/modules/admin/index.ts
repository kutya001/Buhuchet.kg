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
import { adminResetPasswordHandler, adminResetPasswordRoute } from './password-reset';
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

/**
 * Модуль «Админка»: «Учётные записи» — список всех пользователей платформы, сброс пароля (#6),
 * блокировка; «Организации» — список, создание вместе с владельцем, блокировка; остальные разделы —
 * поток Д.
 */
export function adminModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(listUsersRoute, listUsersHandler(deps))
    .openapi(userValuesRoute, userValuesHandler(deps))
    .openapi(exportUsersRoute, exportUsersHandler(deps))
    .openapi(blockUserRoute, userBlockHandler(deps, 'block'))
    .openapi(unblockUserRoute, userBlockHandler(deps, 'unblock'))
    .openapi(adminResetPasswordRoute, adminResetPasswordHandler(deps))
    .openapi(listOrganizationsRoute, listOrganizationsHandler(deps))
    .openapi(organizationValuesRoute, organizationValuesHandler(deps))
    .openapi(exportOrganizationsRoute, exportOrganizationsHandler(deps))
    .openapi(organizationSummaryRoute, organizationSummaryHandler(deps))
    .openapi(createOrganizationRoute, createOrganizationHandler(deps))
    .openapi(blockOrganizationRoute, organizationStatusHandler(deps, 'block'))
    .openapi(unblockOrganizationRoute, organizationStatusHandler(deps, 'unblock'));
}
