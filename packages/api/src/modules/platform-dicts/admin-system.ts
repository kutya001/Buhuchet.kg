import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  adminMessageTemplates,
  adminPermissions,
  adminRoleTemplates,
  adminSetMessageTemplates,
  adminSetPeriodName,
  adminSetPermission,
  adminSetRoleTemplate,
  adminSetStatusName,
  adminSetStatusTone,
  adminStatuses,
  adminSystemHistory,
  exportAdminPermissions,
  listAdminPermissionsPage,
  listAdminPermissionValues,
  withUserContext,
} from '@buhuchet/db';
import {
  DEFAULT_UI_LANGUAGE,
  DICT_HISTORY_SHOWN,
  isStatusTone,
  MESSAGE_TEMPLATE_VARIABLES,
  roleTemplateProblem,
  sameName,
  scaleStatuses,
  unknownTemplateVariables,
  type AdminSystemDict,
} from '@buhuchet/domain';
import {
  AdminDictHistory,
  AdminMessageTemplates,
  AdminMessageTemplatesForm,
  AdminMessageTemplatesSaved,
  AdminPeriodParam,
  AdminPermissionForm,
  AdminPermissionList,
  AdminPermissionParam,
  AdminRoleTemplateForm,
  AdminRoleTemplateParam,
  AdminRoleTemplates,
  AdminStatuses,
  AdminStatusParam,
  AdminStatusToneForm,
  AdminSystemNameForm,
  ApiError,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  OkResponse,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses, versionedSaveResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts, uiDictionaryEdited } from '../l10n/texts';

/*
 * Админка → «Справочники платформы», вкладки группы «Работа системы» (задача 2.36, часть 3; ТЗ
 * «Справочники, на которых держится логика системы», «Шаблоны для организаций»; прототип
 * admin/platform-dicts.js): «Статусы» (названия и цвета, периодичность), «Права ролей», «Шаблоны ролей»
 * и «Шаблоны» сообщений, у каждой — «История изменений». Только администратору платформы. Адреса без
 * кода справочника — раньше общих `/admin/platform-dicts/{dict}`.
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const json = <T>(schema: T) => ({ 'application/json': { schema } });
const body = <T>(schema: T) => ({ required: true, content: json(schema) });
const ok = OkResponse;

const P = '/admin/platform-dicts';

const adminTx = <T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  fn: Parameters<typeof withUserContext<T>>[2],
) => withUserContext(deps.db, c.get('session')!.userId, fn);

/* ---------- «Статусы» ---------- */

export const adminStatusesRoute = createRoute({
  method: 'get',
  path: `${P}/statuses`,
  tags: ['platform-dicts'],
  summary: '«Статусы»: статусы всех шкал и периодичность отчётов',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Статусы по шкалам: место на шкале, название и цвет; периодичность отчётов',
      content: json(AdminStatuses),
    },
    ...denied,
  },
});

export function adminStatusesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminStatusesRoute, AppEnv> {
  return async (c) => {
    const t = await serverTexts(deps);
    return c.json(await adminTx(deps, c, (tx) => adminStatuses(tx, t)), 200);
  };
}

/** Статус шкалы из адреса; нет такого — 404. */
function knownStatus(scale: Parameters<typeof scaleStatuses>[0], code: string) {
  if (!scaleStatuses(scale).includes(code)) apiFail(404, 'not_found', 'Нет такого статуса');
}

export const setStatusNameRoute = createRoute({
  method: 'put',
  path: `${P}/statuses/{scale}/{code}/name`,
  tags: ['platform-dicts'],
  summary: 'Переименовать статус',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminStatusParam, body: body(AdminSystemNameForm) },
  responses: {
    200: { description: 'Новое название сразу видно на шкалах и метках', content: json(ok) },
    400: { description: 'Пустое или слишком длинное название', content: error },
    ...denied,
    ...versionedSaveResponses,
  },
});

