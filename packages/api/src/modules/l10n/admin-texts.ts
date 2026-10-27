import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  adminSetUiText,
  countUiTexts,
  exportUiTexts,
  getUiText,
  listUiTextsPage,
  listUiTextValues,
  withUserContext,
  type UiTextRecord,
} from '@buhuchet/db';
import {
  DEFAULT_UI_LANGUAGE,
  RecordChangedError,
  RecordNotFoundError,
  UI_LANGUAGES,
  uiLanguageShare,
  uiTextProblem,
} from '@buhuchet/domain';
import {
  AdminUiText,
  AdminUiTextList,
  ApiError,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  UiLanguages,
  UiTextUpdateRequest,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses, versionedSaveResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts, uiDictionaryEdited } from './texts';

// Админка → «Локализация» (ТЗ «Модуль Локализация»; прототип admin/l10n.js): словарь текстов
// интерфейса — список, значения фильтра, «В Excel», правка текста; языки на плашках. Язык пока один —
// русский (`DEFAULT_UI_LANGUAGE`), поэтому язык в адресе не передаётся. Только администратору платформы.

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const lang = DEFAULT_UI_LANGUAGE;

/** Текст словаря для ответа API: моменты — строкой ISO. */
function uiTextBody(x: UiTextRecord): AdminUiText {
  return {
    key: x.key,
    text: x.text,
    section: x.section,
    audit: {
      createdAt: x.audit.createdAt.toISOString(),
      createdBy: x.audit.createdBy,
      updatedAt: x.audit.updatedAt.toISOString(),
      updatedBy: x.audit.updatedBy,
    },
    version: x.version,
  };
}

export const listUiTextsRoute = createRoute({
  method: 'get',
  path: '/admin/ui-texts',
  tags: ['l10n'],
  summary: 'Словарь текстов интерфейса: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description: 'Страница словаря: сортировка, страница, фильтры, поиск и группы — на сервере',
      content: { 'application/json': { schema: AdminUiTextList } },
    },
    ...listQueryResponses,
    ...denied,
  },
});

/** Список «Локализации»: ключ, русский текст, раздел; в ответе — страница, всего по фильтру, группы. */
export function listUiTextsHandler(deps: ApiDeps): RouteHandler<typeof listUiTextsRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const page = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listUiTextsPage(tx, lang, query),
    );
    return c.json(
      {
        items: page.rows.map(uiTextBody),
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

export const uiTextValuesRoute = createRoute({
  method: 'get',
  path: '/admin/ui-texts/values',
  tags: ['l10n'],
  summary: 'Значения столбца словаря для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом текстов',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    ...denied,
  },
});

/** Значения для фильтра-галочек: раздел, «Создал», «Изменил»…; `q` — «Найти значение». */
export function uiTextValuesHandler(deps: ApiDeps): RouteHandler<typeof uiTextValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const values = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listUiTextValues(tx, lang, col, q),
    );
    return c.json(values, 200);
  };
}

export const exportUiTextsRoute = createRoute({
  method: 'get',
  path: '/admin/ui-texts/export',
  tags: ['l10n'],
  summary: 'Словарь текстов интерфейса в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми текстами под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

/** Выгрузка словаря в Excel: все тексты под поиском и фильтрами, видимые столбцы по порядку. */
export function exportUiTextsHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportUiTextsRoute, AppEnv> {
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
        (tx) => exportUiTexts(tx, lang, query, keys),
        'export',
      );
      return xlsxResponse(c, {
        title: t('nav.l10n'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        t,
      });
    });
  };
}

export const uiLanguagesRoute = createRoute({
  method: 'get',
  path: '/admin/ui-languages',
  tags: ['l10n'],
  summary: 'Языки интерфейса: сколько текстов переведено',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Языки по порядку; первый — язык по умолчанию',
      content: { 'application/json': { schema: UiLanguages } },
    },
    ...denied,
  },
});

/**
 * Плашки языков «Локализации» (ТЗ: русский — включён и единственный; у нового языка — сколько строк
 * переведено): тексты языка против всех ключей языка по умолчанию.
 */
