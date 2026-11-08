import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { platformFileKey } from '@buhuchet/adapters';
import {
  adminVideoRows,
  adminVideoSummary,
  createVideo,
  createVideoUpload,
  deleteVideo,
  dropVideoUpload,
  exportAdminVideos,
  kbArticles,
  listAdminVideosPage,
  listAdminVideosValues,
  saveVideo,
  setVideoState,
  takeRateLimit,
  videoGuests,
  videoHistory,
  videoModuleTitle,
  videoRecord,
  videoRecords,
  videoUpload,
  videoUploadReady,
  videoViewerCounts,
  withUserContext,
  type AdminVideoRow,
  type RateLimit,
  type Tx,
  type VideoRecord,
  type VideoValues,
} from '@buhuchet/db';
import {
  compareVideos,
  isJpeg,
  MENU_MODULE_IDS,
  probeVideo,
  VIDEO_COVER_MAX_BYTES,
  VIDEO_MAX_PARTS,
  VIDEO_MESSAGES,
  VIDEO_PART_BYTES,
  VIDEO_PART_LINK_SECONDS,
  videoContentType,
  videoFormProblems,
  videoLive,
  videoModuleOrder,
  videoYtId,
  type VideoMessage,
} from '@buhuchet/domain';
import {
  ApiError,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  VideoAdminCard,
  VideoAdminCreate,
  VideoAdminList,
  VideoAdminOff,
  VideoAdminSaved,
  VideoAdminUpdate,
  VideoAdminVersion,
  VideoAdminVersionQuery,
  VideoCoverUploaded,
  VideoIdParam,
  VideoOptions,
  VideoPartLinks,
  VideoPartsInput,
  VideoUploadChecked,
  VideoUploadParam,
  VideoUploadStart,
  VideoUploadStarted,
  VideoUploadState,
  type VideoAdminFields,
  type VideoAdminItem,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { randomUUID } from 'node:crypto';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError, apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { videoPlay } from './video';

/*
 * Админка → «База знаний (содержимое)» → «Видео» (решение заказчика 08.11.2026, прототип v79
 * admin/video-admin.js): список с подписью «Видео · Опубликовано · Занято», карточка с плеером и
 * историей, форма «Новое видео» / «Изменить» / «Заменить файл», «Опубликовать», «Снять с публикации»,
 * «Вернуть в публикацию», «Удалить». Файл видео браузер кладёт в хранилище частями по подписанным
 * ссылкам мимо API (`/admin/videos/uploads`), сервер собирает файл, проверяет, что это MP4 или WebM, и
 * узнаёт длительность. Обложка — JPEG до 2 МБ телом запроса (браузер уменьшает картинку до 960 px).
 * Только администратору платформы; история — в той же транзакции.
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
  404: { description: 'Видео нет или оно удалено', content: error },
  409: { description: 'Запись изменена другим пользователем', content: error },
} as const;

const P = '/admin/videos' as const;
/** Файлы видео и обложки в хранилище: `platform/videos/<загрузка>`, `platform/video-covers/<загрузка>`. */
export const VIDEO_FILES = 'videos';
export const VIDEO_COVERS = 'video-covers';
export const VIDEO_COVER_UPLOAD_PATH = `/api${P}/covers`;

/** Загрузки администратора за час: файлы и обложки (незаконченные убирает задача через сутки). */
export const VIDEO_UPLOAD_RATE_LIMIT: RateLimit = {
  kind: 'video_upload',
  max: 60,
  windowSeconds: 3600,
};

const adminTx = <T>(deps: ApiDeps, c: Context<AppEnv>, fn: (tx: Tx) => Promise<T>) =>
  withUserContext(deps.db, c.get('session')!.userId, fn);

function fail(status: 400 | 404 | 409, code: VideoMessage, field?: string): never {
  return apiFail(status, code, VIDEO_MESSAGES[code], field ? { field } : undefined);
}

/** Порядок модулей для сортировки по «Модулю»: «Общее» — первым, дальше как в меню. */
const moduleOrder = (module: string | null) => videoModuleOrder(module, MENU_MODULE_IDS);

function itemOf(v: VideoRecord, viewers: number, t: (key: string) => string): VideoAdminItem {
  return {
    id: v.id,
    title: v.title,
    kind: v.kind as VideoAdminItem['kind'],
    source: v.source as VideoAdminItem['source'],
    ytId: v.ytId,
    fileName: v.fileName,
    fileSize: v.fileSize,
    duration: v.duration,
    coverKind: (v.coverKind as VideoAdminItem['coverKind']) ?? null,
    description: v.description,
    module: v.module,
    moduleTitle: videoModuleTitle(t, v.module),
    article: v.article,
    ord: v.ord,
    audience: v.audience as VideoAdminItem['audience'],
    status: v.status as VideoAdminItem['status'],
    off: v.off,
    landing: v.landing,
    landingOrd: v.landingOrd,
    ytBad: v.ytBad,
    viewers,
    updatedAt: v.updatedAt.toISOString(),
    version: v.version,
  };
}

const rowItem = (r: AdminVideoRow, t: (key: string) => string) => itemOf(r.video, r.viewers, t);

/** Удалить из хранилища файлы, которые больше не нужны (после записи; ошибка — только в журнал). */
async function dropFiles(deps: ApiDeps, keys: readonly string[]) {
  for (const key of keys) {
    try {
      await deps.storage.delete(key);
    } catch (err) {
      deps.logger.error({ err }, 'видео: не удалось удалить файл из хранилища');
    }
  }
}

/* ───────────── Список ───────────── */

export const adminVideoListRoute = createRoute({
  method: 'get',
  path: P,
  tags: ['kb'],
  summary: 'Админка → «Видео»: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams },
  responses: {
    200: { description: 'Видео и подпись над списком', content: json(VideoAdminList) },
    ...listQueryResponses,
    ...denied,
  },
});

export function adminVideoListHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoListRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const result = await adminTx(deps, c, async (tx) => {
      const rows = await adminVideoRows(tx, t, moduleOrder);
      const page = await listAdminVideosPage(tx, rows, query, t);
      return {
        items: page.rows.map((r) => rowItem(r, t)),
        total: page.total,
        page: page.page,
        size: page.size,
        totals: page.totals,
        ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
        summary: adminVideoSummary(rows),
      };
    });
    return c.json(result, 200);
  };
}

