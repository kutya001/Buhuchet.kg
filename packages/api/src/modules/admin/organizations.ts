import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { hashPassword } from '@buhuchet/adapters/password';
import {
  adminGetOrganization,
  adminOrgSlugs,
  adminOrgSummary,
  adminSetOrganizationStatus,
  exportAdminOrgs,
  listAdminOrgsPage,
  listAdminOrgValues,
  withOrgContext,
  withUserContext,
  type AdminOrganizationRecord,
} from '@buhuchet/db';
import { createOrganization, OrganizationInputError } from '@buhuchet/db/organizations';
import {
  isValidLogin,
  isValidOrgInn,
  normalizeLogin,
  ORG_PROFILE_MESSAGES,
  RecordChangedError,
  RecordNotFoundError,
  slugFree,
  slugOf,
} from '@buhuchet/domain';
import {
  AdminOrganization,
  AdminOrganizationList,
  AdminOrgSummary,
  ApiError,
  CreatedOrganization,
  CreateOrganizationRequest,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  OrganizationVersionRequest,
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

/** Организация для ответа API: только поля схемы, моменты — строкой ISO. */
export function adminOrganizationBody(o: AdminOrganizationRecord): AdminOrganization {
  return {
    id: o.id,
    name: o.name,
    inn: o.inn,
    slug: o.slug,
    ownerLogin: o.ownerLogin,
    contractors: o.contractors,
    employees: o.employees,
    active: o.active,
    blockedReason: o.blockedReason,
    isDemo: o.isDemo,
    audit: {
      createdAt: o.audit.createdAt.toISOString(),
      createdBy: o.audit.createdBy,
      updatedAt: o.audit.updatedAt.toISOString(),
      updatedBy: o.audit.updatedBy,
    },
    version: o.version,
  };
}

export const listOrganizationsRoute = createRoute({
  method: 'get',
  path: '/admin/organizations',
  tags: ['admin'],
  summary: 'Организации платформы: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description:
        'Страница списка организаций: сортировка, страница, фильтры, поиск и группы — на сервере',
      content: { 'application/json': { schema: AdminOrganizationList } },
    },
    ...listQueryResponses,
    ...denied,
  },
});

/**
 * Админка → «Организации» (прототип admin/accounts-orgs.js, renderOrgs): все организации платформы,
 * в ответе — текущая страница, всего по фильтру, итоги и группы.
 */
export function listOrganizationsHandler(
  deps: ApiDeps,
): RouteHandler<typeof listOrganizationsRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listAdminOrgsPage(tx, query, t),
    );
    return c.json(
      {
        items: page.rows.map(adminOrganizationBody),
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

export const organizationValuesRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/values',
  tags: ['admin'],
  summary: 'Значения столбца списка организаций для фильтра',
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

/** Значения для фильтра-галочек столбца: статус, владелец, «Создал»…; `q` — «Найти значение». */
export function organizationValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof organizationValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listAdminOrgValues(tx, col, t, q),
    );
    return c.json(values, 200);
  };
}

export const exportOrganizationsRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/export',
  tags: ['admin'],
  summary: 'Организации платформы в Excel',
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

/** Выгрузка списка организаций в Excel: все под поиском и фильтрами, видимые столбцы по порядку. */
export function exportOrganizationsHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportOrganizationsRoute, AppEnv> {
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
        (tx) => exportAdminOrgs(tx, query, keys, t),
        'export',
      );
      return xlsxResponse(c, {
        title: t('nav.organizations'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        t,
      });
    });
  };
}

export const organizationSummaryRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/summary',
  tags: ['admin'],
  summary: 'Плашки над списком организаций',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description:
        'Активных организаций, контрагентов на платформе, учётных записей организаций, запросов на добавление в справочники',
      content: { 'application/json': { schema: AdminOrgSummary } },
    },
    ...denied,
  },
});

export function organizationSummaryHandler(
  deps: ApiDeps,
): RouteHandler<typeof organizationSummaryRoute, AppEnv> {
  return async (c) => {
    const summary = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      adminOrgSummary(tx),
    );
    return c.json(summary, 200);
  };
}

export const createOrganizationRoute = createRoute({
  method: 'post',
  path: '/admin/organizations',
  tags: ['admin'],
  summary: 'Новая организация вместе с владельцем',
  middleware: [requirePlatformAdmin] as const,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateOrganizationRequest } },
    },
  },
  responses: {
    201: {
      description: 'Организация и владелец с временным паролем созданы',
      content: { 'application/json': { schema: CreatedOrganization } },
    },
    400: { description: 'Неверные данные, ИНН или логин заняты', content: error },
    ...denied,
  },
});

