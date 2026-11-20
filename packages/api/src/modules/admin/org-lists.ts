import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  adminGetOrganization,
  adminReportFiles,
  exportAdminOrgRepMonths,
  exportAdminOrgStaff,
  exportContractors,
  exportReports,
  getReportCard,
  ListQueryError,
  listAdminOrgRepMonthsPage,
  listAdminOrgRepMonthValues,
  listAdminOrgStaffPage,
  listAdminOrgStaffValues,
  listContractorsPage,
  listContractorValues,
  listReportsPage,
  listReportValues,
  orgMenuSettings,
  reportConfirmPolicy,
  reportPlateOptions,
  withOrgContext,
  withUserContext,
  type ContractorListOptions,
  type ContractorRow,
  type ListPageResult,
  type ReportListOptions,
  type ReportPlate,
  type Tx,
} from '@buhuchet/db';
import { accountStates, RecordNotFoundError, type ListQuery } from '@buhuchet/domain';
import {
  ADMIN_ORG_CONTRACTOR_COLUMNS,
  AdminOrgContractorList,
  AdminOrgReport,
  AdminOrgRepMonthList,
  AdminOrgReportPlate,
  AdminOrgStaffList,
  type AdminOrgContractorRow,
  ApiError,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  ReportList,
  Uuid,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { todayOf } from '../contractors/common';
import { serverTexts } from '../l10n/texts';
import { reportRowBody } from '../reports/list';
import { guardCardRead } from './card-guard';

/*
 * Списки карточки организации в Админке с сервера страницами (доработки 20.11.2026, пакет 2, блок 1,
 * пункты 2, 3 и 5; прототип v150 admin/admin-cards.js: ocGrids, ocRep, ocRepWin): «Сотрудники»,
 * «Контрагенты», «Отчёты» с плитками-фильтрами и окно «Отчёт». Только администратор платформы и только
 * чтение: данные организации читаются в её контексте от имени администратора (RLS), открытие списка в
 * историю не пишется — его пишет открытие карточки.
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const notFound = { 404: { description: 'Такой организации нет', content: error } } as const;
const OrgParam = z.object({ id: Uuid });

type OrgContext = { orgId: string; userId: string; kind?: 'export' };

/** Организация из адреса: есть ли такая; контекст чтения её данных от имени администратора. */
async function orgOf(deps: ApiDeps, c: Context<AppEnv>, id: string): Promise<OrgContext> {
  const adminId = c.get('session')!.userId;
  const found = await withUserContext(deps.db, adminId, (tx) => adminGetOrganization(tx, id));
  if (!found) throw new RecordNotFoundError('organization', id);
  return { orgId: id, userId: adminId };
}

/** Страница списка для ответа API. */
function pageBody<R, B>(page: ListPageResult<R>, row: (r: R) => B) {
  return {
    items: page.rows.map(row),
    total: page.total,
    page: page.page,
    size: page.size,
    totals: page.totals,
    ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
  };
}

/** Выгрузка списка карточки: в пределе выгрузок администратора, запрос — видом работы `export`. */
async function exportList(
  deps: ApiDeps,
  c: Context<AppEnv>,
  ctx: OrgContext,
  title: string,
  read: (tx: Tx, t: Awaited<ReturnType<typeof serverTexts>>) => ReturnType<typeof exportReports>,
) {
  // Выгрузка занимает предел выгрузок администратора: запрос не со своего сайта — отказ, как у карточки.
  await guardCardRead(deps, c, true);
  return withExportSlot(deps, ctx.userId, async () => {
    const t = await serverTexts(deps);
    const result = await withOrgContext(deps.db, { ...ctx, kind: 'export' }, (tx) => read(tx, t));
    return xlsxResponse(c, {
      title: t(title),
      today: deps.clock.now(),
      columns: result.columns,
      rows: result.rows,
      more: result.more,
      total: result.total,
      t,
    });
  });
}

// ——— «Отчёты» ———

/** Тексты словаря и сегодняшний день — до транзакции: внутри неё только `tx` (п. О-46). */
async function reportBase(deps: ApiDeps): Promise<Pick<ReportListOptions, 't' | 'today'>> {
  return { t: await serverTexts(deps), today: todayOf(deps) };
}

/**
 * Условия списка отчётов организации глазами администратора: вся организация, плитка-фильтр вместо
 * вкладки, «Просрочено» — как во вкладке «Просроченные» фирмы (с оплатой при «Учёте оплаты налогов»).
 */
async function reportOptions(
  tx: Tx,
  orgId: string,
  plate: ReportPlate,
  base: Pick<ReportListOptions, 't' | 'today'>,
): Promise<ReportListOptions> {
  const [policy, settings] = await Promise.all([
    reportConfirmPolicy(tx, orgId),
    orgMenuSettings(tx, orgId),
  ]);
  return {
    ...base,
    scope: undefined,
    quick: 'all',
    waiting: { confirm: policy.confirm, own: null },
    taxpay: settings.features.taxpay,
    ...reportPlateOptions(plate),
  };
}

export const orgReportsRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/{id}/reports',
  tags: ['admin'],
  summary: 'Карточка организации → «Отчёты»: страница списка всех отчётов организации',
  middleware: [requirePlatformAdmin] as const,
  request: { params: OrgParam, query: ListQueryParams.extend(AdminOrgReportPlate.shape) },
  responses: {
    200: {
      description:
        'Страница списка отчётов организации под плиткой-фильтром («К сдаче» по умолчанию), поиском и фильтрами; прежние версии уточнённых не показываются',
      content: { 'application/json': { schema: ReportList } },
    },
    ...listQueryResponses,
    ...denied,
    ...notFound,
  },
});

