import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  getRole,
  listRoles,
  permissionCatalog,
  withOrgContext,
  type RoleRecord,
  type RoleSummary,
} from '@buhuchet/db';
import { permissionGroup, RecordNotFoundError } from '@buhuchet/domain';
import {
  ApiError,
  PermissionCatalog,
  Role,
  RoleList,
  type RoleListItem,
  Uuid,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { orgContextOf, requirePermission } from '../../middleware/access';

export const error = { 'application/json': { schema: ApiError } };

/** Роль в списке для ответа API: моменты — строкой ISO. */
export function roleSummaryBody(r: RoleSummary): RoleListItem {
  return {
    id: r.id,
    name: r.name,
    isOwner: r.isOwner,
    employees: r.employees,
    permissionCount: r.permissionCount,
    audit: {
      createdAt: r.audit.createdAt.toISOString(),
      createdBy: r.audit.createdBy,
      updatedAt: r.audit.updatedAt.toISOString(),
      updatedBy: r.audit.updatedBy,
    },
    version: r.version,
  };
}

/** Карточка роли для ответа API. */
export function roleBody(r: RoleRecord): Role {
  return { ...roleSummaryBody(r), permissions: r.permissions, scopes: r.scopes };
}

export const listRolesRoute = createRoute({
  method: 'get',
  path: '/roles',
  tags: ['roles'],
  summary: 'Роли организации: число сотрудников и прав',
  middleware: [requirePermission('staff')] as const,
  responses: {
    200: { description: 'Роли', content: { 'application/json': { schema: RoleList } } },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Сотрудники и роли»', content: error },
  },
});

/**
 * Вкладка «Роли» (прототип modules/staff.js, renderStaff): роль, число сотрудников, число прав,
 * изменено. Вкладку видит только тот, у кого есть право «Сотрудники и роли».
 */
export function listRolesHandler(deps: ApiDeps): RouteHandler<typeof listRolesRoute, AppEnv> {
  return async (c) => {
    const items = await withOrgContext(deps.db, orgContextOf(c), listRoles);
    return c.json({ items: items.map(roleSummaryBody) }, 200);
  };
}

export const getRoleRoute = createRoute({
  method: 'get',
  path: '/roles/{id}',
  tags: ['roles'],
  summary: 'Карточка роли: права и область групп',
  middleware: [requirePermission('staff')] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: { description: 'Роль', content: { 'application/json': { schema: Role } } },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Сотрудники и роли»', content: error },
    404: { description: 'Роли нет', content: error },
  },
});

/** Карточка роли (прототип modules/staff.js, roleCard): права по группам только для чтения. */
export function getRoleHandler(deps: ApiDeps): RouteHandler<typeof getRoleRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const role = await withOrgContext(deps.db, orgContextOf(c), (tx) => getRole(tx, id));
    if (!role) throw new RecordNotFoundError('role', id);
    return c.json(roleBody(role), 200);
  };
}

export const permissionCatalogRoute = createRoute({
  method: 'get',
  path: '/permissions',
  tags: ['roles'],
  summary: 'Справочник «Права ролей»: названия и описания прав для формы роли',
  middleware: [requirePermission('staff')] as const,
  responses: {
    200: {
      description: 'Права по порядку формы',
      content: { 'application/json': { schema: PermissionCatalog } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Сотрудники и роли»', content: error },
  },
});

/**
 * Права для формы роли (ТЗ: «Названия и описания прав — из справочника платформы «Права ролей»»):
 * описание видно сразу под названием. Группы и их порядок — `PERMISSION_GROUPS` из @buhuchet/domain.
 */
export function permissionCatalogHandler(
  deps: ApiDeps,
): RouteHandler<typeof permissionCatalogRoute, AppEnv> {
  return async (c) => {
    const rows = await withOrgContext(deps.db, orgContextOf(c), permissionCatalog);
    return c.json({ items: rows.map((r) => ({ ...r, group: permissionGroup(r.id) })) }, 200);
  };
}
