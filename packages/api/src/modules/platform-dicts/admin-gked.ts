import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  adminDictBulkActive,
  type AdminGkedGroups as GroupsRecord,
  adminEnRateGked,
  adminEnRates,
  adminGkedGroups,
  adminGkedGroupSave,
  adminGkedItems,
  adminMarkGns,
  adminTypesBulkDue,
  withUserContext,
  type AdminEnRateRecord,
  type BulkResult,
  type Tx,
} from '@buhuchet/db';
import { RecordChangedError, RecordNotFoundError } from '@buhuchet/domain';
import {
  AdminBulkActive,
  AdminBulkDue,
  AdminBulkResult,
  AdminDuesPreview,
  AdminEnRate,
  AdminEnRateCodeParam,
  AdminEnRateGkedForm,
  AdminGkedGroupForm,
  AdminGkedGroupIdParam,
  AdminGkedGroups,
  AdminGkedItems,
  AdminMarkGns,
  AdminValueDictParam,
  ApiError,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { requirePlatformAdmin } from '../../middleware/access';
import { saveProblem } from './admin';
import { duesPreviewResponses, previewEdit, queued, recalcQueued } from './admin-dues';

/*
 * Админка → «Справочники платформы»: вкладка «ГКЭД» (задача 2.38; прототип admin/gked-admin.js) —
 * коды для дерева и поиска, «Группы кодов», «Виды деятельности (ГКЭД)» ставок единого налога; и
 * массовые действия списков (задача 2.37, часть 3; прототип admin/platform-dicts-edit.js:
 * bulkActive, bulkDueDlg, markGns). Только администратору платформы (`requirePlatformAdmin`,
 * `withUserContext`).
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const json = <T>(schema: T) => ({ 'application/json': { schema } });

/** Группы для ответа: списки — обычными массивами. */
const groupsBody = (x: GroupsRecord): AdminGkedGroups => ({
  ...x,
  items: x.items.map((g) => ({
    ...g,
    codes: [...g.codes],
    en: g.en && typeof g.en === 'object' ? { ...g.en } : g.en,
    spino: g.spino && typeof g.spino === 'object' ? { ...g.spino } : g.spino,
  })),
});

const adminTx = <T>(deps: ApiDeps, c: Context<AppEnv>, fn: (tx: Tx) => Promise<T>) =>
  withUserContext(deps.db, c.get('session')!.userId, fn);

/* ───────────── Коды ГКЭД ───────────── */

export const adminGkedItemsRoute = createRoute({
  method: 'get',
  path: '/admin/platform-gked/items',
  tags: ['platform-dicts'],
  summary: 'ГКЭД: все коды для дерева и поиска',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Коды в порядке классификатора: «Используется», у контрагентов, вложенных',
      content: json(AdminGkedItems),
    },
    ...denied,
  },
});

/** Дерево и поиск (прототип gkTree, gkSearch): весь классификатор — около двух тысяч кодов. */
export function adminGkedItemsHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminGkedItemsRoute, AppEnv> {
  return async (c) => c.json({ items: await adminTx(deps, c, (tx) => adminGkedItems(tx)) }, 200);
}

/* ───────────── Группы кодов ───────────── */

export const adminGkedGroupsRoute = createRoute({
  method: 'get',
  path: '/admin/platform-gked/groups',
  tags: ['platform-dicts'],
  summary: 'ГКЭД: группы кодов',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Группы, версия раздела и что меняет правка группы',
      content: json(AdminGkedGroups),
    },
    ...denied,
  },
});

export function adminGkedGroupsHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminGkedGroupsRoute, AppEnv> {
  return async (c) => c.json(groupsBody(await adminTx(deps, c, (tx) => adminGkedGroups(tx))), 200);
}

export const saveGkedGroupRoute = createRoute({
  method: 'put',
  path: '/admin/platform-gked/groups/{id}',
  tags: ['platform-dicts'],
  summary: 'ГКЭД: изменить группу кодов',
  middleware: [requirePlatformAdmin] as const,
  request: {
    params: AdminGkedGroupIdParam,
    body: { required: true, content: json(AdminGkedGroupForm) },
  },
  responses: {
    200: {
      description: 'Сохранено: перечни единого налога и СПиНО обновлены',
      content: json(AdminGkedGroups),
    },
    400: { description: 'Название или коды пустые, кодов нет в справочнике', content: error },
    ...denied,
    ...versionedSaveResponses,
  },
});

/**
 * «Сохранить» в окне группы (прототип gkGrpDlg): коды прежней группы убираются из «Кроме» и
 * «Предупреждать при ГКЭД» единого налога и СПиНО, коды новой добавляются по действию.
 */
