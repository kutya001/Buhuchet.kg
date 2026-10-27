import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  adminGetUser,
  adminSetUserBlocked,
  exportAdminUsers,
  listAdminUsersPage,
  listAdminUserValues,
  withOrgContext,
  withUserContext,
  type AdminUserRecord,
} from '@buhuchet/db';
import { accountActionRefusal, RecordChangedError, RecordNotFoundError } from '@buhuchet/domain';
import {
  AdminUser,
  AdminUserList,
  AdminUserVersionRequest,
  ApiError,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  Uuid,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses, versionedSaveResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;

/** Учётная запись для ответа API: только поля схемы, моменты — строкой ISO. */
export function adminUserBody(u: AdminUserRecord): AdminUser {
  return {
    id: u.id,
    login: u.login,
    fullName: u.fullName,
    orgId: u.orgId,
    orgName: u.orgName,
    role: u.role,
    isPlatformAdmin: u.isPlatformAdmin,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    blocked: u.blocked,
    status: u.status,
    audit: {
      createdAt: u.audit.createdAt.toISOString(),
      createdBy: u.audit.createdBy,
      updatedAt: u.audit.updatedAt.toISOString(),
      updatedBy: u.audit.updatedBy,
    },
    version: u.version,
  };
}

export const listUsersRoute = createRoute({
  method: 'get',
  path: '/admin/users',
  tags: ['admin'],
  summary: 'Учётные записи платформы: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description:
        'Страница списка учётных записей: сортировка, страница, фильтры, поиск и группы — на сервере',
      content: { 'application/json': { schema: AdminUserList } },
    },
    ...listQueryResponses,
    ...denied,
  },
});

/**
 * Админка → «Учётные записи» (прототип admin/accounts-orgs.js, renderAccounts): все пользователи
 * платформы — сотрудники всех организаций и администраторы платформы; в ответе — текущая страница,
 * всего по фильтру, итоги и группы.
 */
export function listUsersHandler(deps: ApiDeps): RouteHandler<typeof listUsersRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listAdminUsersPage(tx, query, t),
    );
    return c.json(
      {
        items: page.rows.map(adminUserBody),
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

export const userValuesRoute = createRoute({
  method: 'get',
  path: '/admin/users/values',
  tags: ['admin'],
  summary: 'Значения столбца списка учётных записей для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом записей во всём списке',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    ...denied,
  },
});

/** Значения для фильтра-галочек столбца: организация, роль, статус, «Создал»…; `q` — «Найти значение». */
export function userValuesHandler(deps: ApiDeps): RouteHandler<typeof userValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listAdminUserValues(tx, col, t, q),
    );
    return c.json(values, 200);
  };
}

export const exportUsersRoute = createRoute({
  method: 'get',
  path: '/admin/users/export',
  tags: ['admin'],
  summary: 'Учётные записи платформы в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми записями под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

/** Выгрузка списка учётных записей в Excel: все под поиском и фильтрами, видимые столбцы по порядку. */
export function exportUsersHandler(deps: ApiDeps): RouteHandler<typeof exportUsersRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = c.get('session')!.userId;
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const result = await withUserContext(
        deps.db,
        userId,
        (tx) => exportAdminUsers(tx, query, keys, t),
        'export',
      );
      return xlsxResponse(c, {
        title: t('nav.accounts'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        t,
      });
    });
  };
}

function blockRoute(action: 'block' | 'unblock') {
  return createRoute({
    method: 'post',
    path: `/admin/users/{id}/${action}`,
    tags: ['admin'],
    summary: action === 'block' ? 'Заблокировать учётную запись' : 'Разблокировать учётную запись',
    middleware: [requirePlatformAdmin] as const,
    request: {
      params: z.object({ id: Uuid }),
      body: {
        required: true,
        content: { 'application/json': { schema: AdminUserVersionRequest } },
      },
    },
    responses: {
      200: {
        description:
          action === 'block'
            ? 'Учётная запись заблокирована: пользователь не входит, его сеансы завершены'
            : 'Учётная запись разблокирована (блокировку сотрудника владельцем снимает владелец)',
        content: { 'application/json': { schema: AdminUser } },
      },
      400: {
        description: 'Своя учётная запись или учётная запись администратора платформы',
        content: error,
      },
      ...denied,
      ...versionedSaveResponses,
    },
  });
}

export const blockUserRoute = blockRoute('block');
export const unblockUserRoute = blockRoute('unblock');

/**
 * «Заблокировать» и «Разблокировать» в Админке → «Учётные записи» (ТЗ «Сброс пароля, блокировка,
 * разблокировка»; прототип accActions): заблокированный пользователь не входит, открытые сеансы
 * закрываются сразу; действие идёт в контексте организации пользователя от имени администратора и
 * пишется в её историю. Блокировка сотрудника владельцем — отдельная, её снимает владелец
 * (docs/decisions.md, п. 17; docs/deviations.md, п. 49). Свою учётную запись и учётные записи
 * администраторов платформы здесь не блокируют. Устаревшая версия — 409 «запись изменена другим
 * пользователем».
 */
export function userBlockHandler(
  deps: ApiDeps,
  action: 'block' | 'unblock',
): RouteHandler<typeof blockUserRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('json');
    const adminId = c.get('session')!.userId;
    const found = await withUserContext(deps.db, adminId, (tx) => adminGetUser(tx, id));
    if (!found) throw new RecordNotFoundError('user', id);
    const refusal = accountActionRefusal(adminId, found);
    if (refusal === 'self') apiFail(400, 'account_self', 'Это ваша учётная запись');
    if (refusal === 'platform_admin' || !found.orgId) {
      apiFail(
        400,
        'account_platform_admin',
        'Учётные записи администраторов платформы здесь не меняются',
      );
    }
    const result = await withOrgContext(deps.db, { orgId: found.orgId, userId: adminId }, (tx) =>
      adminSetUserBlocked(tx, { userId: id, blocked: action === 'block', version }),
    );
    if (!result.ok) {
      if (result.reason === 'not_found') throw new RecordNotFoundError('user', id);
      const now = await withUserContext(deps.db, adminId, (tx) => adminGetUser(tx, id));
      throw new RecordChangedError('user', id, now?.version ?? version);
    }
    return c.json(adminUserBody(result.record), 200);
  };
}
