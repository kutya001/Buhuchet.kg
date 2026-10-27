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

/**
 * Модуль «Админка»: сброс пароля пользователя организации (#6) и «Организации» — список, создание
 * вместе с владельцем, блокировка; остальные разделы — поток Д.
 */
export function adminModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(adminResetPasswordRoute, adminResetPasswordHandler(deps))
    .openapi(listOrganizationsRoute, listOrganizationsHandler(deps))
    .openapi(organizationValuesRoute, organizationValuesHandler(deps))
    .openapi(exportOrganizationsRoute, exportOrganizationsHandler(deps))
    .openapi(organizationSummaryRoute, organizationSummaryHandler(deps))
    .openapi(createOrganizationRoute, createOrganizationHandler(deps))
    .openapi(blockOrganizationRoute, organizationStatusHandler(deps, 'block'))
    .openapi(unblockOrganizationRoute, organizationStatusHandler(deps, 'unblock'));
}
