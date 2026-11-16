import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { platformFileKey } from '@buhuchet/adapters';
import {
  markNewsRead,
  newsFeed,
  newsUnreadCount,
  newsWhatsNew,
  orgMenuSettings,
  type NewsModulesOfMe,
  type NewsRecord,
  type Tx,
} from '@buhuchet/db';
import { newsModulesOf } from '@buhuchet/domain';
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
import type { AppEnv, AuthSession } from '../../env';
import type { Context } from 'hono';
import { asSessionUser } from '../../middleware/access';

const error = { 'application/json': { schema: ApiError } };
const noSession = { 401: { description: 'Нет входа', content: error } } as const;

/** Раздел хранилища с картинками новостей: `platform/news/<id>`. */
export const NEWS_IMAGES = 'news';

/** Срок ссылки на картинку — как у логотипа и файлов, 15 минут. */
const IMAGE_LINK_SECONDS = 900;

/**
 * Новость для ленты и окна «Что нового»: только поля схемы, моменты — строкой ISO. Второй текст — только
 * администратору платформы (`admin`) и только когда он есть (доработки 16.11.2026, блок 4, пункт 1).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#И-11 — второй текст сотрудникам не уходит вовсе (в прототипе он в данных).
export function newsItemBody(n: NewsRecord, read: boolean, admin = false): NewsItem {
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
    modules: n.modules,
    ...(admin && n.adminMd ? { adminMd: n.adminMd } : {}),
  };
}

/**
 * Лента вошедшего по модулям (доработки 16.11.2026, блок 4, пункт 3; прототип v123 newsModsOk):
 * сотруднику — модули его меню (функции учётной политики и права) и «Плата за обслуживание» при функции
 * и праве; администратору платформы — все новости (null). Функции читаются в той же транзакции.
 */
async function myNewsModules(
  tx: Tx,
  session: AuthSession,
  c: Context<AppEnv>,
  inOrg: boolean,
): Promise<NewsModulesOfMe> {
  // Без организации — только администратор платформы (все новости); иначе закрыто, как в колокольчике.
  if (!inOrg || !session.orgId) return session.isPlatformAdmin ? null : [];
  const access = c.get('access');
  if (!access) return [];
  const { features } = await orgMenuSettings(tx, session.orgId);
  return newsModulesOf(access.subject, features);
}

/** Транзакция вошедшего с его модулями новостей. */
function asReader<T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  fn: (tx: Tx, mine: NewsModulesOfMe) => Promise<T>,
): Promise<T> {
  const session = c.get('session')!;
  return asSessionUser(deps, session, async (tx, inOrg) =>
    fn(tx, await myNewsModules(tx, session, c, inOrg)),
  );
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
 * целиком, а поиск, фильтры «Тип», «Версия» и «Модуль» и группы версий — на экране. Видят все
 * пользователи всех организаций; новость с модулями — у кого есть хотя бы один из них (доработки
 * 16.11.2026, блок 4, пункт 3).
 */
export function newsFeedHandler(deps: ApiDeps): RouteHandler<typeof newsFeedRoute, AppEnv> {
  return async (c) => {
    const { items, admin } = await asReader(deps, c, async (tx, mine) => ({
      items: await newsFeed(tx, mine),
      admin: c.get('session')?.isPlatformAdmin === true,
    }));
    return c.json({ items: items.map((n) => newsItemBody(n, n.read, admin)) }, 200);
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
    const unread = await asReader(deps, c, (tx, mine) => newsUnreadCount(tx, mine));
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
        'Непрочитанные новости «Показывать при входе» от новых к старым; пусто — окно не открывается. `first` — окно впервые (приветствие и «Открыть Базу знаний»); у того, кто видел приветствие организации, — false',
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
    const { items, first, admin } = await asReader(deps, c, async (tx, mine) => ({
      ...(await newsWhatsNew(tx, mine)),
      admin: c.get('session')?.isPlatformAdmin === true,
    }));
    return c.json({ items: items.map((n) => newsItemBody(n, false, admin)), first }, 200);
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
    const result = await asReader(deps, c, async (tx, mine) => ({
      marked: await markNewsRead(tx, ids, mine),
      unread: await newsUnreadCount(tx, mine),
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
    const marked = await asReader(deps, c, (tx, mine) => markNewsRead(tx, 'all', mine));
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
