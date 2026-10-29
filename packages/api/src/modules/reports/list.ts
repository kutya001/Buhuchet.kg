import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  exportReports,
  listReportsPage,
  listReportValues,
  reportTabCounts,
  withOrgContext,
  type ReportListOptions,
  type ReportRow,
  type ReportTab,
} from '@buhuchet/db';
import {
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  ReportList,
  ReportTabCounts,
  ReportTabParam,
  type ReportRow as ReportRowBody,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { subjectOf, todayOf } from '../contractors/common';
import { error, reportScopeOf } from './common';

/*
 * Список отчётов (прототип modules/reports.js: repGrid, repTabs; экран — задача 2.13): вкладки «На этой
 * неделе», «Просроченные», «Все»; прежние версии уточнённых не показываются; область — п. А-2.
 */

const noView = { description: 'Нет права «Просматривать отчёты»', content: error };

async function listOptions(deps: ApiDeps, c: Context<AppEnv>, tab: ReportTab) {
  return {
    t: await serverTexts(deps),
    today: todayOf(deps),
    scope: reportScopeOf(subjectOf(c)),
    tab,
  } satisfies ReportListOptions;
}

/** Строка для ответа API: моменты — строкой ISO. */
export function reportRowBody<T extends ReportRow>(r: T): Omit<T, 'audit'> & ReportRowBody {
  return {
    ...r,
    audit: {
      createdAt: r.audit.createdAt.toISOString(),
      createdBy: r.audit.createdBy,
      updatedAt: r.audit.updatedAt.toISOString(),
      updatedBy: r.audit.updatedBy,
    },
  };
}

export const listReportsRoute = createRoute({
  method: 'get',
  path: '/reports',
  tags: ['reports'],
  summary: 'Отчёты: страница списка',
  middleware: [requirePermission('repView')] as const,
  request: { query: ListQueryParams.extend(ReportTabParam.shape) },
  responses: {
    200: {
      description:
        'Страница списка отчётов в области сотрудника: сортировка (по умолчанию — по сроку), страница, фильтры, поиск и группы — на сервере',
      content: { 'application/json': { schema: ReportList } },
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: noView,
  },
});

export function listReportsHandler(deps: ApiDeps): RouteHandler<typeof listReportsRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const o = await listOptions(deps, c, params.tab);
    const page = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      listReportsPage(tx, query, o),
    );
    return c.json(
      {
        items: page.rows.map(reportRowBody),
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

export const reportTabCountsRoute = createRoute({
  method: 'get',
  path: '/reports/tab-counts',
  tags: ['reports'],
  summary: 'Счётчики вкладок и плашек модуля «Отчеты для сдачи»',
  middleware: [requirePermission('repView')] as const,
  responses: {
    200: {
      description: 'Просроченных и со сроком на этой неделе — в области сотрудника',
      content: { 'application/json': { schema: ReportTabCounts } },
    },
    401: { description: 'Нет входа', content: error },
    403: noView,
  },
});

export function reportTabCountsHandler(
  deps: ApiDeps,
): RouteHandler<typeof reportTabCountsRoute, AppEnv> {
  return async (c) => {
    const counts = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      reportTabCounts(tx, reportScopeOf(subjectOf(c)), todayOf(deps)),
    );
    return c.json(counts, 200);
  };
}

export const reportValuesRoute = createRoute({
  method: 'get',
  path: '/reports/values',
  tags: ['reports'],
  summary: 'Значения столбца списка отчётов для фильтра',
  middleware: [requirePermission('repView')] as const,
  request: { query: ListValuesQuery.extend(ReportTabParam.shape) },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом отчётов в области и вкладке',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: noView,
  },
});

export function reportValuesHandler(deps: ApiDeps): RouteHandler<typeof reportValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q, tab } = c.req.valid('query');
    const o = await listOptions(deps, c, tab);
    const values = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      listReportValues(tx, col, o, q),
    );
    return c.json(values, 200);
  };
}

export const exportReportsRoute = createRoute({
  method: 'get',
  path: '/reports/export',
  tags: ['reports'],
  summary: 'Отчёты в Excel',
  middleware: [requirePermission('repView'), requirePermission('export')] as const,
  request: { query: ListExportParams.extend(ReportTabParam.shape) },
  responses: {
    200: {
      description: 'Файл Excel со всеми отчётами под поиском и фильтрами в области сотрудника',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права «Просматривать отчёты» или «Выгружать в Excel»',
      content: error,
    },
  },
});

export function exportReportsHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportReportsRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const o = await listOptions(deps, c, params.tab);
      const result = await withOrgContext(deps.db, { ...orgContextOf(c), kind: 'export' }, (tx) =>
        exportReports(tx, query, keys, o),
      );
      return xlsxResponse(c, {
        title: o.t('nav.reports'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        total: result.total,
        t: o.t,
      });
    });
  };
}
