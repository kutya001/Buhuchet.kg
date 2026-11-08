import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  addVideoGuest,
  takeRateLimit,
  videoRecord,
  videoVisibilityOf,
  type RateLimit,
} from '@buhuchet/db';
import { videoOnLanding } from '@buhuchet/domain';
import { ApiError, LandingVideoWatched, VideoIdParam, VideoPlay } from '@buhuchet/shared';
import { clientIpSubject } from '../../client-ip';
import type { ApiDeps } from '../../deps';
import type { Context } from 'hono';
import type { AppEnv } from '../../env';
import { apiError, apiFail } from '../../errors';
import { videoPlay } from './video';

/*
 * Видео лендинга для гостя (прототип v79 landing.js: блок «Видео о Buhuchet.kg» и ссылка в первом
 * экране; `vidOpen(id, {guest:true})`): только опубликованные, включённые, «для всех» видео с
 * отметкой «На лендинге». Без входа: обложка, чем играть, «запуск» и «досмотрел до …%» — для сводки
 * «Гости лендинга» Админки (прототип `VGUEST`: запуски и средний процент). Запуски и проценты с одного
 * адреса — не больше VIDEO_GUEST_RATE_LIMIT в час: накрутить сводку можно только медленно. Адреса
 * открыты без входа в `PUBLIC_PATTERNS` (middleware/session.ts).
 */

/** Запуски и «досмотрел» гостей с одного адреса: 60 в час (обычный гость — 2 на видео). */
export const VIDEO_GUEST_RATE_LIMIT: RateLimit = {
  kind: 'video_guest',
  max: 60,
  windowSeconds: 3600,
};

const error = { 'application/json': { schema: ApiError } };
const json = <T>(schema: T) => ({ 'application/json': { schema } });
const notFound = {
  404: { description: 'Видео нет на лендинге (`not_found`)', content: error },
} as const;

/** Видео лендинга или 404: черновик, снятое, удалённое и «для администраторов» гостю не видны. */
async function landingVideo(deps: ApiDeps, id: string) {
  const v = await videoRecord(deps.db, id);
  if (!v || !videoOnLanding(videoVisibilityOf(v))) apiFail(404, 'not_found', 'Видео нет');
  return v;
}

/** Занять запуск или «досмотрел» с адреса; null — можно, иначе готовый ответ 429. */
async function guestLimited(c: Context<AppEnv>, deps: ApiDeps) {
  const take = await takeRateLimit(
    deps.db,
    VIDEO_GUEST_RATE_LIMIT,
    clientIpSubject(c, deps, 'video_guest'),
  );
  if (take.ok) return null;
  c.header('retry-after', String(VIDEO_GUEST_RATE_LIMIT.windowSeconds));
  return apiError('rate_limited', 'Слишком много запросов. Попробуйте позже.');
}

export const landingVideoCoverRoute = createRoute({
  method: 'get',
  path: '/landing/videos/{id}/cover',
  tags: ['kb'],
  summary: 'Обложка видео лендинга (без входа)',
  request: { params: VideoIdParam },
  responses: {
    302: { description: 'Переход на подписанную ссылку на 15 минут' },
    ...notFound,
  },
});

/**
 * Обложка видео лендинга: только своя картинка или кадр из хранилища — у видео YouTube на лендинге
 * обложка не берётся с i.ytimg.com (ТЗ «Видео»: лендинг без внешних запросов); нет своей — 404,
 * лендинг рисует заставку сам.
 */
export function landingVideoCoverHandler(
  deps: ApiDeps,
): RouteHandler<typeof landingVideoCoverRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const v = await landingVideo(deps, id);
    if (!v.coverKey) apiFail(404, 'not_found', 'Обложки нет');
    const url = await deps.storage.signedDownloadUrl(v.coverKey, {
      expiresInSeconds: 15 * 60,
      inline: { contentType: 'image/jpeg' },
    });
    c.header('Cache-Control', 'public, max-age=600');
    return c.redirect(url, 302);
  };
}

export const landingVideoPlayRoute = createRoute({
  method: 'get',
  path: '/landing/videos/{id}/play',
  tags: ['kb'],
  summary: 'Чем играть видео лендинга (без входа)',
  request: { params: VideoIdParam },
  responses: {
    200: { description: 'Подписанная ссылка на файл или код YouTube', content: json(VideoPlay) },
    ...notFound,
  },
});

export function landingVideoPlayHandler(
  deps: ApiDeps,
): RouteHandler<typeof landingVideoPlayRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const v = await landingVideo(deps, id);
    const play = await videoPlay(deps, v);
    if (!play) apiFail(404, 'not_found', 'Видео нет');
    c.header('Cache-Control', 'no-store');
    return c.json(play, 200);
  };
}

export const landingVideoStartRoute = createRoute({
  method: 'post',
  path: '/landing/videos/{id}/start',
  tags: ['kb'],
  summary: 'Гость запустил видео лендинга',
  request: { params: VideoIdParam },
  responses: {
    204: { description: 'Запуск засчитан' },
    ...notFound,
    429: { description: 'Слишком много запусков с адреса (`rate_limited`)', content: error },
  },
});

/** Первый запуск в окне (прототип: `T.started` у гостя → `VGUEST[id].n++`). */
export function landingVideoStartHandler(
  deps: ApiDeps,
): RouteHandler<typeof landingVideoStartRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const v = await landingVideo(deps, id);
    const limited = await guestLimited(c, deps);
    if (limited) return c.json(limited, 429);
    await addVideoGuest(deps.db, v.id, true, 0);
    return c.body(null, 204);
  };
}

export const landingVideoWatchedRoute = createRoute({
  method: 'post',
  path: '/landing/videos/{id}/watched',
  tags: ['kb'],
  summary: 'Сколько процентов гость досмотрел, при закрытии окна',
  request: {
    params: VideoIdParam,
    body: { required: true, content: json(LandingVideoWatched) },
  },
  responses: {
    204: { description: 'Процент добавлен к сводке' },
    400: { description: 'Неверный процент', content: error },
    ...notFound,
    429: { description: 'Слишком много запросов с адреса (`rate_limited`)', content: error },
  },
});

/** Закрытие окна после запуска (прототип: `VGUEST[id].p += процент открытия`). */
export function landingVideoWatchedHandler(
  deps: ApiDeps,
): RouteHandler<typeof landingVideoWatchedRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { pct } = c.req.valid('json');
    const v = await landingVideo(deps, id);
    const limited = await guestLimited(c, deps);
    if (limited) return c.json(limited, 429);
    await addVideoGuest(deps.db, v.id, false, pct);
    return c.body(null, 204);
  };
}
