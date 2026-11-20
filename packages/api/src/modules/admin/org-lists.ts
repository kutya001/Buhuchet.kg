import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  adminGetOrganization,
  adminReportFiles,
  exportAdminOrgStaff,
  exportContractors,
  exportReports,
  getReportCard,
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
  type ListPageResult,
  type ReportListOptions,
  type ReportPlate,
  type Tx,
} from '@buhuchet/db';
import { accountStates, RecordNotFoundError } from '@buhuchet/domain';
import {
  AdminOrgReport,
  AdminOrgReportPlate,
  AdminOrgStaffList,
  ApiError,
  ContractorList,
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
import { contractorRowBody, contractorRowServices } from '../contractors/list';
import { todayOf } from '../contractors/common';
import { serverTexts } from '../l10n/texts';
import { reportRowBody } from '../reports/list';

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

/**
 * Условия списка отчётов организации глазами администратора: вся организация, плитка-фильтр вместо
 * вкладки, «Просрочено» — как во вкладке «Просроченные» фирмы (с оплатой при «Учёте оплаты налогов»).
 */
async function reportOptions(
  deps: ApiDeps,
  tx: Tx,
  orgId: string,
  plate: ReportPlate,
): Promise<ReportListOptions> {
  const [policy, settings] = await Promise.all([
    reportConfirmPolicy(tx, orgId),
    orgMenuSettings(tx, orgId),
  ]);
  return {
    t: await serverTexts(deps),
    today: todayOf(deps),
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
    const page = await withOrgContext(deps.db, ctx, async (tx) =>
      listReportsPage(tx, query, await reportOptions(deps, tx, id, params.plate)),
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
    const values = await withOrgContext(deps.db, ctx, async (tx) =>
      listReportValues(tx, col, await reportOptions(deps, tx, id, plate), q),
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
    return exportList(deps, c, ctx, 'orgs.card.tab.rep', async (tx) =>
      exportReports(tx, query, keys, await reportOptions(deps, tx, id, params.plate)),
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
      content: { 'application/json': { schema: ContractorList } },
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
    const query = listQueryOf(c.req.valid('query'));
    const ctx = await orgOf(deps, c, id);
    const o = await contractorOptions(deps);
    const { page, services } = await withOrgContext(deps.db, ctx, async (tx) => {
      const page = await listContractorsPage(tx, query, o);
      return { page, services: await contractorRowServices(tx, page.rows, o.today) };
    });
    return c.json(
      pageBody(page, (r) => contractorRowBody(r, true, services.get(r.id)!)),
      200,
    );
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
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const ctx = await orgOf(deps, c, id);
    const o = await contractorOptions(deps);
    return exportList(deps, c, ctx, 'orgs.card.tab.cps', (tx) =>
      exportContractors(tx, query, keys, o),
    );
  };
}
