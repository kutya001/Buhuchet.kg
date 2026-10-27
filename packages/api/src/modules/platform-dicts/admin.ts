import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { randomBytes } from 'node:crypto';
import {
  adminDictCreate,
  adminDictDelete,
  adminDictHistory,
  adminDictMove,
  adminDictSetActive,
  adminDictUpdate,
  countNewDictRequests,
  dictValueTakenField,
  exportAdminDict,
  getAdminDictValue,
  listAdminDictPage,
  listAdminDictValues,
  platformDictGroupDefs,
  reportTypeOptions,
  withUserContext,
  type AdminDictDeleteResult,
  type AdminDictInput,
  type AdminDictSaveResult,
  type AdminDictValueRecord,
} from '@buhuchet/db';
import {
  ADMIN_DICT_META,
  DICT_HISTORY_SHOWN,
  RecordChangedError,
  RecordNotFoundError,
  type AdminValueDict,
  type DictUsage,
} from '@buhuchet/domain';
import {
  AdminDictActive,
  AdminDictCodeParam,
  AdminDictDeleteQuery,
  AdminDictGroups,
  AdminDictHistory,
  AdminDictList,
  AdminDictMove,
  AdminDictValue,
  AdminDictValueForm,
  AdminDictValueUpdate,
  AdminReportTypeOptions,
  AdminValueDictParam,
  ApiError,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  PdictsTabCounts,
  type AdminDictData,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses, versionedSaveResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

/*
 * Админка → «Справочники платформы» (задача 2.36; ТЗ «Общие правила для всех справочников»; прототип
 * admin/platform-dicts.js): справочник вкладки — список, значения фильтра, «В Excel»; добавить,
 * изменить, «Выше»/«Ниже», отключить, удалить неиспользуемое; «История изменений»; шапки вкладок и
 * число новых запросов. Только администратору платформы (`requirePlatformAdmin`, `withUserContext`).
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const json = <T>(schema: T) => ({ 'application/json': { schema } });

/** Значение для ответа API: моменты — строкой ISO. */
function valueBody(x: AdminDictValueRecord): AdminDictValue {
  return {
    code: x.code,
    n: x.n,
    name: x.name,
    data: x.data as AdminDictData,
    active: x.active,
    used: x.usage.total,
    contractors: x.usage.contractors,
    audit: {
      createdAt: x.audit.createdAt?.toISOString() ?? null,
      createdBy: x.audit.createdBy,
      updatedAt: x.audit.updatedAt.toISOString(),
      updatedBy: x.audit.updatedBy,
    },
    version: x.version,
  };
}

const adminTx = <T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  fn: Parameters<typeof withUserContext<T>>[2],
) => withUserContext(deps.db, c.get('session')!.userId, fn);

