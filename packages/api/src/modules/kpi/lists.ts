import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  exportKpiMissing,
  exportKpiPeriod,
  kpiMissingRows,
  kpiPeriodRows,
  listKpiMissingPage,
  listKpiMissingValues,
  listKpiPeriodPage,
  listKpiPeriodValues,
  type KpiMissingListRow,
  type KpiPeriodListRow,
} from '@buhuchet/db';
import { KPI_PERIOD_MAX_MONTHS, monthRange, type YearMonth } from '@buhuchet/domain';
import {
  KpiMissingRow,
  KpiMissingSummary,
  KpiPeriodParams,
  KpiPeriodRow,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  listPageSchema,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { error, inKpi, kpiFail, kpiScopeOf, noAuth, subjectOf, todayOf } from './common';

/*
 * Списки «За период» и «Не заполнено» и индикатор незаполненных (задача 2.27; ТЗ «Показатели
 * контрагентов» → «Вкладка «За период»», «Вкладка «Не заполнено»», «Индикатор незаполненных
 * показателей»; прототип modules/kpi.js: kpiPeriod, kpiMissingTab, kMissCnt). Строки — в области
 * сотрудника; поиск, фильтры, сортировка, группы и выгрузка — общий механизм списков.
 */

const noView = {
  description: 'Нет права «Просматривать показатели» или функция выключена',
  content: error,
};
const noExport = {
  description: 'Нет права «Просматривать показатели» или «Выгружать в Excel»',
  content: error,
};

export const KpiPeriodList = listPageSchema(KpiPeriodRow);
export const KpiMissingList = listPageSchema(KpiMissingRow);

/** Месяцы периода «с … по …» (переставлены, если «с» позже «по»); длиннее 72 месяцев — 400. */
function periodOf(params: { from: YearMonth; to: YearMonth }) {
  const [from, to] = params.from <= params.to ? [params.from, params.to] : [params.to, params.from];
  if (monthRange(from, to).length > KPI_PERIOD_MAX_MONTHS) kpiFail(400, 'period_too_long');
  return { from, to };
}

const periodBody = (r: KpiPeriodListRow): KpiPeriodRow => ({
  ...r,
  lastAt: r.lastAt ? r.lastAt.toISOString() : null,
});

const missingBody = (r: KpiMissingListRow): KpiMissingRow => ({
  ...r,
  statusAt: r.statusAt ? r.statusAt.toISOString() : null,
});

async function periodInput(
  deps: ApiDeps,
  c: Context<AppEnv>,
  tx: Parameters<typeof kpiPeriodRows>[0],
  params: { from: YearMonth; to: YearMonth },
) {
  const period = periodOf(params);
  const { rows, months } = await kpiPeriodRows(tx, {
    scope: kpiScopeOf(subjectOf(c)),
    ...period,
    today: todayOf(deps),
  });
  return { rows, months, t: await serverTexts(deps) };
}

export const periodRoute = createRoute({
  method: 'get',
  path: '/kpi/period',
  tags: ['kpi'],
  summary: '«За период»: страница списка',
  middleware: [requirePermission('kpiView')] as const,
  request: { query: ListQueryParams.extend(KpiPeriodParams.shape) },
  responses: {
    200: {
      description:
        'Контрагент × показатель: значения по месяцам периода и итоги только по заполненным месяцам',
      content: { 'application/json': { schema: KpiPeriodList } },
    },
    ...listQueryResponses,
    401: noAuth,
    403: noView,
  },
});

export function periodHandler(deps: ApiDeps): RouteHandler<typeof periodRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const page = await inKpi(deps, c, async (tx) =>
      listKpiPeriodPage(tx, query, await periodInput(deps, c, tx, params)),
    );
    return c.json(
      {
        items: page.rows.map(periodBody),
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

export const periodValuesRoute = createRoute({
  method: 'get',
  path: '/kpi/period/values',
  tags: ['kpi'],
  summary: 'Значения столбца «За период» для фильтра',
  middleware: [requirePermission('kpiView')] as const,
  request: { query: ListValuesQuery.extend(KpiPeriodParams.shape) },
  responses: {
    200: {
      description: 'Значения столбца с числом строк',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    401: noAuth,
    403: noView,
  },
});

export function periodValuesHandler(deps: ApiDeps): RouteHandler<typeof periodValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q, ...params } = c.req.valid('query');
    const values = await inKpi(deps, c, async (tx) =>
      listKpiPeriodValues(tx, col, await periodInput(deps, c, tx, params), q),
    );
    return c.json(values, 200);
  };
}

export const periodExportRoute = createRoute({
  method: 'get',
  path: '/kpi/period/export',
  tags: ['kpi'],
  summary: '«За период» в Excel',
  middleware: [requirePermission('kpiView'), requirePermission('export')] as const,
  request: { query: ListExportParams.extend(KpiPeriodParams.shape) },
  responses: {
    200: {
      description: 'Файл Excel со всеми строками под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: noAuth,
    403: noExport,
  },
});

export function periodExportHandler(deps: ApiDeps): RouteHandler<typeof periodExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await inKpi(
        deps,
        c,
        async (tx) => exportKpiPeriod(tx, query, keys, await periodInput(deps, c, tx, params)),
        'export',
      );
      return xlsxResponse(c, {
        title: t('tab.kpi.period'),
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

/* ───────────── «Не заполнено» ───────────── */

export const missingRoute = createRoute({
  method: 'get',
  path: '/kpi/missing',
  tags: ['kpi'],
  summary: '«Не заполнено»: страница списка',
  middleware: [requirePermission('kpiView')] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description:
        'Контрагенты и месяцы, за которые не внесены обязательные показатели; по умолчанию — по сроку заполнения',
      content: { 'application/json': { schema: KpiMissingList } },
    },
    ...listQueryResponses,
    401: noAuth,
    403: noView,
  },
});

export function missingHandler(deps: ApiDeps): RouteHandler<typeof missingRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const page = await inKpi(deps, c, async (tx) => {
      const rows = await kpiMissingRows(tx, {
        scope: kpiScopeOf(subjectOf(c)),
        today: todayOf(deps),
      });
      return listKpiMissingPage(tx, query, rows, await serverTexts(deps));
    });
    return c.json(
      {
        items: page.rows.map(missingBody),
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

export const missingValuesRoute = createRoute({
  method: 'get',
  path: '/kpi/missing/values',
  tags: ['kpi'],
  summary: 'Значения столбца «Не заполнено» для фильтра',
  middleware: [requirePermission('kpiView')] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с числом строк',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    401: noAuth,
    403: noView,
  },
});

export function missingValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof missingValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const values = await inKpi(deps, c, async (tx) => {
      const rows = await kpiMissingRows(tx, {
        scope: kpiScopeOf(subjectOf(c)),
        today: todayOf(deps),
      });
      return listKpiMissingValues(tx, col, rows, await serverTexts(deps), q);
    });
    return c.json(values, 200);
  };
}

export const missingExportRoute = createRoute({
  method: 'get',
  path: '/kpi/missing/export',
  tags: ['kpi'],
  summary: '«Не заполнено» в Excel',
  middleware: [requirePermission('kpiView'), requirePermission('export')] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми строками под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: noAuth,
    403: noExport,
  },
});