export const adminVideoValuesRoute = createRoute({
  method: 'get',
  path: `${P}/values`,
  tags: ['kb'],
  summary: 'Значения столбца списка видео для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: { description: 'Значения столбца с числом записей', content: json(ListValues) },
    ...listQueryResponses,
    ...denied,
  },
});

export function adminVideoValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await adminTx(deps, c, async (tx) =>
      listAdminVideosValues(tx, await adminVideoRows(tx, t, moduleOrder), col, t, q),
    );
    return c.json(values, 200);
  };
}

export const adminVideoExportRoute = createRoute({
  method: 'get',
  path: `${P}/export`,
  tags: ['kb'],
  summary: 'Список видео в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListExportParams },
  responses: {
    200: { description: 'Файл Excel со всеми видео под поиском и фильтрами', content: xlsxContent },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function adminVideoExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoExportRoute, AppEnv> {
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
        async (tx) =>
          exportAdminVideos(tx, await adminVideoRows(tx, t, moduleOrder), query, keys, t),
        'export',
      );
      return xlsxResponse(c, {
        title: t('tab.kbadm.video'),
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

export const adminVideoOptionsRoute = createRoute({
  method: 'get',
  path: `${P}/options`,
  tags: ['kb'],
  summary: 'Видео для выбора в редакторах новостей, статей и шагов уроков',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Не удалённые видео по порядку групп модулей',
      content: json(VideoOptions),
    },
    ...denied,
  },
});

/** Кнопка «Видео» в редакторах (прототип `vidPickMenu`) и поле «Видео» шага урока. */
export function adminVideoOptionsHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoOptionsRoute, AppEnv> {
  return async (c) => {
    const t = await serverTexts(deps);
    const items = await adminTx(deps, c, async (tx) =>
      (await videoRecords(tx))
        .sort((a, b) => compareVideos(a, b, MENU_MODULE_IDS))
        .map((v) => ({
          id: v.id,
          title: v.title,
          kind: v.kind as 'instr' | 'pres',
          moduleTitle: videoModuleTitle(t, v.module),
          duration: v.duration,
          live: videoLive({
            status: v.status as 'draft' | 'published',
            off: v.off,
            deleted: false,
            audience: v.audience as 'all' | 'adm',
            module: v.module,
          }),
          draft: v.status === 'draft',
        })),
    );
    return c.json({ items }, 200);
  };
}

/* ───────────── Карточка ───────────── */

export const adminVideoCardRoute = createRoute({
  method: 'get',
  path: `${P}/{id}`,
  tags: ['kb'],
  summary: 'Карточка видео: поля, чем играть, история, гости лендинга',
  middleware: [requirePlatformAdmin] as const,
  request: { params: VideoIdParam },
  responses: {
    200: { description: 'Видео', content: json(VideoAdminCard) },
    ...denied,
    404: { description: 'Видео нет или оно удалено', content: error },
  },
});

export function adminVideoCardHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoCardRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const t = await serverTexts(deps);
    const card = await adminTx(deps, c, async (tx) => {
      const v = await videoRecord(tx, id);
      if (!v || v.deletedAt) apiFail(404, 'not_found', 'Видео не найдено');
      const [viewers, guests, history, articles] = await Promise.all([
        videoViewerCounts(tx),
        videoGuests(tx),
        videoHistory(tx, v.id),
        v.article ? kbArticles(tx) : Promise.resolve([]),
      ]);
      return {
        video: itemOf(v, viewers.get(v.id) ?? 0, t),
        articleTitle: articles.find((a) => a.id === v.article)?.t ?? null,
        guests: guests.get(v.id)?.starts ?? 0,
        history,
        v,
      };
    });
    const play = await videoPlay(deps, card.v);
    return c.json(
      {
        video: card.video,
        articleTitle: card.articleTitle,
        guests: card.guests,
        history: card.history,
        play,
      },
      200,
    );
  };
}

/* ───────────── Запись ───────────── */

/**
 * Поля формы → значения записи (прототип `vidEditDlg` → `save`): ошибки полей — 400 с полем; файл —
 * своя проверенная загрузка, обложка — своя загрузка-картинка; статья — из Базы знаний.
 */
async function valuesOf(
  tx: Tx,
  input: VideoAdminFields,
  before: VideoRecord | null,
): Promise<{ values: VideoValues; consumed: string[] }> {
  const ytId = input.source === 'yt' ? videoYtId(input.yt) : null;
  const upload =
    input.source === 'file' && input.upload ? await videoUpload(tx, input.upload) : null;
  if (input.source === 'file' && input.upload) {
    if (!upload || upload.kind !== 'video') fail(400, 'video_not_uploaded', 'file');
    if (upload.state !== 'ready') fail(400, 'video_upload_wait', 'file');
  }
  const keptFile = before?.source === 'file' && before.fileKey !== null;
  const problems = videoFormProblems({
    title: input.title,
    kind: input.kind,
    source: input.source,
    yt: input.yt ?? null,
    hasFile: !!upload || keptFile,
    module: input.module || null,
    description: input.description,
  });
  const field = Object.keys(problems)[0] as keyof typeof problems | undefined;
  if (field) fail(400, problems[field]!, field);
  const article = input.article || null;
  if (article && !(await kbArticles(tx)).some((a) => a.id === article)) {
    apiFail(400, 'validation_failed', 'Такой статьи нет', { field: 'article' });
  }
  const consumed: string[] = [];
  let cover: VideoValues['cover'] = 'keep';
  if (input.cover === 'none') cover = null;
  else if (input.cover !== 'keep') {
    const c = await videoUpload(tx, input.cover.upload);
    if (!c || c.kind !== 'cover') fail(400, 'video_cover', 'cover');
    cover = { key: c.storageKey, kind: input.cover.kind };
    consumed.push(c.id);
  }
  if (upload) consumed.push(upload.id);
  return {
    consumed,
    values: {
      title: input.title.trim(),
      kind: input.kind,
      source: input.source,
      ytId,
      file: upload
        ? {
            key: upload.storageKey,
            name: upload.fileName,
            size: upload.sizeBytes,
            type: upload.contentType,
          }
        : null,
      duration: upload
        ? upload.duration
        : input.source === 'yt'
          ? (input.ytDuration ?? null)
          : null,
      cover,
      description: input.description.trim(),
      module: input.module || null,
      article,
      ord: input.ord,
      audience: input.audience,
      ...(input.landing !== undefined ? { landing: input.landing } : {}),
      ...(input.landingOrd !== undefined ? { landingOrd: input.landingOrd } : {}),
    },
  };
}

export const adminVideoCreateRoute = createRoute({
  method: 'post',
  path: P,
  tags: ['kb'],
  summary: 'Новое видео: черновик или сразу опубликовать',
  middleware: [requirePlatformAdmin] as const,
  request: { body: body(VideoAdminCreate) },
  responses: {
    201: { description: 'Видео сохранено', content: json(VideoAdminSaved) },
    400: saveFails[400],
    ...denied,
  },
});

export function adminVideoCreateHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoCreateRoute, AppEnv> {
  return async (c) => {
    const input = c.req.valid('json');
    const t = await serverTexts(deps);
    const saved = await adminTx(deps, c, async (tx) => {
      const { values, consumed } = await valuesOf(tx, input, null);
      if (input.source === 'file' && !values.file) fail(400, 'file', 'file');
      const v = await createVideo(tx, values, input.publish);
      for (const id of consumed) await dropVideoUpload(tx, id);
      return v;
    });
    return c.json({ video: itemOf(saved, 0, t), replaced: false }, 201);
  };
}

export const adminVideoUpdateRoute = createRoute({
  method: 'put',
  path: `${P}/{id}`,
  tags: ['kb'],
  summary: 'Изменить видео, заменить файл или ссылку (той версии, что видел администратор)',
  middleware: [requirePlatformAdmin] as const,
  request: { params: VideoIdParam, body: body(VideoAdminUpdate) },
  responses: {
    200: { description: 'Видео сохранено', content: json(VideoAdminSaved) },
    ...saveFails,
    ...denied,
  },
});

export function adminVideoUpdateHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoUpdateRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const t = await serverTexts(deps);
    const result = await adminTx(deps, c, async (tx) => {
      const before = await videoRecord(tx, id);
      if (!before || before.deletedAt) apiFail(404, 'not_found', 'Видео не найдено');
      const { values, consumed } = await valuesOf(tx, input, before);
      const r = await saveVideo(tx, id, input.version, values, input.publish === true);
      if (!r.ok) {
        if (r.reason === 'not_found') apiFail(404, 'not_found', 'Видео не найдено');
        apiFail(409, 'record_changed', 'Запись изменена другим пользователем', {
          version: before.version,
        });
      }
      for (const u of consumed) await dropVideoUpload(tx, u);
      const viewers = await videoViewerCounts(tx);
      return { r, viewers: viewers.get(id) ?? 0 };
    });
    await dropFiles(deps, result.r.dropKeys);
    return c.json(
      { video: itemOf(result.r.video, result.viewers, t), replaced: result.r.replaced },
      200,
    );
  };
}

