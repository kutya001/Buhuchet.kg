import { randomUUID } from 'node:crypto';
import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { platformFileKey } from '@buhuchet/adapters';
import {
  createNews,
  deleteNewsDraft,
  exportNewsAdmin,
  getNews,
  kbArticles,
  listNewsAdminPage,
  listNewsAdminValues,
  newsAdminHistory,
  publishNews,
  saveNews,
  setNewsOff,
  withUserContext,
  type NewsAdminRecord,
  type NewsInput,
  type NewsRecord,
  type NewsSaveResult,
  type Tx,
} from '@buhuchet/db';
import {
  MENU_MODULE_IDS,
  NEWS_IMAGE_MAX_BYTES,
  NEWS_IMAGE_MESSAGES,
  NEWS_IMAGE_PATH,
  NEWS_MESSAGES,
  newsImageProblem,
  newsImageType,
  newsMdTrim,
  newsProblems,
  newsState,
  PLATFORM_ADMIN_NAME,
  RecordChangedError,
  RecordNotFoundError,
  type NewsField,
} from '@buhuchet/domain';
import {
  type AdminNews,
  AdminNewsList,
  AdminNewsRecord,
  ApiError,
  CreateNewsRequest,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  NewsAdminHistory,
  NewsArticleOptions,
  NewsCode,
  NewsImageUploaded,
  NewsOffRequest,
  NewsVersionQuery,
  NewsVersionRequest,
  SaveNewsRequest,
  type NewsInputSchema,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import {
  apiError,
  apiFail,
  listQueryOf,
  listQueryResponses,
  versionedSaveResponses,
} from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { NEWS_IMAGES } from './feed';

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const params = z.object({ id: NewsCode });

/** Путь загрузки картинки: общий предел тела API (1 МиБ) здесь заменён своим — 2 МБ. */
export const NEWS_IMAGE_UPLOAD_PATH = '/api/admin/news/images';

/** Правка — в контексте администратора платформы (политики `news_admin_*`). */
function asAdmin<T>(deps: ApiDeps, c: Context<AppEnv>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withUserContext(deps.db, c.get('session')!.userId, fn);
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

function adminCommon(n: Omit<NewsRecord, 'md'>) {
  return {
    id: n.id,
    title: n.title,
    type: n.type,
    release: n.release,
    date: n.date,
    short: n.short,
    link: n.link,
    pinned: n.pinned,
    showOnLogin: n.showOnLogin,
    audience: n.audience,
    status: n.status,
    off: n.off,
    publishedAt: iso(n.publishedAt),
    editedAt: iso(n.editedAt),
    version: n.version,
  };
}

function adminNewsBody(n: NewsAdminRecord): AdminNews {
  return {
    ...adminCommon(n),
    state: n.state,
    reads: n.reads,
    audit: {
      createdAt: n.createdAt.toISOString(),
      createdBy: n.createdBy,
      updatedAt: n.updatedAt.toISOString(),
      updatedBy: n.updatedBy,
    },
  };
}

/**
 * Новость целиком для окна «Новость». Состояние — по настоящим часам, как видимость в базе (`now()`),
 * а не по часам демо-стенда.
 */
function newsRecordBody(n: NewsRecord): AdminNewsRecord {
  return { ...adminCommon(n), state: newsState(n, new Date()), md: n.md };
}

export const listNewsRoute = createRoute({
  method: 'get',
  path: '/admin/news',
  tags: ['news'],
  summary: 'Новости в Админке: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description:
        'Все новости — черновики, опубликованные, снятые; сортировка и фильтры на сервере',
      content: { 'application/json': { schema: AdminNewsList } },
    },
    ...listQueryResponses,
    ...denied,
  },
});