export const listAdminDictRoute = createRoute({
  method: 'get',
  path: '/admin/platform-dicts/{dict}',
  tags: ['platform-dicts'],
  summary: 'Справочник платформы в Админке: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminValueDictParam, query: ListQueryParams },
  responses: {
    200: {
      description:
        'Значения с «№», «Используется» и «Статусом»; поиск, фильтры и группы — на сервере',
      content: json(AdminDictList),
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function listAdminDictHandler(
  deps: ApiDeps,
): RouteHandler<typeof listAdminDictRoute, AppEnv> {
  return async (c) => {
    const { dict } = c.req.valid('param');
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await adminTx(deps, c, (tx) => listAdminDictPage(tx, dict, query, t));
    return c.json(
      {
        items: page.rows.map(valueBody),
        count: page.count,
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

export const adminDictValuesRoute = createRoute({
  method: 'get',
  path: '/admin/platform-dicts/{dict}/values',
  tags: ['platform-dicts'],
  summary: 'Значения столбца справочника для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminValueDictParam, query: ListValuesQuery },
  responses: {
    200: { description: 'Значения столбца с подписью и числом', content: json(ListValues) },
    ...listQueryResponses,
    ...denied,
  },
});

export function adminDictValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminDictValuesRoute, AppEnv> {
  return async (c) => {
    const { dict } = c.req.valid('param');
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await adminTx(deps, c, (tx) => listAdminDictValues(tx, dict, col, t, q));
    return c.json(values, 200);
  };
}

export const exportAdminDictRoute = createRoute({
  method: 'get',
  path: '/admin/platform-dicts/{dict}/export',
  tags: ['platform-dicts'],
  summary: 'Справочник платформы в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminValueDictParam, query: ListExportParams },
  responses: {
    200: { description: 'Файл Excel со значениями под поиском и фильтрами', content: xlsxContent },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function exportAdminDictHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportAdminDictRoute, AppEnv> {
  return async (c) => {
    const { dict } = c.req.valid('param');
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = c.get('session')!.userId;
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const result = await withUserContext(
        deps.db,
        userId,
        (tx) => exportAdminDict(tx, dict, query, keys, t),
        'export',
      );
      return xlsxResponse(c, {
        title: t(`pdicts.title.${dict}`),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        t,
      });
    });
  };
}

export const adminDictGroupsRoute = createRoute({
  method: 'get',
  path: '/admin/platform-dicts/groups',
  tags: ['platform-dicts'],
  summary: 'Шапки вкладок: группы справочников платформы',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Группы: что это за справочник и где он используется',
      content: json(AdminDictGroups),
    },
    ...denied,
  },
});

/** Шапка вкладки (прототип dgHead): группа, «что это» и «где используется» из раздела `dictGroups`. */
export function adminDictGroupsHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminDictGroupsRoute, AppEnv> {
  return async (c) => {
    const body: AdminDictGroups = {
      items: (await platformDictGroupDefs(deps.db)).map((g) => ({ ...g, tabs: [...g.tabs] })),
    };
    return c.json(body, 200);
  };
}

export const reportTypeOptionsRoute = createRoute({
  method: 'get',
  path: '/admin/platform-dicts/report-type-options',
  tags: ['platform-dicts'],
  summary: 'Каталог видов отчётов кратко',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Код, название, краткое название, тип и статус вида — в порядке каталога',
      content: json(AdminReportTypeOptions),
    },
    ...denied,
  },
});

/** Виды отчётов для окна основания (прототип baseDlg) и подписей «Виды отчётов». */
export function reportTypeOptionsHandler(
  deps: ApiDeps,
): RouteHandler<typeof reportTypeOptionsRoute, AppEnv> {
  return async (c) => {
    const items = await adminTx(deps, c, (tx) => reportTypeOptions(tx));
    return c.json({ items }, 200);
  };
}

export const pdictsTabCountsRoute = createRoute({
  method: 'get',
  path: '/admin/platform-dicts/tab-counts',
  tags: ['platform-dicts'],
  summary: 'Числа на вкладках «Справочников платформы»',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: { description: 'Новых запросов организаций', content: json(PdictsTabCounts) },
    ...denied,
  },
});

/** Число на вкладке «Запросы» — новых запросов (прототип pdTabs). */
export function pdictsTabCountsHandler(
  deps: ApiDeps,
): RouteHandler<typeof pdictsTabCountsRoute, AppEnv> {
  return async (c) => {
    const requests = await adminTx(deps, c, (tx) => countNewDictRequests(tx));
    return c.json({ requests }, 200);
  };
}

export const adminDictHistoryRoute = createRoute({
  method: 'get',
  path: '/admin/platform-dicts/{dict}/history',
  tags: ['platform-dicts'],
  summary: '«История изменений» справочника',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminValueDictParam },
  responses: {
    200: {
      description: `Последние ${DICT_HISTORY_SHOWN} записей, сначала новые, и сколько их всего`,
      content: json(AdminDictHistory),
    },
    ...denied,
  },
});

export function adminDictHistoryHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminDictHistoryRoute, AppEnv> {
  return async (c) => {
    const { dict } = c.req.valid('param');
    const history = await adminTx(deps, c, (tx) => adminDictHistory(tx, dict, DICT_HISTORY_SHOWN));
    const body: AdminDictHistory = {
      total: history.total,
      items: history.items.map((h) => ({ ...h, at: h.at.toISOString() })),
    };
    return c.json(body, 200);
  };
}

export const getAdminDictValueRoute = createRoute({
  method: 'get',
  path: '/admin/platform-dicts/{dict}/{code}',
  tags: ['platform-dicts'],
  summary: 'Значение справочника',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminDictCodeParam },
  responses: {
    200: { description: 'Значение с версией', content: json(AdminDictValue) },
    404: { description: 'Нет такого значения', content: error },
    ...denied,
  },
});

/** Значение для окна правки — «Перечитать» после «запись изменена другим». */
export function getAdminDictValueHandler(
  deps: ApiDeps,
): RouteHandler<typeof getAdminDictValueRoute, AppEnv> {
  return async (c) => {
    const { dict, code } = c.req.valid('param');
    const found = await adminTx(deps, c, (tx) => getAdminDictValue(tx, dict, code));
    if (!found) throw new RecordNotFoundError('platform_dict', code);
    return c.json(valueBody(found), 200);
  };
}

/**
 * Поля формы → поля значения справочника (только поля этого справочника). «Тип» не этого справочника
 * (у режима — «Банк») — 400 под полем; пустой — тип нового значения.
 */
function inputOf(dict: AdminValueDict, form: AdminDictValueForm): AdminDictInput {
  const meta = ADMIN_DICT_META[dict];
  const values = form as Record<string, unknown>;
  const data: AdminDictInput['data'] = {};
  for (const f of meta.fields) {
    if (f === 'name') continue;
    const v = values[f];
    if (f === 'byPhone') data[f] = v === true;
    else if (f === 'contacts' || meta.links?.includes(f)) {
      data[f] = (v as AdminDictInput['data'][string]) ?? [];
    } else data[f] = (v as string) ?? '';
  }
  if (dict === 'forms' && !data.declarationFor) data.declarationFor = 'org';
  if (meta.kind) {
    data.kind ||= meta.kind.default;
    if (!meta.kind.values.includes(data.kind as string)) {
      apiFail(400, 'invalid_kind', 'Такого типа у справочника нет', { field: 'kind' });
    }
  }
  return { name: form.name, data };
}

/** Обязательные поля сверх названия (прототип ugnsDlg, regimeDlg). */
const REQUIRED = {
  shortName: ['short_name_required', 'Введите краткое название'],
  fullName: ['full_name_required', 'Введите полное название'],
  dialCode: ['dial_code_required', '1–4 цифры'],
  mask: ['mask_required', 'Только X и пробелы'],
} as const;

/** Краткое название управления, полное название режима, код и маска страны обязательны. */
function checkRequired(dict: AdminValueDict, input: AdminDictInput) {
  for (const field of ADMIN_DICT_META[dict].required ?? []) {
    if (!String(input.data[field] ?? '').trim()) {
      const [code, message] = REQUIRED[field];
      apiFail(400, code, message, { field });
    }
  }
}

const TAKEN = {
  name: ['dict_value_taken', 'Такое значение уже есть'],
  gnsCode: ['ugns_code_taken', 'Такой код уже есть'],
} as const;

/**
 * Отказ сохранения: повтор — 400 под полем; используется — 409 `dict_value_used` с числом записей;
 * устаревшая версия — 409 «запись изменена другим пользователем» с нынешней версией; нет значения — 404.
 */
async function failOf(
  deps: ApiDeps,
  c: Context<AppEnv>,
  result: Exclude<AdminDictSaveResult | AdminDictDeleteResult, { ok: true }>,
  dict: AdminValueDict,
  code: string,
): Promise<never> {
  if (result.reason === 'taken') {
    const field = result.problems[0]!.field;
    const [errCode, message] = TAKEN[field];
    apiFail(400, errCode, message, { field });
  }
  if (result.reason === 'used') return usedFail(result.usage);
  if (result.reason === 'fixed') {
    apiFail(409, 'dict_value_fixed', 'Код по умолчанию отключить нельзя');
  }
  if (result.reason === 'undeletable') {
    apiFail(409, 'dict_value_undeletable', 'Значение можно только отключить');
  }
  if (result.reason === 'bad_link') {
    apiFail(400, 'invalid_link', 'Можно выбрать только сквозные действующие виды отчётов', {
      field: result.field,
    });
  }
  if (result.reason === 'changed') {
    const now = await adminTx(deps, c, (tx) => getAdminDictValue(tx, dict, code));
    if (now) throw new RecordChangedError('platform_dict', code, now.version);
  }
  throw new RecordNotFoundError('platform_dict', `${dict}:${code}`);
}

function usedFail(usage: DictUsage): never {
  apiFail(
    409,
    'dict_value_used',
    `Значение используется в ${usage.total} записях — его можно только отключить`,
    {
      n: usage.total,
      contractors: usage.contractors,
    },
  );
}

/** Тот же отказ от уникального индекса (другой администратор успел сохранить такое же) — под полем. */
async function saving<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const field = dictValueTakenField(err);
    if (!field) throw err;
    const [errCode, message] = TAKEN[field];
    return apiFail(400, errCode, message, { field });
  }
}

