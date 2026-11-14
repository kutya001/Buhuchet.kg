import { randomUUID } from 'node:crypto';
import { platformFileKey } from '@buhuchet/adapters';
import {
  adminKbArticles,
  adminTelegramBroadcastCount,
  allNewsForAdmin,
  getNews,
  messageTemplates,
  videoRecords,
  videoVisibilityOf,
  withUserContext,
  type NewsRecord,
  type Tx,
} from '@buhuchet/db';
import {
  botMessageProblem,
  botPlainText,
  botTemplate,
  CAST_IMAGE_MAX_BYTES,
  CAST_IMAGES_SECTION,
  CAST_MESSAGES,
  CAST_NEWS_MAX,
  CAST_PATHS,
  castBotMessage,
  castImageProblem,
  castImageType,
  newsLive,
  newsOrder,
  videoLive,
  type BotMessage,
} from '@buhuchet/domain';
import {
  AdminTelegramCastCount,
  AdminTelegramCastCountQuery,
  AdminTelegramCastImage,
  AdminTelegramCastOptions,
  AdminTelegramCastOptionsQuery,
  ApiError,
  type AdminTelegramCastMore,
} from '@buhuchet/shared';
import { createRoute, type RouteHandler, z } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError, apiFail } from '../../errors';
import { requirePlatformAdmin } from '../../middleware/access';
import { botSiteUrl } from '../telegram/staff-view';

/*
 * Оформленная рассылка (поток Т, задача Т6; пакет заказчика 13.11.2026, идея 15; прототип v103
 * admin/tg-cast.js): Админка → «Телеграм» → «Рассылка» собирает сообщение из картинки, заголовка,
 * текста и кнопок «Подробнее» и «Смотреть видео». Кнопки ведут только на записи сайта: адрес собирает
 * сервер из опубликованной новости «для всех», статьи Базы знаний не «только для Админки» или
 * опубликованного видео — свой адрес прислать нельзя. Картинка — JPG, PNG или WebP до 2 МБ, тип по
 * первым байтам; лежит в хранилище платформы. Только администратору платформы.
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const json = <T>(schema: T) => ({ 'application/json': { schema } });
const binary = { schema: z.string().openapi({ format: 'binary' }) };

/** Путь загрузки картинки: свой предел тела запроса (`OWN_BODY_LIMIT_PATHS` в app.ts). */
export const CAST_IMAGE_UPLOAD_PATH = '/api/admin/telegram/images';

const liveNews = (n: NewsRecord, now: Date) => n.audience === 'all' && newsLive(n, now);
const sendableVideo = (v: Parameters<typeof videoVisibilityOf>[0]) => {
  const vis = videoVisibilityOf(v);
  return videoLive(vis) && vis.audience !== 'adm';
};

/**
 * Что можно поставить в кнопки рассылки (прототип `tgCastNews`, `tgCastArts`, `tgCastVids`). `asked` —
 * новость из «Отправить в Telegram»: прототип заполняет поля из любой вышедшей новости, не только из 20.
 */
export async function castOptions(
  tx: Tx,
  now: Date,
  asked: string | null = null,
): Promise<AdminTelegramCastOptions> {
  const [news, articles, videos] = await Promise.all([
    allNewsForAdmin(tx),
    adminKbArticles(tx),
    videoRecords(tx),
  ]);
  const okVideos = videos.filter(sendableVideo);
  const okVideo = (id: string) => okVideos.some((v) => v.id === id);
  const live = newsOrder(
    news.filter((n) => liveNews(n, now)),
    (n) => ({ date: n.date, publishedAt: n.publishedAt, version: n.release }),
  ).slice(0, CAST_NEWS_MAX);
  const extra =
    asked && !live.some((n) => n.id === asked) ? news.find((n) => n.id === asked) : null;
  if (extra && liveNews(extra, now)) live.push(extra);
  return {
    news: live.map((n) => ({
      id: n.id,
      title: n.title,
      short: n.short,
      video: n.link?.kind === 'video' && okVideo(n.link.id) ? n.link.id : null,
    })),
    articles: articles
      .filter((a) => a.active && a.aud !== 'adm')
      .map((a) => ({ id: a.id, title: a.t })),
    videos: okVideos.map((v) => ({ id: v.id, title: v.title })),
  };
}

/** Что пришло из формы рассылки (после схемы запроса). */
export interface CastInput {
  title: string;
  text: string;
  image: string | null;
  more: AdminTelegramCastMore | null;
  video: string | null;
}

/**
 * Сообщение рассылки и его простой текст. Запись для «Подробнее» и видео проверяются на момент
 * постановки в очередь (снятая с публикации — 409), картинка — что она есть в хранилище. Подписи
 * кнопок — шаблоны бота «Telegram: кнопка «Подробнее»» и «…«Смотреть видео»».
 */