/** Админка → «База знаний (содержимое)» → «Новости» (прототип admin/news.js, renderNewsAdm). */
export function listNewsHandler(deps: ApiDeps): RouteHandler<typeof listNewsRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await asAdmin(deps, c, (tx) => listNewsAdminPage(tx, query, t));
    return c.json(
      {
        items: page.rows.map(adminNewsBody),
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

export const newsValuesRoute = createRoute({
  method: 'get',
  path: '/admin/news/values',
  tags: ['news'],
  summary: 'Значения столбца списка новостей для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом записей во всём списке',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function newsValuesHandler(deps: ApiDeps): RouteHandler<typeof newsValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    return c.json(await asAdmin(deps, c, (tx) => listNewsAdminValues(tx, col, t, q)), 200);
  };
}

export const exportNewsRoute = createRoute({
  method: 'get',
  path: '/admin/news/export',
  tags: ['news'],
  summary: 'Новости в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми новостями под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function exportNewsHandler(deps: ApiDeps): RouteHandler<typeof exportNewsRoute, AppEnv> {
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
        (tx) => exportNewsAdmin(tx, query, keys, t),
        'export',
      );
      return xlsxResponse(c, {
        title: t('news.title'),
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

export const getNewsRoute = createRoute({
  method: 'get',
  path: '/admin/news/{id}',
  tags: ['news'],
  summary: 'Новость целиком',
  middleware: [requirePlatformAdmin] as const,
  request: { params },
  responses: {
    200: {
      description: 'Все поля новости с подробным описанием',
      content: { 'application/json': { schema: AdminNewsRecord } },
    },
    404: { description: 'Новости нет', content: error },
    ...denied,
  },
});

export function getNewsHandler(deps: ApiDeps): RouteHandler<typeof getNewsRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const n = await asAdmin(deps, c, (tx) => getNews(tx, id));
    if (!n) return c.json(apiError('not_found', 'Новости нет'), 404);
    return c.json(newsRecordBody(n), 200);
  };
}

/**
 * Поля окна в запись: проверка домена (та же, что на экране) и ссылка «Подробнее» на существующую
 * статью или модуль. Пустые разделы шаблона убираются (прототип mdTrim).
 */
async function checkedInput(tx: Tx, body: NewsInputSchema, publish: boolean): Promise<NewsInput> {
  const problems = newsProblems(
    {
      title: body.title,
      type: body.type,
      version: body.release,
      date: body.date,
      short: body.short,
      md: body.md,
    },
    { publish },
  );
  const field = (Object.keys(problems) as NewsField[])[0];
  if (field) {
    const problem = problems[field]!;
    apiFail(400, problem, NEWS_MESSAGES[problem], { field });
  }
  if (body.link) {
    const { kind, id } = body.link;
    const known =
      kind === 'mod'
        ? (MENU_MODULE_IDS as readonly string[]).includes(id)
        : (await kbArticles(tx)).some((a) => a.id === id && a.active !== false);
    if (!known) apiFail(400, 'news_link', 'Нет такой статьи или модуля', { field: 'link' });
  }
  return {
    title: body.title.trim(),
    type: body.type,
    release: body.release.trim() || null,
    date: body.date,
    short: body.short.trim(),
    md: newsMdTrim(body.md),
    link: body.link,
    pinned: body.pinned,
    showOnLogin: body.showOnLogin,
    audience: body.audience,
  };
}

/** Итог правки: запись или ошибка версии, «нет записи», «не черновик», «ещё черновик». */
function savedOrFail(id: string, r: NewsSaveResult): NewsRecord {
  if (r.ok) return r.record;
  if (r.reason === 'not_found') throw new RecordNotFoundError('news', id);
  if (r.reason === 'changed') throw new RecordChangedError('news', id, r.current);
  if (r.reason === 'not_published') {
    return apiFail(409, 'news_off_draft', 'Снять с публикации можно только опубликованную новость');
  }
  return apiFail(409, 'news_not_draft', 'Новость уже опубликована');
}

const saved = (description: string) => ({
  200: { description, content: { 'application/json': { schema: AdminNewsRecord } } },
});

export const createNewsRoute = createRoute({
  method: 'post',
  path: '/admin/news',
  tags: ['news'],
  summary: 'Новая новость: черновиком или сразу опубликовать',
  middleware: [requirePlatformAdmin] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: CreateNewsRequest } } },
  },
  responses: {
    201: {
      description: 'Новость создана',
      content: { 'application/json': { schema: AdminNewsRecord } },
    },
    400: { description: 'Не заполнено обязательное поле (в `details.field`)', content: error },
    ...denied,
  },
});

/** «+ Новость» (прототип newsEditDlg): «Сохранить черновик» или «Опубликовать». */
export function createNewsHandler(deps: ApiDeps): RouteHandler<typeof createNewsRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const n = await asAdmin(deps, c, async (tx) =>
      createNews(tx, await checkedInput(tx, body, body.publish), { publish: body.publish }),
    );
    return c.json(newsRecordBody(n), 201);
  };
}