const stateRoute = <
  Path extends 'publish' | 'off',
  S extends typeof VideoAdminVersion | typeof VideoAdminOff,
>(
  path: Path,
  summary: string,
  schema: S,
) =>
  createRoute({
    method: 'post',
    path: `${P}/{id}/${path}` as `${typeof P}/{id}/${Path}`,
    tags: ['kb'],
    summary,
    middleware: [requirePlatformAdmin] as const,
    request: { params: VideoIdParam, body: body(schema) },
    responses: {
      200: { description: 'Видео', content: json(VideoAdminSaved) },
      ...saveFails,
      ...denied,
    },
  });

export const adminVideoPublishRoute = stateRoute(
  'publish',
  'Опубликовать черновик',
  VideoAdminVersion,
);
export const adminVideoOffRoute = stateRoute(
  'off',
  'Снять с публикации (`off: true`) или вернуть в публикацию',
  VideoAdminOff,
);

async function changeState(
  deps: ApiDeps,
  c: Context<AppEnv>,
  id: string,
  version: number,
  change: 'publish' | 'off' | 'on',
) {
  const t = await serverTexts(deps);
  const out = await adminTx(deps, c, async (tx) => {
    const r = await setVideoState(tx, id, version, change);
    if (!r.ok) {
      if (r.reason === 'not_found') apiFail(404, 'not_found', 'Видео не найдено');
      if (r.reason === 'state') {
        fail(400, change === 'publish' ? 'video_not_draft' : 'video_not_published');
      }
      apiFail(409, 'record_changed', 'Запись изменена другим пользователем');
    }
    const viewers = await videoViewerCounts(tx);
    return itemOf(r.video, viewers.get(id) ?? 0, t);
  });
  return { video: out, replaced: false };
}