export async function castMessage(
  deps: ApiDeps,
  tx: Tx,
  input: CastInput,
): Promise<{ text: string; message: BotMessage | null }> {
  const now = deps.clock.now();
  const site = (path: string) => botSiteUrl(deps, path);
  let more: { kind: AdminTelegramCastMore['kind']; url: string | null } | null = null;
  if (input.more?.kind === 'news') {
    const n = await getNews(tx, input.more.id);
    if (!n || !liveNews(n, now)) apiFail(409, 'cast_more', CAST_MESSAGES.cast_more);
    more = { kind: 'news', url: site(CAST_PATHS.news(input.more.id)) };
  } else if (input.more?.kind === 'article') {
    const id = input.more.id;
    const a = (await adminKbArticles(tx)).find((x) => x.id === id);
    if (!a || !a.active || a.aud === 'adm') apiFail(409, 'cast_more', CAST_MESSAGES.cast_more);
    more = { kind: 'article', url: site(CAST_PATHS.article(id)) };
  }
  let video: string | null = null;
  if (input.video) {
    const id = input.video;
    const v = (await videoRecords(tx)).find((x) => x.id === id);
    if (!v || !sendableVideo(v)) apiFail(409, 'cast_video', CAST_MESSAGES.cast_video);
    video = site(CAST_PATHS.video(id));
  }
  if (
    input.image &&
    !(await deps.storage.exists(platformFileKey(CAST_IMAGES_SECTION, input.image)))
  ) {
    apiFail(409, 'cast_image', CAST_MESSAGES.cast_image);
  }
  // Простое объявление без картинки и кнопок уходит, как раньше, одним текстом.
  if (!input.title && !input.image && !more && !video) {
    return { text: input.text, message: null };
  }
  const templates = await messageTemplates(tx);
  const message = castBotMessage({
    title: input.title,
    text: input.text,
    image: input.image,
    more: more?.url ? { text: botTemplate('tgBtnMore', templates.tgBtnMore), url: more.url } : null,
    video: video ? { text: botTemplate('tgBtnVideo', templates.tgBtnVideo), url: video } : null,
  });
  const problem = botMessageProblem(message);
  if (problem) {
    // Подписи кнопок испортили в справочнике — объявление всё равно уходит, текстом без кнопок.
    deps.logger.error({ problem }, 'Telegram: рассылка собрана неверно');
    return { text: [input.title, input.text].filter(Boolean).join('\n'), message: null };
  }
  return { text: botPlainText(message), message };
}

export const telegramCastOptionsRoute = createRoute({
  method: 'get',
  path: '/admin/telegram/cast-options',
  tags: ['admin'],
  summary: 'Рассылка: новости, статьи и видео для кнопок и «Заполнить из новости»',
  middleware: [requirePlatformAdmin] as const,
  request: { query: AdminTelegramCastOptionsQuery },
  responses: {
    200: {
      description: 'Записи, на которые могут вести кнопки',
      content: json(AdminTelegramCastOptions),
    },
    400: { description: 'Неверный номер новости', content: error },
    ...denied,
  },
});

export function telegramCastOptionsHandler(
  deps: ApiDeps,
): RouteHandler<typeof telegramCastOptionsRoute, AppEnv> {
  return async (c) => {
    const { news } = c.req.valid('query');
    const body = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      castOptions(tx, deps.clock.now(), news ?? null),
    );
    return c.json(body, 200);
  };
}

export const telegramCastCountRoute = createRoute({
  method: 'get',
  path: '/admin/telegram/broadcast/count',
  tags: ['admin'],
  summary: 'Рассылка: сколько получателей сейчас (для окна подтверждения)',
  middleware: [requirePlatformAdmin] as const,
  request: { query: AdminTelegramCastCountQuery },
  responses: {
    200: { description: 'Число получателей', content: json(AdminTelegramCastCount) },
    400: { description: 'Неверный номер организации', content: error },
    409: { description: 'Организация не найдена или заблокирована', content: error },
    ...denied,
  },
});

/** «Поставить в очередь?» (прототип `tgCastCount`): столько сообщений уйдёт — то же условие, что у рассылки. */
export function telegramCastCountHandler(
  deps: ApiDeps,
): RouteHandler<typeof telegramCastCountRoute, AppEnv> {
  return async (c) => {
    const { org } = c.req.valid('query');
    const count = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      adminTelegramBroadcastCount(tx, org ?? null),
    );
    if (count === null) {
      return apiFail(409, 'broadcast_org', 'Организация не найдена или заблокирована');
    }
    return c.json({ count }, 200);
  };
}

const tooLarge = () => apiError('cast_image_too_large', CAST_MESSAGES.cast_image_too_large);

/** Предел тела загрузки — сама картинка до 2 МБ (прототип: «Картинка больше 2 МБ»). */
const imageBodyLimit = bodyLimit({
  maxSize: CAST_IMAGE_MAX_BYTES,
  onError: (c) => c.json(tooLarge(), 413),
});

export const telegramCastImageRoute = createRoute({
  method: 'put',
  path: '/admin/telegram/images',
  tags: ['admin'],
  summary: 'Рассылка: загрузить картинку — JPG, PNG или WebP до 2 МБ телом запроса',
  middleware: [requirePlatformAdmin, imageBodyLimit] as const,
  request: {
    body: {
      required: true,
      content: { 'image/png': binary, 'image/jpeg': binary, 'image/webp': binary },
    },
  },
  responses: {
    201: {
      description: 'Картинка сохранена: номер для рассылки',
      content: json(AdminTelegramCastImage),
    },
    400: { description: 'Не картинка JPG, PNG или WebP', content: error },
    413: { description: 'Картинка больше 2 МБ', content: error },
    ...denied,
  },
});

/** Картинка рассылки — в хранилище платформы; тип — по первым байтам файла, а не по словам браузера. */
export function telegramCastImageHandler(
  deps: ApiDeps,
): RouteHandler<typeof telegramCastImageRoute, AppEnv> {
  return async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const problem = castImageProblem(bytes);
    if (problem === 'cast_image_too_large') return c.json(tooLarge(), 413);
    if (problem) return c.json(apiError(problem, CAST_MESSAGES[problem]), 400);
    const id = randomUUID();
    await deps.storage.put(platformFileKey(CAST_IMAGES_SECTION, id), bytes, {
      contentType: castImageType(bytes)!,
    });
    return c.json({ id }, 201);
  };
}