export function uiLanguagesHandler(deps: ApiDeps): RouteHandler<typeof uiLanguagesRoute, AppEnv> {
  return async (c) => {
    const total = await countUiTexts(deps.db, DEFAULT_UI_LANGUAGE);
    const items = await Promise.all(
      UI_LANGUAGES.map(async (l) => {
        const texts = l === DEFAULT_UI_LANGUAGE ? total : await countUiTexts(deps.db, l);
        return {
          lang: l,
          isDefault: l === DEFAULT_UI_LANGUAGE,
          enabled: true,
          texts,
          total,
          share: uiLanguageShare(texts, total),
        };
      }),
    );
    return c.json({ items }, 200);
  };
}

const keyParam = z.object({ key: z.string().min(1).max(200) });

export const getUiTextRoute = createRoute({
  method: 'get',
  path: '/admin/ui-texts/{key}',
  tags: ['l10n'],
  summary: 'Текст словаря',
  middleware: [requirePlatformAdmin] as const,
  request: { params: keyParam },
  responses: {
    200: {
      description: 'Текст словаря с версией',
      content: { 'application/json': { schema: AdminUiText } },
    },
    404: { description: 'Нет такого ключа', content: error },
    ...denied,
  },
});

/** Текст словаря для окна «Текст интерфейса» — «Перечитать» после «запись изменена другим». */
export function getUiTextHandler(deps: ApiDeps): RouteHandler<typeof getUiTextRoute, AppEnv> {
  return async (c) => {
    const { key } = c.req.valid('param');
    const found = await getUiText(deps.db, lang, key);
    if (!found) throw new RecordNotFoundError('ui_text', key);
    return c.json(uiTextBody(found), 200);
  };
}

export const updateUiTextRoute = createRoute({
  method: 'put',
  path: '/admin/ui-texts/{key}',
  tags: ['l10n'],
  summary: 'Изменить текст словаря',
  middleware: [requirePlatformAdmin] as const,
  request: {
    params: keyParam,
    body: { required: true, content: { 'application/json': { schema: UiTextUpdateRequest } } },
  },
  responses: {
    200: {
      description: 'Текст сохранён: виден на экранах со следующего обновления страницы',
      content: { 'application/json': { schema: AdminUiText } },
    },
    400: {
      description: 'Текст пустой, слишком длинный или с другими подстановками {…}',
      content: error,
    },
    ...denied,
    ...versionedSaveResponses,
  },
});

/**
 * «Сохранить» в окне «Текст интерфейса» (прототип: «Изменение применится без изменения кода»): текст не
 * пустой и с теми же подстановками `{имя}`, что прежний (docs/deviations.md, п. Д-1); «было → стало» —
 * в историю платформы. Словари в памяти этого процесса сверяются с базой сразу, остальные процессы — не
 * позже чем через секунду. Устаревшая версия — 409 «запись изменена другим пользователем».
 */
export function updateUiTextHandler(deps: ApiDeps): RouteHandler<typeof updateUiTextRoute, AppEnv> {
  return async (c) => {
    const { key } = c.req.valid('param');
    const { text, version } = c.req.valid('json');
    const adminId = c.get('session')!.userId;
    const result = await withUserContext(deps.db, adminId, async (tx) => {
      const before = await getUiText(tx, lang, key);
      if (!before) throw new RecordNotFoundError('ui_text', key);
      const problem = uiTextProblem(before.text, text);
      if (problem?.code === 'placeholders') {
        const names = problem.names.map((n) => `{${n}}`).join(', ');
        apiFail(
          400,
          'ui_text_placeholders',
          names
            ? `Подстановки в тексте должны остаться прежними: ${names}`
            : 'У этого текста подстановок нет',
          names ? { names } : { variant: 'none' },
        );
      }
      if (problem) apiFail(400, 'validation_failed', 'Неверные данные запроса');
      return adminSetUiText(tx, { lang, key, text, version });
    });
    if (!result.ok) {
      if (result.reason === 'not_found') throw new RecordNotFoundError('ui_text', key);
      const now = await getUiText(deps.db, lang, key);
      throw new RecordChangedError('ui_text', key, now?.version ?? version);
    }
    uiDictionaryEdited(lang);
    return c.json(uiTextBody(result.record), 200);
  };
}