export function orgReportsHandler(deps: ApiDeps): RouteHandler<typeof orgReportsRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const ctx = await orgOf(deps, c, id);
    const base = await reportBase(deps);
    const page = await withOrgContext(deps.db, ctx, async (tx) =>
      listReportsPage(tx, query, await reportOptions(tx, id, params.plate, base)),
    );
    return c.json(pageBody(page, reportRowBody), 200);
  };
}

export const orgReportValuesRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/{id}/reports/values',
  tags: ['admin'],
  summary: 'Карточка организации → «Отчёты»: значения столбца для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { params: OrgParam, query: ListValuesQuery.extend(AdminOrgReportPlate.shape) },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом отчётов под плиткой-фильтром',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    ...denied,
    ...notFound,
  },
});

export function orgReportValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgReportValuesRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { col, q, plate } = c.req.valid('query');
    const ctx = await orgOf(deps, c, id);
    const base = await reportBase(deps);
    const values = await withOrgContext(deps.db, ctx, async (tx) =>
      listReportValues(tx, col, await reportOptions(tx, id, plate, base), q),
    );
    return c.json(values, 200);
  };
}

export const orgReportExportRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/{id}/reports/export',
  tags: ['admin'],
  summary: 'Карточка организации → «Отчёты» в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { params: OrgParam, query: ListExportParams.extend(AdminOrgReportPlate.shape) },
  responses: {
    200: {
      description:
        'Файл Excel со всеми отчётами организации под плиткой-фильтром, поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
    ...notFound,
  },
});

export function orgReportExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgReportExportRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const ctx = await orgOf(deps, c, id);
    const base = await reportBase(deps);
    return exportList(deps, c, ctx, 'orgs.card.tab.rep', async (tx) =>
      exportReports(tx, query, keys, await reportOptions(tx, id, params.plate, base)),
    );
  };
}

// ——— «По месяцам и видам отчётов» ———

export const orgRepMonthsRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/{id}/reports/months',
  tags: ['admin'],
  summary: 'Карточка организации → «Отчёты» → «По месяцам и видам отчётов»: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { params: OrgParam, query: ListQueryParams },
  responses: {
    200: {
      description:
        'Месяц срока и вид отчёта: всего, сдано, просрочено — 6 прошлых месяцев, текущий и 3 следующих',
      content: { 'application/json': { schema: AdminOrgRepMonthList } },
    },
    ...listQueryResponses,
    ...denied,
    ...notFound,
  },
});

export function orgRepMonthsHandler(deps: ApiDeps): RouteHandler<typeof orgRepMonthsRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const query = listQueryOf(c.req.valid('query'));
    const ctx = await orgOf(deps, c, id);
    const today = todayOf(deps);
    const page = await withOrgContext(deps.db, ctx, (tx) =>
      listAdminOrgRepMonthsPage(tx, query, today),
    );
    return c.json(
      pageBody(page, (r) => r),
      200,
    );
  };
}

export const orgRepMonthValuesRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/{id}/reports/months/values',
  tags: ['admin'],
  summary: 'Карточка организации → «По месяцам и видам отчётов»: значения столбца для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { params: OrgParam, query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом строк',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    ...denied,
    ...notFound,
  },
});

export function orgRepMonthValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgRepMonthValuesRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { col, q } = c.req.valid('query');
    const ctx = await orgOf(deps, c, id);
    const today = todayOf(deps);
    const values = await withOrgContext(deps.db, ctx, (tx) =>
      listAdminOrgRepMonthValues(tx, col, today, q),
    );
    return c.json(values, 200);
  };
}

