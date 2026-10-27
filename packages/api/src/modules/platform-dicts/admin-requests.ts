import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  adminAnswerDictRequest,
  exportAdminDictRequests,
  getAdminDictRequest,
  listAdminDictRequestsPage,
  listAdminDictRequestValues,
  withUserContext,
  type AdminDictRequestRecord,
} from '@buhuchet/db';
import { RecordChangedError, RecordNotFoundError } from '@buhuchet/domain';
import {
  AdminDictRequest,
  AdminDictRequestList,
  ApiError,
  DictRequestAnswerRequest,
  DictRequestIdParam,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { listQueryOf, listQueryResponses, versionedSaveResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

/*
 * Админка → «Справочники платформы» → «Запросы» (прототип v59 renderPDicts0, reqAnswerDlg; решение
 * заказчика по docs/deviations.md п. 46): запросы «Попросить добавить» всех организаций — список,
 * значения фильтра, «В Excel» и ответ «Добавлено» / «Отклонить». Только администратору платформы.
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;

/** Запрос для ответа API: моменты — строкой ISO. */
function requestBody(x: AdminDictRequestRecord): AdminDictRequest {
  return {
    id: x.id,
    orgName: x.orgName,
    dict: x.dict,
    what: x.what,
    comment: x.comment,
    status: x.status,
    answer: x.answer,
    decidedAt: x.decidedAt?.toISOString() ?? null,
    audit: {
      createdAt: x.audit.createdAt.toISOString(),
      createdBy: x.audit.createdBy,
      updatedAt: x.audit.updatedAt.toISOString(),
      updatedBy: x.audit.updatedBy,
    },
    version: x.version,
  };
}

export const listAdminDictRequestsRoute = createRoute({
  method: 'get',
  path: '/admin/dict-requests',
  tags: ['platform-dicts'],
  summary: '«Запросы» организаций: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description: 'Запросы всех организаций; поиск, фильтры и группы — на сервере',
      content: { 'application/json': { schema: AdminDictRequestList } },
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function listAdminDictRequestsHandler(
  deps: ApiDeps,
): RouteHandler<typeof listAdminDictRequestsRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listAdminDictRequestsPage(tx, query, t),
    );
    return c.json(
      {
        items: page.rows.map(requestBody),
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

export const adminDictRequestValuesRoute = createRoute({
  method: 'get',
  path: '/admin/dict-requests/values',
  tags: ['platform-dicts'],
  summary: 'Значения столбца «Запросов» для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом запросов',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function adminDictRequestValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminDictRequestValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listAdminDictRequestValues(tx, col, t, q),
    );
    return c.json(values, 200);
  };
}

export const exportAdminDictRequestsRoute = createRoute({
  method: 'get',
  path: '/admin/dict-requests/export',
  tags: ['platform-dicts'],
  summary: '«Запросы» в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListExportParams },
  responses: {
    200: { description: 'Файл Excel с запросами под поиском и фильтрами', content: xlsxContent },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function exportAdminDictRequestsHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportAdminDictRequestsRoute, AppEnv> {
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
        (tx) => exportAdminDictRequests(tx, query, keys, t),
        'export',
      );
      return xlsxResponse(c, {
        title: t('tab.pdicts.requests'),
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

export const answerDictRequestRoute = createRoute({
  method: 'post',
  path: '/admin/dict-requests/{id}/answer',
  tags: ['platform-dicts'],
  summary: 'Ответ на запрос: «Добавлено» или «Отклонено»',
  middleware: [requirePlatformAdmin] as const,
  request: {
    params: DictRequestIdParam,
    body: { required: true, content: { 'application/json': { schema: DictRequestAnswerRequest } } },
  },
  responses: {
    200: {
      description: 'Статус и ответ сохранены: организация видит их в «Мои запросы»',
      content: { 'application/json': { schema: AdminDictRequest } },
    },
    400: { description: 'Отказ без ответа или ответ длиннее предела', content: error },
    ...denied,
    ...versionedSaveResponses,
  },
});

/**
 * «Добавлено» / «Отклонить» (прототип v59 reqAnswerDlg): при отказе ответ обязателен — это проверяет
 * схема запроса (400) и функция базы. Устаревшая версия — 409 «запись изменена другим пользователем».
 */
export function answerDictRequestHandler(
  deps: ApiDeps,
): RouteHandler<typeof answerDictRequestRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { status, answer, version } = c.req.valid('json');
    const userId = c.get('session')!.userId;
    const result = await withUserContext(deps.db, userId, (tx) =>
      adminAnswerDictRequest(tx, { id, status, answer, version }),
    );
    if (!result.ok) {
      const now = await withUserContext(deps.db, userId, (tx) => getAdminDictRequest(tx, id));
      if (result.reason === 'changed' && now) {
        throw new RecordChangedError('dict_request', id, now.version);
      }
      throw new RecordNotFoundError('dict_request', id);
    }
    return c.json(requestBody(result.record), 200);
  };
}