export function saveGkedGroupHandler(
  deps: ApiDeps,
): RouteHandler<typeof saveGkedGroupRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, ...value } = c.req.valid('json');
    const result = await adminTx(deps, c, async (tx) => {
      const saved = await adminGkedGroupSave(tx, id, value, version);
      if (saved.ok) return adminGkedGroups(tx);
      if (saved.reason === 'codes') {
        const codes = saved.unknown.join(', ');
        return apiFail(400, 'gked_unknown', `Нет в справочнике ГКЭД: ${codes}`, {
          field: 'codes',
          codes,
        });
      }
      if (saved.reason === 'not_found') throw new RecordNotFoundError('platform_dict', id);
      if (saved.reason === 'target') {
        // Перечень режима, вида или статуса изменили между чтением и записью — сохранить заново.
        throw new RecordChangedError('platform_dict', saved.target.code, version);
      }
      const now = await adminGkedGroups(tx);
      throw new RecordChangedError('platform_dict', id, now.version);
    });
    return c.json(groupsBody(result), 200);
  };
}

/* ───────────── Ставки единого налога ───────────── */

const enRateBody = (x: AdminEnRateRecord): AdminEnRate => ({
  code: x.code,
  activity: x.activity,
  rate: x.rate,
  explanation: x.explanation,
  article: x.article,
  gked: x.gked,
  version: x.version,
});

export const adminEnRateRoute = createRoute({
  method: 'get',
  path: '/admin/platform-enrates/{code}',
  tags: ['platform-dicts'],
  summary: 'Ставка единого налога: «Виды деятельности (ГКЭД)»',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminEnRateCodeParam },
  responses: {
    200: { description: 'Ставка с перечнем и версией', content: json(AdminEnRate) },
    404: { description: 'Нет такой ставки', content: error },
    ...denied,
  },
});

export function adminEnRateHandler(deps: ApiDeps): RouteHandler<typeof adminEnRateRoute, AppEnv> {
  return async (c) => {
    const { code } = c.req.valid('param');
    const [found] = await adminTx(deps, c, (tx) => adminEnRates(tx, code));
    if (!found) throw new RecordNotFoundError('platform_dict', code);
    return c.json(enRateBody(found), 200);
  };
}

export const saveEnRateGkedRoute = createRoute({
  method: 'put',
  path: '/admin/platform-enrates/{code}/gked',
  tags: ['platform-dicts'],
  summary: 'Ставка единого налога: изменить «Виды деятельности (ГКЭД)»',
  middleware: [requirePlatformAdmin] as const,
  request: {
    params: AdminEnRateCodeParam,
    body: { required: true, content: json(AdminEnRateGkedForm) },
  },
  responses: {
    200: { description: 'Сохранено', content: json(AdminEnRate) },
    400: { description: 'Кодов нет в справочнике ГКЭД', content: error },
    ...denied,
    ...versionedSaveResponses,
  },
});

/** «Сохранить» в окне ставки (прототип enRateDlg): ставка подбирается по основному ГКЭД. */
export function saveEnRateGkedHandler(
  deps: ApiDeps,
): RouteHandler<typeof saveEnRateGkedRoute, AppEnv> {
  return async (c) => {
    const { code } = c.req.valid('param');
    const { gked, version } = c.req.valid('json');
    const record = await adminTx(deps, c, async (tx) => {
      const saved = await adminEnRateGked(tx, code, gked, version);
      if (saved.ok) return saved.record;
      if (saved.reason === 'codes') {
        const codes = saved.unknown.join(', ');
        return apiFail(400, 'gked_unknown', `Нет в справочнике ГКЭД: ${codes}`, {
          field: 'gked',
          codes,
        });
      }
      const [now] = await adminEnRates(tx, code);
      if (saved.reason === 'changed' && now) {
        throw new RecordChangedError('platform_dict', code, now.version);
      }
      throw new RecordNotFoundError('platform_dict', code);
    });
    return c.json(enRateBody(record), 200);
  };
}

/* ───────────── Массовые действия ───────────── */

const BULK = '/admin/platform-dicts-bulk';

const bulkResponses = {
  400: { description: 'Неверные данные или значение не подходит', content: error },
  ...denied,
  ...versionedSaveResponses,
} as const;

/**
 * Отказ у одного из отмеченных — отказ всего: под полем его окна (повтор, связь), иначе 409 или 404.
 * Транзакция откатывается, ни одно значение не меняется.
 */
function bulkFail(result: Extract<BulkResult, { ok: false }>): never {
  const problem = saveProblem(result.result);
  if (problem) {
    return apiFail(400, problem.code, problem.message, { field: problem.field, code: result.code });
  }
  if (result.result.reason === 'fixed') {
    return apiFail(409, 'dict_value_fixed', 'Код по умолчанию отключить нельзя');
  }
  if (result.result.reason === 'changed') {
    return apiFail(409, 'record_changed', 'Запись изменена другим пользователем', {
      code: result.code,
    });
  }
  throw new RecordNotFoundError('platform_dict', result.code);
}

/** Транзакция массового действия: отказ — исключение, правки откатываются. */
async function bulkTx(
  deps: ApiDeps,
  c: Context<AppEnv>,
  run: (tx: Tx) => Promise<BulkResult>,
) {
  return adminTx(deps, c, async (tx) => {
    const result = await run(tx);
    if (!result.ok) return bulkFail(result);
    return queued(tx, result);
  });
}