export const saveNewsRoute = createRoute({
  method: 'put',
  path: '/admin/news/{id}',
  tags: ['news'],
  summary: 'Сохранить новость',
  middleware: [requirePlatformAdmin] as const,
  request: {
    params,
    body: { required: true, content: { 'application/json': { schema: SaveNewsRequest } } },
  },
  responses: {
    ...saved('Новость сохранена; опубликованная — с отметкой «Изменено»'),
    400: { description: 'Не заполнено обязательное поле (в `details.field`)', content: error },
    ...versionedSaveResponses,
    ...denied,
  },
});

/**
 * Правка в окне «Новость»: черновик — «Сохранить черновик» или «Опубликовать»; опубликованная
 * исправляется на месте (у пользователей — «Изменено ДД.ММ.ГГГГ»), версия у неё обязательна, если это
 * не объявление.
 */
export function saveNewsHandler(deps: ApiDeps): RouteHandler<typeof saveNewsRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const n = await asAdmin(deps, c, async (tx) => {
      const before = await getNews(tx, id);
      if (!before) throw new RecordNotFoundError('news', id);
      const publish = body.publish || before.status === 'published';
      const input = await checkedInput(tx, body, publish);
      return savedOrFail(id, await saveNews(tx, id, body.version, input, { publish }));
    });
    return c.json(newsRecordBody(n), 200);
  };
}

export const publishNewsRoute = createRoute({
  method: 'post',
  path: '/admin/news/{id}/publish',
  tags: ['news'],
  summary: 'Опубликовать черновик',
  middleware: [requirePlatformAdmin] as const,
  request: {
    params,
    body: { required: true, content: { 'application/json': { schema: NewsVersionRequest } } },
  },
  responses: {
    ...saved('Новость опубликована: у пользователей — с даты публикации в 09:00 по Бишкеку'),
    400: { description: 'У новости не заполнено обязательное поле', content: error },
    ...versionedSaveResponses,
    ...denied,
  },
});

/** «Опубликовать» из меню записи: черновик проверяется так же, как при публикации из окна. */
export function publishNewsHandler(deps: ApiDeps): RouteHandler<typeof publishNewsRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('json');
    const n = await asAdmin(deps, c, async (tx) => {
      const before = await getNews(tx, id);
      if (!before) throw new RecordNotFoundError('news', id);
      if (before.status === 'draft') {
        await checkedInput(tx, { ...before, release: before.release ?? '', md: before.md }, true);
      }
      return savedOrFail(id, await publishNews(tx, id, version));
    });
    return c.json(newsRecordBody(n), 200);
  };
}

export const newsOffRoute = createRoute({
  method: 'post',
  path: '/admin/news/{id}/off',
  tags: ['news'],
  summary: 'Снять с публикации или вернуть в публикацию',
  middleware: [requirePlatformAdmin] as const,
  request: {
    params,
    body: { required: true, content: { 'application/json': { schema: NewsOffRequest } } },
  },
  responses: {
    ...saved('Новость снята с публикации (пропала у пользователей) или возвращена'),
    ...versionedSaveResponses,
    ...denied,
  },
});

export function newsOffHandler(deps: ApiDeps): RouteHandler<typeof newsOffRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, off } = c.req.valid('json');
    const n = await asAdmin(deps, c, async (tx) =>
      savedOrFail(id, await setNewsOff(tx, id, version, off)),
    );
    return c.json(newsRecordBody(n), 200);
  };
}

export const deleteNewsRoute = createRoute({
  method: 'delete',
  path: '/admin/news/{id}',
  tags: ['news'],
  summary: 'Удалить черновик',
  middleware: [requirePlatformAdmin] as const,
  request: { params, query: NewsVersionQuery },
  responses: {
    204: { description: 'Черновик удалён' },
    ...versionedSaveResponses,
    ...denied,
  },
});

/** Удалить можно только черновик; опубликованную — только снять с публикации (ТЗ). */
export function deleteNewsHandler(deps: ApiDeps): RouteHandler<typeof deleteNewsRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('query');
    await asAdmin(deps, c, async (tx) => {
      const r = await deleteNewsDraft(tx, id, version);
      if (r.ok) return;
      if (r.reason === 'not_found') throw new RecordNotFoundError('news', id);
      if (r.reason === 'changed') throw new RecordChangedError('news', id, r.current);
      apiFail(
        409,
        'news_delete_not_draft',
        'Удалить можно только черновик; опубликованную — снять с публикации',
      );
    });
    return c.body(null, 204);
  };
}