/** Отказ в данных новой организации: код и текст для поля формы. */
function inputFail(err: OrganizationInputError): never {
  switch (err.field) {
    case 'name':
      return apiFail(400, 'name_required', err.message);
    case 'inn':
      return apiFail(
        400,
        err.message === ORG_PROFILE_MESSAGES.inn_taken ? 'inn_taken' : 'inn_invalid',
        err.message,
      );
    case 'ownerFullName':
      return apiFail(400, 'owner_fio_required', err.message);
    case 'ownerLogin':
      return err.message === 'Логин уже занят'
        ? apiFail(400, 'login_taken', 'Такой логин уже занят на платформе')
        : apiFail(400, 'invalid_login', err.message);
    case 'slug':
      return apiFail(400, 'slug_taken', err.message);
    case 'templates':
      throw err;
  }
}

/**
 * «Новая организация» (ТЗ «Админка» → «Создание организации и её владельца»; прототип addOrgDlg):
 * название, ИНН (14 цифр, второй организации с таким ИНН быть не может), ФИО и логин владельца
 * (уникален на платформе), временный пароль — при первом входе владелец его меняет. Организация
 * получает копии шаблонов ролей и учётную политику по умолчанию (`createOrganization`); адрес страницы
 * — первый свободный по названию (прототип slugFree). Создание пишется в историю организации от имени
 * администратора.
 */
export function createOrganizationHandler(
  deps: ApiDeps,
): RouteHandler<typeof createOrganizationRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const adminId = c.get('session')!.userId;
    if (!isValidOrgInn(body.inn)) apiFail(400, 'inn_invalid', ORG_PROFILE_MESSAGES.inn_invalid);
    const login = normalizeLogin(body.ownerLogin);
    if (!isValidLogin(login)) {
      apiFail(400, 'invalid_login', 'Латиница, цифры, точка, дефис; от 3 символов');
    }
    const taken = await withUserContext(deps.db, adminId, (tx) => adminOrgSlugs(tx));
    const passwordHash = await hashPassword(body.temporaryPassword);
    let orgId: string;
    try {
      ({ orgId } = await createOrganization(deps.db, {
        name: body.name,
        inn: body.inn,
        slug: slugFree(slugOf(body.name), taken),
        owner: { fullName: body.ownerFullName, login, passwordHash },
        createdBy: adminId,
      }));
    } catch (err) {
      if (err instanceof OrganizationInputError) inputFail(err);
      throw err;
    }
    const organization = await withUserContext(deps.db, adminId, (tx) =>
      adminGetOrganization(tx, orgId),
    );
    return c.json({ organization: adminOrganizationBody(organization!) }, 201);
  };
}

function statusRoute(action: 'block' | 'unblock') {
  return createRoute({
    method: 'post',
    path: `/admin/organizations/{id}/${action}`,
    tags: ['admin'],
    summary: action === 'block' ? 'Заблокировать организацию' : 'Разблокировать организацию',
    middleware: [requirePlatformAdmin] as const,
    request: {
      params: z.object({ id: Uuid }),
      body: {
        required: true,
        content: { 'application/json': { schema: OrganizationVersionRequest } },
      },
    },
    responses: {
      200: {
        description:
          action === 'block'
            ? 'Организация заблокирована: её сотрудники не входят, данные сохраняются'
            : 'Организация разблокирована',
        content: { 'application/json': { schema: AdminOrganization } },
      },
      400: { description: 'Демо-организацию стенда не блокируют', content: error },
      ...denied,
      ...versionedSaveResponses,
    },
  });
}

export const blockOrganizationRoute = statusRoute('block');
export const unblockOrganizationRoute = statusRoute('unblock');

/**
 * «Заблокировать» и «Разблокировать» организацию (ТЗ «Блокировка организации», например при
 * неоплате платформы; прототип renderOrgs): сотрудники заблокированной при входе видят сообщение о
 * блокировке, открытые сеансы перестают работать со следующего запроса; данные сохраняются и
 * возвращаются при разблокировке. Демо-организацию стенда не блокируют (как в прототипе). Устаревшая
 * версия — 409 «запись изменена другим пользователем».
 */
export function organizationStatusHandler(
  deps: ApiDeps,
  action: 'block' | 'unblock',
): RouteHandler<typeof blockOrganizationRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('json');
    const adminId = c.get('session')!.userId;
    const t = await serverTexts(deps);
    const found = await withUserContext(deps.db, adminId, (tx) => adminGetOrganization(tx, id));
    if (!found) throw new RecordNotFoundError('organization', id);
    if (action === 'block' && found.isDemo) {
      apiFail(400, 'demo_org', 'Демо-организацию стенда не блокируют');
    }
    const result = await withOrgContext(deps.db, { orgId: id, userId: adminId }, (tx) =>
      adminSetOrganizationStatus(tx, {
        orgId: id,
        blocked: action === 'block',
        reason: action === 'block' ? t('orgs.block.reason') : null,
        version,
      }),
    );
    if (!result.ok) {
      if (result.reason === 'not_found') throw new RecordNotFoundError('organization', id);
      const now = await withUserContext(deps.db, adminId, (tx) => adminGetOrganization(tx, id));
      throw new RecordChangedError('organization', id, now?.version ?? version);
    }
    return c.json(adminOrganizationBody(result.record), 200);
  };
}