export const bulkActiveRoute = createRoute({
  method: 'post',
  path: `${BULK}/{dict}/active`,
  tags: ['platform-dicts'],
  summary: '«Включить» / «Отключить» у отмеченных',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminValueDictParam, body: { required: true, content: json(AdminBulkActive) } },
  responses: {
    200: { description: 'Сколько значений и пересчёт сроков', content: json(AdminBulkResult) },
    ...bulkResponses,
  },
});

/** Прототип bulkActive, benActive: у статусов со своими сроками сроки пересчитываются. */
export function bulkActiveHandler(deps: ApiDeps): RouteHandler<typeof bulkActiveRoute, AppEnv> {
  return async (c) => {
    const { dict } = c.req.valid('param');
    const { codes, active } = c.req.valid('json');
    const result = await bulkTx(deps, c, (tx) => adminDictBulkActive(tx, dict, codes, active));
    const { reports, orgs, pending } = await recalcQueued(deps, result.queued);
    return c.json({ n: result.records.length, dues: { reports, orgs }, pending }, 200);
  };
}

export const bulkActivePreviewRoute = createRoute({
  method: 'post',
  path: `${BULK}/{dict}/active/dues-preview`,
  tags: ['platform-dicts'],
  summary: 'Предпросмотр: у скольких отчётов изменятся сроки после «Включить» / «Отключить»',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminValueDictParam, body: { required: true, content: json(AdminBulkActive) } },
  responses: {
    200: { description: 'Отчёты и организации; правка не сохраняется', content: json(AdminDuesPreview) },
    ...duesPreviewResponses,
  },
});

/** Окно подтверждения у статусов, которые меняют сроки (прототип benActive `dueNote`). */
export function bulkActivePreviewHandler(
  deps: ApiDeps,
): RouteHandler<typeof bulkActivePreviewRoute, AppEnv> {
  return async (c) => {
    const { dict } = c.req.valid('param');
    const { codes, active } = c.req.valid('json');
    const preview = await previewEdit(deps, c, async (tx) => {
      const result = await adminDictBulkActive(tx, dict, codes, active);
      return result.ok ? result.redue : false;
    });
    return c.json(preview, 200);
  };
}

export const bulkDueRoute = createRoute({
  method: 'post',
  path: `${BULK}/types/due`,
  tags: ['platform-dicts'],
  summary: '«Изменить срок у N видов»',
  middleware: [requirePlatformAdmin] as const,
  request: { body: { required: true, content: json(AdminBulkDue) } },
  responses: {
    200: { description: 'Сколько видов и пересчёт сроков', content: json(AdminBulkResult) },
    ...bulkResponses,
  },
});

/** Прототип bulkDueDlg «Применить»: каждый вид — как окном вида, сроки несданных пересчитываются. */
export function bulkDueHandler(deps: ApiDeps): RouteHandler<typeof bulkDueRoute, AppEnv> {
  return async (c) => {
    const { codes, ...change } = c.req.valid('json');
    const result = await bulkTx(deps, c, (tx) => adminTypesBulkDue(tx, codes, change));
    const { reports, orgs, pending } = await recalcQueued(deps, result.queued);
    return c.json({ n: result.records.length, dues: { reports, orgs }, pending }, 200);
  };
}

export const bulkDuePreviewRoute = createRoute({
  method: 'post',
  path: `${BULK}/types/due/dues-preview`,
  tags: ['platform-dicts'],
  summary: 'Предпросмотр: у скольких отчётов изменятся сроки после «Изменить срок у N видов»',
  middleware: [requirePlatformAdmin] as const,
  request: { body: { required: true, content: json(AdminBulkDue) } },
  responses: {
    200: { description: 'Отчёты и организации; правка не сохраняется', content: json(AdminDuesPreview) },
    ...duesPreviewResponses,
  },
});

/** Окно «Изменить срок у N видов» (прототип `bd-n`): число меняется при каждом вводе. */
export function bulkDuePreviewHandler(
  deps: ApiDeps,
): RouteHandler<typeof bulkDuePreviewRoute, AppEnv> {
  return async (c) => {
    const { codes, ...change } = c.req.valid('json');
    const preview = await previewEdit(deps, c, async (tx) => {
      const result = await adminTypesBulkDue(tx, codes, change);
      return result.ok ? result.redue : false;
    });
    return c.json(preview, 200);
  };
}

export const markGnsRoute = createRoute({
  method: 'post',
  path: `${BULK}/types/gns`,
  tags: ['platform-dicts'],
  summary: '«Отметить сверку с ГНС»',
  middleware: [requirePlatformAdmin] as const,
  request: { body: { required: true, content: json(AdminMarkGns) } },
  responses: {
    200: { description: 'Сколько видов отмечено', content: json(AdminBulkResult) },
    ...denied,
  },
});

/** Прототип markGns: у видов — сегодняшняя дата и кто сверял; сроки не меняются. */
export function markGnsHandler(deps: ApiDeps): RouteHandler<typeof markGnsRoute, AppEnv> {
  return async (c) => {
    const { codes } = c.req.valid('json');
    const n = await adminTx(deps, c, (tx) => adminMarkGns(tx, codes));
    return c.json({ n, dues: { reports: 0, orgs: 0 }, pending: false }, 200);
  };
}
