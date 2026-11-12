import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  activityContractors,
  activityCounters,
  activityDays,
  activityStaff,
  activityStaffMember,
  activitySubmittedByDay,
  exportActivity,
  listActivityPage,
  listActivityValues,
  orgMenuSettings,
  withOrgContext,
  type ActivityContractor,
  type ActivityWindow,
  type Tx,
} from '@buhuchet/db';
import {
  activityBuckets,
  activityByDay,
  activityLastDay,
  activityRange,
  activityRow,
  activityRows,
  activityTotals,
  hasPermission,
  RecordNotFoundError,
  type ActivityPeriod,
} from '@buhuchet/domain';
import {
  ActivityEmployee,
  ActivityList,
  ActivityOverview,
  ActivityPeriodParam,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  Uuid,
} from '@buhuchet/shared';
import { z } from 'zod';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { scopeSqlOf, subjectOf, todayOf } from '../contractors/common';
import { error } from '../reports/common';

/*
 * «Главная» → «Активность» (прототип v84, modules/activity.js, `renderHomeAct`, `actEmpDlg`;
 * docs/deviations.md п. О-71): входы, выходы и действия сотрудников за день, неделю, месяц или год,
 * сданные отчёты, контрагенты и задачи. Только с правом «Смотреть аналитику по сотрудникам»; области
 * «Свои контрагенты» здесь нет — право открывает числа всех сотрудников организации (как в прототипе).
 * Список — общий механизм списков: поиск, фильтры, сортировка, итоги и выгрузка в Excel на сервере.
 */

const noAuth = { description: 'Нет входа', content: error };
const off = { description: 'Нет права «Смотреть аналитику по сотрудникам»', content: error };
const offExport = {
  description: 'Нет права «Смотреть аналитику по сотрудникам» или «Выгружать в Excel»',
  content: error,
};
const badPeriod = { description: 'Неверный период', content: error };

/** Период целиком, его наступившая часть и сегодня. */
function windowOf(deps: ApiDeps, p: ActivityPeriod): ActivityWindow {
  const today = todayOf(deps);
  const range = activityRange(p, today);
  return { range, span: { from: range.from, to: activityLastDay(range, today) }, today };
}

/** Строки списка за период и действия по дням сотрудников списка. */
async function activityOf(tx: Tx, w: ActivityWindow) {
  const [staff, byUser, counters] = await Promise.all([
    activityStaff(tx),
    activityDays(tx, w.span),
    activityCounters(tx, w),
  ]);
  const days = new Map(staff.map((e) => [e.id, byUser.get(e.userId) ?? []]));
  const rows = activityRows(staff, days, counters);
  return { rows, days };
}

export const activityOverviewRoute = createRoute({
  method: 'get',
  path: '/home/activity/summary',
  tags: ['home'],
  summary: '«Активность»: плашки и действия по дням',
  middleware: [requirePermission('staffStats')] as const,
  request: { query: ActivityPeriodParam },
  responses: {
    200: {
      description:
        'Сколько сотрудников работали в программе, входы и выходы, действия, сданные отчёты и выполненные задачи за период; действия по дням (за год — по месяцам)',
      content: { 'application/json': { schema: ActivityOverview } },
    },
    400: badPeriod,
    401: noAuth,
    403: off,
  },
});

export function activityOverviewHandler(
  deps: ApiDeps,
): RouteHandler<typeof activityOverviewRoute, AppEnv> {
  return async (c) => {
    const p = c.req.valid('query');
    const w = windowOf(deps, p);
    const ctx = orgContextOf(c);
    const body = await withOrgContext(deps.db, ctx, async (tx) => {
      const [{ rows, days }, { features }] = await Promise.all([
        activityOf(tx, w),
        orgMenuSettings(tx, ctx.orgId),
      ]);
      const totals = activityTotals(rows);
      return {
        k: p.k,
        off: p.off,
        from: w.range.from,
        to: w.range.to,
        today: w.today,
        ...totals,
        tasks: features.tasks ? totals.tasks : null,
        buckets: activityBuckets(
          p,
          w.range,
          w.today,
          activityByDay(
            days,
            rows.map((r) => r.id),
          ),
        ),
      };
    });
    return c.json(body, 200);
  };
}

export const activityListRoute = createRoute({
  method: 'get',
  path: '/home/activity',
  tags: ['home'],
  summary: '«Активность»: страница списка сотрудников',
  middleware: [requirePermission('staffStats')] as const,
  request: { query: ListQueryParams.extend(ActivityPeriodParam.shape) },
  responses: {
    200: {
      description:
        'Действующие сотрудники и заблокированные с активностью или сданными отчётами в периоде: по умолчанию — по «Действий», от больших',
      content: { 'application/json': { schema: ActivityList } },
    },
    ...listQueryResponses,
    401: noAuth,
    403: off,
  },
});

