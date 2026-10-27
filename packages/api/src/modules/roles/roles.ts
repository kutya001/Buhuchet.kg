import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  exportRoles,
  getRole,
  listRolesPage,
  listRoleValues,
  permissionCatalog,
  roleRightsMap,
  withOrgContext,
  type RoleRecord,
  type RoleSummary,
} from '@buhuchet/db';
import {
  permissionGroup,
  RecordNotFoundError,
  roleReadOnly,
  type RoleReadOnly,
  type RoleSaveEditor,
} from '@buhuchet/domain';
import {
  ApiError,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  PermissionCatalog,
  Role,
  RoleList,
  type RoleListItem,
  Uuid,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { staffActor } from '../staff/employees';

export const error = { 'application/json': { schema: ApiError } };

/** Роль в списке для ответа API: моменты — строкой ISO; `readOnly` — для того, кто смотрит. */
export function roleSummaryBody(r: RoleSummary, readOnly: RoleReadOnly | null): RoleListItem {
  return {
    id: r.id,
    name: r.name,
    isOwner: r.isOwner,
    templateCode: r.templateCode,
    employees: r.employees,
    permissionCount: r.permissionCount,
    readOnly,
    audit: {
      createdAt: r.audit.createdAt.toISOString(),
      createdBy: r.audit.createdBy,
      updatedAt: r.audit.updatedAt.toISOString(),
      updatedBy: r.audit.updatedBy,
    },
    version: r.version,
  };
}

/**
 * Карточка роли для ответа API: только ли для чтения она тому, кто смотрит (`roleReadOnly`: своя, с
 * правами «выдаёт только владелец», шире своей).
 */
export function roleBody(r: RoleRecord, editor: RoleSaveEditor): Role {
  return {
    ...roleSummaryBody(r, roleReadOnly(editor, r)),
    permissions: r.permissions,
    scopes: r.scopes,
  };
}

export const listRolesRoute = createRoute({
  method: 'get',
  path: '/roles',
  tags: ['roles'],
  summary: 'Роли организации: страница списка',
  middleware: [requirePermission('staff')] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description:
        'Страница списка ролей с числом сотрудников и прав: сортировка, страница, фильтры, поиск и группы — на сервере',
      content: { 'application/json': { schema: RoleList } },
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Сотрудники и роли»', content: error },
  },
});

/**
 * Вкладка «Роли» (прототип modules/staff.js, renderStaff): роль, число сотрудников, число прав,
 * изменено — на общем списке; по умолчанию по названию. Вкладку видит только тот, у кого есть право
 * «Сотрудники и роли». Все роли для выбора в формах — `size=all`.
 */
export function listRolesHandler(deps: ApiDeps): RouteHandler<typeof listRolesRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const editor = staffActor(c);
    const { page, rights } = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const page = await listRolesPage(tx, query);
      return {
        page,
        rights: await roleRightsMap(
          tx,
          page.rows.map((r) => r.id),
        ),
      };
    });
    // Роль удалили между запросами: не владельцу — только для чтения, как сотрудник без признака.
    const readOnly = (r: RoleSummary) => {
      const role = rights.get(r.id);
      if (role) return roleReadOnly(editor, { id: r.id, ...role });
      return editor.isOwner || r.isOwner ? null : 'beyond_own_role';
    };
    return c.json(
      {
        items: page.rows.map((r) => roleSummaryBody(r, readOnly(r))),
        total: page.total,
        page: page.page,
        size: page.size,
        totals: page.totals,
        ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
      },
      200,
    );
  };
}

export const roleValuesRoute = createRoute({
  method: 'get',
  path: '/roles/values',
  tags: ['roles'],
  summary: 'Значения столбца списка ролей для фильтра',
  middleware: [requirePermission('staff')] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом записей во всём списке',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Сотрудники и роли»', content: error },
  },
});

/** Значения для фильтра-галочек столбца («Изменил», числа); `q` — «Найти значение» по всем значениям. */
export function roleValuesHandler(deps: ApiDeps): RouteHandler<typeof roleValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const values = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      listRoleValues(tx, col, q),
    );
    return c.json(values, 200);
  };
}

export const exportRolesRoute = createRoute({
  method: 'get',
  path: '/roles/export',
  tags: ['roles'],
  summary: 'Роли в Excel',
  middleware: [requirePermission('staff'), requirePermission('export')] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми записями под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Сотрудники и роли» или «Выгружать в Excel»', content: error },
  },
});

/** Выгрузка списка ролей в Excel: все записи под поиском и фильтрами, видимые столбцы по порядку экрана. */
export function exportRolesHandler(deps: ApiDeps): RouteHandler<typeof exportRolesRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await withOrgContext(deps.db, { ...orgContextOf(c), kind: 'export' }, (tx) =>
        exportRoles(tx, query, keys),
      );
      return xlsxResponse(c, {
        title: t('tab.staff.roles'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        total: result.total,
        t,
      });
    });
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
    return c.json(roleBody(role, staffActor(c)), 200);
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
