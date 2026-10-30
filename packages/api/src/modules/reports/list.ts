import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  exportReports,
  listReportsPage,
  listReportValues,
  reportConfirmPolicy,
  reportSummary,
  withOrgContext,
  type ReportListOptions,
  type ReportRow,
  type ReportWaitingView,
  type Tx,
} from '@buhuchet/db';
import { hasPermission, reportWeek, type AccessSubject } from '@buhuchet/domain';
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
import type { z } from 'zod';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { subjectOf, todayOf } from '../contractors/common';
import { error, reportScopeOf } from './common';

/*
 * Список отчётов (прототип modules/reports.js: repGrid, repTabs, renderReports; экран — задача 2.13):
 * вкладки «На неделе», «Просрочено», «Ожидают подтверждения», «Все отчёты», быстрый фильтр «Все /
 * Сдать / Уплатить»; прежние версии уточнённых не показываются; область — п. А-2.
 */

const noView = { description: 'Нет права «Просматривать отчёты»', content: error };

/**
 * «Ожидают подтверждения» (прототип repWaitList): тому, кто может подтверждать, — все в области,
 * остальным — только отчёты, где он ответственный.
 */
function waitingView(subject: AccessSubject, confirm: boolean): ReportWaitingView {
  if (hasPermission(subject, 'repConfirm')) return { confirm, own: null };
  // Без сотрудника (администратор платформы сюда не попадает) своих отчётов нет.
  return { confirm: confirm && !!subject.employeeId, own: subject.employeeId };
}

type TabQuery = z.infer<typeof ReportTabParam>;

async function listOptions(
  deps: ApiDeps,
  c: Context<AppEnv>,
  tx: Tx,
  q: TabQuery,
): Promise<ReportListOptions> {
  const subject = subjectOf(c);
  const policy = await reportConfirmPolicy(tx, orgContextOf(c).orgId);
  return {
    t: await serverTexts(deps),
    today: todayOf(deps),
    scope: reportScopeOf(subject),
    tab: q.tab,
    quick: q.quick,
    waiting: waitingView(subject, policy.confirm),
    contractorId: q.contractorId ?? null,
  };
}

/** Строка для ответа API: моменты — строкой ISO. */
export function reportRowBody<T extends ReportRow>(
  r: T,
): Omit<T, 'audit' | 'submittedAt' | 'confirmedAt' | 'lastStatus'> & ReportRowBody {
  return {
    ...r,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
    lastStatus: r.lastStatus ? { at: r.lastStatus.at.toISOString(), by: r.lastStatus.by } : null,
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
        'Страница списка отчётов в области сотрудника: сортировка (по умолчанию — от новых к старым по «Создано»), страница, фильтры, поиск и группы — на сервере',
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
    const page = await withOrgContext(deps.db, orgContextOf(c), async (tx) =>
      listReportsPage(tx, query, await listOptions(deps, c, tx, params)),
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
  summary: 'Счётчики вкладок, плашек и быстрого фильтра модуля «Отчеты для сдачи»',
  middleware: [requirePermission('repView')] as const,
  responses: {
    200: {
      description:
        'Просрочено, на этой неделе, ожидают подтверждения, сдано в этом месяце, к уплате за месяц и числа «Все / Сдать / Уплатить» каждой вкладки — в области сотрудника',
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
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const policy = await reportConfirmPolicy(tx, orgContextOf(c).orgId);
      const summary = await reportSummary(tx, {
        scope: reportScopeOf(subject),
        today,
        waiting: waitingView(subject, policy.confirm),
      });
      const week = reportWeek(today);
      return {
        ...summary,
        month: `${today.slice(0, 7)}-01`,
        weekFrom: week.from,
        weekTo: week.to,
        waitDays: policy.waitDays,
      };
    });
    return c.json(body, 200);
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
    const { col, q, ...tab } = c.req.valid('query');
    const values = await withOrgContext(deps.db, orgContextOf(c), async (tx) =>
      listReportValues(tx, col, await listOptions(deps, c, tx, tab), q),
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
      const t = await serverTexts(deps);
      const result = await withOrgContext(
        deps.db,
        { ...orgContextOf(c), kind: 'export' },
        async (tx) => exportReports(tx, query, keys, await listOptions(deps, c, tx, params)),
      );
      return xlsxResponse(c, {
        title: t('nav.reports'),
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