export const orgRepMonthExportRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/{id}/reports/months/export',
  tags: ['admin'],
  summary: 'Карточка организации → «По месяцам и видам отчётов» в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { params: OrgParam, query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со строками «По месяцам и видам отчётов»',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
    ...notFound,
  },
});

export function orgRepMonthExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgRepMonthExportRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const ctx = await orgOf(deps, c, id);
    const today = todayOf(deps);
    return exportList(deps, c, ctx, 'orgs.card.rep.months', (tx) =>
      exportAdminOrgRepMonths(tx, query, keys, today),
    );
  };
}

export const orgReportRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/{id}/reports/{reportId}',
  tags: ['admin'],
  summary: 'Карточка организации → окно «Отчёт»: только просмотр',
  middleware: [requirePlatformAdmin] as const,
  request: { params: z.object({ id: Uuid, reportId: Uuid }) },
  responses: {
    200: {
      description:
        'Отчёт организации: поля строки списка, «История статусов» и файлы отчёта (свои и прикреплённые ссылкой, без ссылок на скачивание)',
      content: { 'application/json': { schema: AdminOrgReport } },
    },
    400: { description: 'Неверный номер', content: error },
    ...denied,
    404: { description: 'Такой организации или такого отчёта в ней нет', content: error },
  },
});

/**
 * Окно «Отчёт» (прототип v150 ocRepWin): без кнопок смены статуса. Отчёт другой организации не виден —
 * чтение идёт в контексте организации из адреса (RLS).
 */
export function orgReportHandler(deps: ApiDeps): RouteHandler<typeof orgReportRoute, AppEnv> {
  return async (c) => {
    const { id, reportId } = c.req.valid('param');
    const ctx = await orgOf(deps, c, id);
    const t = await serverTexts(deps);
    const out = await withOrgContext(deps.db, ctx, async (tx) => {
      const { features } = await orgMenuSettings(tx, id);
      const card = await getReportCard(tx, reportId, {
        t,
        today: todayOf(deps),
        scope: undefined,
        taxpay: features.taxpay,
      });
      if (!card) return null;
      return { card, files: await adminReportFiles(tx, reportId) };
    });
    if (!out) throw new RecordNotFoundError('report', reportId);
    const {
      assignment: _assignment,
      dueChanges: _dueChanges,
      versions: _versions,
      superseded: _superseded,
      statusHistory,
      ...row
    } = out.card;
    const body: AdminOrgReport = {
      ...reportRowBody(row),
      statusHistory: statusHistory.map((h) => ({ ...h, at: h.at.toISOString() })),
      files: out.files.map((f) => ({
        id: f.id,
        name: f.name,
        bytes: f.sizeBytes,
        contentType: f.contentType,
        by: f.uploadedBy,
        at: f.createdAt.toISOString(),
      })),
    };
    return c.json(body, 200);
  };
}

// ——— «Сотрудники» ———

export const orgStaffRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/{id}/staff',
  tags: ['admin'],
  summary: 'Карточка организации → «Сотрудники»: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { params: OrgParam, query: ListQueryParams },
  responses: {
    200: {
      description:
        'Сотрудники организации с учётной записью: роль, Telegram, последний вход и все состояния учётной записи',
      content: { 'application/json': { schema: AdminOrgStaffList } },
    },
    ...listQueryResponses,
    ...denied,
    ...notFound,
  },
});

export function orgStaffHandler(deps: ApiDeps): RouteHandler<typeof orgStaffRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const query = listQueryOf(c.req.valid('query'));
    const ctx = await orgOf(deps, c, id);
    const t = await serverTexts(deps);
    const page = await withOrgContext(deps.db, ctx, (tx) => listAdminOrgStaffPage(tx, query, t));
    return c.json(
      pageBody(page, (u) => ({
        userId: u.userId,
        fullName: u.fullName,
        login: u.login,
        role: u.role,
        telegram: u.telegram,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        states: accountStates({ ...u, isPlatformAdmin: false }),
      })),
      200,
    );
  };
}

export const orgStaffValuesRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/{id}/staff/values',
  tags: ['admin'],
  summary: 'Карточка организации → «Сотрудники»: значения столбца для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { params: OrgParam, query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом сотрудников',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    ...denied,
    ...notFound,
  },
});

export function orgStaffValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgStaffValuesRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { col, q } = c.req.valid('query');
    const ctx = await orgOf(deps, c, id);
    const t = await serverTexts(deps);
    const values = await withOrgContext(deps.db, ctx, (tx) =>
      listAdminOrgStaffValues(tx, col, t, q),
    );
    return c.json(values, 200);
  };
}

export const orgStaffExportRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/{id}/staff/export',
  tags: ['admin'],
  summary: 'Карточка организации → «Сотрудники» в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { params: OrgParam, query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми сотрудниками организации под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
    ...notFound,
  },
});