export function adminVideoPublishHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoPublishRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('json');
    return c.json(await changeState(deps, c, id, version, 'publish'), 200);
  };
}

export function adminVideoOffHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoOffRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json') as z.infer<typeof VideoAdminOff>;
    return c.json(await changeState(deps, c, id, input.version, input.off ? 'off' : 'on'), 200);
  };
}

export const adminVideoDeleteRoute = createRoute({
  method: 'delete',
  path: `${P}/{id}`,
  tags: ['kb'],
  summary: 'Удалить черновик или снятое с публикации видео',
  middleware: [requirePlatformAdmin] as const,
  request: { params: VideoIdParam, query: VideoAdminVersionQuery },
  responses: {
    204: { description: 'Удалено: файл и обложка убраны из хранилища' },
    400: { description: 'Видео опубликовано (`video_delete_live`)', content: error },
    404: saveFails[404],
    409: saveFails[409],
    ...denied,
  },
});

/** «Удалить» (прототип `vidDel`): только черновик или снятое; статистика просмотров остаётся. */
export function adminVideoDeleteHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoDeleteRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('query');
    const keys = await adminTx(deps, c, async (tx) => {
      const r = await deleteVideo(tx, id, version);
      if (!r.ok) {
        if (r.reason === 'not_found') apiFail(404, 'not_found', 'Видео не найдено');
        if (r.reason === 'state') fail(400, 'video_delete_live');
        apiFail(409, 'record_changed', 'Запись изменена другим пользователем');
      }
      return r.dropKeys;
    });
    await dropFiles(deps, keys);
    return c.body(null, 204);
  };
}

