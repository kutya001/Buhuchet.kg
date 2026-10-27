import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  catalogTypes,
  createOrgReportType,
  exportOrgReportTypes,
  getOrgPolicy,
  listOrgReportTypeSettings,
  listOrgReportTypesPage,
  listOrgReportTypeValues,
  lockOrgReportTypes,
  updateOrgReportType,
  withOrgContext,
  type OrgReportTypeRow as OrgReportTypeRecord,
  type OrgReportTypeSetting,
  type Tx,
} from '@buhuchet/db';
import {
  normalizeRemindDays,
  ORG_REPORT_TYPE_MESSAGES,
  orgReportTypeProblem,
  RecordChangedError,
  RecordNotFoundError,
  type OrgReportTypeChange,
  type OrgReportTypeProblem,
} from '@buhuchet/domain';
import {
  ApiError,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  OrgReportTypeCodeParam,
  OrgReportTypeList,
  OrgReportTypeSave,
  OrgReportTypeSetting as OrgReportTypeSettingSchema,
  OrgReportTypeSettings,
  OrgReportTypesConnect,
  OrgReportTypesConnected,
  type OrgReportTypeRow,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses, versionedSaveResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

/*
 * «Справочники» → «Виды отчётов» (задача 2.02; прототип modules/dicts.js, tax-pick.js): видят все
 * сотрудники (модуль без права просмотра), подключают и настраивают виды — право «Вести справочники
 * организации» (`dicts`). Настройки действуют только для своей организации, каталог не меняется.
 */

const error = { 'application/json': { schema: ApiError } };

/** Строка списка для ответа API: моменты — строкой ISO. */
function rowBody(r: OrgReportTypeRecord): OrgReportTypeRow {
  return {
    ...r,
    audit: r.audit && {
      createdAt: r.audit.createdAt.toISOString(),
      createdBy: r.audit.createdBy,
      updatedAt: r.audit.updatedAt.toISOString(),
      updatedBy: r.audit.updatedBy,
    },
  };
}

/** Отказ по правилу подключения: 409 — состояние вида не то, 400 — неверное значение. */
function refuse(problem: OrgReportTypeProblem): never {
  const status = problem === 'need_file_pay' || problem === 'remind_days_invalid' ? 400 : 409;
  apiFail(status, problem, ORG_REPORT_TYPE_MESSAGES[problem]);
}

export const listOrgReportTypesRoute = createRoute({
  method: 'get',
  path: '/org-report-types',
  tags: ['dicts'],
  summary: '«Виды отчётов»: каталог платформы с настройками организации — страница списка',
  middleware: [requireEmployee] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description:
        'Страница списка: весь действующий каталог, подключён ли вид, сроки словами и настройки организации',
      content: { 'application/json': { schema: OrgReportTypeList } },
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не сотрудник организации', content: error },
  },
});

/**
 * Список «Виды отчётов» (прототип renderDicts, вкладка «Виды отчётов»): сроки сдачи и оплаты и «Что
 * уплачивается» — текстами словаря, по ним работают фильтр, поиск и сортировка.
 */
export function listOrgReportTypesHandler(
  deps: ApiDeps,
): RouteHandler<typeof listOrgReportTypesRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      listOrgReportTypesPage(tx, query, t),
    );
    return c.json(
      {
        items: page.rows.map(rowBody),
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

export const orgReportTypeValuesRoute = createRoute({
  method: 'get',
  path: '/org-report-types/values',
  tags: ['dicts'],
  summary: 'Значения столбца списка «Виды отчётов» для фильтра',
  middleware: [requireEmployee] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом записей во всём списке',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не сотрудник организации', content: error },
  },
});

export function orgReportTypeValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgReportTypeValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      listOrgReportTypeValues(tx, col, t, q),
    );
    return c.json(values, 200);
  };
}

export const exportOrgReportTypesRoute = createRoute({
  method: 'get',
  path: '/org-report-types/export',
  tags: ['dicts'],
  summary: '«Виды отчётов» в Excel',
  middleware: [requireEmployee, requirePermission('export')] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми записями под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Выгружать в Excel»', content: error },
  },
});

