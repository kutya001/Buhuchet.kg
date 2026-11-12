import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  adminActivityByDay,
  adminOrgActivity,
  exportOrgActivity,
  listOrgActivityPage,
  listOrgActivityValues,
  withUserContext,
  type ActivitySpan,
} from '@buhuchet/db';
import {
  activityBuckets,
  activityLastDay,
  activityRange,
  bishkekDate,
  orgActivityTotals,
  type ActivityPeriod,
} from '@buhuchet/domain';
import {
  ActivityPeriodParam,
  ApiError,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  OrgActivityList,
  OrgActivityOverview,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

/*
 * Админка → «Организации» → «Активность» (прототип v84, modules/activity.js — `actOrg`,
 * `renderOrgAct`; docs/deviations.md п. О-72, docs/decisions.md п. О-44): по каждой организации
 * платформы — только числа за день, неделю, месяц или год: сколько пользователей работали, дни с
 * активностью, входы, действия, сданные отчёты и новые контрагенты. Только администратору платформы;
 * самих записей организаций (кто, что и у какого контрагента) в ответах нет.
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const badPeriod = { description: 'Неверный период', content: error };

/** Период целиком, его наступившая часть и сегодня (как на «Главной» → «Активность»). */
function windowOf(deps: ApiDeps, p: ActivityPeriod) {
  const today = bishkekDate(deps.clock.now());
  const range = activityRange(p, today);
  const span: ActivitySpan = { from: range.from, to: activityLastDay(range, today) };
  return { range, span, today };
}

export const orgActivityOverviewRoute = createRoute({
  method: 'get',
  path: '/admin/org-activity/summary',
  tags: ['admin'],
  summary: '«Активность» организаций: плашки и действия по дням',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ActivityPeriodParam },
  responses: {
    200: {
      description:
        'Сколько организаций работали в программе, пользователи, входы, действия, сданные отчёты и новые контрагенты за период; действия по дням (за год — по месяцам)',
      content: { 'application/json': { schema: OrgActivityOverview } },
    },
    400: badPeriod,
    ...denied,
  },
});

export function orgActivityOverviewHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgActivityOverviewRoute, AppEnv> {
  return async (c) => {
    const p = c.req.valid('query');
    const w = windowOf(deps, p);
    const body = await withUserContext(deps.db, c.get('session')!.userId, async (tx) => {
      const rows = await adminOrgActivity(tx, w.span);
      const byDay = await adminActivityByDay(tx, w.span);
      return {
        k: p.k,
        off: p.off,
        from: w.range.from,
        to: w.range.to,
        today: w.today,
        ...orgActivityTotals(rows),
        buckets: activityBuckets(p, w.range, w.today, byDay),
      };
    });
    return c.json(body, 200);
  };
}

export const orgActivityListRoute = createRoute({
  method: 'get',
  path: '/admin/org-activity',
  tags: ['admin'],
  summary: '«Активность» организаций: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams.extend(ActivityPeriodParam.shape) },
  responses: {
    200: {
      description:
        'Все организации платформы с числами за период: по умолчанию — по «Действий», от больших',
      content: { 'application/json': { schema: OrgActivityList } },
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function orgActivityListHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgActivityListRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const w = windowOf(deps, params);
    const t = await serverTexts(deps);
    const page = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listOrgActivityPage(tx, query, w.span, t),
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

export const orgActivityValuesRoute = createRoute({
  method: 'get',
  path: '/admin/org-activity/values',
  tags: ['admin'],
  summary: 'Значения столбца «Активности» организаций для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListValuesQuery.extend(ActivityPeriodParam.shape) },
  responses: {
    200: {
      description: 'Значения столбца с числом строк',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function orgActivityValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgActivityValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q, ...p } = c.req.valid('query');
    const w = windowOf(deps, p);
    const t = await serverTexts(deps);
    const values = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listOrgActivityValues(tx, col, w.span, t, q),
    );
    return c.json(values, 200);
  };
}

export const orgActivityExportRoute = createRoute({
  method: 'get',
  path: '/admin/org-activity/export',
  tags: ['admin'],
  summary: '«Активность» организаций в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListExportParams.extend(ActivityPeriodParam.shape) },
  responses: {
    200: {
      description: 'Файл Excel со всеми строками под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function orgActivityExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgActivityExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const w = windowOf(deps, params);
    const userId = c.get('session')!.userId;
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const result = await withUserContext(
        deps.db,
        userId,
        (tx) => exportOrgActivity(tx, query, keys, w.span, t),
        'export',
      );
      return xlsxResponse(c, {
        title: `${t('nav.organizations')} · ${t('tab.orgs.act')}`,
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