/** «Название статуса»: смысл и порядок этапа не меняются, только надпись (прототип). */
export function setStatusNameHandler(
  deps: ApiDeps,
): RouteHandler<typeof setStatusNameRoute, AppEnv> {
  return async (c) => {
    const { scale, code } = c.req.valid('param');
    const { name, version } = c.req.valid('json');
    knownStatus(scale, code);
    await adminTx(deps, c, (tx) => adminSetStatusName(tx, { scale, code, name, version }));
    uiDictionaryEdited(DEFAULT_UI_LANGUAGE);
    return c.json({ ok: true as const }, 200);
  };
}

export const setStatusToneRoute = createRoute({
  method: 'put',
  path: `${P}/statuses/{scale}/{code}/tone`,
  tags: ['platform-dicts'],
  summary: 'Цвет статуса',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminStatusParam, body: body(AdminStatusToneForm) },
  responses: {
    200: { description: 'Цвет изменён для всех организаций', content: json(ok) },
    400: { description: 'Цвет не из набора', content: error },
    ...denied,
    ...versionedSaveResponses,
  },
});

export function setStatusToneHandler(
  deps: ApiDeps,
): RouteHandler<typeof setStatusToneRoute, AppEnv> {
  return async (c) => {
    const { scale, code } = c.req.valid('param');
    const { tone, version } = c.req.valid('json');
    knownStatus(scale, code);
    if (!isStatusTone(tone)) apiFail(400, 'validation_failed', 'Цвет не из набора');
    await adminTx(deps, c, (tx) => adminSetStatusTone(tx, { scale, code, tone, version }));
    uiDictionaryEdited(DEFAULT_UI_LANGUAGE);
    return c.json({ ok: true as const }, 200);
  };
}

export const setPeriodNameRoute = createRoute({
  method: 'put',
  path: `${P}/statuses/periods/{code}`,
  tags: ['platform-dicts'],
  summary: 'Переименовать периодичность отчётов',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminPeriodParam, body: body(AdminSystemNameForm) },
  responses: {
    200: { description: 'Новое название сразу видно в списках и формах', content: json(ok) },
    400: {
      description: 'Пустое название или такое уже есть у другой периодичности (`period_taken`)',
      content: error,
    },
    ...denied,
    ...versionedSaveResponses,
  },
});

/** «Название периодичности»: расчёт периодов и сроков не меняется (прототип). */
export function setPeriodNameHandler(
  deps: ApiDeps,
): RouteHandler<typeof setPeriodNameRoute, AppEnv> {
  return async (c) => {
    const { code } = c.req.valid('param');
    const { name, version } = c.req.valid('json');
    const t = await serverTexts(deps);
    await adminTx(deps, c, async (tx) => {
      const { periods } = await adminStatuses(tx, t);
      if (periods.some((p) => p.code !== code && sameName(p.name, name))) {
        apiFail(400, 'period_taken', 'Такое название уже есть', { field: 'name' });
      }
      await adminSetPeriodName(tx, { code, name, version });
    });
    uiDictionaryEdited(DEFAULT_UI_LANGUAGE);
    return c.json({ ok: true as const }, 200);
  };
}

/* ---------- «Права ролей» ---------- */

export const adminPermissionsRoute = createRoute({
  method: 'get',
  path: `${P}/perms`,
  tags: ['platform-dicts'],
  summary: '«Права ролей»: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description: 'Права с группой, названием и описанием; поиск, фильтры и группы — на сервере',
      content: json(AdminPermissionList),
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function adminPermissionsHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminPermissionsRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await adminTx(deps, c, (tx) => listAdminPermissionsPage(tx, query, t));
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

export const adminPermissionValuesRoute = createRoute({
  method: 'get',
  path: `${P}/perms/values`,
  tags: ['platform-dicts'],
  summary: '«Права ролей»: значения столбца для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: { description: 'Значения столбца с подписью и числом', content: json(ListValues) },
    ...listQueryResponses,
    ...denied,
  },
});

export function adminPermissionValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminPermissionValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    return c.json(await adminTx(deps, c, (tx) => listAdminPermissionValues(tx, col, t, q)), 200);
  };
}

