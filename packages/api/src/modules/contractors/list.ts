import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  contractorTabCounts,
  exportContractors,
  listContractorsPage,
  listContractorValues,
  withOrgContext,
  type ContractorListOptions,
  type ContractorRow,
  type Tx,
} from '@buhuchet/db';
import {
  ContractorList,
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
import { serverTexts } from '../l10n/texts';
import { error, feeVisible, scopeSqlOf, subjectOf, todayOf } from './common';

const noView = { description: 'Нет права «Просматривать контрагентов»', content: error };

/** Условия списка того, кто смотрит: область, вкладка, плата за обслуживание. */
async function listOptions(
  deps: ApiDeps,
  c: Context<AppEnv>,
  tx: Tx,
  tab: 'all' | 'mine',
): Promise<ContractorListOptions> {
  const subject = subjectOf(c);
  return {
    t: await serverTexts(deps),
    today: todayOf(deps),
    fee: await feeVisible(tx, orgContextOf(c).orgId, subject),
    scope: scopeSqlOf(subject),
    tab,
    employeeId: subject.employeeId,
  };
}

/** Строка списка для ответа API: моменты — строкой ISO, ставка — только тому, кто видит плату. */
function rowBody(r: ContractorRow, fee: boolean): ContractorRowBody {
  return {
    ...r,
    tariff: fee ? r.tariff : null,
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
    const { page, fee } = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const o = await listOptions(deps, c, tx, params.tab);
      return { page: await listContractorsPage(tx, query, o), fee: o.fee };
    });
    return c.json(
      {
        items: page.rows.map((r) => rowBody(r, fee)),
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
      description: 'Контрагентов на обслуживании в области и закреплённых за собой',
      content: { 'application/json': { schema: ContractorTabCounts } },
    },
    401: { description: 'Нет входа', content: error },
    403: noView,
  },
});

/** Числа на вкладках (прототип cpsTabs): «Все» — в области, «Мои контрагенты» — свои; без архива. */
export function contractorTabCountsHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorTabCountsRoute, AppEnv> {
  return async (c) => {
    const subject = subjectOf(c);
    const counts = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      contractorTabCounts(tx, scopeSqlOf(subject), subject.employeeId),
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
      listContractorValues(tx, col, await listOptions(deps, c, tx, tab), { filters: {} }, q),
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
          exportContractors(tx, query, keys, await listOptions(deps, c, tx, params.tab)),
      );
      return xlsxResponse(c, {
        title: t('nav.counterparties'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        t,
      });
    });
  };
}