const valueTaken = {
  description:
    'Название пустое или уже есть, не заполнено обязательное поле, тип не этого справочника, код ГНС не из трёх цифр или уже есть',
  content: error,
};

export const createAdminDictValueRoute = createRoute({
  method: 'post',
  path: '/admin/platform-dicts/{dict}',
  tags: ['platform-dicts'],
  summary: 'Добавить значение справочника',
  middleware: [requirePlatformAdmin] as const,
  request: {
    params: AdminValueDictParam,
    body: { required: true, content: json(AdminDictValueForm) },
  },
  responses: {
    201: { description: 'Значение добавлено в конец справочника', content: json(AdminDictValue) },
    400: valueTaken,
    ...denied,
  },
});

/** «+ Добавить» → «Значение» / «Налоговый орган»: код — следующий номер справочника. */
export function createAdminDictValueHandler(
  deps: ApiDeps,
): RouteHandler<typeof createAdminDictValueRoute, AppEnv> {
  return async (c) => {
    const { dict } = c.req.valid('param');
    const input = inputOf(dict, c.req.valid('json'));
    checkRequired(dict, input);
    const random = () => randomBytes(4).toString('hex');
    const result = await saving(() =>
      adminTx(deps, c, (tx) => adminDictCreate(tx, dict, input, random)),
    );
    if (!result.ok) return failOf(deps, c, result, dict, '');
    return c.json(valueBody(result.record), 201);
  };
}

