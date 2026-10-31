import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  adminKbArticleSave,
  adminKbArticles,
  adminKbHistory,
  adminKbLevels,
  adminKbLevelsSave,
  adminKbMeta,
  adminKbStepActive,
  adminKbStepMove,
  adminKbStepSave,
  adminKbSteps,
  exportAdminKb,
  kbScreenUi,
  listAdminKbPage,
  listAdminKbValues,
  withUserContext,
  type AdminKbSaveResult,
  type Tx,
} from '@buhuchet/db';
import {
  DICT_HISTORY_SHOWN,
  KB_ADMIN_MESSAGES,
  kbArticleBlocks,
  kbArticleProblems,
  kbLevelsProblem,
  kbScreenBlocks,
  kbStepProblems,
  type KbArticleInput,
  type KbStepInput,
} from '@buhuchet/domain';
import {
  AdminKbActive,
  AdminKbArticle,
  AdminKbArticleFields,
  AdminKbArticlePreview,
  AdminKbArticleUpdate,
  AdminKbCodeParam,
  AdminKbHistory,
  AdminKbHistoryParam,
  AdminKbLevels,
  AdminKbLevelSetParam,
  AdminKbLevelsSaved,
  AdminKbLevelsUpdate,
  AdminKbListParam,
  AdminKbMeta,
  AdminKbMove,
  AdminKbRowList,
  AdminKbStep,
  AdminKbStepCreate,
  AdminKbStepUpdate,
  ApiError,
  KbArticle,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError, apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

/*
 * Админка → «База знаний (содержимое)» (задача 2.39, docs/decisions.md п. Д-11; прототип
 * admin/kb-content.js): списки «Шагов уроков» и «Статей» (страница, значения фильтра, «В Excel»),
 * окна шага и статьи, «Выше» / «Ниже», «Выключить» / «Включить», предпросмотр статьи, «Уровни» и
 * «История изменений» вкладок. Только администратору платформы; пишет функция базы, история — в той
 * же транзакции. Пути со словом (`meta`, `history`, `levels`, `list`, `preview`) не совпадают с путями
 * с кодом записи.
 */

const error = { 'application/json': { schema: ApiError } };
const json = <T>(schema: T) => ({ 'application/json': { schema } });
const body = <T>(schema: T) => ({ required: true, content: json(schema) });
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const saveFails = {
  400: { description: 'Неверные данные: поле в `details.field`', content: error },
  404: { description: 'Записи нет', content: error },
  409: { description: 'Запись изменена другим пользователем', content: error },
} as const;

const P = '/admin/kb';

const adminTx = <T>(deps: ApiDeps, c: Context<AppEnv>, fn: (tx: Tx) => Promise<T>) =>
  withUserContext(deps.db, c.get('session')!.userId, fn);

/** Итог записи или 404 / 409 (откатывает транзакцию). */
function savedOrFail<T>(r: AdminKbSaveResult<T>): T {
  if (r.ok) return r.value;
  if (r.reason === 'not_found') return apiFail(404, 'not_found', 'Запись не найдена');
  return apiFail(409, 'record_changed', 'Запись изменена другим пользователем');
}

/** Первая ошибка поля — 400 с полем (экран показывает текст словаря под ним). */
function failFirst(problems: Partial<Record<string, keyof typeof KB_ADMIN_MESSAGES>>) {
  const field = Object.keys(problems)[0];
  if (!field) return;
  const problem = problems[field]!;
  apiFail(400, problem, KB_ADMIN_MESSAGES[problem], { field });
}

/* ───────────── Справочники окон и история ───────────── */

export const adminKbMetaRoute = createRoute({
  method: 'get',
  path: `${P}/meta`,
  tags: ['kb'],
  summary: 'Модули программы, статьи, права и сценарии показов — для окон шага и статьи',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: { description: 'Справочники окон', content: json(AdminKbMeta) },
    ...denied,
  },
});

export function adminKbMetaHandler(deps: ApiDeps): RouteHandler<typeof adminKbMetaRoute, AppEnv> {
  return async (c) => c.json(await adminTx(deps, c, (tx) => adminKbMeta(tx)), 200);
}

export const adminKbHistoryRoute = createRoute({
  method: 'get',
  path: `${P}/history/{section}`,
  tags: ['kb'],
  summary: '«История изменений» вкладки: шаги уроков, статьи или уровни',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminKbHistoryParam },
  responses: {
    200: {
      description: `Последние ${DICT_HISTORY_SHOWN} записей, сначала новые, и сколько их всего`,
      content: json(AdminKbHistory),
    },
    ...denied,
  },
});

