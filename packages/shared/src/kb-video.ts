import {
  VIDEO_AUDIENCES,
  VIDEO_DESC_MAX,
  VIDEO_DURATION_MAX,
  VIDEO_FILE_MAX_BYTES,
  VIDEO_KINDS,
  VIDEO_MAX_PARTS,
  VIDEO_SEGMENTS_MAX,
  VIDEO_SOURCES,
  VIDEO_STATUSES,
  VIDEO_TITLE_MAX,
  VIDEO_VIEW_STATUSES,
} from '@buhuchet/domain';
import { z } from 'zod';
import { RecordVersion, Uuid } from './common';
import { listPageSchema } from './list';

/*
 * Видео платформы (решение заказчика 08.11.2026, прототип v79 modules/video.js и
 * admin/video-admin.js): окно видео, вкладки «Видео» и «Просмотры видео» Базы знаний, Админка →
 * «Видео» с загрузкой файла частями, видео на лендинге.
 */

/** Код видео (`v` и 12 знаков; у видео из файла Excel — свой). */
export const VideoId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
export const VideoKindSchema = z.enum(VIDEO_KINDS);
export const VideoSourceSchema = z.enum(VIDEO_SOURCES);
export const VideoAudienceSchema = z.enum(VIDEO_AUDIENCES);
export const VideoStatusSchema = z.enum(VIDEO_STATUSES);
export const VideoViewStatusSchema = z.enum(VIDEO_VIEW_STATUSES);

/** Проигранный отрезок `[с, по]` в секундах. */
export const VideoSegmentSchema = z.tuple([z.number(), z.number()]);

/** Свой просмотр видео: отрезки, где остановился, «Просмотрено». */
export const VideoView = z.object({
  segs: z.array(VideoSegmentSchema),
  pos: z.number(),
  status: VideoViewStatusSchema,
  /** Просмотренные секунды (не больше длительности) и процент. */
  secs: z.number(),
  pct: z.number().int(),
  doneAt: z.iso.datetime().nullable(),
  opens: z.number().int(),
});
export type VideoView = z.infer<typeof VideoView>;

/** Видео для окна, вкладки «Видео», «?» модуля и кнопок в статьях и новостях. */
export const VideoItem = z.object({
  id: VideoId,
  title: z.string(),
  kind: VideoKindSchema,
  source: VideoSourceSchema,
  /** Код видео YouTube; у файла — null. */
  ytId: z.string().nullable(),
  /** Длительность в секундах; null — ещё неизвестна. */
  duration: z.number().int().nullable(),
  /** Модуль меню; null — «Общее». */
  module: z.string().nullable(),
  /** Название группы модуля: «Контрагенты», «Админка · Организации» или «Общее». */
  moduleTitle: z.string(),
  article: z.string().nullable(),
  ord: z.number().int(),
  description: z.string(),
  /** Своя обложка или кадр видео — `GET /api/kb/videos/{id}/cover`. */
  cover: z.boolean(),
  status: VideoStatusSchema,
  off: z.boolean(),
  publishedAt: z.iso.datetime().nullable(),
  /** «Новое»: видеоинструкция, которую пользователь ещё не открывал. */
  isNew: z.boolean(),
  /** Свой просмотр; у администратора платформы (его просмотры не учитываются) — null. */
  view: VideoView.nullable(),
});
export type VideoItem = z.infer<typeof VideoItem>;

/** Все видео, доступные пользователю, по порядку групп модулей. */
export const VideoCatalog = z.object({
  items: z.array(VideoItem),
  /** Учитываются ли просмотры (не администратор платформы). */
  tracked: z.boolean(),
});
export type VideoCatalog = z.infer<typeof VideoCatalog>;

/** Вкладка «Видео»: страница общего списка и плашка «Не просмотренные». */
export const VideoList = listPageSchema(VideoItem).extend({
  unseen: z.number().int(),
  tracked: z.boolean(),
});
export type VideoList = z.infer<typeof VideoList>;

