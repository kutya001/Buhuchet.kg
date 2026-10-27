import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  createDictRequest,
  exportPlatformDict,
  exportPlatformValues,
  listDictRequests,
  listPlatformDictPage,
  listPlatformDictValues,
  listPlatformValuesPage,
  listPlatformValueValues,
  platformDictTiles,
  platformDictTitle,
  withOrgContext,
  type DictRequestRecord,
  type ListPageResult,
  takeRateLimit,
  type RateLimit,
} from '@buhuchet/db';
import { bishkekDate, DICT_REQUEST_HOURLY_LIMIT } from '@buhuchet/domain';
import {
  ApiError,
  DictRequest,
  DictRequestCreate,
  DictRequests,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  PlatformDictGroups,
  PlatformDictList,
  PlatformDictParam,
  PlatformValueList,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

/*
 * «Справочники» → «Справочники платформы» (задача 2.03; ТЗ «Справочники платформы — только просмотр»;
 * прототип modules/dicts.js, dict-guide.js): плитки по группам, окно справочника со списком значений,
 * «Поиск по всем значениям» — видят все сотрудники, менять нельзя (только администратор платформы в
 * Админке). «Попросить добавить» — любой сотрудник; «Мои запросы» — запросы своей организации
 * (docs/deviations.md п. 46).
 */

const error = { 'application/json': { schema: ApiError } };
const access = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не сотрудник организации', content: error },
} as const;

/** «Сегодня» по Бишкеку: календарь в окне — текущего года. */
const todayOf = (deps: ApiDeps) => bishkekDate(deps.clock.now());

const pageBody = <T>(page: ListPageResult<T>) => ({
  items: page.rows,
  total: page.total,
  page: page.page,
  size: page.size,
  totals: page.totals,
  ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
});

export const platformDictTilesRoute = createRoute({
  method: 'get',
  path: '/platform-dicts',
  tags: ['dicts'],
  summary: '«Справочники платформы»: плитки справочников по группам',
  middleware: [requireEmployee] as const,
  responses: {
    200: {
      description:
        'Группы справочников с плитками: название, число действующих значений, что это и где используется',
      content: { 'application/json': { schema: PlatformDictGroups } },
    },
    ...access,
  },
});

export function platformDictTilesHandler(
  deps: ApiDeps,
): RouteHandler<typeof platformDictTilesRoute, AppEnv> {
  return async (c) => {
    const t = await serverTexts(deps);
    const groups = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      platformDictTiles(tx, t, todayOf(deps)),
    );
    return c.json({ groups }, 200);
  };
}

export const platformDictListRoute = createRoute({
  method: 'get',
  path: '/platform-dicts/{id}',
  tags: ['dicts'],
  summary: 'Окно справочника платформы: страница списка значений',
  middleware: [requireEmployee] as const,
  request: { params: PlatformDictParam, query: ListQueryParams },
  responses: {
    200: {
      description: 'Страница действующих значений справочника; столбцы — как в окне справочника',
      content: { 'application/json': { schema: PlatformDictList } },
    },
    ...listQueryResponses,
    ...access,
  },
});

export function platformDictListHandler(
  deps: ApiDeps,
): RouteHandler<typeof platformDictListRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      listPlatformDictPage(tx, id, query, t, todayOf(deps)),
    );
    return c.json(pageBody(page), 200);
  };
}

export const platformDictValuesRoute = createRoute({
  method: 'get',
  path: '/platform-dicts/{id}/values',
  tags: ['dicts'],
  summary: 'Значения столбца окна справочника платформы для фильтра',
  middleware: [requireEmployee] as const,
  request: { params: PlatformDictParam, query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом записей',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    ...access,
  },
});

export function platformDictValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof platformDictValuesRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      listPlatformDictValues(tx, id, col, t, todayOf(deps), q),
    );
    return c.json(values, 200);
  };
}

export const exportPlatformDictRoute = createRoute({
  method: 'get',
  path: '/platform-dicts/{id}/export',
  tags: ['dicts'],
  summary: 'Справочник платформы в Excel',
  middleware: [requireEmployee, requirePermission('export')] as const,
  request: { params: PlatformDictParam, query: ListExportParams },
  responses: {
    200: { description: 'Файл Excel со значениями под поиском и фильтрами', content: xlsxContent },
    ...listQueryResponses,
    ...exportRateResponses,
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Выгружать в Excel»', content: error },
  },
});

export function exportPlatformDictHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportPlatformDictRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const { title, result } = await withOrgContext(
        deps.db,
        { ...orgContextOf(c), kind: 'export' },
        async (tx) => ({
          title: await platformDictTitle(tx, id, t),
          result: await exportPlatformDict(tx, id, query, keys, t, todayOf(deps)),
        }),
      );
      return xlsxResponse(c, {
        title,
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

export const platformValuesRoute = createRoute({
  method: 'get',
  path: '/platform-values',
  tags: ['dicts'],
  summary: '«Поиск по всем значениям» справочников платформы: страница списка',
  middleware: [requireEmployee] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description: 'Страница общей таблицы «Справочник — значение»',
      content: { 'application/json': { schema: PlatformValueList } },
    },
    ...listQueryResponses,
    ...access,
  },
});

