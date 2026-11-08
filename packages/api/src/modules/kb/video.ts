import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  listVideoTabPage,
  listVideoTabValues,
  openVideoSession,
  ownVideoSession,
  ownVideoViews,
  saveVideoProgress,
  setVideoDuration,
  setVideoYtBad,
  videoModuleTitle,
  videoRecord,
  videoRecords,
  videoViewBody,
  videoVisibilityOf,
  type LearnerVideoRow,
  type Tx,
  type VideoRecord,
} from '@buhuchet/db';
import {
  compareVideos,
  kbProgramSteps,
  VIDEO_LINK_SECONDS,
  VIDEO_MESSAGES,
  videoLive,
  videoModuleOrder,
  videoProgressProblem,
  videoVisible,
  type VideoContentType,
  type VideoSegment,
} from '@buhuchet/domain';
import {
  ApiError,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  VideoCatalog,
  VideoIdParam,
  VideoList,
  VideoMetaInput,
  VideoOpened,
  VideoProgressInput,
  VideoProgressSaved,
  VideoSessionParam,
  type VideoItem,
  type VideoPlay,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { serverTexts } from '../l10n/texts';
import { asLearner, markSteps, programContext, type KbLearner } from './state';

/*
 * Видео платформы для вошедшего (решение заказчика 08.11.2026, прототип v79 modules/video.js): все
 * доступные видео (окно «?» модуля, кнопка «▶» верхней панели, кнопки в статьях, новостях и уроках),
 * вкладка «Видео» Базы знаний, окно видео — подписанная ссылка на файл или код YouTube, учёт
 * просмотренных секунд по открытиям, обложка. Кому какое видео: администратору платформы — любое
 * опубликованное (его просмотры не записываются), остальным — «для всех» и «Общее» или модуль из его
 * меню (`videoVisible`).
 */

const error = { 'application/json': { schema: ApiError } };
const json = <T>(schema: T) => ({ 'application/json': { schema } });
const common = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Сотрудник организации или администратор платформы', content: error },
} as const;

/** Видео, доступные пользователю, по порядку групп модулей и «Порядку», со своими просмотрами. */
export async function learnerVideos(
  tx: Tx,
  learner: KbLearner,
  t: (key: string) => string,
): Promise<LearnerVideoRow[]> {
  const access = { admin: learner.access.admin, modules: learner.access.modules };
  const menu = [...learner.access.modules];
  const list = (await videoRecords(tx))
    .filter((v) => videoVisible(videoVisibilityOf(v), access))
    .sort((a, b) => compareVideos(a, b, menu));
  const tracked = !learner.access.admin;
  const views = tracked
    ? await ownVideoViews(
        tx,
        learner.userId,
        list.map((v) => v.id),
      )
    : new Map();
  return list.map((video) => ({
    id: video.id,
    video,
    moduleTitle: videoModuleTitle(t, video.module),
    moduleOrder: videoModuleOrder(video.module, menu),
    view: views.get(video.id) ?? null,
    tracked,
  }));
}

/** Видео для ответа (прототип `vidCardHtml`, `vidProg`, `vidNew`). */
export function videoItem(row: LearnerVideoRow): VideoItem {
  const v = row.video;
  return {
    id: v.id,
    title: v.title,
    kind: v.kind as VideoItem['kind'],
    source: v.source as VideoItem['source'],
    ytId: v.ytId,
    duration: v.duration,
    module: v.module,
    moduleTitle: row.moduleTitle,
    article: v.article,
    ord: v.ord,
    description: v.description,
    cover: v.coverKey !== null,
    status: v.status as VideoItem['status'],
    off: v.off,
    publishedAt: v.publishedAt?.toISOString() ?? null,
    isNew: row.tracked && v.kind === 'instr' && !row.view,
    view: row.tracked ? videoViewBody(row.view, v.duration) : null,
  };
}