export const exportAdminPermissionsRoute = createRoute({
  method: 'get',
  path: `${P}/perms/export`,
  tags: ['platform-dicts'],
  summary: '«Права ролей» в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListExportParams },
  responses: {
    200: { description: 'Файл Excel с правами под поиском и фильтрами', content: xlsxContent },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function exportAdminPermissionsHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportAdminPermissionsRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = c.get('session')!.userId;
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const result = await withUserContext(
        deps.db,
        userId,
        (tx) => exportAdminPermissions(tx, query, keys, t),
        'export',
      );
      return xlsxResponse(c, {
        title: t('tab.pdicts.perms'),
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

export const setPermissionRoute = createRoute({
  method: 'put',
  path: `${P}/perms/{id}`,
  tags: ['platform-dicts'],
  summary: 'Изменить название и описание права',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminPermissionParam, body: body(AdminPermissionForm) },
  responses: {
    200: { description: 'Тексты сразу видят все организации в форме роли', content: json(ok) },
    400: {
      description: 'Пустое название или описание; такое название уже есть (`perm_taken`)',
      content: error,
    },
    ...denied,
    ...versionedSaveResponses,
  },
});

/** «Право роли» (прототип permEditDlg): набор прав не меняется, только тексты. */
export function setPermissionHandler(
  deps: ApiDeps,
): RouteHandler<typeof setPermissionRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { name, description, version } = c.req.valid('json');
    await adminTx(deps, c, async (tx) => {
      const all = await adminPermissions(tx);
      if (all.some((p) => p.id !== id && sameName(p.name, name))) {
        apiFail(400, 'perm_taken', 'Такое право уже есть', { field: 'name' });
      }
      await adminSetPermission(tx, { id, name, description, version });
    });
    return c.json({ ok: true as const }, 200);
  };
}

/* ---------- «Шаблоны ролей» ---------- */

export const adminRoleTemplatesRoute = createRoute({
  method: 'get',
  path: `${P}/roletpl`,
  tags: ['platform-dicts'],
  summary: '«Шаблоны ролей»: шаблоны с правами и областью',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: { description: 'Шаблоны ролей для новых организаций', content: json(AdminRoleTemplates) },
    ...denied,
  },
});

export function adminRoleTemplatesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminRoleTemplatesRoute, AppEnv> {
  return async (c) => c.json({ items: await adminTx(deps, c, adminRoleTemplates) }, 200);
}

/** Что не так с правами шаблона — код ошибки и текст. */
const TEMPLATE_PROBLEM = {
  unknown_permission: 'Нет такого права',
  owner_only: 'Это право есть только у владельца организации',
  view_required: 'Сначала дайте просмотр',
  bad_scope: 'Область — «Свои» или «Все контрагенты» у группы с областью',
} as const;

export const setRoleTemplateRoute = createRoute({
  method: 'put',
  path: `${P}/roletpl/{code}`,
  tags: ['platform-dicts'],
  summary: 'Изменить шаблон роли: название, права и область',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminRoleTemplateParam, body: body(AdminRoleTemplateForm) },
  responses: {
    200: {
      description: 'Шаблон изменён: действует для новых организаций, роли созданных не меняются',
      content: json(ok),
    },
    400: {
      description:
        'Такой шаблон уже есть (`roletpl_taken`); право только владельца, без просмотра группы или ' +
        'неизвестное; область не «Свои» и не «Все»',
      content: error,
    },
    ...denied,
    ...versionedSaveResponses,
  },
});

export function setRoleTemplateHandler(
  deps: ApiDeps,
): RouteHandler<typeof setRoleTemplateRoute, AppEnv> {
  return async (c) => {
    const { code } = c.req.valid('param');
    const form = c.req.valid('json');
    const problem = roleTemplateProblem(form.permissions, form.scopes);
    if (problem) {
      apiFail(400, `roletpl_${problem.problem}`, TEMPLATE_PROBLEM[problem.problem], {
        field: 'permissions',
        ...('permission' in problem
          ? { permission: problem.permission }
          : { group: problem.group }),
      });
    }
    await adminTx(deps, c, async (tx) => {
      const all = await adminRoleTemplates(tx);
      if (all.some((x) => x.code !== code && sameName(x.name, form.name))) {
        apiFail(400, 'roletpl_taken', 'Такой шаблон уже есть', { field: 'name' });
      }
      await adminSetRoleTemplate(tx, { code, ...form });
    });
    return c.json({ ok: true as const }, 200);
  };
}