export const updateAdminDictValueRoute = createRoute({
  method: 'put',
  path: '/admin/platform-dicts/{dict}/{code}',
  tags: ['platform-dicts'],
  summary: 'Изменить значение справочника',
  middleware: [requirePlatformAdmin] as const,
  request: {
    params: AdminDictCodeParam,
    body: { required: true, content: json(AdminDictValueUpdate) },
  },
  responses: {
    200: {
      description: 'Сохранено: новое название сразу видно у всех организаций',
      content: json(AdminDictValue),
    },
    400: valueTaken,
    ...denied,
    ...versionedSaveResponses,
  },
});

/** «Изменить» / «Переименовать»: записи ссылаются на код, поэтому новое название видно везде. */
export function updateAdminDictValueHandler(
  deps: ApiDeps,
): RouteHandler<typeof updateAdminDictValueRoute, AppEnv> {
  return async (c) => {
    const { dict, code } = c.req.valid('param');
    const { version, ...form } = c.req.valid('json');
    const input = inputOf(dict, form);
    checkRequired(dict, input);
    const result = await saving(() =>
      adminTx(deps, c, (tx) => adminDictUpdate(tx, dict, code, input, version)),
    );
    if (!result.ok) return failOf(deps, c, result, dict, code);
    return c.json(valueBody(result.record), 200);
  };
}

export const moveAdminDictValueRoute = createRoute({
  method: 'post',
  path: '/admin/platform-dicts/{dict}/{code}/move',
  tags: ['platform-dicts'],
  summary: '«Выше» / «Ниже»',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminDictCodeParam, body: { required: true, content: json(AdminDictMove) } },
  responses: {
    200: { description: 'Значение поменялось местами с соседним', content: json(AdminDictValue) },
    ...denied,
    ...versionedSaveResponses,
  },
});

export function moveAdminDictValueHandler(
  deps: ApiDeps,
): RouteHandler<typeof moveAdminDictValueRoute, AppEnv> {
  return async (c) => {
    const { dict, code } = c.req.valid('param');
    const { step, version } = c.req.valid('json');
    const result = await adminTx(deps, c, (tx) => adminDictMove(tx, dict, code, step, version));
    if (!result.ok) return failOf(deps, c, result, dict, code);
    return c.json(valueBody(result.record), 200);
  };
}

export const setAdminDictActiveRoute = createRoute({
  method: 'post',
  path: '/admin/platform-dicts/{dict}/{code}/active',
  tags: ['platform-dicts'],
  summary: '«Отключить» / «Включить»',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminDictCodeParam, body: { required: true, content: json(AdminDictActive) } },
  responses: {
    200: {
      description: 'Отключённое не предлагается в новых записях, в старых остаётся',
      content: json(AdminDictValue),
    },
    ...denied,
    ...versionedSaveResponses,
    409: {
      description:
        'Изменено другим пользователем или значение по умолчанию (Кыргызстан) отключить нельзя',
      content: error,
    },
  },
});

export function setAdminDictActiveHandler(
  deps: ApiDeps,
): RouteHandler<typeof setAdminDictActiveRoute, AppEnv> {
  return async (c) => {
    const { dict, code } = c.req.valid('param');
    const { active, version } = c.req.valid('json');
    const result = await adminTx(deps, c, (tx) =>
      adminDictSetActive(tx, dict, code, active, version),
    );
    if (!result.ok) return failOf(deps, c, result, dict, code);
    return c.json(valueBody(result.record), 200);
  };
}

export const deleteAdminDictValueRoute = createRoute({
  method: 'delete',
  path: '/admin/platform-dicts/{dict}/{code}',
  tags: ['platform-dicts'],
  summary: 'Удалить неиспользуемое значение',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminDictCodeParam, query: AdminDictDeleteQuery },
  responses: {
    204: { description: 'Удалено' },
    404: { description: 'Нет такого значения', content: error },
    409: {
      description:
        'Значение используется или его удалять нельзя (только отключить), или изменено другим пользователем',
      content: error,
    },
    ...denied,
  },
});

/** «Удалить»: используемое — 409 `dict_value_used` с числом записей (ТЗ: только отключить). */
export function deleteAdminDictValueHandler(
  deps: ApiDeps,
): RouteHandler<typeof deleteAdminDictValueRoute, AppEnv> {
  return async (c) => {
    const { dict, code } = c.req.valid('param');
    const { version } = c.req.valid('query');
    const result = await adminTx(deps, c, (tx) => adminDictDelete(tx, dict, code, version));
    if (!result.ok) return failOf(deps, c, result, dict, code);
    return c.body(null, 204);
  };
}
