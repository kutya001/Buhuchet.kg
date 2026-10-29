import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { platformFileKey } from '@buhuchet/adapters';
import {
  markNewsRead,
  newsFeed,
  newsUnreadCount,
  newsWhatsNew,
  type NewsRecord,
} from '@buhuchet/db';
import {
  ApiError,
  NewsFeed,
  NewsReadRequest,
  NewsReadResult,
  NewsUnread,
  Uuid,
  WhatsNew,
  type NewsItem,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { asSessionUser } from '../../middleware/access';

const error = { 'application/json': { schema: ApiError } };
const noSession = { 401: { description: 'Нет входа', content: error } } as const;

/** Раздел хранилища с картинками новостей: `platform/news/<id>`. */
export const NEWS_IMAGES = 'news';

/** Срок ссылки на картинку — как у логотипа и файлов, 15 минут. */
const IMAGE_LINK_SECONDS = 900;

/** Новость для ленты и окна «Что нового»: только поля схемы, моменты — строкой ISO. */
export function newsItemBody(n: NewsRecord, read: boolean): NewsItem {
  return {
    id: n.id,
    title: n.title,
    type: n.type,
    release: n.release,
    date: n.date,
    short: n.short,
    md: n.md,
    link: n.link,
    pinned: n.pinned,
    editedAt: n.editedAt?.toISOString() ?? null,
    read,
  };
}

export const newsFeedRoute = createRoute({
  method: 'get',
  path: '/news',
  tags: ['news'],
  summary: 'Лента «Новостей» вошедшего',
  responses: {
    200: {
      description:
        'Опубликованные новости с наступившей датой (в 09:00 по Бишкеку), для всех или — администратору платформы — «Только режим Админка»; от новых к старым, с отметкой «прочитана»',
      content: { 'application/json': { schema: NewsFeed } },
    },
    ...noSession,
  },
});

/**
 * Вкладка «Новости» Базы знаний (прототип renderNews): новостей немного, поэтому лента приходит
 * целиком, а поиск, фильтры «Тип» и «Версия» и группы версий — на экране. Видят все пользователи
 * всех организаций независимо от прав (ТЗ).
 */
export function newsFeedHandler(deps: ApiDeps): RouteHandler<typeof newsFeedRoute, AppEnv> {
  return async (c) => {
    const items = await asSessionUser(deps, c.get('session')!, (tx) => newsFeed(tx));
    return c.json({ items: items.map((n) => newsItemBody(n, n.read)) }, 200);
  };
}

export const newsUnreadRoute = createRoute({
  method: 'get',
  path: '/news/unread',
  tags: ['news'],
  summary: 'Сколько новостей не прочитано',
  responses: {
    200: {
      description: 'Число непрочитанных: у вкладки «Новости», у «Базы знаний» и точка у «Меню»',
      content: { 'application/json': { schema: NewsUnread } },
    },
    ...noSession,
  },
});

export function newsUnreadHandler(deps: ApiDeps): RouteHandler<typeof newsUnreadRoute, AppEnv> {
  return async (c) => {
    const unread = await asSessionUser(deps, c.get('session')!, (tx) => newsUnreadCount(tx));
    return c.json({ unread }, 200);
  };
}

export const whatsNewRoute = createRoute({
  method: 'get',
  path: '/news/whats-new',
  tags: ['news'],
  summary: 'Окно «Что нового» при входе',
  responses: {
    200: {
      description:
        'Непрочитанные новости «Показывать при входе» от новых к старым; пусто — окно не открывается. `first` — окно впервые (приветствие и «Открыть Базу знаний»)',
      content: { 'application/json': { schema: WhatsNew } },
    },
    ...noSession,
  },
});

/**
 * «Что нового» (прототип whatsNew): экран спрашивает только сразу после входа. Показанные новости он
 * сам отмечает прочитанными (`POST /api/news/read`), поэтому окно с ними больше не откроется (решение
 * заказчика 25.10.2026).
 */
export function whatsNewHandler(deps: ApiDeps): RouteHandler<typeof whatsNewRoute, AppEnv> {
  return async (c) => {
    const { items, first } = await asSessionUser(deps, c.get('session')!, (tx) => newsWhatsNew(tx));
    return c.json({ items: items.map((n) => newsItemBody(n, false)), first }, 200);
  };
}

export const newsReadRoute = createRoute({
  method: 'post',
  path: '/news/read',
  tags: ['news'],
  summary: 'Отметить новости прочитанными',
  request: {
    body: { required: true, content: { 'application/json': { schema: NewsReadRequest } } },
  },
  responses: {
    200: {
      description:
        'Новость открыта или показана в «Что нового»: видимые непрочитанные из списка отмечены',
      content: { 'application/json': { schema: NewsReadResult } },
    },
    400: { description: 'Неверный список', content: error },
    ...noSession,
  },
});

export function newsReadHandler(deps: ApiDeps): RouteHandler<typeof newsReadRoute, AppEnv> {
  return async (c) => {
    const { ids } = c.req.valid('json');
    const result = await asSessionUser(deps, c.get('session')!, async (tx) => ({
      marked: await markNewsRead(tx, ids),
      unread: await newsUnreadCount(tx),
    }));
    return c.json(result, 200);
  };
}

export const newsReadAllRoute = createRoute({
  method: 'post',
  path: '/news/read-all',
  tags: ['news'],
  summary: '«Отметить все прочитанными»',
  responses: {
    200: {
      description: 'Все видимые новости отмечены прочитанными',
      content: { 'application/json': { schema: NewsReadResult } },
    },
    ...noSession,
  },
});

export function newsReadAllHandler(deps: ApiDeps): RouteHandler<typeof newsReadAllRoute, AppEnv> {
  return async (c) => {
    const marked = await asSessionUser(deps, c.get('session')!, (tx) => markNewsRead(tx, 'all'));
    return c.json({ marked, unread: 0 }, 200);
  };
}

export const newsImageRoute = createRoute({
  method: 'get',
  path: '/news/images/{id}',
  tags: ['news'],
  summary: 'Картинка из подробного описания новости',
  request: { params: z.object({ id: Uuid }) },
  responses: {
    302: { description: 'Переход на подписанную ссылку на 15 минут' },
    400: { description: 'Неверный код картинки', content: error },
    ...noSession,
  },
});

/**
 * Картинки новостей лежат в хранилище (`platform/news/<id>`), в markdown — адрес этого метода. Любой
 * вошедший получает временную подписанную ссылку: новости видят все пользователи платформы. Хранилище
 * отдаёт файл вложением — в `<img>` картинка показывается, открытая отдельно — скачивается.
 */
export function newsImageHandler(deps: ApiDeps): RouteHandler<typeof newsImageRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const url = await deps.storage.signedDownloadUrl(platformFileKey(NEWS_IMAGES, id), {
      expiresInSeconds: IMAGE_LINK_SECONDS,
    });
    c.header('Cache-Control', 'private, max-age=600');
    return c.redirect(url, 302);
  };
}