/** Чем играть видео: подписанная ссылка на файл (2 часа) или код YouTube. */
export async function videoPlay(deps: ApiDeps, v: VideoRecord): Promise<VideoPlay | null> {
  if (v.source === 'yt') return v.ytId ? { kind: 'yt', ytId: v.ytId } : null;
  if (!v.fileKey || !v.fileType) return null;
  const type = v.fileType as VideoContentType;
  const url = await deps.storage.signedVideoUrl(v.fileKey, {
    expiresInSeconds: VIDEO_LINK_SECONDS,
    contentType: type,
  });
  const expiresAt = new Date(deps.clock.now().getTime() + VIDEO_LINK_SECONDS * 1000);
  return { kind: 'file', url, type, expiresAt: expiresAt.toISOString() };
}

/* ───────────── Все доступные видео ───────────── */

export const kbVideoCatalogRoute = createRoute({
  method: 'get',
  path: '/kb/videos/all',
  tags: ['kb'],
  summary: 'Все видео, доступные пользователю, со своими просмотрами',
  responses: {
    200: { description: 'Видео по порядку групп модулей', content: json(VideoCatalog) },
    ...common,
  },
});

/** Для «?» модуля, кнопки «▶» верхней панели, кнопок в статьях, новостях и шагах уроков. */
export function kbVideoCatalogHandler(
  deps: ApiDeps,
): RouteHandler<typeof kbVideoCatalogRoute, AppEnv> {
  return async (c) => {
    const t = await serverTexts(deps);
    const body = await asLearner(deps, c, async (tx, learner) => ({
      items: (await learnerVideos(tx, learner, t)).map(videoItem),
      tracked: !learner.access.admin,
    }));
    return c.json(body, 200);
  };
}

/* ───────────── Вкладка «Видео» ───────────── */

export const kbVideoListRoute = createRoute({
  method: 'get',
  path: '/kb/videos',
  tags: ['kb'],
  summary: '«Видео» Базы знаний: страница списка',
  request: { query: ListQueryParams },
  responses: {
    200: {
      description: 'Видео, плашка «Не просмотренные»; учитываются ли просмотры',
      content: json(VideoList),
    },
    ...listQueryResponses,
    ...common,
  },
});

/**
 * Вкладка «Видео» (прототип `renderKbVideo`): карточками по группам модулей, поиск по названию и
 * описанию, «Не просмотренные» — видео, которые пользователь ещё не досмотрел.
 */
export function kbVideoListHandler(deps: ApiDeps): RouteHandler<typeof kbVideoListRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const body = await asLearner(deps, c, async (tx, learner) => {
      const rows = await learnerVideos(tx, learner, t);
      const page = await listVideoTabPage(tx, rows, query, t);
      const tracked = !learner.access.admin;
      return {
        items: page.rows.map(videoItem),
        total: page.total,
        page: page.page,
        size: page.size,
        totals: page.totals,
        ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
        // «Не просмотренные» (прототип `un`): все доступные, кроме «Просмотрено».
        unseen: tracked ? rows.filter((r) => !r.view?.doneAt).length : 0,
        tracked,
      };
    });
    return c.json(body, 200);
  };
}

export const kbVideoValuesRoute = createRoute({
  method: 'get',
  path: '/kb/videos/values',
  tags: ['kb'],
  summary: 'Значения столбца вкладки «Видео» для фильтра',
  request: { query: ListValuesQuery },
  responses: {
    200: { description: 'Значения столбца с числом записей', content: json(ListValues) },
    ...listQueryResponses,
    ...common,
  },
});

export function kbVideoValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof kbVideoValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await asLearner(deps, c, async (tx, learner) =>
      listVideoTabValues(tx, await learnerVideos(tx, learner, t), col, t, q),
    );
    return c.json(values, 200);
  };
}

/* ───────────── Окно видео ───────────── */

