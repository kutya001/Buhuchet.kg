import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  contractorSummary,
  contractorTabCounts,
  exportContractors,
  kpiMissingRows,
  listContractorsPage,
  listContractorValues,
  orgMenuSettings,
  servicePeriodsOf,
  withOrgContext,
  type ContractorListOptions,
  type ContractorRow,
  type Tx,
} from '@buhuchet/db';
import {
  hasPermission,
  plannedPause,
  plannedResume,
  scopeOf,
  type ListQuery,
} from '@buhuchet/domain';
import {
  ContractorList,
  ContractorSummary,
  ContractorTabCounts,
  ContractorTabParam,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  type ContractorRow as ContractorRowBody,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { kpiScopeOf } from '../kpi/common';
import { serverTexts } from '../l10n/texts';
import { error, feeVisible, scopeSqlOf, subjectOf, todayOf } from './common';

const noView = { description: 'Нет права «Просматривать контрагентов»', content: error };

/** Запросу нужен столбец «Не заполнены показатели»: фильтр, сортировка, группа или выгрузка. */
function needsKpi(
  query: Pick<ListQuery, 'filters' | 'sort' | 'group'>,
  keys: readonly string[] = [],
) {
  return (
    Object.hasOwn(query.filters, KPI_COLUMN) ||
    query.sort?.key === KPI_COLUMN ||
    !!query.group?.includes(KPI_COLUMN) ||
    keys.includes(KPI_COLUMN)
  );
}

const KPI_COLUMN = 'kpiMissing';

/**
 * Контрагенты с незаполненными показателями (индикатор `kpiMissingRows`, область «Показателей
 * контрагентов»); null — функция выключена в учётной политике или нет права «Просматривать показатели».
 */
async function kpiMissingIds(deps: ApiDeps, c: Context<AppEnv>, tx: Tx): Promise<string[] | null> {
  const subject = subjectOf(c);
  if (!hasPermission(subject, 'kpiView')) return null;
  const { features } = await orgMenuSettings(tx, orgContextOf(c).orgId);
  if (!features.indicators) return null;
  const rows = await kpiMissingRows(tx, { scope: kpiScopeOf(subject), today: todayOf(deps) });
  return [...new Set(rows.map((r) => r.contractorId))];
}

/** Условия списка того, кто смотрит: область, вкладка, плата за обслуживание. */
async function listOptions(
  deps: ApiDeps,
  c: Context<AppEnv>,
  tx: Tx,
  tab: ContractorListOptions['tab'],
  kpi = false,
): Promise<ContractorListOptions> {
  const subject = subjectOf(c);
  return {
    t: await serverTexts(deps),
    today: todayOf(deps),
    fee: await feeVisible(tx, orgContextOf(c).orgId, subject),
    scope: scopeSqlOf(subject),
    tab,
    employeeId: subject.employeeId,
    kpiMissing: kpi ? await kpiMissingIds(deps, c, tx) : null,
  };
}

type RowService = ContractorRowBody['service'];

/** Обслуживание строк для меню: периоды и запланированное (правила `serviceMenu`). */
async function rowServices(
  tx: Tx,
  rows: readonly ContractorRow[],
  today: string,
): Promise<Map<string, RowService>> {
  const periods = await servicePeriodsOf(
    tx,
    rows.map((r) => r.id),
  );
  const month = today.slice(0, 7);
  return new Map(
    rows.map((r) => {
      const list = (periods.get(r.id) ?? []).map(({ from, to }) => ({ from, to }));
      const subject = { archived: r.serviceStatus === 'archived', periods: list };
      const regular = r.kind === 'regular';
      return [
        r.id,
        {
          periods: list,
          month,
          plannedPause: regular ? plannedPause(subject, month) : null,
          plannedResume: regular ? plannedResume(subject, month) : null,
        },
      ];
    }),
  );
}

/** Строка списка для ответа API: моменты — строкой ISO, ставка и долг — только тому, кто видит плату. */
function rowBody(r: ContractorRow, fee: boolean, service: RowService): ContractorRowBody {
  return {
    ...r,
    tariff: fee ? r.tariff : null,
    feeDebt: fee ? r.feeDebt : null,
    service,
    serviceSince: { at: r.serviceSince.at.toISOString(), by: r.serviceSince.by },
    audit: {
      createdAt: r.audit.createdAt.toISOString(),
      createdBy: r.audit.createdBy,
      updatedAt: r.audit.updatedAt.toISOString(),
      updatedBy: r.audit.updatedBy,
    },
  };
}

export const listContractorsRoute = createRoute({
  method: 'get',
  path: '/contractors',
  tags: ['contractors'],
  summary: 'Контрагенты: страница списка',
  middleware: [requirePermission('cpView')] as const,
  request: { query: ListQueryParams.extend(ContractorTabParam.shape) },
  responses: {
    200: {
      description:
        'Страница списка контрагентов в области сотрудника: сортировка, страница, фильтры, поиск и группы — на сервере; архивные — только с фильтром «Статус обслуживания»',
      content: { 'application/json': { schema: ContractorList } },
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: noView,
  },
});

/**
 * Список контрагентов (прототип modules/contractors.js, renderCps): вкладки «Все» и «Мои
 * контрагенты»; с областью «Свои контрагенты» — только закреплённые за сотрудником.
 */
export function listContractorsHandler(
  deps: ApiDeps,
): RouteHandler<typeof listContractorsRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const { page, fee, services } = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const o = await listOptions(deps, c, tx, params.tab, needsKpi(query));
      const page = await listContractorsPage(tx, query, o);
      return { page, fee: o.fee, services: await rowServices(tx, page.rows, o.today) };
    });
    return c.json(
      {
        items: page.rows.map((r) => rowBody(r, fee, services.get(r.id)!)),
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

export const contractorTabCountsRoute = createRoute({
  method: 'get',
  path: '/contractors/tab-counts',
  tags: ['contractors'],
  summary: 'Счётчики вкладок модуля «Контрагенты»',
  middleware: [requirePermission('cpView')] as const,
  responses: {
    200: {
      description:
        'Контрагентов на обслуживании в области, закреплённых за собой и с долгом за обслуживание',
      content: { 'application/json': { schema: ContractorTabCounts } },
    },
    401: { description: 'Нет входа', content: error },
    403: noView,
  },
});

/**
 * Числа на вкладках (прототип cpsTabs): «Все» — в области, «Мои контрагенты» — свои, «Должники» — с
 * долгом за обслуживание (только тому, кто видит плату); без архива.
 */
export function contractorTabCountsHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorTabCountsRoute, AppEnv> {
  return async (c) => {
    const subject = subjectOf(c);
    const counts = await withOrgContext(deps.db, orgContextOf(c), async (tx) =>
      contractorTabCounts(
        tx,
        scopeSqlOf(subject),
        subject.employeeId,
        (await feeVisible(tx, orgContextOf(c).orgId, subject))
          ? { today: todayOf(deps) }
          : undefined,
      ),
    );
    return c.json(counts, 200);
  };
}

export const contractorValuesRoute = createRoute({
  method: 'get',
  path: '/contractors/values',
  tags: ['contractors'],
  summary: 'Значения столбца списка контрагентов для фильтра',
  middleware: [requirePermission('cpView')] as const,
  request: { query: ListValuesQuery.extend(ContractorTabParam.shape) },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом записей в области',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: noView,
  },
});

/** Значения для фильтра-галочек (прототип filterPop): режимы, ответственные, статусы…. */
export function contractorValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q, tab } = c.req.valid('query');
    const values = await withOrgContext(deps.db, orgContextOf(c), async (tx) =>
      listContractorValues(
        tx,
        col,
        await listOptions(deps, c, tx, tab, col === KPI_COLUMN),
        { filters: {} },
        q,
      ),
    );
    return c.json(values, 200);
  };
}