export const VideoIdParam = z.object({ id: VideoId });

/** Чем играть: подписанная ссылка на файл (на 2 часа) или код YouTube. */
export const VideoPlay = z.union([
  z.object({
    kind: z.literal('file'),
    url: z.string(),
    type: z.string(),
    expiresAt: z.iso.datetime(),
  }),
  z.object({ kind: z.literal('yt'), ytId: z.string() }),
]);
export type VideoPlay = z.infer<typeof VideoPlay>;

/** Окно видео открыто: видео, чем играть, своё открытие (у администратора платформы — нет). */
export const VideoOpened = z.object({
  video: VideoItem,
  play: VideoPlay,
  session: Uuid.nullable(),
});
export type VideoOpened = z.infer<typeof VideoOpened>;

export const VideoSessionParam = z.object({ id: VideoId, sessionId: Uuid });

/** Что проигралось в этом открытии окна (все отрезки открытия) и где остановился. */
export const VideoProgressInput = z.object({
  segs: z.array(z.tuple([z.number().min(0), z.number().min(0)])).max(VIDEO_SEGMENTS_MAX),
  pos: z.number().min(0).max(VIDEO_DURATION_MAX),
});
export type VideoProgressInput = z.infer<typeof VideoProgressInput>;

/** Засчитанный просмотром видео шаг урока. */
export const VideoStepDone = z.object({ id: z.string(), title: z.string() });

export const VideoProgressSaved = z.object({
  view: VideoView,
  /** «Просмотрено» поставлено этим сохранением. */
  done: z.boolean(),
  /** Шаги «Посмотреть» с этим видео, засчитанные сейчас. */
  steps: z.array(VideoStepDone),
});
export type VideoProgressSaved = z.infer<typeof VideoProgressSaved>;

/** Что узнал плеер: длительность (YouTube, WebM без длительности) и играет ли видео на YouTube. */
export const VideoMetaInput = z.object({
  duration: z.number().int().min(1).max(VIDEO_DURATION_MAX).optional(),
  ytOk: z.boolean().optional(),
});
export type VideoMetaInput = z.infer<typeof VideoMetaInput>;

/* ───────────── «Просмотры видео» ───────────── */

/** Строка «Просмотров видео»: сотрудник и доступная ему видеоинструкция. */
export const VideoViewRow = z.object({
  id: z.string(),
  orgName: z.string(),
  userId: Uuid,
  fullName: z.string(),
  role: z.string(),
  videoId: VideoId,
  /** Название; удалённое — с пометкой «(удалено)». */
  videoTitle: z.string(),
  deleted: z.boolean(),
  moduleTitle: z.string(),
  duration: z.number().int().nullable(),
  secs: z.number(),
  pct: z.number().int(),
  status: VideoViewStatusSchema,
  opens: z.number().int(),
  firstAt: z.iso.datetime().nullable(),
  lastAt: z.iso.datetime().nullable(),
});
export type VideoViewRow = z.infer<typeof VideoViewRow>;

/** Сводка над списком: по всем строкам, без фильтров (прототип `renderKbVViews`). */
export const VideoViewStats = z.object({
  videos: z.number().int(),
  /** «Просмотрено полностью», % строк. */
  donePct: z.number().int(),
  /** Сотрудники, не начавшие ни одной видеоинструкции. */
  idle: z.number().int(),
  none: z.number().int(),
  started: z.number().int(),
  done: z.number().int(),
});

/** Сводка по видео в Админке: организаций, сотрудников, «Просмотрено», средний процент. */
export const VideoAdminSummaryRow = z.object({
  videoId: VideoId,
  title: z.string(),
  kind: VideoKindSchema,
  deleted: z.boolean(),
  orgs: z.number().int(),
  viewers: z.number().int(),
  done: z.number().int(),
  avgPct: z.number().int(),
});

