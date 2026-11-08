import {
  KB_HOWS,
  KB_KNOWN_KEY_MAX,
  VIDEO_AUDIENCES,
  VIDEO_DURATION_MAX,
  VIDEO_FILE_MAX_BYTES,
  VIDEO_KINDS,
  VIDEO_SOURCES,
  VIDEO_STATUSES,
} from '@buhuchet/domain';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { organizations } from './organizations';
import { appRole, currentOrgId } from './rls';
import { users } from './users';

const currentUserId = sql`app.current_user_id()`;

/*
 * «База знаний»: прогресс обучения каждого пользователя на сервере (ТЗ «Прогресс хранится на сервере
 * у каждого пользователя и не зависит от устройства»; задача 2.30, docs/decisions.md п. Г-2). Содержимое
 * шагов, статей и уровней — в `platform_reference` (refDB.json), здесь — только отметки пользователя.
 * Строки видит вся организация (уровни сотрудников у владельца и в «Сотрудниках»), а добавляет и
 * меняет пользователь только свои: шаг засчитывается тому, кто сам сделал действие. У администратора
 * платформы организации нет — его строки видит только он сам и только как незаблокированный
 * администратор (`app.is_platform_admin()`).
 */

/** Строки организации видны всем её пользователям, а пишутся только свои. */
function kbPolicies(table: string, t: { orgId: AnyPgColumn; userId: AnyPgColumn }) {
  const own: SQL = sql`${t.orgId} = ${currentOrgId} and ${t.userId} = ${currentUserId}`;
  return [
    pgPolicy(`${table}_isolation`, {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: sql`${t.orgId} = ${currentOrgId}`,
    }),
    pgPolicy(`${table}_own_insert`, {
      as: 'permissive',
      for: 'insert',
      to: appRole,
      withCheck: own,
    }),
    pgPolicy(`${table}_own_update`, {
      as: 'permissive',
      for: 'update',
      to: appRole,
      using: own,
      withCheck: own,
    }),
    pgPolicy(`${table}_platform_admin`, {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: sql`${t.orgId} is null and ${currentOrgId} is null and ${t.userId} = ${currentUserId} and app.is_platform_admin()`,
      withCheck: sql`${t.orgId} is null and ${currentOrgId} is null and ${t.userId} = ${currentUserId} and app.is_platform_admin()`,
    }),
  ];
}

const userColumns = () => ({
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Пусто — администратор платформы. */
  orgId: uuid('org_id')
    .default(currentOrgId)
    .references(() => organizations.id, { onDelete: 'restrict' }),
});

/**
 * Отметки шагов: выполнен (один раз и навсегда — способ и момент, ТЗ «Точные правила подсчёта») или
 * пропущен. Шаг — код из `kbSteps`; шаги, которых нет в программе пользователя, просто не считаются.
 * Удалять отметки нельзя (у роли приложения нет DELETE), менять — только способ, момент и пропуск.
 */