export function missingExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof missingExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await inKpi(
        deps,
        c,
        async (tx) => {
          const rows = await kpiMissingRows(tx, {
            scope: kpiScopeOf(subjectOf(c)),
            today: todayOf(deps),
          });
          return exportKpiMissing(tx, query, keys, rows, t);
        },
        'export',
      );
      return xlsxResponse(c, {
        title: t('tab.kpi.missing'),
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

export const missingSummaryRoute = createRoute({
  method: 'get',
  path: '/kpi/missing-summary',
  tags: ['kpi'],
  summary: 'Индикатор незаполненных показателей',
  middleware: [requirePermission('kpiView')] as const,
  responses: {
    200: {
      description:
        'Контрагентов с незаполненными месяцами в области сотрудника, есть ли просроченные и месяцы по контрагентам',
      content: { 'application/json': { schema: KpiMissingSummary } },
    },
    401: noAuth,
    403: noView,
  },
});

/**
 * Счётчик модуля, вкладки «Не заполнено» и значок в списке контрагентов (прототип `kMissCnt`): красный —
 * есть просроченные месяцы, жёлтый — не заполнен только текущий месяц до срока.
 */
export function missingSummaryHandler(
  deps: ApiDeps,
): RouteHandler<typeof missingSummaryRoute, AppEnv> {
  return async (c) => {
    const rows = await inKpi(deps, c, (tx) =>
      kpiMissingRows(tx, { scope: kpiScopeOf(subjectOf(c)), today: todayOf(deps) }),
    );
    const by = new Map<string, { contractorId: string; months: YearMonth[]; overdue: boolean }>();
    for (const r of rows) {
      const x = by.get(r.contractorId) ?? {
        contractorId: r.contractorId,
        months: [],
        overdue: false,
      };
      x.months.push(r.month);
      if (r.overdueDays > 0) x.overdue = true;
      by.set(r.contractorId, x);
    }
    const contractors = [...by.values()];
    return c.json(
      { count: contractors.length, overdue: contractors.some((x) => x.overdue), contractors },
      200,
    );
  };
}