export function adminKbHistoryHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminKbHistoryRoute, AppEnv> {
  return async (c) => {
    const { section } = c.req.valid('param');
    const history = await adminTx(deps, c, (tx) => adminKbHistory(tx, section, DICT_HISTORY_SHOWN));
    const body: AdminKbHistory = {
      total: history.total,
      items: history.items.map((h) => ({ ...h, at: h.at.toISOString() })),
    };
    return c.json(body, 200);
  };
}

/* ───────────── Списки ───────────── */

const TITLE = { steps: 'tab.kbadm.steps', arts: 'tab.kbadm.arts' } as const;

export const listAdminKbRoute = createRoute({
  method: 'get',
  path: `${P}/list/{list}`,
  tags: ['kb'],
  summary: '«Шаги уроков» или «Статьи»: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminKbListParam, query: ListQueryParams },
  responses: {
    200: {
      description: 'Строки списка; поиск, фильтры, сортировка и группы — на сервере',
      content: json(AdminKbRowList),
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function listAdminKbHandler(deps: ApiDeps): RouteHandler<typeof listAdminKbRoute, AppEnv> {
  return async (c) => {
    const { list } = c.req.valid('param');
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await adminTx(deps, c, (tx) => listAdminKbPage(tx, list, query, t));
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

export const adminKbValuesRoute = createRoute({
  method: 'get',
  path: `${P}/list/{list}/values`,
  tags: ['kb'],
  summary: 'Значения столбца списка для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminKbListParam, query: ListValuesQuery },
  responses: {
    200: { description: 'Значения столбца с подписью и числом', content: json(ListValues) },
    ...listQueryResponses,
    ...denied,
  },
});

export function adminKbValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminKbValuesRoute, AppEnv> {
  return async (c) => {
    const { list } = c.req.valid('param');
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    return c.json(await adminTx(deps, c, (tx) => listAdminKbValues(tx, list, col, t, q)), 200);
  };
}

export const exportAdminKbRoute = createRoute({
  method: 'get',
  path: `${P}/list/{list}/export`,
  tags: ['kb'],
  summary: 'Список «Шагов уроков» или «Статей» в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminKbListParam, query: ListExportParams },
  responses: {
    200: { description: 'Файл Excel со строками под поиском и фильтрами', content: xlsxContent },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function exportAdminKbHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportAdminKbRoute, AppEnv> {
  return async (c) => {
    const { list } = c.req.valid('param');
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = c.get('session')!.userId;
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const result = await withUserContext(
        deps.db,
        userId,
        (tx) => exportAdminKb(tx, list, query, keys, t),
        'export',
      );
      return xlsxResponse(c, {
        title: t(TITLE[list]),
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

/* ───────────── Шаги уроков ───────────── */

/** Поля окна → запись шага: проверка домена (та же, что на экране). */
async function checkedStep(tx: Tx, input: KbStepInput, isNew: boolean): Promise<KbStepInput> {
  const meta = await adminKbMeta(tx);
  failFirst(
    kbStepProblems(input, {
      groups: new Set(meta.groups.map((g) => g.id)),
      articles: new Set(meta.articles.map((a) => a.id)),
      isNew,
    }),
  );
  return input;
}

export const getAdminKbStepRoute = createRoute({
  method: 'get',
  path: `${P}/steps/{id}`,
  tags: ['kb'],
  summary: 'Шаг урока для окна',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminKbCodeParam },
  responses: {
    200: { description: 'Шаг с версией', content: json(AdminKbStep) },
    404: { description: 'Шага нет', content: error },
    ...denied,
  },
});

export function getAdminKbStepHandler(
  deps: ApiDeps,
): RouteHandler<typeof getAdminKbStepRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const step = (await adminTx(deps, c, (tx) => adminKbSteps(tx))).find((s) => s.id === id);
    if (!step) return c.json(apiError('not_found', 'Шаг не найден'), 404);
    return c.json(step, 200);
  };
}

const stepSaved = (description: string) => ({
  200: { description, content: json(AdminKbStep) },
});

export const createAdminKbStepRoute = createRoute({
  method: 'post',
  path: `${P}/steps`,
  tags: ['kb'],
  summary: 'Новый шаг урока: появится у всех с отметкой «Новое»',
  middleware: [requirePlatformAdmin] as const,
  request: { body: body(AdminKbStepCreate) },
  responses: { ...stepSaved('Новый шаг'), ...saveFails, ...denied },
});

export function createAdminKbStepHandler(
  deps: ApiDeps,
): RouteHandler<typeof createAdminKbStepRoute, AppEnv> {
  return async (c) => {
    const input = c.req.valid('json');
    const step = await adminTx(deps, c, async (tx) =>
      savedOrFail(await adminKbStepSave(tx, null, await checkedStep(tx, input, true), 0)),
    );
    return c.json(step, 200);
  };
}

export const saveAdminKbStepRoute = createRoute({
  method: 'put',
  path: `${P}/steps/{id}`,
  tags: ['kb'],
  summary: 'Сохранить шаг урока той версии, что видел администратор',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminKbCodeParam, body: body(AdminKbStepUpdate) },
  responses: { ...stepSaved('Шаг после записи'), ...saveFails, ...denied },
});

export function saveAdminKbStepHandler(
  deps: ApiDeps,
): RouteHandler<typeof saveAdminKbStepRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, ...input } = c.req.valid('json');
    const step = await adminTx(deps, c, async (tx) =>
      savedOrFail(await adminKbStepSave(tx, id, await checkedStep(tx, input, false), version)),
    );
    return c.json(step, 200);
  };
}

export const moveAdminKbStepRoute = createRoute({
  method: 'post',
  path: `${P}/steps/{id}/move`,
  tags: ['kb'],
  summary: '«Выше» или «Ниже» в своём модуле программы',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminKbCodeParam, body: body(AdminKbMove) },
  responses: {
    ...stepSaved('Шаг на новом месте'),
    400: { description: 'Неверный запрос', content: error },
    404: { description: 'Шага нет или он крайний', content: error },
    409: { description: 'Запись изменена другим пользователем', content: error },
    ...denied,
  },
});

export function moveAdminKbStepHandler(
  deps: ApiDeps,
): RouteHandler<typeof moveAdminKbStepRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { dir, version } = c.req.valid('json');
    const step = await adminTx(deps, c, async (tx) =>
      savedOrFail(await adminKbStepMove(tx, id, dir, version)),
    );
    return c.json(step, 200);
  };
}

export const activeAdminKbStepRoute = createRoute({
  method: 'post',
  path: `${P}/steps/{id}/active`,
  tags: ['kb'],
  summary: '«Выключить» или «Включить» шаг: выключенный пропадает из программ и из подсчёта',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminKbCodeParam, body: body(AdminKbActive) },
  responses: { ...stepSaved('Шаг после записи'), ...saveFails, ...denied },
});

export function activeAdminKbStepHandler(
  deps: ApiDeps,
): RouteHandler<typeof activeAdminKbStepRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { active, version } = c.req.valid('json');
    const step = await adminTx(deps, c, async (tx) =>
      savedOrFail(await adminKbStepActive(tx, id, active, version)),
    );
    return c.json(step, 200);
  };
}