/** Гости лендинга по видео: запусков и средний процент. */
export const VideoGuestRow = z.object({
  videoId: VideoId,
  title: z.string(),
  starts: z.number().int(),
  avgPct: z.number().int(),
});

export const VideoViewList = listPageSchema(VideoViewRow).extend({
  stats: VideoViewStats,
  /** Только в Админке. */
  summary: z.array(VideoAdminSummaryRow).optional(),
  guests: z.array(VideoGuestRow).optional(),
});
export type VideoViewList = z.infer<typeof VideoViewList>;

export const VideoViewParam = z.object({ userId: Uuid, videoId: VideoId });

/** «История просмотров» сотрудника по видео. */
export const VideoViewHistory = z.object({
  fullName: z.string(),
  orgName: z.string(),
  videoTitle: z.string(),
  duration: z.number().int().nullable(),
  segs: z.array(VideoSegmentSchema),
  secs: z.number(),
  pct: z.number().int(),
  status: VideoViewStatusSchema,
  doneAt: z.iso.datetime().nullable(),
  sessions: z.array(
    z.object({
      at: z.iso.datetime(),
      segs: z.array(VideoSegmentSchema),
      secs: z.number(),
    }),
  ),
});
export type VideoViewHistory = z.infer<typeof VideoViewHistory>;

/* ───────────── Админка → «Видео» ───────────── */

/** Видео в списке и карточке Админки. */
export const VideoAdminItem = z.object({
  id: VideoId,
  title: z.string(),
  kind: VideoKindSchema,
  source: VideoSourceSchema,
  ytId: z.string().nullable(),
  fileName: z.string().nullable(),
  fileSize: z.number().int().nullable(),
  duration: z.number().int().nullable(),
  /** `own` — своя картинка, `frame` — кадр видео; null — рисованная (у YouTube — обложка YouTube). */
  coverKind: z.enum(['own', 'frame']).nullable(),
  description: z.string(),
  module: z.string().nullable(),
  moduleTitle: z.string(),
  article: z.string().nullable(),
  ord: z.number().int(),
  audience: VideoAudienceSchema,
  status: VideoStatusSchema,
  off: z.boolean(),
  landing: z.boolean(),
  landingOrd: z.number().int(),
  ytBad: z.boolean(),
  viewers: z.number().int(),
  updatedAt: z.iso.datetime(),
  version: RecordVersion,
});
export type VideoAdminItem = z.infer<typeof VideoAdminItem>;

export const VideoAdminList = listPageSchema(VideoAdminItem).extend({
  /** Подпись над списком: видео, опубликовано, занято байт. */
  summary: z.object({
    count: z.number().int(),
    published: z.number().int(),
    bytes: z.number(),
  }),
});
export type VideoAdminList = z.infer<typeof VideoAdminList>;

/** Карточка видео в Админке: поля, история, гости лендинга, чем играть. */
export const VideoAdminCard = z.object({
  video: VideoAdminItem,
  articleTitle: z.string().nullable(),
  guests: z.number().int(),
  play: VideoPlay.nullable(),
  history: z.array(
    z.object({ at: z.iso.datetime(), kind: z.string(), actor: z.string().nullable() }),
  ),
});
export type VideoAdminCard = z.infer<typeof VideoAdminCard>;

/** Обложка в форме: оставить как есть, убрать или новая загрузка (своя картинка или кадр видео). */
export const VideoCoverInput = z.union([
  z.literal('keep'),
  z.literal('none'),
  z.object({ upload: Uuid, kind: z.enum(['own', 'frame']) }),
]);