/* ---------- «Шаблоны» сообщений ---------- */

export const adminMessageTemplatesRoute = createRoute({
  method: 'get',
  path: `${P}/templates`,
  tags: ['platform-dicts'],
  summary: '«Шаблоны»: тексты сообщений WhatsApp и Telegram',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Шаблоны с подстановками, в порядке вкладки',
      content: json(AdminMessageTemplates),
    },
    ...denied,
  },
});

export function adminMessageTemplatesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminMessageTemplatesRoute, AppEnv> {
  return async (c) => {
    const items = await adminTx(deps, c, adminMessageTemplates);
    return c.json(
      {
        items: items.map((x) => ({
          ...x,
          variables: [...(MESSAGE_TEMPLATE_VARIABLES[x.key] ?? [])],
        })),
      },
      200,
    );
  };
}

export const saveMessageTemplatesRoute = createRoute({
  method: 'put',
  path: `${P}/templates`,
  tags: ['platform-dicts'],
  summary: '«Сохранить шаблоны»',
  middleware: [requirePlatformAdmin] as const,
  request: { body: body(AdminMessageTemplatesForm) },
  responses: {
    200: {
      description: 'Сохранено; сколько шаблонов изменилось',
      content: json(AdminMessageTemplatesSaved),
    },
    400: {
      description: 'Пустой текст или подстановка, которой нет у шаблона (`unknown_vars`)',
      content: error,
    },
    ...denied,
    ...versionedSaveResponses,
  },
});

/**
 * «Сохранить шаблоны»: все тексты вкладки одной транзакцией. Подстановка, которой у шаблона нет, —
 * 400 `unknown_vars` с шаблоном и списком: её никто не заполнит, и клиент получит «{кантрагент}».
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-13
export function saveMessageTemplatesHandler(
  deps: ApiDeps,
): RouteHandler<typeof saveMessageTemplatesRoute, AppEnv> {
  return async (c) => {
    const { items } = c.req.valid('json');
    for (const item of items) {
      const unknown = unknownTemplateVariables(item.key, item.text);
      if (unknown.length) {
        apiFail(400, 'unknown_vars', 'Нет такой подстановки', {
          field: item.key,
          list: unknown.map((v) => `{${v}}`).join(', '),
          known: (MESSAGE_TEMPLATE_VARIABLES[item.key] ?? []).map((v) => `{${v}}`).join(', '),
        });
      }
    }
    const changed = await adminTx(deps, c, (tx) => adminSetMessageTemplates(tx, items));
    return c.json({ changed }, 200);
  };
}

/* ---------- «История изменений» вкладок ---------- */

const historyRoute = <Path extends string>(path: Path) =>
  createRoute({
    method: 'get',
    path,
    tags: ['platform-dicts'],
    summary: '«История изменений» вкладки',
    middleware: [requirePlatformAdmin] as const,
    responses: {
      200: {
        description: `Последние ${DICT_HISTORY_SHOWN} записей, сначала новые, и сколько их всего`,
        content: json(AdminDictHistory),
      },
      ...denied,
    },
  });

export const statusesHistoryRoute = historyRoute(`${P}/statuses/history`);
export const permsHistoryRoute = historyRoute(`${P}/perms/history`);
export const roletplHistoryRoute = historyRoute(`${P}/roletpl/history`);
export const templatesHistoryRoute = historyRoute(`${P}/templates/history`);

/** История вкладки `dict`; маршрут — только для типа ответа (у каждой вкладки свой адрес). */
export function systemHistoryHandler<Path extends string>(
  deps: ApiDeps,
  dict: AdminSystemDict,
  _route: ReturnType<typeof historyRoute<Path>>,
): RouteHandler<ReturnType<typeof historyRoute<Path>>, AppEnv> {
  return async (c) => {
    const t = await serverTexts(deps);
    const history = await adminTx(deps, c, (tx) =>
      adminSystemHistory(tx, dict, DICT_HISTORY_SHOWN, t),
    );
    const out: AdminDictHistory = {
      total: history.total,
      items: history.items.map((h) => ({ ...h, at: h.at.toISOString() })),
    };
    return c.json(out, 200);
  };
}