/* ───────────── Статьи ───────────── */

function checkedArticle(input: KbArticleInput): KbArticleInput {
  failFirst(kbArticleProblems(input));
  return input;
}

export const getAdminKbArticleRoute = createRoute({
  method: 'get',
  path: `${P}/arts/{id}`,
  tags: ['kb'],
  summary: 'Статья для окна: текст разметкой',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminKbCodeParam },
  responses: {
    200: { description: 'Статья с версией', content: json(AdminKbArticle) },
    404: { description: 'Статьи нет', content: error },
    ...denied,
  },
});

export function getAdminKbArticleHandler(
  deps: ApiDeps,
): RouteHandler<typeof getAdminKbArticleRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const article = (await adminTx(deps, c, (tx) => adminKbArticles(tx))).find((a) => a.id === id);
    if (!article) {
      return c.json(apiError('not_found', 'Статья не найдена'), 404);
    }
    return c.json(article, 200);
  };
}

const articleSaved = (description: string) => ({
  200: { description, content: json(AdminKbArticle) },
});

export const createAdminKbArticleRoute = createRoute({
  method: 'post',
  path: `${P}/arts`,
  tags: ['kb'],
  summary: 'Новая статья Базы знаний',
  middleware: [requirePlatformAdmin] as const,
  request: { body: body(AdminKbArticleFields) },
  responses: { ...articleSaved('Новая статья'), ...saveFails, ...denied },
});

export function createAdminKbArticleHandler(
  deps: ApiDeps,
): RouteHandler<typeof createAdminKbArticleRoute, AppEnv> {
  return async (c) => {
    const input = checkedArticle(c.req.valid('json'));
    const article = await adminTx(deps, c, async (tx) =>
      savedOrFail(await adminKbArticleSave(tx, null, input, 0)),
    );
    return c.json(article, 200);
  };
}

export const saveAdminKbArticleRoute = createRoute({
  method: 'put',
  path: `${P}/arts/{id}`,
  tags: ['kb'],
  summary: 'Сохранить статью той версии, что видел администратор',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminKbCodeParam, body: body(AdminKbArticleUpdate) },
  responses: { ...articleSaved('Статья после записи'), ...saveFails, ...denied },
});

export function saveAdminKbArticleHandler(
  deps: ApiDeps,
): RouteHandler<typeof saveAdminKbArticleRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, ...fields } = c.req.valid('json');
    const input = checkedArticle(fields);
    const article = await adminTx(deps, c, async (tx) =>
      savedOrFail(await adminKbArticleSave(tx, id, input, version)),
    );
    return c.json(article, 200);
  };
}

