import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  exportRevenue,
  listRevenuePage,
  listRevenueValues,
  orgHasNoContractors,
  orgMenuSettings,
  revenueSource,
  withOrgContext,
  type RevenueListInput,
  type Tx,
} from '@buhuchet/db';
import {
  revenueGridRows,
  revenueOverview,
  revenueRows,
  revenueYears,
  type IsoDate,
} from '@buhuchet/domain';
import {
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  RevenueList,
  RevenueOverview,
  RevenueYearParam,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { scopeSqlOf, subjectOf, todayOf } from '../contractors/common';
import { feeFail } from '../fees/common';
import { error } from '../reports/common';

/*
 * «Главная» → «Аналитика»: выручка по контрагентам (задача 2.34; ТЗ «Главная» → «Вкладка «Аналитика»»;
 * прототип modules/analytics.js). Только владельцу и роли с правом «Видеть плату за обслуживание» при
 * включённой «Плате за обслуживание» (прототип `feat('fee') && can('fee')`); контрагенты — в области
 * группы «Контрагенты» (прототип `visCps(true)`: и разовые, и архивные). Список — общий механизм
 * списков: поиск, фильтры, сортировка, группы, итоги и выгрузка в Excel на сервере.
 */

const noAuth = { description: 'Нет входа', content: error };
const off = {
  description: 'Нет права «Видеть плату за обслуживание» или «Плата за обслуживание» выключена',
  content: error,
};
const offExport = {
  description: 'Нет права «Видеть плату за обслуживание», «Выгружать в Excel» или плата выключена',
  content: error,
};

/** Транзакция «Аналитики»: «Плата за обслуживание» выключена — 403 `fee_off`. */
function inAnalytics<T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  fn: (tx: Tx) => Promise<T>,
  kind?: 'export',
): Promise<T> {
  const ctx = orgContextOf(c);
  return withOrgContext(deps.db, kind ? { ...ctx, kind } : ctx, async (tx) => {
    const { features } = await orgMenuSettings(tx, ctx.orgId);
    if (!features.fee) feeFail(403, 'fee_off');
    return fn(tx);
  });
}

/** Выручка за год и прошлый год в области сотрудника. */
async function revenueOf(deps: ApiDeps, c: Context<AppEnv>, tx: Tx, year: number) {
  const today: IsoDate = todayOf(deps);
  const source = await revenueSource(tx, {
    scope: scopeSqlOf(subjectOf(c)),
    today,
    from: year - 1,
    to: year,
  });
  return {
    today,
    source,
    rows: revenueRows(source.contractors, source.payments, year, today),
    prev: revenueRows(source.contractors, source.payments, year - 1, today),
  };
}

async function listInput(
  deps: ApiDeps,
  c: Context<AppEnv>,
  tx: Tx,
  year: number,
): Promise<RevenueListInput> {
  const { rows, prev } = await revenueOf(deps, c, tx, year);
  return { rows: revenueGridRows(rows, prev), t: await serverTexts(deps), prevYear: year - 1 };
}

export const revenueOverviewRoute = createRoute({
  method: 'get',
  path: '/home/analytics/summary',
  tags: ['home'],
  summary: '«Аналитика»: плашки, график по месяцам, «Топ-10» и «Концентрация»',
  middleware: [requirePermission('fee')] as const,
  request: { query: RevenueYearParam },
  responses: {
    200: {
      description: 'Выручка за год по видам и месяцам, прошлый год для сравнения, долги сейчас',
      content: { 'application/json': { schema: RevenueOverview } },
    },
    400: { description: 'Неверный год', content: error },
    401: noAuth,
    403: off,
  },
});

export function revenueOverviewHandler(
  deps: ApiDeps,
): RouteHandler<typeof revenueOverviewRoute, AppEnv> {
  return async (c) => {
    const { year } = c.req.valid('query');
    const body = await inAnalytics(deps, c, async (tx) => {
      const [{ today, source, rows, prev }, empty] = await Promise.all([
        revenueOf(deps, c, tx, year),
        orgHasNoContractors(tx),
      ]);
      return {
        ...revenueOverview(rows, prev, source.contractors, year, today),
        years: revenueYears(today),
        empty,
      };
    });
    return c.json(body, 200);
  };
}

export const revenueListRoute = createRoute({
  method: 'get',
  path: '/home/analytics',
  tags: ['home'],
  summary: '«Аналитика»: страница списка выручки по контрагентам',
  middleware: [requirePermission('fee')] as const,
  request: { query: ListQueryParams.extend(RevenueYearParam.shape) },
  responses: {
    200: {
      description:
        'Контрагенты с выручкой, начислениями или долгом за год (или с выручкой в прошлом году): по умолчанию — по «Итого получено», от больших',
      content: { 'application/json': { schema: RevenueList } },
    },
    ...listQueryResponses,
    401: noAuth,
    403: off,
  },
});

export function revenueListHandler(deps: ApiDeps): RouteHandler<typeof revenueListRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const page = await inAnalytics(deps, c, async (tx) =>
      listRevenuePage(tx, query, await listInput(deps, c, tx, params.year)),
    );
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

export const revenueValuesRoute = createRoute({
  method: 'get',
  path: '/home/analytics/values',
  tags: ['home'],
  summary: 'Значения столбца «Аналитики» для фильтра',
  middleware: [requirePermission('fee')] as const,
  request: { query: ListValuesQuery.extend(RevenueYearParam.shape) },
  responses: {
    200: {
      description: 'Значения столбца с числом строк',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    401: noAuth,
    403: off,
  },
});

export function revenueValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof revenueValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q, year } = c.req.valid('query');
    const values = await inAnalytics(deps, c, async (tx) =>
      listRevenueValues(tx, col, await listInput(deps, c, tx, year), q),
    );
    return c.json(values, 200);
  };
}

export const revenueExportRoute = createRoute({
  method: 'get',
  path: '/home/analytics/export',
  tags: ['home'],
  summary: '«Аналитика» в Excel',
  middleware: [requirePermission('fee'), requirePermission('export')] as const,
  request: { query: ListExportParams.extend(RevenueYearParam.shape) },
  responses: {
    200: {
      description: 'Файл Excel со всеми строками под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: noAuth,
    403: offExport,
  },
});

export function revenueExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof revenueExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await inAnalytics(
        deps,
        c,
        async (tx) => exportRevenue(tx, query, keys, await listInput(deps, c, tx, params.year)),
        'export',
      );
      return xlsxResponse(c, {
        title: t('tab.home.analytics'),
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