/** Поля формы видео (прототип `vidEditDlg`). */
export const VideoAdminFields = z.object({
  title: z.string().max(VIDEO_TITLE_MAX * 2),
  kind: VideoKindSchema,
  source: VideoSourceSchema,
  /** Ссылка YouTube как вставлена. */
  yt: z.string().max(500).optional(),
  /** Загруженный и проверенный файл: новый (загрузка) или прежний (нет поля). */
  upload: Uuid.optional(),
  /** Длительность YouTube из предпросмотра. */
  ytDuration: z.number().int().min(1).max(VIDEO_DURATION_MAX).optional(),
  cover: VideoCoverInput,
  description: z.string().max(VIDEO_DESC_MAX * 2),
  module: z.string().max(40).nullable(),
  article: z.string().max(64).nullable(),
  ord: z.number().int().min(0).max(100000),
  audience: VideoAudienceSchema,
  /** «Показывать на лендинге» и порядок — только у опубликованного видео. */
  landing: z.boolean().optional(),
  landingOrd: z.number().int().min(1).max(100000).optional(),
});
export type VideoAdminFields = z.infer<typeof VideoAdminFields>;

export const VideoAdminCreate = VideoAdminFields.extend({ publish: z.boolean() });
export const VideoAdminUpdate = VideoAdminFields.extend({
  version: RecordVersion,
  publish: z.boolean().optional(),
});
export const VideoAdminVersion = z.object({ version: RecordVersion });
export const VideoAdminOff = z.object({ version: RecordVersion, off: z.boolean() });
export const VideoAdminVersionQuery = z.object({ version: z.coerce.number().int().nonnegative() });

/** Ответ записи: видео и что сказать (замена сохранила ссылки и просмотры). */
export const VideoAdminSaved = z.object({ video: VideoAdminItem, replaced: z.boolean() });

/** Видео для выбора в редакторах новостей, статей и шагов. */
export const VideoOption = z.object({
  id: VideoId,
  title: z.string(),
  kind: VideoKindSchema,
  moduleTitle: z.string(),
  duration: z.number().int().nullable(),
  live: z.boolean(),
  /** Черновик: в списке ссылок новости — «(черновик)». */
  draft: z.boolean(),
});
export type VideoOption = z.infer<typeof VideoOption>;
export const VideoOptions = z.object({ items: z.array(VideoOption) });

/* ───────────── Загрузка файла частями ───────────── */

export const VideoUploadStart = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().min(1).max(VIDEO_FILE_MAX_BYTES),
  type: z.string().max(100).optional(),
});

export const VideoUploadStarted = z.object({
  id: Uuid,
  partSize: z.number().int(),
  parts: z.number().int(),
});

export const VideoUploadParam = z.object({ id: Uuid });

export const VideoPartsInput = z.object({
  numbers: z.array(z.number().int().min(1).max(VIDEO_MAX_PARTS)).min(1).max(20),
});

export const VideoPartLinks = z.object({
  links: z.array(z.object({ number: z.number().int(), url: z.string() })),
  expiresAt: z.iso.datetime(),
});

/** Какие части уже в хранилище — для «Продолжить» после обрыва. */
export const VideoUploadState = z.object({
  parts: z.array(z.object({ number: z.number().int(), size: z.number().int() })),
  partSize: z.number().int(),
  size: z.number().int(),
});

export const VideoUploadChecked = z.object({
  id: Uuid,
  type: z.enum(['video/mp4', 'video/webm']),
  duration: z.number().int().nullable(),
});

export const VideoCoverUploaded = z.object({ id: Uuid });

/* ───────────── Лендинг ───────────── */

/** Видео на лендинге: без статистики и модулей; обложка своя, без внешних запросов. */
export const LandingVideo = z.object({
  id: VideoId,
  title: z.string(),
  kind: VideoKindSchema,
  source: VideoSourceSchema,
  ytId: z.string().nullable(),
  duration: z.number().int().nullable(),
  description: z.string(),
  cover: z.boolean(),
});
export type LandingVideo = z.infer<typeof LandingVideo>;

export const LandingVideoWatched = z.object({ pct: z.number().min(0).max(100) });