/* ───────────── Загрузка файла частями ───────────── */

const uploadLimit = async (deps: ApiDeps, c: Context<AppEnv>) => {
  const slot = await takeRateLimit(deps.db, VIDEO_UPLOAD_RATE_LIMIT, c.get('session')!.userId);
  if (!slot.ok) apiFail(429, 'video_upload_limit', VIDEO_MESSAGES.video_upload_limit);
};

export const adminVideoUploadStartRoute = createRoute({
  method: 'post',
  path: `${P}/uploads`,
  tags: ['kb'],
  summary: 'Начать загрузку файла видео частями',
  middleware: [requirePlatformAdmin] as const,
  request: { body: body(VideoUploadStart) },
  responses: {
    201: {
      description: 'Загрузка начата: размер части и число частей',
      content: json(VideoUploadStarted),
    },
    400: {
      description: 'Не MP4 или WebM, пустой или больше 500 МБ (`video_file`)',
      content: error,
    },
    429: { description: 'Слишком много загрузок за час', content: error },
    ...denied,
  },
});

/**
 * Начать загрузку (прототип `pick` → `startUp`): тип — по имени и заявленному браузером, размер — до
 * 500 МБ. Хранилище открывает многочастную загрузку; части браузер кладёт сам по ссылкам `…/parts`.
 */
export function adminVideoUploadStartHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoUploadStartRoute, AppEnv> {
  return async (c) => {
    const input = c.req.valid('json');
    const type = videoContentType(input.name, input.type);
    if (!type) fail(400, 'video_file', 'file');
    await uploadLimit(deps, c);
    const id = randomUUID();
    const key = platformFileKey(VIDEO_FILES, id);
    const uploadId = await deps.storage.createMultipart(key, { contentType: type });
    try {
      await adminTx(deps, c, (tx) =>
        createVideoUpload(tx, {
          id,
          kind: 'video',
          storageKey: key,
          s3UploadId: uploadId,
          fileName: input.name.slice(0, 255),
          sizeBytes: input.size,
          contentType: type,
        }),
      );
    } catch (err) {
      await deps.storage.abortMultipart(key, uploadId).catch(() => undefined);
      throw err;
    }
    return c.json(
      { id, partSize: VIDEO_PART_BYTES, parts: Math.ceil(input.size / VIDEO_PART_BYTES) },
      201,
    );
  };
}

/** Своя загрузка файла, которая ещё идёт. */
async function uploading(deps: ApiDeps, c: Context<AppEnv>, id: string) {
  const u = await adminTx(deps, c, (tx) => videoUpload(tx, id));
  if (!u || u.kind !== 'video') apiFail(404, 'not_found', 'Загрузка не найдена');
  return u;
}