export const exportContractorsRoute = createRoute({
  method: 'get',
  path: '/contractors/export',
  tags: ['contractors'],
  summary: 'Контрагенты в Excel',
  middleware: [requirePermission('cpView'), requirePermission('export')] as const,
  request: { query: ListExportParams.extend(ContractorTabParam.shape) },
  responses: {
    200: {
      description: 'Файл Excel со всеми записями под поиском и фильтрами в области сотрудника',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права «Просматривать контрагентов» или «Выгружать в Excel»',
      content: error,
    },
  },
});

/** Выгрузка списка в Excel: все записи под поиском и фильтрами, видимые столбцы по порядку экрана. */
export function exportContractorsHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportContractorsRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await withOrgContext(
        deps.db,
        { ...orgContextOf(c), kind: 'export' },
        async (tx) =>
          exportContractors(
            tx,
            query,
            keys,
            await listOptions(deps, c, tx, params.tab, needsKpi(query, keys)),
          ),
      );
      return xlsxResponse(c, {
        title: t('nav.counterparties'),
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

export const contractorSummaryRoute = createRoute({
  method: 'get',
  path: '/contractors/summary',
  tags: ['contractors'],
  summary: 'Итоги плашек списка контрагентов',
  middleware: [requirePermission('cpView')] as const,
  responses: {
    200: {
      description:
        'Контрагентов в области: на обслуживании, без ответственного, с просрочкой, должников за обслуживание, без ГКЭД, с тарифом под вопросом, с незаполненными показателями, приостановленных, разовых и в архиве',
      content: { 'application/json': { schema: ContractorSummary } },
    },
    401: { description: 'Нет входа', content: error },
    403: noView,
  },
});

/**
 * Плашки списка (прототип renderCps): итоги в области сотрудника; клик по плашке ставит фильтр на тех
 * же столбцах списка.
 */
export function contractorSummaryHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorSummaryRoute, AppEnv> {
  return async (c) => {
    const subject = subjectOf(c);
    const summary = await withOrgContext(deps.db, orgContextOf(c), async (tx) =>
      contractorSummary(tx, await listOptions(deps, c, tx, 'all', true)),
    );
    return c.json({ ...summary, scopeAll: scopeOf(subject, 'cps') === 'all' }, 200);
  };
}
