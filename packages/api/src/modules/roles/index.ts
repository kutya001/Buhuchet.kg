import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { createRoleHandler, createRoleRoute } from './create';
import { deleteRoleHandler, deleteRoleRoute } from './delete';
import {
  exportRolesHandler,
  exportRolesRoute,
  getRoleHandler,
  getRoleRoute,
  listRolesHandler,
  listRolesRoute,
  permissionCatalogHandler,
  permissionCatalogRoute,
  roleValuesHandler,
  roleValuesRoute,
} from './roles';
import { updateRoleHandler, updateRoleRoute } from './update';

/**
 * Роли организации (вкладка «Роли» модуля «Сотрудники»): список (значения для фильтра, выгрузка в
 * Excel), карточка, справочник прав, создание, сохранение прав и области, удаление неиспользуемой
 * роли. Всё — с правом «Сотрудники и роли».
 */
export function rolesModule(deps: ApiDeps) {
  return (
    createModuleApp()
      .openapi(listRolesRoute, listRolesHandler(deps))
      // Раньше `/roles/{id}`: иначе «values» и «export» разбирались бы как номер роли.
      .openapi(roleValuesRoute, roleValuesHandler(deps))
      .openapi(exportRolesRoute, exportRolesHandler(deps))
      .openapi(getRoleRoute, getRoleHandler(deps))
      .openapi(permissionCatalogRoute, permissionCatalogHandler(deps))
      .openapi(createRoleRoute, createRoleHandler(deps))
      .openapi(updateRoleRoute, updateRoleHandler(deps))
      .openapi(deleteRoleRoute, deleteRoleHandler(deps))
  );
}
