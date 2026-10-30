import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { bishkekDate, DICT_HISTORY_SHOWN } from '@buhuchet/domain';
import {
  adminSectionHistory,
  adminTaxInfo,
  exportAdminTaxes,
  listAdminTaxPage,
  listAdminTaxValues,
  withUserContext,
} from '@buhuchet/db';
import {
  AdminDictHistory,
  AdminTaxInfo,
  AdminTaxListParam,
  AdminTaxRowList,
  ApiError,
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

/*
 * Админка → «Справочники платформы» → «Налоги и ставки» (задача 2.36, часть 2б; ТЗ «Налоги и ставки»;
 * прототип renderPDicts0, вкладка `taxes`): справка по НК КР только для просмотра — таблицы налогов и
 * платежей, ставок единого налога и ставок налога на имущество (страница, значения фильтра, «В
 * Excel») и пояснения вкладки. Форму просмотра налога экран строит по `/api/taxes?all=true`. Только
 * администратору платформы.
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const json = <T>(schema: T) => ({ 'application/json': { schema } });

const P = '/admin/tax-ref';

const adminTx = <T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  fn: Parameters<typeof withUserContext<T>>[2],
) => withUserContext(deps.db, c.get('session')!.userId, fn);

const TITLE = {
  taxes: 'pdicts.tax.box.taxes',
  en_rates: 'pdicts.tax.box.en_rates',
  property_rates: 'pdicts.tax.box.property_rates',
} as const;

export const adminTaxInfoRoute = createRoute({
  method: 'get',
  path: `${P}/info`,
  tags: ['platform-dicts'],
  summary: '«Налоги и ставки»: размер бизнеса и пояснения над таблицами',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description:
        'Размер бизнеса (ст. 4), пояснения к ставкам единого налога и налога на имущество',
      content: json(AdminTaxInfo),
    },
    ...denied,
  },
});

export function adminTaxInfoHandler(deps: ApiDeps): RouteHandler<typeof adminTaxInfoRoute, AppEnv> {
  return async (c) => {
    const info = await adminTx(deps, c, (tx) => adminTaxInfo(tx));
    return c.json(info, 200);
  };
}

export const adminTaxHistoryRoute = createRoute({
  method: 'get',
  path: `${P}/history`,
  tags: ['platform-dicts'],
  summary: '«История изменений» вкладки «Налоги и ставки»',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: `Последние ${DICT_HISTORY_SHOWN} записей налогов и ставок, сначала новые, и сколько их всего`,
      content: json(AdminDictHistory),
    },
    ...denied,
  },
});

/** История налогов, ставок единого налога и налога на имущество: загрузки и правки ГКЭД (задача 2.38). */
export function adminTaxHistoryHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminTaxHistoryRoute, AppEnv> {
  return async (c) => {
    const history = await adminTx(deps, c, (tx) =>
      adminSectionHistory(
        tx,
        ['taxes', 'enrates', 'proprates'],
        DICT_HISTORY_SHOWN,
        bishkekDate(deps.clock.now()),
      ),
    );
    const body: AdminDictHistory = {
      total: history.total,
      items: history.items.map((h) => ({ ...h, at: h.at.toISOString() })),
    };
    return c.json(body, 200);
  };
}

export const listAdminTaxesRoute = createRoute({
  method: 'get',
  path: `${P}/{list}`,
  tags: ['platform-dicts'],
  summary: '«Налоги и ставки»: страница таблицы',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminTaxListParam, query: ListQueryParams },
  responses: {
    200: {
      description: 'Строки таблицы; поиск, фильтры, сортировка и группы — на сервере',
      content: json(AdminTaxRowList),
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function listAdminTaxesHandler(
  deps: ApiDeps,
): RouteHandler<typeof listAdminTaxesRoute, AppEnv> {
  return async (c) => {
    const { list } = c.req.valid('param');
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await adminTx(deps, c, (tx) => listAdminTaxPage(tx, list, query, t));
    return c.json(
      {
        items: page.rows,
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

export const adminTaxValuesRoute = createRoute({
  method: 'get',
  path: `${P}/{list}/values`,
  tags: ['platform-dicts'],
  summary: 'Значения столбца таблицы «Налогов и ставок» для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminTaxListParam, query: ListValuesQuery },
  responses: {
    200: { description: 'Значения столбца с подписью и числом', content: json(ListValues) },
    ...listQueryResponses,
    ...denied,
  },
});

export function adminTaxValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminTaxValuesRoute, AppEnv> {
  return async (c) => {
    const { list } = c.req.valid('param');
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await adminTx(deps, c, (tx) => listAdminTaxValues(tx, list, col, t, q));
    return c.json(values, 200);
  };
}

export const exportAdminTaxesRoute = createRoute({
  method: 'get',
  path: `${P}/{list}/export`,
  tags: ['platform-dicts'],
  summary: 'Таблица «Налогов и ставок» в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminTaxListParam, query: ListExportParams },
  responses: {
    200: { description: 'Файл Excel со строками под поиском и фильтрами', content: xlsxContent },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function exportAdminTaxesHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportAdminTaxesRoute, AppEnv> {
  return async (c) => {
    const { list } = c.req.valid('param');
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = c.get('session')!.userId;
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const result = await withUserContext(
        deps.db,
        userId,
        (tx) => exportAdminTaxes(tx, list, query, keys, t),
        'export',
      );
      return xlsxResponse(c, {
        title: t(TITLE[list]),
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