export function platformValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof platformValuesRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      listPlatformValuesPage(tx, query, t, todayOf(deps)),
    );
    return c.json(pageBody(page), 200);
  };
}

export const platformValueValuesRoute = createRoute({
  method: 'get',
  path: '/platform-values/values',
  tags: ['dicts'],
  summary: 'Значения столбца «Поиска по всем значениям» для фильтра',
  middleware: [requireEmployee] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом записей',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    ...access,
  },
});

export function platformValueValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof platformValueValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      listPlatformValueValues(tx, col, t, todayOf(deps), q),
    );
    return c.json(values, 200);
  };
}

export const exportPlatformValuesRoute = createRoute({
  method: 'get',
  path: '/platform-values/export',
  tags: ['dicts'],
  summary: '«Поиск по всем значениям» в Excel',
  middleware: [requireEmployee, requirePermission('export')] as const,
  request: { query: ListExportParams },
  responses: {
    200: { description: 'Файл Excel со значениями под поиском и фильтрами', content: xlsxContent },
    ...listQueryResponses,
    ...exportRateResponses,
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Выгружать в Excel»', content: error },
  },
});

export function exportPlatformValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportPlatformValuesRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await withOrgContext(deps.db, { ...orgContextOf(c), kind: 'export' }, (tx) =>
        exportPlatformValues(tx, query, keys, t, todayOf(deps)),
      );
      return xlsxResponse(c, {
        title: t('dicts.platform.all_values'),
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

/** Запрос для ответа API: моменты — строкой ISO. */
const requestBody = (r: DictRequestRecord): DictRequest => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString() ?? null,
});

export const createDictRequestRoute = createRoute({
  method: 'post',
  path: '/dict-requests',
  tags: ['dicts'],
  summary: '«Попросить добавить»: запрос администратору платформы',
  middleware: [requireEmployee] as const,
  request: { body: { content: { 'application/json': { schema: DictRequestCreate } } } },
  responses: {
    201: {
      description: 'Запрос отправлен: статус «Новый»',
      content: { 'application/json': { schema: DictRequest } },
    },
    400: { description: 'Не выбран справочник или пусто «Что добавить»', content: error },
    429: {
      description: 'Больше `DICT_REQUEST_HOURLY_LIMIT` запросов за час от пользователя',
      content: error,
    },
    ...access,
  },
});

/** Предел «Попросить добавить» (docs/decisions.md, п. Д-2): запросов за час от одного пользователя. */
export const DICT_REQUEST_RATE_LIMIT: RateLimit = {
  kind: 'dict_request',
  max: DICT_REQUEST_HOURLY_LIMIT,
  windowSeconds: 3600,
};

/**
 * Отправить запрос; больше `DICT_REQUEST_HOURLY_LIMIT` за час от пользователя — 429
 * `dict_request_rate`, чтобы запросами не завалили «Запросы» администратора. Попытка с неверными
 * данными (400) в счёт не идёт: тело проверено раньше.
 */
export function createDictRequestHandler(
  deps: ApiDeps,
): RouteHandler<typeof createDictRequestRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const userId = c.get('session')!.userId;
    // ОТКЛОНЕНИЕ: docs/deviations.md#Д-4 — не больше 20 запросов в час от пользователя.
    const take = await takeRateLimit(deps.db, DICT_REQUEST_RATE_LIMIT, userId);
    if (!take.ok) {
      apiFail(
        429,
        'dict_request_rate',
        `Не больше ${DICT_REQUEST_HOURLY_LIMIT} запросов за час. Попробуйте позже.`,
        { n: DICT_REQUEST_HOURLY_LIMIT },
      );
    }
    const created = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      createDictRequest(tx, { dict: body.dict, what: body.what, comment: body.comment ?? '' }),
    );
    return c.json(requestBody(created), 201);
  };
}

export const listDictRequestsRoute = createRoute({
  method: 'get',
  path: '/dict-requests',
  tags: ['dicts'],
  summary: '«Мои запросы»: запросы организации администратору платформы',
  middleware: [requireEmployee] as const,
  responses: {
    200: {
      description: 'Запросы организации, сначала новые: что просили, статус и ответ',
      content: { 'application/json': { schema: DictRequests } },
    },
    ...access,
  },
});

export function listDictRequestsHandler(
  deps: ApiDeps,
): RouteHandler<typeof listDictRequestsRoute, AppEnv> {
  return async (c) => {
    const items = await withOrgContext(deps.db, orgContextOf(c), (tx) => listDictRequests(tx));
    return c.json({ items: items.map(requestBody) }, 200);
  };
}