export function exportOrgReportTypesHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportOrgReportTypesRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await withOrgContext(deps.db, { ...orgContextOf(c), kind: 'export' }, (tx) =>
        exportOrgReportTypes(tx, query, keys, t),
      );
      return xlsxResponse(c, {
        title: t('tab.dicts.types'),
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

export const orgReportTypeSettingsRoute = createRoute({
  method: 'get',
  path: '/org-report-types/settings',
  tags: ['dicts'],
  summary: 'Подключённые и отключённые виды отчётов организации с настройками',
  middleware: [requireEmployee] as const,
  responses: {
    200: {
      description:
        'Строки организации по порядку каталога и дни напоминаний по умолчанию из учётной политики',
      content: { 'application/json': { schema: OrgReportTypeSettings } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не сотрудник организации', content: error },
  },
});

/** Для окна «Выбор налогов» (что уже подключено) и формы просмотра вида («Настройки организации»). */
export function orgReportTypeSettingsHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgReportTypeSettingsRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const body = await withOrgContext(deps.db, ctx, async (tx) => ({
      items: await listOrgReportTypeSettings(tx),
      remindDays: (await getOrgPolicy(tx, ctx.orgId))?.remindDays ?? [],
    }));
    return c.json(body, 200);
  };
}

/** Набор дней по умолчанию из учётной политики организации. */
async function policyDays(tx: Tx, orgId: string): Promise<number[]> {
  const policy = await getOrgPolicy(tx, orgId);
  if (!policy) throw new RecordNotFoundError('org_settings', orgId);
  return policy.remindDays;
}

export const saveOrgReportTypeRoute = createRoute({
  method: 'put',
  path: '/org-report-types/{code}',
  tags: ['dicts'],
  summary: 'Подключить или отключить вид отчёта, изменить настройки организации по нему',
  middleware: [requirePermission('dicts')] as const,
  request: {
    params: OrgReportTypeCodeParam,
    body: { content: { 'application/json': { schema: OrgReportTypeSave } }, required: true },
  },
  responses: {
    200: {
      description: 'Строка организации после сохранения',
      content: { 'application/json': { schema: OrgReportTypeSettingSchema } },
    },
    400: {
      description: 'Неверные дни напоминаний или «Файл при сдаче» у вида «Уплата»',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Вести справочники организации»', content: error },
    ...versionedSaveResponses,
    404: { description: 'Нет такого вида в каталоге', content: error },
    409: {
      description: 'Запись изменена другим пользователем, вид отключён в каталоге или не подключён',
      content: error,
    },
  },
});

/**
 * Переключатели списка и «Сохранить» в форме вида (прототип renderDicts, typeSettingsDlg): первое
 * подключение создаёт строку с днями из учётной политики (или заданными), «Файл при сдаче» и
 * «Квитанция» выключены; повторное подключение возвращает прежние настройки. Изменение — в историю.
 */
export function saveOrgReportTypeHandler(
  deps: ApiDeps,
): RouteHandler<typeof saveOrgReportTypeRoute, AppEnv> {
  return async (c) => {
    const { code } = c.req.valid('param');
    const body = c.req.valid('json');
    const ctx = orgContextOf(c);
    const change: OrgReportTypeChange = {
      enabled: body.enabled,
      remindDays: body.remindDays && normalizeRemindDays(body.remindDays),
      needFile: body.needFile,
      needReceipt: body.needReceipt,
    };
    const saved = await withOrgContext(deps.db, ctx, async (tx): Promise<OrgReportTypeSetting> => {
      const [type] = await catalogTypes(tx, [code]);
      if (!type) throw new RecordNotFoundError('org_report_type', code);
      const [current] = await lockOrgReportTypes(tx, [code]);
      const problem = orgReportTypeProblem(type, current ?? null, change);
      if (problem) refuse(problem);
      if (!current) {
        return createOrgReportType(tx, code, {
          enabled: true,
          remindDays: change.remindDays ? [...change.remindDays] : await policyDays(tx, ctx.orgId),
          needFile: change.needFile ?? false,
          needReceipt: change.needReceipt ?? false,
        });
      }
      // Строку успели создать, пока у пользователя был открыт неподключённый вид.
      if (body.version === null)
        throw new RecordChangedError('org_report_type', code, current.version);
      return updateOrgReportType(tx, code, body.version, {
        ...change,
        remindDays: change.remindDays && [...change.remindDays],
      });
    });
    return c.json(saved, 200);
  };
}

export const connectOrgReportTypesRoute = createRoute({
  method: 'post',
  path: '/org-report-types/connect',
  tags: ['dicts'],
  summary: '«Выбор налогов»: подключить отмеченные виды отчётов и отключить снятые',
  middleware: [requirePermission('dicts')] as const,
  request: {
    body: { content: { 'application/json': { schema: OrgReportTypesConnect } }, required: true },
  },
  responses: {
    200: {
      description: 'Сколько видов подключено и отключено',
      content: { 'application/json': { schema: OrgReportTypesConnected } },
    },
    400: { description: 'Неверные дни напоминаний или один вид в обоих списках', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Вести справочники организации»', content: error },
    404: { description: 'Нет такого вида в каталоге', content: error },
    409: {
      description:
        'Вид отключён в каталоге платформы или его только что подключил или изменил другой пользователь',
      content: error,
    },
  },
});

/**
 * Окно «Выбор налогов» (прототип txApply): новые подключённые получают дни из поля «Напоминать до
 * срока, за дней» (пусто — из учётной политики), «Файл при сдаче» и «Квитанция» — как были (у нового
 * — выключены); снятые отключаются. Уже подключённые и уже отключённые не трогаются. Контрагентам
 * ничего не назначается. Всё — одной транзакцией.
 */
export function connectOrgReportTypesHandler(
  deps: ApiDeps,
): RouteHandler<typeof connectOrgReportTypesRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const connect = [...new Set(body.connect)];
    const disconnect = [...new Set(body.disconnect)];
    if (connect.some((code) => disconnect.includes(code))) {
      apiFail(400, 'validation_failed', 'Вид отчёта не может быть и подключён, и отключён');
    }
    // Пустой набор — как без поля: дни учётной политики (прототип txApply).
    const days = body.remindDays?.length ? normalizeRemindDays(body.remindDays) : undefined;
    if (days) {
      const problem = orgReportTypeProblem(
        { active: true, act: 'both' },
        { enabled: true },
        { remindDays: days },
      );
      if (problem) refuse(problem);
    }
    const ctx = orgContextOf(c);
    const result = await withOrgContext(deps.db, ctx, async (tx) => {
      const codes = [...connect, ...disconnect];
      const types = new Map((await catalogTypes(tx, codes)).map((x) => [x.code, x]));
      const missing = codes.find((code) => !types.has(code));
      if (missing) throw new RecordNotFoundError('org_report_type', missing);
      const rows = new Map((await lockOrgReportTypes(tx, codes)).map((r) => [r.code, r]));
      const remindDays = days ?? (await policyDays(tx, ctx.orgId));
      let connected = 0;
      for (const code of connect) {
        const row = rows.get(code);
        if (row?.enabled) continue;
        const problem = orgReportTypeProblem(types.get(code)!, row ?? null, { enabled: true });
        if (problem) refuse(problem);
        if (row) await updateOrgReportType(tx, code, row.version, { enabled: true, remindDays });
        else {
          await createOrgReportType(tx, code, {
            enabled: true,
            remindDays,
            needFile: false,
            needReceipt: false,
          });
        }
        connected++;
      }
      let disconnected = 0;
      for (const code of disconnect) {
        const row = rows.get(code);
        if (!row?.enabled) continue;
        await updateOrgReportType(tx, code, row.version, { enabled: false });
        disconnected++;
      }
      return { connected, disconnected };
    });
    return c.json(result, 200);
  };
}