const tooLarge = () => apiError('news_image_too_large', NEWS_IMAGE_MESSAGES.news_image_too_large);

/** Предел тела загрузки картинки — сама картинка до 2 МБ (прототип: «Картинка больше 2 МБ»). */
const imageBodyLimit = bodyLimit({
  maxSize: NEWS_IMAGE_MAX_BYTES,
  onError: (c) => c.json(tooLarge(), 413),
});

export const newsHistoryRoute = createRoute({
  method: 'get',
  path: '/admin/news/history',
  tags: ['news'],
  summary: '«История изменений» новостей',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Всего записей и последние 12, новые сверху',
      content: { 'application/json': { schema: NewsAdminHistory } },
    },
    ...denied,
  },
});

/** «История изменений · N» под списком (прототип pdHistHtml('news')). */
export function newsHistoryHandler(deps: ApiDeps): RouteHandler<typeof newsHistoryRoute, AppEnv> {
  return async (c) => {
    const history = await asAdmin(deps, c, (tx) => newsAdminHistory(tx));
    const body: NewsAdminHistory = {
      total: history.total,
      items: history.items.map((h) => ({
        id: h.id,
        at: h.at.toISOString(),
        kind: h.kind,
        title: h.title,
        ...(h.counts ? { counts: h.counts } : {}),
        ...(h.loadedAt ? { loadedAt: h.loadedAt.toISOString() } : {}),
        actor: PLATFORM_ADMIN_NAME,
      })),
    };
    return c.json(body, 200);
  };
}

const binary = { schema: z.string().openapi({ format: 'binary' }) };

export const newsArticlesRoute = createRoute({
  method: 'get',
  path: '/admin/news/articles',
  tags: ['news'],
  summary: 'Статьи для ссылки «Подробнее»',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Все активные статьи Базы знаний — не только видные администратору',
      content: { 'application/json': { schema: NewsArticleOptions } },
    },
    ...denied,
  },
});

/** Ссылка «Подробнее» (прототип newsEditDlg, `links`): любая активная статья, кому бы она ни была видна. */
export function newsArticlesHandler(deps: ApiDeps): RouteHandler<typeof newsArticlesRoute, AppEnv> {
  return async (c) => {
    const articles = await asAdmin(deps, c, (tx) => kbArticles(tx));
    return c.json(
      {
        items: articles.filter((a) => a.active !== false).map((a) => ({ id: a.id, title: a.t })),
      },
      200,
    );
  };
}

export const uploadNewsImageRoute = createRoute({
  method: 'put',
  path: '/admin/news/images',
  tags: ['news'],
  summary:
    'Загрузить картинку для подробного описания: PNG, JPG, GIF или WebP до 2 МБ телом запроса',
  middleware: [requirePlatformAdmin, imageBodyLimit] as const,
  request: {
    body: {
      required: true,
      content: {
        'image/png': binary,
        'image/jpeg': binary,
        'image/gif': binary,
        'image/webp': binary,
      },
    },
  },
  responses: {
    201: {
      description: 'Картинка сохранена: адрес для markdown `![имя](адрес)`',
      content: { 'application/json': { schema: NewsImageUploaded } },
    },
    400: { description: 'Не картинка PNG, JPG, GIF или WebP', content: error },
    413: { description: 'Картинка больше 2 МБ', content: error },
    ...denied,
  },
});

/**
 * Картинка в новости (прототип вставлял её в текст data-адресом): файл кладётся в хранилище, в текст
 * идёт адрес `/api/news/images/<id>`. Тип — по первым байтам файла, SVG не принимается.
 */
export function uploadNewsImageHandler(
  deps: ApiDeps,
): RouteHandler<typeof uploadNewsImageRoute, AppEnv> {
  return async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const problem = newsImageProblem(bytes);
    if (problem === 'news_image_too_large') return c.json(tooLarge(), 413);
    if (problem) return c.json(apiError(problem, NEWS_IMAGE_MESSAGES[problem]), 400);
    const id = randomUUID();
    await deps.storage.put(platformFileKey(NEWS_IMAGES, id), bytes, {
      contentType: newsImageType(bytes)!,
    });
    return c.json({ id, url: `${NEWS_IMAGE_PATH}${id}` }, 201);
  };
}