/** Видео для окна: нет, удалено или снято — 404 «Видео снято с публикации»; не по модулям — 403. */
async function openable(tx: Tx, learner: KbLearner, id: string): Promise<VideoRecord> {
  const v = await videoRecord(tx, id);
  if (!v || v.deletedAt) apiFail(404, 'video_off', VIDEO_MESSAGES.video_off);
  // Администратор платформы проверяет в окне и черновик, и снятое (прототип vidOpen: isAdmin()).
  if (learner.access.admin) return v;
  if (!videoLive(videoVisibilityOf(v))) apiFail(404, 'video_off', VIDEO_MESSAGES.video_off);
  if (!videoVisible(videoVisibilityOf(v), learner.access)) {
    apiFail(403, 'video_denied', VIDEO_MESSAGES.video_denied);
  }
  return v;
}

export const kbVideoOpenRoute = createRoute({
  method: 'post',
  path: '/kb/videos/{id}/open',
  tags: ['kb'],
  summary: 'Открыть окно видео: чем играть и новое открытие',
  request: { params: VideoIdParam },
  responses: {
    200: { description: 'Видео, ссылка или код YouTube, открытие', content: json(VideoOpened) },
    401: common[401],
    403: {
      description: 'Видео недоступно: модуль выключен или нет прав (`video_denied`)',
      content: error,
    },
    404: { description: 'Видео снято с публикации или удалено (`video_off`)', content: error },
  },
});

/**
 * Окно видео (прототип `vidOpen` и `vidPlayer`): у сотрудника открытие записывается сразу — «Открывал,
 * раз» +1 и строка «открыл, не смотрел»; у администратора платформы — не записывается.
 */
export function kbVideoOpenHandler(deps: ApiDeps): RouteHandler<typeof kbVideoOpenRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const t = await serverTexts(deps);
    const body = await asLearner(deps, c, async (tx, learner) => {
      const v = await openable(tx, learner, id);
      const tracked = !learner.access.admin;
      // Время открытия — по часам приложения: по ним же сервер считает, сколько могло проиграться.
      const opened = tracked
        ? await openVideoSession(tx, learner.userId, v.id, deps.clock.now())
        : null;
      const play = await videoPlay(deps, v);
      if (!play) apiFail(404, 'video_off', VIDEO_MESSAGES.video_off);
      const menu = [...learner.access.modules];
      return {
        video: videoItem({
          id: v.id,
          video: v,
          moduleTitle: videoModuleTitle(t, v.module),
          moduleOrder: videoModuleOrder(v.module, menu),
          view: opened?.view ?? null,
          tracked,
        }),
        play,
        session: opened?.sessionId ?? null,
      };
    });
    return c.json(body, 200);
  };
}

export const kbVideoProgressRoute = createRoute({
  method: 'put',
  path: '/kb/videos/{id}/sessions/{sessionId}',
  tags: ['kb'],
  summary: 'Сохранить, что проигралось в открытии окна',
  request: {
    params: VideoSessionParam,
    body: { required: true, content: json(VideoProgressInput) },
  },
  responses: {
    200: {
      description: 'Просмотр; поставлено ли «Просмотрено» и засчитанные шаги уроков',
      content: json(VideoProgressSaved),
    },
    400: { description: 'Неверные отрезки (`video_progress_invalid`)', content: error },
    ...common,
    404: { description: 'Нет такого открытия у пользователя или видео удалено', content: error },
  },
});

/**
 * Прогресс открытия (прототип: каждые 15 секунд просмотра, при паузе, уходе со вкладки и закрытии
 * окна): все отрезки этого открытия; сервер сливает их с прежними — каждая секунда видео один раз — и
 * не принимает больше, чем могло проиграться с открытия окна на скорости 2. Набралось 90 % —
 * «Просмотрено» и шаги «Посмотреть» с этим видео засчитываются способом «просмотром видео».
 */
