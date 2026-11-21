import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  dmRequestsToday,
  exportDmRequests,
  listDmRequestsPage,
  listDmRequestValues,
  withUserContext,
} from '@buhuchet/db';
import {
  ApiError,
  DmRequestList,
  DmRequestSummary,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { activeTokenCount } from './tokens';

/*
 * Админка → «Витрина данных» → «Журнал запросов» (доработки 20.11.2026: Витрина данных, блок 6,
 * пункт 7; поток Т, этап 2, П11; прототип v155 `renderDmLog`): все запросы внешних программ по токенам
 * за 90 дней (журнал чистит «Очистка журналов»), плашки «Запросов сегодня», «Ошибок сегодня»,
 * «Действующих токенов». Только администратор платформы, только чтение, в `withUserContext` (RLS
 * `dm_requests_admin_read`). Строка открывает окно токена — метод `/api/admin/dm/tokens/{id}`.
 */

const error = { 'application/json': { schema: ApiError } };
const json = <T>(schema: T) => ({ 'application/json': { schema } });
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const tags = ['admin'];
const BASE = '/admin/dm/requests' as const;

export const REQUEST_ROUTES = {
  list: createRoute({
    method: 'get',
    path: BASE,
    tags,
    summary: '«Журнал запросов» Витрины данных: страница списка',
    middleware: [requirePlatformAdmin] as const,
    request: { query: ListQueryParams },
    responses: {
      200: { description: 'Запросы по токенам', content: json(DmRequestList) },
      ...listQueryResponses,
      ...denied,
    },
  }),
  values: createRoute({
    method: 'get',
    path: `${BASE}/values` as const,
    tags,
    summary: '«Журнал запросов»: значения столбца для фильтра',
    middleware: [requirePlatformAdmin] as const,
    request: { query: ListValuesQuery },
    responses: {
      200: { description: 'Значения столбца', content: json(ListValues) },
      ...listQueryResponses,
      ...denied,
    },
  }),
  export: createRoute({
    method: 'get',
    path: `${BASE}/export` as const,
    tags,
    summary: '«Журнал запросов» в Excel',
    middleware: [requirePlatformAdmin] as const,
    request: { query: ListExportParams },
    responses: {
      200: { description: 'Файл Excel с запросами под поиском и фильтрами', content: xlsxContent },
      ...listQueryResponses,
      ...exportRateResponses,
      ...denied,
    },
  }),
  summary: createRoute({
    method: 'get',
    path: `${BASE}/summary` as const,
    tags,
    summary: '«Журнал запросов»: плашки — запросов и ошибок сегодня, действующих токенов',
    middleware: [requirePlatformAdmin] as const,
    responses: {
      200: { description: 'Числа плашек', content: json(DmRequestSummary) },
      ...denied,
    },
  }),
};

type R = typeof REQUEST_ROUTES;

export function requestHandlers(deps: ApiDeps) {
  const inAdmin = <T>(c: Context<AppEnv>, fn: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(deps.db, c.get('session')!.userId, fn);

  const list: RouteHandler<R['list'], AppEnv> = async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await inAdmin(c, (tx) => listDmRequestsPage(tx, query, t));
    return c.json(
      {
        items: page.rows.map((x) => ({
          id: x.id,
          at: x.at.toISOString(),
          ok: x.outcome === 'ok',
          orgName: x.orgName,
          tokenId: x.tokenId,
          tokenName: x.tokenName,
          prefix: x.prefix,
          tplName: x.tplName,
          params: x.params,
          rows: x.rows,
          ms: x.ms,
          error: x.error,
          ip: x.ip,
        })),
        total: page.total,
        page: page.page,
        size: page.size,
        totals: page.totals,
        ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
      },
      200,
    );
  };

  const values: RouteHandler<R['values'], AppEnv> = async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const res = await inAdmin(c, (tx) => listDmRequestValues(tx, col, t, q));
    return c.json(res, 200);
  };

  const exportList: RouteHandler<R['export'], AppEnv> = async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = c.get('session')!.userId;
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const result = await withUserContext(
        deps.db,
        userId,
        (tx) => exportDmRequests(tx, query, keys, t),
        'export',
      );
      return xlsxResponse(c, {
        title: `${t('nav.dm')} — ${t('tab.dm.log')}`,
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        total: result.total,
        t,
      });
    });
  };

  const summary: RouteHandler<R['summary'], AppEnv> = async (c) => {
    const res = await inAdmin(c, async (tx) => ({
      ...(await dmRequestsToday(tx)),
      tokens: await activeTokenCount(tx, deps),
    }));
    return c.json(res, 200);
  };

  return { list, values, exportList, summary };
}