export const activeAdminKbArticleRoute = createRoute({
  method: 'post',
  path: `${P}/arts/{id}/active`,
  tags: ['kb'],
  summary: '«Отключить» или «Включить» статью',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminKbCodeParam, body: body(AdminKbActive) },
  responses: { ...articleSaved('Статья после записи'), ...saveFails, ...denied },
});

export function activeAdminKbArticleHandler(
  deps: ApiDeps,
): RouteHandler<typeof activeAdminKbArticleRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { active, version } = c.req.valid('json');
    const article = await adminTx(deps, c, async (tx) => {
      const found = (await adminKbArticles(tx)).find((a) => a.id === id);
      if (!found) return apiFail(404, 'not_found', 'Статья не найдена');
      const { id: _id, version: _v, ...fields } = found;
      return savedOrFail(await adminKbArticleSave(tx, id, { ...fields, active }, version));
    });
    return c.json(article, 200);
  };
}

export const previewAdminKbArticleRoute = createRoute({
  method: 'post',
  path: `${P}/arts/preview`,
  tags: ['kb'],
  summary: 'Предпросмотр статьи из окна: как увидит пользователь',
  middleware: [requirePlatformAdmin] as const,
  request: { body: body(AdminKbArticlePreview) },
  responses: {
    200: {
      description: 'Статья блоками и описания экранов модулей, как в окне статьи',
      content: json(KbArticle),
    },
    400: { description: 'Неверный запрос', content: error },
    ...denied,
  },
});

/** Тот же разбор, что у окна статьи (`/api/kb/articles/{id}`): разметка на страницу не попадает. */
export function previewAdminKbArticleHandler(
  deps: ApiDeps,
): RouteHandler<typeof previewAdminKbArticleRoute, AppEnv> {
  return async (c) => {
    const input = c.req.valid('json');
    const blocks = kbArticleBlocks(input.html);
    const ui = await adminTx(deps, c, (tx) => kbScreenUi(tx));
    const screens = Object.fromEntries(
      blocks.flatMap((b) =>
        b.type === 'screen' ? [[b.module, kbScreenBlocks(ui, b.module)]] : [],
      ),
    );
    return c.json(
      {
        id: 'preview',
        section: input.sec,
        title: input.t,
        module: input.mod || null,
        read: false,
        blocks,
        screens,
      },
      200,
    );
  };
}

/* ───────────── Уровни ───────────── */

export const adminKbLevelsRoute = createRoute({
  method: 'get',
  path: `${P}/levels`,
  tags: ['kb'],
  summary: 'Уровни пользователей организаций и администраторов платформы',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: { description: 'Названия и пороги с версией раздела', content: json(AdminKbLevels) },
    404: { description: 'Уровней нет', content: error },
    ...denied,
  },
});

export function adminKbLevelsHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminKbLevelsRoute, AppEnv> {
  return async (c) => {
    const levels = await adminTx(deps, c, (tx) => adminKbLevels(tx));
    if (!levels) return c.json(apiError('not_found', 'Уровней нет'), 404);
    return c.json(levels, 200);
  };
}

export const saveAdminKbLevelsRoute = createRoute({
  method: 'put',
  path: `${P}/levels/{set}`,
  tags: ['kb'],
  summary: 'Сохранить названия и пороги одного набора уровней',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminKbLevelSetParam, body: body(AdminKbLevelsUpdate) },
  responses: {
    200: {
      description: 'Уровни после записи; `changed: false` — изменений нет',
      content: json(AdminKbLevelsSaved),
    },
    ...saveFails,
    ...denied,
  },
});

const LEVEL_MESSAGES = {
  kb_level_name: 'У каждого уровня должно быть название',
  kb_level_name_too_long: 'Не длиннее 60 знаков',
  kb_level_order: 'Пороги должны расти и быть не больше 100 %',
} as const;

export function saveAdminKbLevelsHandler(
  deps: ApiDeps,
): RouteHandler<typeof saveAdminKbLevelsRoute, AppEnv> {
  return async (c) => {
    const { set } = c.req.valid('param');
    const { levels, version } = c.req.valid('json');
    const problem = kbLevelsProblem(levels);
    if (problem) apiFail(400, problem, LEVEL_MESSAGES[problem], { field: 'levels' });
    const saved = await adminTx(deps, c, async (tx) => {
      const now = await adminKbLevels(tx);
      // Уровней столько же, сколько было: окно меняет названия и пороги, не число уровней.
      if (now && now[set].length !== levels.length) {
        apiFail(400, 'kb_level_count', 'Число уровней не меняется', { field: 'levels' });
      }
      return savedOrFail(await adminKbLevelsSave(tx, set, levels, version));
    });
    return c.json(saved, 200);
  };
}