export function kbVideoProgressHandler(
  deps: ApiDeps,
): RouteHandler<typeof kbVideoProgressRoute, AppEnv> {
  return async (c) => {
    const { id, sessionId } = c.req.valid('param');
    const input = c.req.valid('json');
    const body = await asLearner(deps, c, async (tx, learner) => {
      if (learner.access.admin)
        apiFail(403, 'forbidden', 'Просмотры администратора не записываются');
      const session = await ownVideoSession(tx, sessionId, learner.userId, id);
      if (!session) apiFail(404, 'not_found', 'Открытие не найдено');
      const v = await videoRecord(tx, id);
      if (!v) apiFail(404, 'not_found', 'Видео не найдено');
      const now = deps.clock.now();
      const problem = videoProgressProblem({
        segs: input.segs,
        duration: v.duration,
        openedAt: session.openedAt,
        now,
      });
      if (problem) apiFail(400, problem, VIDEO_MESSAGES[problem]);
      const end = v.duration ?? Infinity;
      const segs: VideoSegment[] = input.segs
        .map(([a, b]) => [a, Math.min(b, end)] as const)
        .filter(([a, b]) => b > a);
      const { view, doneNow } = await saveVideoProgress(tx, {
        session,
        segs,
        pos: Math.min(input.pos, end),
        duration: v.duration,
      });
      let steps: { id: string; title: string }[] = [];
      if (doneNow) {
        const ctx = await programContext(tx, learner);
        const marks = kbProgramSteps(ctx.program)
          .filter((s) => s.learn && s.def.video === v.id)
          .map((step) => ({ step, how: 'video' as const }));
        if (marks.length) {
          const result = await markSteps(tx, ctx, marks, now, { congrats: false });
          steps = result.fresh.map((f) => ({ id: f.id, title: f.title }));
        }
      }
      return { view: videoViewBody(view, v.duration), done: doneNow, steps };
    });
    return c.json(body, 200);
  };
}

export const kbVideoMetaRoute = createRoute({
  method: 'post',
  path: '/kb/videos/{id}/meta',
  tags: ['kb'],
  summary: 'Длительность из плеера и «YouTube: видео недоступно»',
  request: { params: VideoIdParam, body: { required: true, content: json(VideoMetaInput) } },
  responses: {
    204: { description: 'Принято' },
    ...common,
    404: { description: 'Видео нет или оно недоступно', content: error },
  },
});

/**
 * Что узнал плеер (прототип `onDur`, `v.ytBad`): длительность видео YouTube до первого запуска и WebM
 * без длительности в файле — только пока она неизвестна; видео YouTube не играет (удалено или закрыто)
 * — пометка в Админке, снова заиграло — пометка снимается.
 */
export function kbVideoMetaHandler(deps: ApiDeps): RouteHandler<typeof kbVideoMetaRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    await asLearner(deps, c, async (tx, learner) => {
      const v = await openable(tx, learner, id);
      if (input.duration !== undefined && v.duration === null) {
        await setVideoDuration(tx, v.id, input.duration);
      }
      if (input.ytOk !== undefined && v.source === 'yt') await setVideoYtBad(tx, v.id, !input.ytOk);
    });
    return c.body(null, 204);
  };
}

export const kbVideoCoverRoute = createRoute({
  method: 'get',
  path: '/kb/videos/{id}/cover',
  tags: ['kb'],
  summary: 'Обложка видео',
  request: { params: VideoIdParam },
  responses: {
    302: { description: 'Переход на подписанную ссылку на 15 минут' },
    ...common,
    404: { description: 'Обложки нет или видео недоступно', content: error },
  },
});

/** Обложка (своя картинка или кадр видео) — JPEG в хранилище, ссылка на 15 минут. */
export function kbVideoCoverHandler(deps: ApiDeps): RouteHandler<typeof kbVideoCoverRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const key = await asLearner(deps, c, async (tx, learner) => {
      const v = await videoRecord(tx, id);
      if (!v || v.deletedAt || !v.coverKey) return null;
      if (!learner.access.admin && !videoVisible(videoVisibilityOf(v), learner.access)) return null;
      return v.coverKey;
    });
    if (!key) apiFail(404, 'not_found', 'Обложки нет');
    const url = await deps.storage.signedDownloadUrl(key, {
      expiresInSeconds: 15 * 60,
      inline: { contentType: 'image/jpeg' },
    });
    c.header('Cache-Control', 'private, max-age=600');
    return c.redirect(url, 302);
  };
}