export const adminVideoUploadPartsRoute = createRoute({
  method: 'post',
  path: `${P}/uploads/{id}/parts`,
  tags: ['kb'],
  summary: 'Ссылки на загрузку частей файла',
  middleware: [requirePlatformAdmin] as const,
  request: { params: VideoUploadParam, body: body(VideoPartsInput) },
  responses: {
    200: { description: 'Ссылки `PUT` на 15 минут', content: json(VideoPartLinks) },
    400: { description: 'Номер части вне файла', content: error },
    404: { description: 'Загрузки нет или она уже собрана', content: error },
    ...denied,
  },
});

export function adminVideoUploadPartsHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoUploadPartsRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { numbers } = c.req.valid('json');
    const u = await uploading(deps, c, id);
    if (!u.s3UploadId || u.state !== 'uploading') apiFail(404, 'not_found', 'Загрузка уже собрана');
    const parts = Math.min(VIDEO_MAX_PARTS, Math.ceil(u.sizeBytes / VIDEO_PART_BYTES));
    if (numbers.some((n) => n > parts)) {
      apiFail(400, 'validation_failed', 'Номер части вне файла', { field: 'numbers' });
    }
    const links = await Promise.all(
      [...new Set(numbers)].map(async (number) => ({
        number,
        url: await deps.storage.signedPartUrl(u.storageKey, u.s3UploadId!, number, {
          expiresInSeconds: VIDEO_PART_LINK_SECONDS,
          // Все части по 10 МБ, последняя — остаток файла.
          size: number < parts ? VIDEO_PART_BYTES : u.sizeBytes - VIDEO_PART_BYTES * (parts - 1),
        }),
      })),
    );
    const expiresAt = new Date(deps.clock.now().getTime() + VIDEO_PART_LINK_SECONDS * 1000);
    return c.json({ links, expiresAt: expiresAt.toISOString() }, 200);
  };
}

export const adminVideoUploadStateRoute = createRoute({
  method: 'get',
  path: `${P}/uploads/{id}`,
  tags: ['kb'],
  summary: 'Какие части файла уже в хранилище («Продолжить» после обрыва)',
  middleware: [requirePlatformAdmin] as const,
  request: { params: VideoUploadParam },
  responses: {
    200: { description: 'Уложенные части', content: json(VideoUploadState) },
    404: { description: 'Загрузки нет', content: error },
    ...denied,
  },
});

export function adminVideoUploadStateHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoUploadStateRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const u = await uploading(deps, c, id);
    const parts = u.s3UploadId ? await deps.storage.listParts(u.storageKey, u.s3UploadId) : null;
    if (!parts) apiFail(404, 'not_found', 'Загрузка не найдена');
    return c.json(
      {
        parts: parts.map((p) => ({ number: p.partNumber, size: p.size })),
        partSize: VIDEO_PART_BYTES,
        size: u.sizeBytes,
      },
      200,
    );
  };
}

export const adminVideoUploadCompleteRoute = createRoute({
  method: 'post',
  path: `${P}/uploads/{id}/complete`,
  tags: ['kb'],
  summary: 'Собрать файл из частей и проверить, что это видео',
  middleware: [requirePlatformAdmin] as const,
  request: { params: VideoUploadParam },
  responses: {
    200: { description: 'Файл собран и проверен', content: json(VideoUploadChecked) },
    400: {
      description:
        'Части дошли не все (`video_not_uploaded`) или файл не похож на видео (`video_not_video`)',
      content: error,
    },
    404: { description: 'Загрузки нет', content: error },
    ...denied,
  },
});

/**
 * «Проверяем файл…» (прототип `check`): части — все и нужных размеров, файл собирается, сервер читает
 * начало файла и узнаёт, MP4 это или WebM и сколько он длится. Не видео — файл удаляется.
 */
export function adminVideoUploadCompleteHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoUploadCompleteRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const u = await uploading(deps, c, id);
    if (u.state === 'ready') {
      return c.json(
        { id, type: u.contentType as 'video/mp4' | 'video/webm', duration: u.duration },
        200,
      );
    }
    const parts = u.s3UploadId ? await deps.storage.listParts(u.storageKey, u.s3UploadId) : null;
    if (!parts) apiFail(404, 'not_found', 'Загрузка не найдена');
    const count = Math.ceil(u.sizeBytes / VIDEO_PART_BYTES);
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const whole =
      sorted.length === count &&
      sorted.every((p, i) => p.partNumber === i + 1) &&
      sorted.reduce((sum, p) => sum + p.size, 0) === u.sizeBytes &&
      sorted.slice(0, -1).every((p) => p.size === VIDEO_PART_BYTES);
    if (!whole) fail(400, 'video_not_uploaded', 'file');
    await deps.storage.completeMultipart(u.storageKey, u.s3UploadId!, sorted);
    const probe = await probeVideo(
      async (offset, length) =>
        (await deps.storage.getRange(u.storageKey, offset, length)) ?? new Uint8Array(),
      u.sizeBytes,
      u.contentType as 'video/mp4' | 'video/webm',
    );
    if (!probe) {
      await dropFiles(deps, [u.storageKey]);
      await adminTx(deps, c, (tx) => dropVideoUpload(tx, id));
      fail(400, 'video_not_video', 'file');
    }
    await adminTx(deps, c, (tx) =>
      videoUploadReady(tx, id, { contentType: probe.type, duration: probe.duration }),
    );
    return c.json({ id, type: probe.type, duration: probe.duration }, 200);
  };
}

export const adminVideoUploadCancelRoute = createRoute({
  method: 'delete',
  path: `${P}/uploads/{id}`,
  tags: ['kb'],
  summary: '«Отменить» загрузку: части и файл убираются из хранилища',
  middleware: [requirePlatformAdmin] as const,
  request: { params: VideoUploadParam },
  responses: {
    204: { description: 'Загрузка отменена' },
    ...denied,
  },
});

export function adminVideoUploadCancelHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoUploadCancelRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const u = await adminTx(deps, c, (tx) => videoUpload(tx, id));
    if (u) {
      if (u.s3UploadId) await deps.storage.abortMultipart(u.storageKey, u.s3UploadId);
      else await dropFiles(deps, [u.storageKey]);
      await adminTx(deps, c, (tx) => dropVideoUpload(tx, id));
    }
    return c.body(null, 204);
  };
}

/* ───────────── Обложка ───────────── */

const coverTooLarge = () => apiError('video_cover', VIDEO_MESSAGES.video_cover);

/** Свой предел тела у обложки — 2 МБ (путь в `OWN_BODY_LIMIT_PATHS`). */
const coverBodyLimit = bodyLimit({
  maxSize: VIDEO_COVER_MAX_BYTES,
  onError: (c) => c.json(coverTooLarge(), 413),
});

const binary = { schema: z.string().openapi({ format: 'binary' }) };

export const adminVideoCoverRoute = createRoute({
  method: 'post',
  path: `${P}/covers`,
  tags: ['kb'],
  summary: 'Загрузить обложку: JPEG до 2 МБ телом запроса',
  middleware: [requirePlatformAdmin, coverBodyLimit] as const,
  request: { body: { required: true, content: { 'image/jpeg': binary } } },
  responses: {
    201: {
      description: 'Обложка в хранилище: код загрузки для формы',
      content: json(VideoCoverUploaded),
    },
    400: { description: 'Не JPEG (`video_cover`)', content: error },
    413: { description: 'Больше 2 МБ', content: error },
    429: { description: 'Слишком много загрузок за час', content: error },
    ...denied,
  },
});

/**
 * Обложка (прототип `vidShrink`, `frame`): браузер уменьшает свою картинку PNG или JPG до 960 px или
 * снимает кадр с первой секунды файла и присылает JPEG; сервер проверяет первые байты.
 */
export function adminVideoCoverHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminVideoCoverRoute, AppEnv> {
  return async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > VIDEO_COVER_MAX_BYTES) return c.json(coverTooLarge(), 413);
    if (!isJpeg(bytes)) fail(400, 'video_cover', 'cover');
    await uploadLimit(deps, c);
    const id = randomUUID();
    const key = platformFileKey(VIDEO_COVERS, id);
    await deps.storage.put(key, bytes, { contentType: 'image/jpeg' });
    await adminTx(deps, c, (tx) =>
      createVideoUpload(tx, {
        id,
        kind: 'cover',
        storageKey: key,
        s3UploadId: null,
        fileName: 'cover.jpg',
        sizeBytes: bytes.length,
        contentType: 'image/jpeg',
        state: 'ready',
      }),
    );
    return c.json({ id }, 201);
  };
}