export function activityListHandler(deps: ApiDeps): RouteHandler<typeof activityListRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const w = windowOf(deps, params);
    const page = await withOrgContext(deps.db, orgContextOf(c), async (tx) =>
      listActivityPage(tx, query, (await activityOf(tx, w)).rows),
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

export const activityValuesRoute = createRoute({
  method: 'get',
  path: '/home/activity/values',
  tags: ['home'],
  summary: 'Значения столбца «Активности» для фильтра',
  middleware: [requirePermission('staffStats')] as const,
  request: { query: ListValuesQuery.extend(ActivityPeriodParam.shape) },
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

export function activityValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof activityValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q, ...p } = c.req.valid('query');
    const w = windowOf(deps, p);
    const values = await withOrgContext(deps.db, orgContextOf(c), async (tx) =>
      listActivityValues(tx, col, (await activityOf(tx, w)).rows, q),
    );
    return c.json(values, 200);
  };
}

export const activityExportRoute = createRoute({
  method: 'get',
  path: '/home/activity/export',
  tags: ['home'],
  summary: '«Активность» в Excel',
  middleware: [requirePermission('staffStats'), requirePermission('export')] as const,
  request: { query: ListExportParams.extend(ActivityPeriodParam.shape) },
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

export function activityExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof activityExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const w = windowOf(deps, params);
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await withOrgContext(
        deps.db,
        { ...orgContextOf(c), kind: 'export' },
        async (tx) => exportActivity(tx, query, keys, (await activityOf(tx, w)).rows),
      );
      return xlsxResponse(c, {
        title: t('tab.home.act'),
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

export const activityEmployeeRoute = createRoute({
  method: 'get',
  path: '/home/activity/employees/{id}',
  tags: ['home'],
  summary: '«Активность по дням»: окно сотрудника',
  middleware: [requirePermission('staffStats')] as const,
  request: { params: z.object({ id: Uuid }), query: ActivityPeriodParam },
  responses: {
    200: {
      description:
        'Числа сотрудника за период, дни с активностью (первый вход, последняя активность, входы, выходы, действия, сдано) и его контрагенты',
      content: { 'application/json': { schema: ActivityEmployee } },
    },
    400: badPeriod,
    401: noAuth,
    403: off,
    404: { description: 'Сотрудник не найден', content: error },
  },
});

/** Контрагенты, названия которых смотрящему не положены: число и суммы; пусто — null. */
function othersOf(list: readonly ActivityContractor[]) {
  if (list.length === 0) return null;
  const sum = (get: (cp: ActivityContractor) => number) => list.reduce((a, cp) => a + get(cp), 0);
  return {
    count: list.length,
    sub: sum((cp) => cp.sub),
    due: sum((cp) => cp.due),
    open: sum((cp) => cp.open),
    over: sum((cp) => cp.over),
    act: sum((cp) => cp.act),
  };
}

export function activityEmployeeHandler(
  deps: ApiDeps,
): RouteHandler<typeof activityEmployeeRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const p = c.req.valid('query');
    const w = windowOf(deps, p);
    const subject = subjectOf(c);
    // Названия контрагентов — только тому, кто вправе их видеть («Просматривать контрагентов» и его
    // область); остальные приходят одной строкой с числами (docs/deviations.md п. О-71).
    const canView = hasPermission(subject, 'cpView');
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const member = await activityStaffMember(tx, id);
      if (!member) throw new RecordNotFoundError('employee', id);
      const [byUser, counters, submitted, list] = await Promise.all([
        activityDays(tx, w.span, member.userId),
        activityCounters(tx, w),
        activitySubmittedByDay(tx, w.span, member.id),
        activityContractors(tx, w, member, scopeSqlOf(subject)),
      ]);
      const days = byUser.get(member.userId) ?? [];
      const row = activityRow(member, days, counters.get(member.id));
      return {
        id: row.id,
        name: row.name,
        active: row.active,
        k: p.k,
        off: p.off,
        from: w.range.from,
        to: w.range.to,
        last: row.last,
        in: row.in,
        out: row.out,
        n: row.n,
        sub: row.sub,
        due: row.due,
        over: row.over,
        cps: row.cps,
        days: [...days].reverse().map((d) => ({ ...d, sub: submitted.get(d.day) ?? 0 })),
        contractors: list.filter((cp) => canView && cp.inScope).map(({ inScope: _, ...cp }) => cp),
        others: othersOf(list.filter((cp) => !(canView && cp.inScope))),
      };
    });
    return c.json(body, 200);
  };
}