export function orgStaffExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgStaffExportRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const ctx = await orgOf(deps, c, id);
    return exportList(deps, c, ctx, 'orgs.card.tab.staff', (tx, t) =>
      exportAdminOrgStaff(tx, query, keys, t),
    );
  };
}

// ——— «Контрагенты» ———

const CONTRACTOR_KEYS: ReadonlySet<string> = new Set(ADMIN_ORG_CONTRACTOR_COLUMNS);

/** Столбец не из `ADMIN_ORG_CONTRACTOR_COLUMNS` — 400, как неизвестный столбец списка. */
function contractorColumn(part: ConstructorParameters<typeof ListQueryError>[0], key: string) {
  if (!CONTRACTOR_KEYS.has(key)) throw new ListQueryError(part, key);
}

/** Запрос списка контрагентов карточки — только по столбцам карточки. */
function contractorQuery(query: ListQuery): ListQuery {
  if (query.sort) contractorColumn('sort', query.sort.key);
  for (const key of Object.keys(query.filters)) contractorColumn('filter', key);
  for (const key of query.search?.keys ?? []) contractorColumn('search', key);
  for (const key of query.group ?? []) contractorColumn('group', key);
  for (const key of Object.keys(query.agg ?? {})) contractorColumn('agg', key);
  return query;
}

/** Строка «Контрагентов» карточки — только поля её столбцов. */
function contractorRowOut(r: ContractorRow): AdminOrgContractorRow {
  return {
    id: r.id,
    name: r.name,
    inn: r.inn,
    form: r.form,
    regime: r.regime,
    responsible: r.responsible,
    kind: r.kind,
    tariff: r.tariff,
    serviceStatus: r.serviceStatus,
    serviceSince: { at: r.serviceSince.at.toISOString(), by: r.serviceSince.by },
  };
}

/**
 * Условия списка контрагентов глазами администратора (прототип v150 ocGrids, oc-cps): вся организация
 * вместе с архивом («В архиве» — в «Статусе обслуживания»), стоимость обслуживания видна.
 */
async function contractorOptions(deps: ApiDeps): Promise<ContractorListOptions> {
  return {
    t: await serverTexts(deps),
    today: todayOf(deps),
    fee: true,
    scope: undefined,
    tab: 'all',
    employeeId: '',
    kpiMissing: null,
    archived: true,
  };
}

export const orgContractorsRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/{id}/contractors',
  tags: ['admin'],
  summary: 'Карточка организации → «Контрагенты»: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { params: OrgParam, query: ListQueryParams },
  responses: {
    200: {
      description:
        'Все контрагенты организации вместе с архивом: сортировка, фильтры, поиск, группы',
      content: { 'application/json': { schema: AdminOrgContractorList } },
    },
    ...listQueryResponses,
    ...denied,
    ...notFound,
  },
});

export function orgContractorsHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgContractorsRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const query = contractorQuery(listQueryOf(c.req.valid('query')));
    const ctx = await orgOf(deps, c, id);
    const o = await contractorOptions(deps);
    const page = await withOrgContext(deps.db, ctx, (tx) => listContractorsPage(tx, query, o));
    return c.json(pageBody(page, contractorRowOut), 200);
  };
}

export const orgContractorValuesRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/{id}/contractors/values',
  tags: ['admin'],
  summary: 'Карточка организации → «Контрагенты»: значения столбца для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { params: OrgParam, query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом контрагентов',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    ...denied,
    ...notFound,
  },
});

export function orgContractorValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgContractorValuesRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { col, q } = c.req.valid('query');
    contractorColumn('column', col);
    const ctx = await orgOf(deps, c, id);
    const o = await contractorOptions(deps);
    const values = await withOrgContext(deps.db, ctx, (tx) =>
      listContractorValues(tx, col, o, { filters: {} }, q),
    );
    return c.json(values, 200);
  };
}

export const orgContractorExportRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/{id}/contractors/export',
  tags: ['admin'],
  summary: 'Карточка организации → «Контрагенты» в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { params: OrgParam, query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми контрагентами организации под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
    ...notFound,
  },
});

export function orgContractorExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgContractorExportRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const params = c.req.valid('query');
    const query = contractorQuery(listQueryOf(params));
    const keys = [...new Set(params.cols.split(','))];
    for (const key of keys) contractorColumn('column', key);
    const ctx = await orgOf(deps, c, id);
    const o = await contractorOptions(deps);
    return exportList(deps, c, ctx, 'orgs.card.tab.cps', (tx) =>
      exportContractors(tx, query, keys, o),
    );
  };
}