export const kbProgress = pgTable(
  'kb_progress',
  {
    ...userColumns(),
    stepId: text('step_id').notNull(),
    /** Как засчитан: `KbHow` из @buhuchet/domain. Пусто — не выполнен (только пропущен). */
    doneHow: text('done_how'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    /** «Пропустить»: шаг серый, в уровень не засчитывается; «Вернуть» — снова пусто. */
    skippedAt: timestamp('skipped_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'kb_progress_pk', columns: [t.userId, t.stepId] }),
    foreignKey({
      name: 'kb_progress_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    index('kb_progress_org_idx').on(t.orgId),
    check('kb_progress_step_check', sql`${t.stepId} ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`),
    check(
      'kb_progress_how_check',
      sql`${t.doneHow} is null or ${t.doneHow} in (${sql.raw(KB_HOWS.map((h) => `'${h}'`).join(', '))})`,
    ),
    check('kb_progress_done_check', sql`(${t.doneHow} is null) = (${t.doneAt} is null)`),
    ...kbPolicies('kb_progress', t),
  ],
).enableRLS();

/** Прочитанные статьи: открыта и прокручена до конца (ТЗ «Статья «прочитана»…»). */
export const kbArticleReads = pgTable(
  'kb_article_reads',
  {
    ...userColumns(),
    articleId: text('article_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'kb_article_reads_pk', columns: [t.userId, t.articleId] }),
    foreignKey({
      name: 'kb_article_reads_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    index('kb_article_reads_org_idx').on(t.orgId),
    check('kb_article_reads_article_check', sql`${t.articleId} ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`),
    ...kbPolicies('kb_article_reads', t),
  ],
).enableRLS();

/**
 * Полученные уровни с датами (ТЗ «Полученные уровни с датами»): уровень записывается, когда процент
 * его достиг, и не понижается. Номер — индекс в `kbLevels` (0 — «Новичок»).
 */
export const kbLevels = pgTable(
  'kb_levels',
  {
    ...userColumns(),
    level: smallint('level').notNull(),
    reachedAt: timestamp('reached_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'kb_levels_pk', columns: [t.userId, t.level] }),
    foreignKey({
      name: 'kb_levels_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    index('kb_levels_org_idx').on(t.orgId),
    check('kb_levels_level_check', sql`${t.level} between 0 and 20`),
    ...kbPolicies('kb_levels', t),
  ],
).enableRLS();

/**
 * Знакомые элементы показов (задача 2.31, ТЗ «Знакомые элементы»; docs/decisions.md п. Г-5): облачко,
 * с которого ушли «Далее» или «Готово», в следующих «Показать как» и «Обзоре экрана» пропускается.
 * Ключ — `kbKnownKey` из @buhuchet/domain. Список хранится у пользователя и общий для ПК и телефона;
 * видит, добавляет и удаляет («Показывать всё заново») его только сам пользователь — даже владелец
 * организации чужой список не видит. Менять строки нельзя (у роли приложения нет UPDATE).
 */
export const kbKnown = pgTable(
  'kb_known',
  {
    ...userColumns(),
    key: text('key').notNull(),
    knownAt: timestamp('known_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    const own: SQL = sql`${t.orgId} = ${currentOrgId} and ${t.userId} = ${currentUserId}`;
    const admin: SQL = sql`${t.orgId} is null and ${currentOrgId} is null and ${t.userId} = ${currentUserId} and app.is_platform_admin()`;
    return [
      primaryKey({ name: 'kb_known_pk', columns: [t.userId, t.key] }),
      foreignKey({
        name: 'kb_known_user_org_fk',
        columns: [t.userId, t.orgId],
        foreignColumns: [users.id, users.orgId],
      }).onDelete('cascade'),
      index('kb_known_org_idx').on(t.orgId),
      check(
        'kb_known_key_check',
        sql`char_length(${t.key}) between 3 and ${sql.raw(String(KB_KNOWN_KEY_MAX))} and ${t.key} ~ '^[gs]:'`,
      ),
      pgPolicy('kb_known_own', {
        as: 'permissive',
        for: 'all',
        to: appRole,
        using: own,
        withCheck: own,
      }),
      pgPolicy('kb_known_platform_admin', {
        as: 'permissive',
        for: 'all',
        to: appRole,
        using: admin,
        withCheck: admin,
      }),
    ];
  },
).enableRLS();

/* ───────────── Видео платформы (решение заказчика 08.11.2026, прототип v79) ───────────── */

const isPlatformAdmin = sql`app.is_platform_admin()`;
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * Видео платформы — для вкладки «Видео» Базы знаний, окна «?» модулей, статей, новостей, шагов уроков и
 * лендинга. Общие данные платформы: загружает, меняет и удаляет только администратор платформы (файл —
 * в хранилище, `platform/videos/<загрузка>`), опубликованные видят все вошедшие (какие именно — по
 * модулям меню и «Для кого» решает API). Удалённое видео остаётся строкой с отметкой `deleted_at`:
 * файл из хранилища удаляется, а статистика просмотров сохраняет название (ТЗ «пометка «удалено»»);
 * удалить строку приложение не может.
 */
export const videos = pgTable(
  'videos',
  {
    /** Код: `v` и 12 случайных знаков; на него ссылаются статьи, новости и шаги уроков. */
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    /** `VideoKind`: `instr` — видеоинструкция, `pres` — презентация. */
    kind: text('kind').notNull(),
    /** `VideoSource`: `file` — файл в хранилище, `yt` — ссылка YouTube. */
    source: text('source').notNull(),
    /** Код видео YouTube (11 знаков). */
    ytId: text('yt_id'),
    fileKey: text('file_key'),
    fileName: text('file_name'),
    fileSize: bigint('file_size', { mode: 'number' }),
    /** `video/mp4` или `video/webm` — по содержимому файла. */
    fileType: text('file_type'),
    /** Длительность в секундах; пусто — ещё неизвестна (YouTube до первого запуска). */
    duration: integer('duration'),
    /** Обложка — JPEG-копия в хранилище (`platform/video-covers/<id>`): своя или кадр видео. */
    coverKey: text('cover_key'),
    /** `own` — своя картинка, `frame` — кадр с первой секунды файла. */
    coverKind: text('cover_kind'),
    description: text('description').notNull().default(''),
    /** Модуль меню; пусто — «Общее». */
    module: text('module'),
    /** «Связанная статья» Базы знаний. */
    article: text('article'),
    /** «Порядок» — место в группе модуля. */
    ord: integer('ord').notNull().default(0),
    audience: text('audience').notNull().default('all'),
    status: text('status').notNull().default('draft'),
    /** «Снято с публикации». */
    off: boolean('off').notNull().default(false),
    /** «Показывать на лендинге» и «Порядок на лендинге». */
    landing: boolean('landing').notNull().default(false),
    landingOrd: integer('landing_ord').notNull().default(1),
    /** Видео удалено или закрыто на YouTube — пометка «YouTube: видео недоступно» в Админке. */
    ytBad: boolean('yt_bad').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    index('videos_module_idx').on(t.module),
    check('videos_id_check', sql`${t.id} ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`),
    check('videos_title_check', sql`char_length(${t.title}) between 1 and 120`),
    check('videos_description_check', sql`char_length(${t.description}) <= 1000`),
    check('videos_kind_check', sql`${t.kind} in (${inList(VIDEO_KINDS)})`),
    check('videos_source_check', sql`${t.source} in (${inList(VIDEO_SOURCES)})`),
    check('videos_audience_check', sql`${t.audience} in (${inList(VIDEO_AUDIENCES)})`),
    check('videos_status_check', sql`${t.status} in (${inList(VIDEO_STATUSES)})`),
    check(
      'videos_yt_check',
      sql`(${t.source} = 'yt') = (${t.ytId} is not null) and (${t.ytId} is null or ${t.ytId} ~ '^[A-Za-z0-9_-]{11}$')`,
    ),
    // У файла есть ключ в хранилище, пока видео не удалено (файл удаляется вместе с ним).
    check(
      'videos_file_check',
      sql`(${t.source} = 'file' and (${t.fileKey} is not null or ${t.deletedAt} is not null) and ${t.fileType} in ('video/mp4', 'video/webm') and ${t.fileSize} between 1 and ${sql.raw(String(VIDEO_FILE_MAX_BYTES))}) or (${t.source} = 'yt' and ${t.fileKey} is null)`,
    ),
    check(
      'videos_duration_check',
      sql`${t.duration} is null or ${t.duration} between 1 and ${sql.raw(String(VIDEO_DURATION_MAX))}`,
    ),
    check(
      'videos_cover_check',
      sql`(${t.coverKey} is null) = (${t.coverKind} is null) and (${t.coverKind} is null or ${t.coverKind} in ('own', 'frame'))`,
    ),
    check(
      'videos_module_check',
      sql`(${t.module} is null or ${t.module} ~ '^[a-z][a-z0-9]{0,31}$') and (${t.kind} <> 'instr' or ${t.module} is not null)`,
    ),
    check(
      'videos_article_check',
      sql`${t.article} is null or ${t.article} ~ '^[A-Za-z0-9_-]{1,64}$'`,
    ),
    check(
      'videos_ord_check',
      sql`${t.ord} between 0 and 100000 and ${t.landingOrd} between 1 and 100000`,
    ),
    check(
      'videos_published_check',
      sql`(${t.status} = 'published') = (${t.publishedAt} is not null)`,
    ),
    // «Показывать на лендинге» — только у опубликованного видео; удалённое с лендинга снимается.
    check(
      'videos_landing_check',
      sql`not ${t.landing} or (${t.status} = 'published' and ${t.deletedAt} is null)`,
    ),
    // Вошедшим — опубликованные, не снятые, не удалённые «для всех»; видео, которые смотрели сотрудники
    // организации, — ещё и снятые и удалённые: в статистике просмотров видно название с пометкой.
    pgPolicy('videos_read', {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: sql`${isPlatformAdmin} or (${t.status} = 'published' and not ${t.off} and ${t.deletedAt} is null and ${t.audience} = 'all') or exists (select 1 from video_views w where w.video_id = ${t.id})`,
    }),
    pgPolicy('videos_admin_insert', {
      as: 'permissive',
      for: 'insert',
      to: appRole,
      withCheck: isPlatformAdmin,
    }),
    pgPolicy('videos_admin_update', {
      as: 'permissive',
      for: 'update',
      to: appRole,
      using: isPlatformAdmin,
      withCheck: isPlatformAdmin,
    }),
  ],
).enableRLS();

/**
 * Загрузки администратора платформы, ещё не ставшие видео: файл, который браузер кладёт в хранилище
 * частями (`kind = video`, многочастная загрузка S3), и JPEG-обложка (`kind = cover`). Сохранение видео
 * забирает загрузку себе (строка удаляется), незаконченные и неиспользованные через сутки убирает
 * задача `kb.cleanup-video-uploads` (функции миграции — у неё нет администратора в контексте).
 */
export const videoUploads = pgTable(
  'video_uploads',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    /** Номер многочастной загрузки S3; у обложки и после окончания загрузки — пусто. */
    s3UploadId: text('s3_upload_id'),
    fileName: text('file_name').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    contentType: text('content_type').notNull(),
    /** `uploading` — части ещё идут; `ready` — файл проверен (или обложка положена). */
    state: text('state').notNull().default('uploading'),
    duration: integer('duration'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('video_uploads_created_idx').on(t.createdAt),
    check('video_uploads_kind_check', sql`${t.kind} in ('video', 'cover')`),
    check('video_uploads_state_check', sql`${t.state} in ('uploading', 'ready')`),
    check(
      'video_uploads_type_check',
      sql`(${t.kind} = 'video' and ${t.contentType} in ('video/mp4', 'video/webm')) or (${t.kind} = 'cover' and ${t.contentType} = 'image/jpeg')`,
    ),
    check(
      'video_uploads_size_check',
      sql`${t.sizeBytes} between 1 and ${sql.raw(String(VIDEO_FILE_MAX_BYTES))}`,
    ),
    // Свои загрузки — только незаблокированному администратору платформы.
    pgPolicy('video_uploads_admin', {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: sql`${isPlatformAdmin} and ${t.createdBy} = ${currentUserId}`,
      withCheck: sql`${isPlatformAdmin} and ${t.createdBy} = ${currentUserId}`,
    }),
  ],
).enableRLS();

/**
 * Строки просмотров организации видит вся организация (статистику — владелец и право «Видеть уровни
 * сотрудников», решает API), пишет пользователь только свои; администратор платформы читает все —
 * «Просмотры видео» в Админке по всем организациям (ТЗ). Его собственные просмотры не записываются.
 */
function videoViewPolicies(table: string, t: { orgId: AnyPgColumn; userId: AnyPgColumn }) {
  const own: SQL = sql`${t.orgId} = ${currentOrgId} and ${t.userId} = ${currentUserId}`;
  return [
    pgPolicy(`${table}_isolation`, {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: sql`${t.orgId} = ${currentOrgId}`,
    }),
    pgPolicy(`${table}_own_insert`, {
      as: 'permissive',
      for: 'insert',
      to: appRole,
      withCheck: own,
    }),
    pgPolicy(`${table}_own_update`, {
      as: 'permissive',
      for: 'update',
      to: appRole,
      using: own,
      withCheck: own,
    }),
    pgPolicy(`${table}_platform_admin_read`, {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: isPlatformAdmin,
    }),
  ];
}

const viewerColumns = () => ({
  orgId: uuid('org_id')
    .notNull()
    .default(currentOrgId)
    .references(() => organizations.id, { onDelete: 'restrict' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  videoId: text('video_id')
    .notNull()
    .references(() => videos.id, { onDelete: 'restrict' }),
});

/**
 * Просмотр видео сотрудником (прототип `videoViews`): проигранные отрезки (каждая секунда — один раз),
 * где остановился, «Просмотрено» (ставится один раз и не снимается), сколько раз открывал, первое
 * открытие и последний просмотр. Удалять строки нельзя (у роли приложения нет DELETE).
 */
export const videoViews = pgTable(
  'video_views',
  {
    ...viewerColumns(),
    /** Проигранные отрезки `[[с, по], …]` в секундах, слитые и по порядку. */
    segs: jsonb('segs')
      .$type<[number, number][]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Где остановился — для «Продолжить с 2:10». */
    pos: real('pos').notNull().default(0),
    doneAt: timestamp('done_at', { withTimezone: true }),
    opens: integer('opens').notNull().default(0),
    firstAt: timestamp('first_at', { withTimezone: true }).notNull().defaultNow(),
    /** Последнее открытие, в котором что-то проигралось. */
    lastAt: timestamp('last_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'video_views_pk', columns: [t.userId, t.videoId] }),
    foreignKey({
      name: 'video_views_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    index('video_views_org_idx').on(t.orgId, t.videoId),
    index('video_views_video_idx').on(t.videoId),
    check('video_views_segs_check', sql`jsonb_typeof(${t.segs}) = 'array'`),
    check('video_views_pos_check', sql`${t.pos} >= 0 and ${t.opens} >= 0`),
    ...videoViewPolicies('video_views', t),
  ],
).enableRLS();

/**
 * Одно открытие окна видео (ТЗ «По каждому открытию запоминаются дата и время, с какой по какую секунду
 * смотрели и сколько секунд проигралось»): окно открыли — строка, без запуска — с пустыми отрезками.
 */
export const videoSessions = pgTable(
  'video_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...viewerColumns(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    segs: jsonb('segs')
      .$type<[number, number][]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'video_sessions_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    index('video_sessions_view_idx').on(t.orgId, t.userId, t.videoId, t.openedAt),
    index('video_sessions_video_idx').on(t.videoId),
    check('video_sessions_segs_check', sql`jsonb_typeof(${t.segs}) = 'array'`),
    ...videoViewPolicies('video_sessions', t),
  ],
).enableRLS();

/**
 * Просмотры гостей лендинга — только общим числом по видео (ТЗ «без имён, адресов и сторонних
 * счётчиков»): сколько раз запустили и сумма процентов просмотра. Пишет функция миграции
 * `app.video_guest_add` (у гостя нет контекста), читает администратор платформы.
 */
export const videoGuestStats = pgTable(
  'video_guest_stats',
  {
    videoId: text('video_id')
      .primaryKey()
      .references(() => videos.id, { onDelete: 'cascade' }),
    starts: integer('starts').notNull().default(0),
    pctSum: real('pct_sum').notNull().default(0),
  },
  (t) => [
    check('video_guest_stats_check', sql`${t.starts} >= 0 and ${t.pctSum} >= 0`),
    pgPolicy('video_guest_stats_admin_read', {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: isPlatformAdmin,
    }),
  ],
).enableRLS();
