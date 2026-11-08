import {
  auditActorName,
  bishkekDate,
  isMenuModuleId,
  KB_MODULE_TITLES,
  VIDEO_SEGMENTS_MAX,
  videoLive,
  videoPct,
  videoReachedDone,
  videoSecs,
  videoSegLen,
  videoSegMerge,
  videoViewStatus,
  type ListQuery,
  type ListSort,
  type VideoAudience,
  type VideoKind,
  type VideoSegment,
  type VideoSource,
  type VideoStatus,
  type VideoViewStatus,
} from '@buhuchet/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Db, Tx } from './client';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumn,
  type ListColumns,
  type ListFrom,
  type ListTexts,
} from './list';
import { readPlatformHistory, writePlatformHistory } from './platform-history';
import { videoGuestStats, videos, videoSessions, videoUploads, videoViews } from './schema';

/*
 * Видео платформы (решение заказчика 08.11.2026, прототип v79 modules/video.js и admin/video-admin.js):
 * записи видео, загрузки файлов, просмотры сотрудников по открытиям, гости лендинга. Видео меняет
 * только администратор платформы (`withUserContext`), свои просмотры пишет пользователь в контексте
 * своей организации (`withOrgContext`), длительность, «YouTube: видео недоступно» и гостей лендинга —
 * узкие функции миграции 0106. История видео — в истории платформы (`platform_dict`, `video:<код>`),
 * рядом с историей вкладок «Базы знаний (содержимое)».
 */

export type VideoRecord = typeof videos.$inferSelect;
export type VideoViewRecord = typeof videoViews.$inferSelect;
export type VideoUploadRecord = typeof videoUploads.$inferSelect;

/** Раздел истории видео: `video:<код>`. */
export const VIDEO_HISTORY_SECTION = 'video';

const segsOf = (value: unknown): VideoSegment[] =>
  Array.isArray(value)
    ? value.filter(
        (x): x is [number, number] =>
          Array.isArray(x) && typeof x[0] === 'number' && typeof x[1] === 'number',
      )
    : [];

/** Видимость записи для правил домена. */
export const videoVisibilityOf = (v: VideoRecord) => ({
  status: v.status as VideoStatus,
  off: v.off,
  deleted: v.deletedAt !== null,
  audience: v.audience as VideoAudience,
  module: v.module,
  landing: v.landing,
});

/** Название группы модуля: модуль меню или «Общее» (прототип `vidModT`). */
export function videoModuleTitle(t: ListTexts, module: string | null): string {
  if (!module) return t('video.mod.none');
  return isMenuModuleId(module) ? t(KB_MODULE_TITLES[module]) : module;
}

/* ───────────── Чтение видео ───────────── */

/** Видео, которые видит контекст (RLS): администратору — все, остальным — опубликованные и просмотренные. */
export async function videoRecords(tx: Tx, options: { withDeleted?: boolean } = {}) {
  return tx
    .select()
    .from(videos)
    .where(options.withDeleted ? undefined : isNull(videos.deletedAt))
    .orderBy(asc(videos.ord), asc(videos.title));
}

export async function videoRecord(tx: Tx | Db, id: string): Promise<VideoRecord | null> {
  const [row] = await tx.select().from(videos).where(eq(videos.id, id));
  return row ?? null;
}

/** Свой просмотр видео (или нескольких): по коду видео. */
export async function ownVideoViews(
  tx: Tx,
  userId: string,
  videoIds?: readonly string[],
): Promise<Map<string, VideoViewRecord>> {
  if (videoIds && !videoIds.length) return new Map();
  const rows = await tx
    .select()
    .from(videoViews)
    .where(
      and(
        eq(videoViews.userId, userId),
        videoIds ? inArray(videoViews.videoId, [...videoIds]) : undefined,
      ),
    );
  return new Map(rows.map((r) => [r.videoId, r]));
}

/** Просмотр для ответа: отрезки, процент, статус. */
export function videoViewBody(view: VideoViewRecord | null | undefined, duration: number | null) {
  const segs = segsOf(view?.segs);
  return {
    segs: segs.map((s) => [s[0], s[1]] as [number, number]),
    pos: view?.pos ?? 0,
    status: videoViewStatus(view ? { done: view.doneAt !== null, segs } : null),
    secs: Math.round(videoSecs(duration, segs) * 10) / 10,
    pct: videoPct(duration, segs),
    doneAt: view?.doneAt?.toISOString() ?? null,
    opens: view?.opens ?? 0,
  };
}

/* ───────────── Открытия и прогресс ───────────── */

/**
 * Окно видео открыто сотрудником (прототип `vidPlayer`: `rec.ses.push`): +1 к «Открывал, раз», новая
 * строка открытия без отрезков. Организация — из контекста.
 */
export async function openVideoSession(
  tx: Tx,
  userId: string,
  videoId: string,
  now: Date,
): Promise<{ sessionId: string; view: VideoViewRecord }> {
  const [view] = await tx
    .insert(videoViews)
    .values({ userId, videoId, opens: 1, firstAt: now })
    .onConflictDoUpdate({
      target: [videoViews.userId, videoViews.videoId],
      set: { opens: sql`${videoViews.opens} + 1`, updatedAt: sql`now()` },
    })
    .returning();
  const [session] = await tx
    .insert(videoSessions)
    .values({ userId, videoId, openedAt: now })
    .returning({ id: videoSessions.id });
  return { sessionId: session!.id, view: view! };
}

/** Своё открытие (RLS: организация из контекста; пользователь сверяется здесь). */
export async function ownVideoSession(tx: Tx, sessionId: string, userId: string, videoId: string) {
  const [row] = await tx
    .select()
    .from(videoSessions)
    .where(
      and(
        eq(videoSessions.id, sessionId),
        eq(videoSessions.userId, userId),
        eq(videoSessions.videoId, videoId),
      ),
    );
  return row ?? null;
}

/** Сколько недавних открытий сверяется при сохранении просмотра (открытия ограничены частотой). */
export const VIDEO_RECENT_SESSIONS = 20;

/**
 * Перед сохранением просмотра: строка просмотра пользователя блокируется до конца транзакции (сохранения
 * одного видео из нескольких окон идут по очереди), затем — недавние открытия этого видео (с `since`,
 * не больше `VIDEO_RECENT_SESSIONS`) с их отрезками и временем открытия.
 */
export async function recentVideoSessions(
  tx: Tx,
  userId: string,
  videoId: string,
  since: Date,
): Promise<{ id: string; openedAt: Date; segs: VideoSegment[] }[]> {
  await tx
    .select({ userId: videoViews.userId })
    .from(videoViews)
    .where(and(eq(videoViews.userId, userId), eq(videoViews.videoId, videoId)))
    .for('update');
  const rows = await tx
    .select({ id: videoSessions.id, openedAt: videoSessions.openedAt, segs: videoSessions.segs })
    .from(videoSessions)
    .where(
      and(
        eq(videoSessions.userId, userId),
        eq(videoSessions.videoId, videoId),
        gte(videoSessions.openedAt, since),
      ),
    )
    .orderBy(desc(videoSessions.openedAt))
    .limit(VIDEO_RECENT_SESSIONS);
  return rows.map((r) => ({ id: r.id, openedAt: r.openedAt, segs: segsOf(r.segs) }));
}

/**
 * Сохранить прогресс открытия (прототип: каждые 15 секунд, при паузе и закрытии): отрезки открытия —
 * все, что проигралось в нём (сливаются с прежними), отрезки просмотра — объединение всех открытий;
 * набралось 90 % — «Просмотрено» (один раз, не снимается). Отвечает просмотром и тем, поставлено ли
 * «Просмотрено» сейчас.
 */
export async function saveVideoProgress(
  tx: Tx,
  input: {
    session: typeof videoSessions.$inferSelect;
    segs: readonly VideoSegment[];
    pos: number;
    duration: number | null;
  },
): Promise<{ view: VideoViewRecord; doneNow: boolean } | null> {
  const { session } = input;
  const sessionSegs = videoSegMerge(segsOf(session.segs), input.segs);
  if (sessionSegs.length > VIDEO_SEGMENTS_MAX) return null;
  await tx
    .update(videoSessions)
    .set({ segs: sessionSegs.map((s) => [s[0], s[1]]), updatedAt: sql`now()` })
    .where(eq(videoSessions.id, session.id));
  const [current] = await tx
    .select()
    .from(videoViews)
    .where(and(eq(videoViews.userId, session.userId), eq(videoViews.videoId, session.videoId)))
    .for('update');
  const segs = videoSegMerge(segsOf(current?.segs), sessionSegs);
  // Отрезков просмотра (всех открытий) не больше 2 000: сохранение не принимается, транзакция отменяется.
  if (segs.length > VIDEO_SEGMENTS_MAX) return null;
  const doneNow = !current?.doneAt && videoReachedDone(input.duration, segs);
  const played = videoSegLen(sessionSegs) > 0;
  const [view] = await tx
    .update(videoViews)
    .set({
      segs: segs.map((s) => [s[0], s[1]]),
      pos: Math.round(input.pos * 10) / 10,
      ...(doneNow ? { doneAt: sql`now()` } : {}),
      ...(played ? { lastAt: session.openedAt } : {}),
      updatedAt: sql`now()`,
    })
    .where(and(eq(videoViews.userId, session.userId), eq(videoViews.videoId, session.videoId)))
    .returning();
  return { view: view!, doneNow };
}

/** Длительность стала известна у зрителя (функция миграции 0106: только пока неизвестна). */
export async function setVideoDuration(tx: Tx, id: string, duration: number): Promise<boolean> {
  const [r] = await tx.execute<{ ok: boolean }>(
    sql`select app.video_set_duration(${id}, ${duration}) as ok`,
  );
  return r?.ok === true;
}

/** «YouTube: видео недоступно» — или снова играет (функция миграции 0106). */
export async function setVideoYtBad(tx: Tx, id: string, bad: boolean): Promise<boolean> {
  const [r] = await tx.execute<{ ok: boolean }>(
    sql`select app.video_set_yt_bad(${id}, ${bad}) as ok`,
  );
  return r?.ok === true;
}

/** Гость лендинга запустил видео или закрыл окно (функция миграции 0106, без контекста). */
export async function addVideoGuest(
  db: Db,
  id: string,
  start: boolean,
  pct: number,
): Promise<boolean> {
  const [r] = await db.execute<{ ok: boolean }>(
    sql`select app.video_guest_add(${id}, ${start}, ${pct}::real) as ok`,
  );
  return r?.ok === true;
}

/* ───────────── Лендинг ───────────── */

/**
 * Видео на лендинге (прототип `vidLand`): опубликованные, «Показывать на лендинге», для всех; по
 * «Порядку на лендинге». Читается без контекста — политика `videos_read` открывает их и гостю.
 */
export async function landingVideoRecords(db: Db | Tx): Promise<VideoRecord[]> {
  return db
    .select()
    .from(videos)
    .where(
      and(
        eq(videos.status, 'published'),
        eq(videos.off, false),
        isNull(videos.deletedAt),
        eq(videos.landing, true),
        eq(videos.audience, 'all'),
      ),
    )
    .orderBy(asc(videos.landingOrd), asc(videos.ord), asc(videos.title));
}

/* ───────────── Списки из посчитанных строк ───────────── */

type SqlType = 'text' | 'integer' | 'real' | 'date' | 'timestamptz' | 'boolean';

/** Столбец списка из посчитанных строк: тип, подпись, тип в SQL и поле сортировки. */
interface RowColumn {
  type: ListColumn['type'];
  label: string;
  sqlType: SqlType;
  /** Сортировать по другому полю строки (число, порядок), а не по тексту столбца. */
  sortBy?: { key: string; sqlType: SqlType };
  /** Искать ещё и по другому полю строки (название — и по описанию, прототип `searchText`). */
  searchAlso?: string;
}

/** Поле строки `jsonb_to_recordset`: имена — постоянные, не ввод пользователя. */
const field = (key: string) => sql.raw(`"r"."${key}"`);

interface RowList<R extends { id: string }> {
  rows: readonly R[];
  source: SQL;
  columns: ListColumns;
}

/**
 * Строки, посчитанные в коде, одним параметром запроса (`jsonb_to_recordset`): поиск, фильтры,
 * сортировка, группы и выгрузка — общим механизмом списков (как «Уровни сотрудников»).
 */
function rowList<R extends { id: string }>(
  rows: readonly R[],
  defs: Readonly<Record<string, RowColumn>>,
  cell: (row: R, key: string) => unknown,
): RowList<R> {
  const keys = Object.keys(defs);
  const records = rows.map((r, n) => {
    const out: Record<string, unknown> = { id: r.id, n };
    for (const k of keys) {
      out[k] = cell(r, k);
      const by = defs[k]!.sortBy;
      if (by) out[by.key] = cell(r, by.key);
      const also = defs[k]!.searchAlso;
      if (also) out[also] = cell(r, also);
    }
    return out;
  });
  const types = new Map<string, SqlType>([
    ['id', 'text'],
    ['n', 'integer'],
  ]);
  for (const k of keys) {
    types.set(k, defs[k]!.sqlType);
    const by = defs[k]!.sortBy;
    if (by) types.set(by.key, by.sqlType);
    const also = defs[k]!.searchAlso;
    if (also) types.set(also, 'text');
  }
  const defsSql = [...types].map(([k, t]) => `"${k}" ${t}`).join(', ');
  const columns: Record<string, ListColumn> = {};
  for (const k of keys) {
    const d = defs[k]!;
    columns[k] = {
      type: d.type,
      label: d.label,
      value: field(k),
      ...(d.sortBy ? { sort: { value: field(d.sortBy.key), text: false } } : {}),
      ...(d.searchAlso
        ? { searchDisplay: sql`concat_ws(' ', ${field(k)}, ${field(d.searchAlso)})` }
        : {}),
    };
  }
  return {
    rows,
    columns,
    source: sql`jsonb_to_recordset(${JSON.stringify(records)}::jsonb) as r(${sql.raw(defsSql)})`,
  };
}

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

async function rowListPage<R extends { id: string }>(
  tx: Tx,
  list: RowList<R>,
  query: ListQuery,
  defaultSort: ListSort,
) {
  const byId = new Map(list.rows.map((r) => [r.id, r]));
  const page = await selectListPage({
    query,
    columns: list.columns,
    natural: [field('n')],
    defaultSort,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ id: sql<string>`${field('id')}`, ...window })
        .from(list.source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: fromOf(tx, list.source),
  });
  return { ...page, rows: page.rows.map((r) => byId.get(r.id)!) };
}

function rowListValues<R extends { id: string }>(
  tx: Tx,
  list: RowList<R>,
  key: string,
  q?: string,
) {
  return selectListValues({
    columns: list.columns,
    key,
    scope: undefined,
    from: fromOf(tx, list.source),
    q,
  });
}

function rowListExport<R extends { id: string }>(
  tx: Tx,
  list: RowList<R>,
  query: ListQuery,
  keys: readonly string[],
  defaultSort: ListSort,
) {
  return selectListExport({
    query,
    columns: list.columns,
    keys,
    natural: [field('n')],
    defaultSort,
    scope: undefined,
    from: fromOf(tx, list.source),
  });
}

/** Длительность «3:25» (прототип `vidT`). */
function clock(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const c = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${c}` : `${m}:${c}`;
}

/* ───────────── Вкладка «Видео» Базы знаний ───────────── */

/** Видео для вкладки: запись, группа модуля, место группы и свой просмотр. */
export interface LearnerVideoRow {
  id: string;
  video: VideoRecord;
  moduleTitle: string;
  moduleOrder: number;
  view: VideoViewRecord | null;
  /** Учитываются ли просмотры (не администратор). */
  tracked: boolean;
}

const VIDEO_TAB_COLUMNS: Readonly<Record<string, RowColumn>> = {
  title: { type: 'text', label: 'video.col.title', sqlType: 'text', searchAlso: 'description' },
  kind: { type: 'enum', label: 'video.col.kind', sqlType: 'text' },
  module: {
    type: 'enum',
    label: 'video.col.module',
    sqlType: 'text',
    sortBy: { key: 'module_ord', sqlType: 'integer' },
  },
  duration: {
    type: 'text',
    label: 'video.col.duration',
    sqlType: 'text',
    sortBy: { key: 'duration_s', sqlType: 'integer' },
  },
  pct: { type: 'int', label: 'video.col.pct', sqlType: 'integer' },
  seen: { type: 'enum', label: 'video.col.seen', sqlType: 'text' },
  ord: { type: 'int', label: 'video.col.ord', sqlType: 'integer' },
  published: { type: 'date', label: 'video.col.published', sqlType: 'date' },
};

/** «Видео»: по порядку видео внутри групп модулей (прототип `sort:{key:'ord'}`, группы — модуль). */
export const VIDEO_TAB_SORT: ListSort = { key: 'ord', dir: 'asc' };

function videoTabList(rows: readonly LearnerVideoRow[], t: ListTexts) {
  return rowList(rows, VIDEO_TAB_COLUMNS, (r, k) => {
    const v = r.video;
    const segs = segsOf(r.view?.segs);
    switch (k) {
      case 'title':
        return v.title;
      case 'description':
        return v.description;
      case 'kind':
        return t(`video.kind.${v.kind}`);
      case 'module':
        return r.moduleTitle;
      case 'module_ord':
        return r.moduleOrder;
      case 'duration':
        return clock(v.duration);
      case 'duration_s':
        return v.duration ?? 0;
      case 'pct':
        return r.tracked ? videoPct(v.duration, segs) : null;
      case 'seen':
        return r.tracked
          ? t(
              `video.view.${videoViewStatus(r.view ? { done: r.view.doneAt !== null, segs } : null)}`,
            )
          : '—';
      case 'ord':
        return v.ord;
      case 'published':
        return v.publishedAt ? bishkekDate(v.publishedAt) : null;
      default:
        return null;
    }
  });
}

export function listVideoTabPage(
  tx: Tx,
  rows: readonly LearnerVideoRow[],
  query: ListQuery,
  t: ListTexts,
) {
  return rowListPage(tx, videoTabList(rows, t), query, VIDEO_TAB_SORT);
}

export function listVideoTabValues(
  tx: Tx,
  rows: readonly LearnerVideoRow[],
  key: string,
  t: ListTexts,
  q?: string,
) {
  return rowListValues(tx, videoTabList(rows, t), key, q);
}

export function exportVideoTab(
  tx: Tx,
  rows: readonly LearnerVideoRow[],
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
) {
  return rowListExport(tx, videoTabList(rows, t), query, keys, VIDEO_TAB_SORT);
}

/* ───────────── Админка → «Видео» ───────────── */

/** Сколько сотрудников смотрели каждое видео (проигралась хотя бы секунда; прототип `vidViewers`). */
export async function videoViewerCounts(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx
    .select({ videoId: videoViews.videoId, n: sql<number>`count(*)::int` })
    .from(videoViews)
    .where(
      sql`(select coalesce(sum((e->>1)::float8 - (e->>0)::float8), 0) from jsonb_array_elements(${videoViews.segs}) e) >= 1`,
    )
    .groupBy(videoViews.videoId);
  return new Map(rows.map((r) => [r.videoId, r.n]));
}

/** Видео в списке Админки: запись и число зрителей. */
export interface AdminVideoRow {
  id: string;
  video: VideoRecord;
  viewers: number;
  moduleTitle: string;
  moduleOrder: number;
}

/** Не удалённые видео со зрителями — строки списка Админки. */
export async function adminVideoRows(
  tx: Tx,
  t: ListTexts,
  moduleOrder: (module: string | null) => number,
): Promise<AdminVideoRow[]> {
  const [list, viewers] = await Promise.all([videoRecords(tx), videoViewerCounts(tx)]);
  return list.map((video) => ({
    id: video.id,
    video,
    viewers: viewers.get(video.id) ?? 0,
    moduleTitle: videoModuleTitle(t, video.module),
    moduleOrder: moduleOrder(video.module),
  }));
}

/** Статус видео в Админке: «1/2 Черновик», «2/2 Опубликовано», «2/2 Опубликовано · снято». */
export const videoAdminStatus = (v: VideoRecord): 'draft' | 'pub' | 'off' =>
  v.status === 'draft' ? 'draft' : v.off ? 'off' : 'pub';

const ADMIN_VIDEO_COLUMNS: Readonly<Record<string, RowColumn>> = {
  cover: { type: 'enum', label: 'video.col.cover', sqlType: 'text' },
  title: { type: 'text', label: 'video.col.title', sqlType: 'text', searchAlso: 'description' },
  kind: { type: 'enum', label: 'video.col.kind', sqlType: 'text' },
  source: { type: 'enum', label: 'video.col.source', sqlType: 'text' },
  module: {
    type: 'enum',
    label: 'video.col.module',
    sqlType: 'text',
    sortBy: { key: 'module_ord', sqlType: 'integer' },
  },
  duration: {
    type: 'text',
    label: 'video.col.duration',
    sqlType: 'text',
    sortBy: { key: 'duration_s', sqlType: 'integer' },
  },
  size: { type: 'int', label: 'video.col.size', sqlType: 'integer' },
  status: {
    type: 'enum',
    label: 'video.col.status',
    sqlType: 'text',
    sortBy: { key: 'status_ord', sqlType: 'integer' },
  },
  landing: { type: 'enum', label: 'video.col.landing', sqlType: 'text' },
  viewers: { type: 'int', label: 'video.col.viewers', sqlType: 'integer' },
  audience: { type: 'enum', label: 'video.col.audience', sqlType: 'text' },
  ord: { type: 'int', label: 'video.col.ord', sqlType: 'integer' },
  code: { type: 'text', label: 'video.col.code', sqlType: 'text' },
  updated: { type: 'date', label: 'video.col.updated', sqlType: 'date' },
};

/** По умолчанию — недавно изменённые сверху (прототип `sort:{key:'upd',dir:-1}`). */
export const ADMIN_VIDEO_SORT: ListSort = { key: 'updated', dir: 'desc' };

function adminVideoList(rows: readonly AdminVideoRow[], t: ListTexts) {
  return rowList(rows, ADMIN_VIDEO_COLUMNS, (r, k) => {
    const v = r.video;
    switch (k) {
      case 'cover':
        return t(`video.cv.${v.coverKind ?? 'none'}`);
      case 'title':
        return v.title;
      case 'description':
        return v.description;
      case 'kind':
        return t(`video.kind.${v.kind}`);
      case 'source':
        return t(`video.src.${v.source}`);
      case 'module':
        return r.moduleTitle;
      case 'module_ord':
        return r.moduleOrder;
      case 'duration':
        return v.duration ? clock(v.duration) : '—';
      case 'duration_s':
        return v.duration ?? 0;
      case 'size':
        return v.source === 'file' ? (v.fileSize ?? 0) : 0;
      case 'status':
        return t(`video.st.${videoAdminStatus(v)}`);
      case 'status_ord':
        return { draft: 0, pub: 1, off: 2 }[videoAdminStatus(v)];
      case 'landing':
        return v.landing && videoLive(videoVisibilityOf(v))
          ? t('video.land.yes').replace('{n}', String(v.landingOrd))
          : t('video.land.no');
      case 'viewers':
        return r.viewers;
      case 'audience':
        return t(`video.aud.${v.audience}`);
      case 'ord':
        return v.ord;
      case 'code':
        return v.id;
      case 'updated':
        return bishkekDate(v.updatedAt);
      default:
        return null;
    }
  });
}

export function listAdminVideosPage(
  tx: Tx,
  rows: readonly AdminVideoRow[],
  query: ListQuery,
  t: ListTexts,
) {
  return rowListPage(tx, adminVideoList(rows, t), query, ADMIN_VIDEO_SORT);
}

export function listAdminVideosValues(
  tx: Tx,
  rows: readonly AdminVideoRow[],
  key: string,
  t: ListTexts,
  q?: string,
) {
  return rowListValues(tx, adminVideoList(rows, t), key, q);
}

export function exportAdminVideos(
  tx: Tx,
  rows: readonly AdminVideoRow[],
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
) {
  return rowListExport(tx, adminVideoList(rows, t), query, keys, ADMIN_VIDEO_SORT);
}

/** Подпись над списком (прототип `caption`): видео, опубликовано, занято. */
export function adminVideoSummary(rows: readonly AdminVideoRow[]) {
  return {
    count: rows.length,
    published: rows.filter((r) => videoLive(videoVisibilityOf(r.video))).length,
    bytes: rows.reduce(
      (sum, r) => sum + (r.video.source === 'file' ? (r.video.fileSize ?? 0) : 0),
      0,
    ),
  };
}

/* ───────────── Запись видео в Админке ───────────── */

export type VideoSaveResult =
  | { ok: true; video: VideoRecord; replaced: boolean; dropKeys: string[] }
  | { ok: false; reason: 'not_found' | 'changed' };

/** Поля видео, которые сохраняет форма. */
export interface VideoValues {
  title: string;
  kind: VideoKind;
  source: VideoSource;
  ytId: string | null;
  file: { key: string; name: string; size: number; type: string } | null;
  duration: number | null;
  cover: { key: string; kind: 'own' | 'frame' } | null | 'keep';
  description: string;
  module: string | null;
  article: string | null;
  ord: number;
  audience: VideoAudience;
  landing?: boolean;
  landingOrd?: number;
}

const historyNote = (kind: string, title: string) => [
  { field: 'video', to: kind },
  { field: 't', to: title },
];

/** Запись истории видео: что сделали (`VideoHistoryKind`) и название. */
async function logVideo(
  tx: Tx,
  v: VideoRecord,
  kind: string,
  action: 'create' | 'update' | 'delete',
) {
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: `${VIDEO_HISTORY_SECTION}:${v.id}`,
    action,
    changes: historyNote(kind, v.title),
  });
}

/** Код нового видео: `v` и 12 знаков. */
const freshVideoId = () => `v${randomBytes(6).toString('hex')}`;

/**
 * Новое видео — черновиком или сразу опубликованное (прототип «Сохранить черновик» / «Опубликовать»);
 * в историю — «Загружено» или «Добавлена ссылка YouTube», затем «Опубликовано».
 */
export async function createVideo(
  tx: Tx,
  values: VideoValues,
  publish: boolean,
): Promise<VideoRecord> {
  const cover = values.cover === 'keep' ? null : values.cover;
  const [row] = await tx
    .insert(videos)
    .values({
      id: freshVideoId(),
      title: values.title,
      kind: values.kind,
      source: values.source,
      ytId: values.ytId,
      fileKey: values.file?.key ?? null,
      fileName: values.file?.name ?? null,
      fileSize: values.file?.size ?? null,
      fileType: values.file?.type ?? null,
      duration: values.duration,
      coverKey: cover?.key ?? null,
      coverKind: cover?.kind ?? null,
      description: values.description,
      module: values.module,
      article: values.article,
      ord: values.ord,
      audience: values.audience,
      status: publish ? 'published' : 'draft',
      publishedAt: publish ? sql`now()` : null,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning();
  await logVideo(tx, row!, values.source === 'yt' ? 'yt' : 'upload', 'create');
  if (publish) await logVideo(tx, row!, 'publish', 'update');
  return row!;
}

/**
 * Правка видео той версии, что видел администратор: поля формы, замена файла или ссылки (ссылки в
 * статьях, новостях и уроках и набранные просмотры сохраняются — код тот же), обложка, «Показывать на
 * лендинге» (только у опубликованного). Отвечает ключами хранилища, которые больше не нужны (прежний
 * файл, прежняя обложка) — их удаляет API после записи.
 */
export async function saveVideo(
  tx: Tx,
  id: string,
  version: number,
  values: VideoValues,
  publish: boolean,
): Promise<VideoSaveResult> {
  const [before] = await tx.select().from(videos).where(eq(videos.id, id)).for('update');
  if (!before || before.deletedAt) return { ok: false, reason: 'not_found' };
  if (before.version !== version) return { ok: false, reason: 'changed' };
  const replaced =
    values.source !== before.source ||
    (values.source === 'yt' && values.ytId !== before.ytId) ||
    (values.source === 'file' && values.file !== null && values.file.key !== before.fileKey);
  const dropKeys: string[] = [];
  const file =
    values.source === 'file'
      ? (values.file ?? {
          key: before.fileKey!,
          name: before.fileName!,
          size: before.fileSize!,
          type: before.fileType!,
        })
      : null;
  if (before.fileKey && before.fileKey !== file?.key) dropKeys.push(before.fileKey);
  const cover =
    values.cover === 'keep'
      ? before.coverKey
        ? { key: before.coverKey, kind: before.coverKind as 'own' | 'frame' }
        : null
      : values.cover;
  // Кадр прежнего файла — не обложка нового: без своей картинки обложкой станет кадр нового файла.
  const coverFinal = replaced && values.cover === 'keep' && cover?.kind === 'frame' ? null : cover;
  if (before.coverKey && before.coverKey !== coverFinal?.key) dropKeys.push(before.coverKey);
  // «Показывать на лендинге» — только у опубликованного и не снятого видео (прототип `pubd`).
  const live = before.status === 'published' && !before.off;
  const duration = replaced ? values.duration : (values.duration ?? before.duration);
  const [row] = await tx
    .update(videos)
    .set({
      title: values.title,
      kind: values.kind,
      source: values.source,
      ytId: values.ytId,
      fileKey: file?.key ?? null,
      fileName: file?.name ?? null,
      fileSize: file?.size ?? null,
      fileType: file?.type ?? null,
      duration,
      coverKey: coverFinal?.key ?? null,
      coverKind: coverFinal?.kind ?? null,
      description: values.description,
      module: values.module,
      article: values.article,
      ord: values.ord,
      audience: values.audience,
      ...(live && values.landing !== undefined ? { landing: values.landing } : {}),
      ...(live && values.landingOrd !== undefined ? { landingOrd: values.landingOrd } : {}),
      ...(replaced ? { ytBad: false } : {}),
      ...(publish && before.status === 'draft'
        ? { status: 'published', publishedAt: sql`now()` }
        : {}),
      updatedBy: sql`app.current_user_id()`,
      updatedAt: sql`now()`,
      version: before.version + 1,
    })
    .where(eq(videos.id, id))
    .returning();
  await logVideo(tx, row!, replaced ? 'replace' : 'edit', 'update');
  if (publish && before.status === 'draft') await logVideo(tx, row!, 'publish', 'update');
  return { ok: true, video: row!, replaced, dropKeys };
}

/** Опубликовать, снять с публикации или вернуть (прототип `vidPub`). */
export async function setVideoState(
  tx: Tx,
  id: string,
  version: number,
  change: 'publish' | 'off' | 'on',
): Promise<VideoSaveResult | { ok: false; reason: 'state' }> {
  const [before] = await tx.select().from(videos).where(eq(videos.id, id)).for('update');
  if (!before || before.deletedAt) return { ok: false, reason: 'not_found' };
  if (before.version !== version) return { ok: false, reason: 'changed' };
  if ((change === 'publish') !== (before.status === 'draft')) return { ok: false, reason: 'state' };
  if (change === 'off' && before.off) return { ok: false, reason: 'state' };
  if (change === 'on' && !before.off) return { ok: false, reason: 'state' };
  const [row] = await tx
    .update(videos)
    .set({
      ...(change === 'publish' ? { status: 'published', publishedAt: sql`now()`, off: false } : {}),
      ...(change === 'off' ? { off: true } : {}),
      ...(change === 'on' ? { off: false } : {}),
      updatedBy: sql`app.current_user_id()`,
      updatedAt: sql`now()`,
      version: before.version + 1,
    })
    .where(eq(videos.id, id))
    .returning();
  await logVideo(tx, row!, change, 'update');
  return { ok: true, video: row!, replaced: false, dropKeys: [] };
}

/**
 * Удалить черновик или снятое с публикации видео (прототип `vidDel`): строка остаётся с отметкой
 * «удалено» для статистики просмотров, с лендинга снимается, файл и обложку API удаляет из хранилища.
 */
export async function deleteVideo(
  tx: Tx,
  id: string,
  version: number,
): Promise<VideoSaveResult | { ok: false; reason: 'state' }> {
  const [before] = await tx.select().from(videos).where(eq(videos.id, id)).for('update');
  if (!before || before.deletedAt) return { ok: false, reason: 'not_found' };
  if (before.version !== version) return { ok: false, reason: 'changed' };
  if (before.status === 'published' && !before.off) return { ok: false, reason: 'state' };
  const dropKeys = [before.fileKey, before.coverKey].filter((k): k is string => !!k);
  const [row] = await tx
    .update(videos)
    .set({
      deletedAt: sql`now()`,
      landing: false,
      fileKey: null,
      coverKey: null,
      coverKind: null,
      updatedBy: sql`app.current_user_id()`,
      updatedAt: sql`now()`,
      version: before.version + 1,
    })
    .where(eq(videos.id, id))
    .returning();
  await logVideo(tx, row!, 'delete', 'delete');
  return { ok: true, video: row!, replaced: false, dropKeys };
}

/** История видео в карточке (прототип `v.hist`): что сделали, когда и кто; сначала новые. */
export async function videoHistory(tx: Tx, id: string) {
  const rows = await readPlatformHistory(tx, 'platform_dict', `${VIDEO_HISTORY_SECTION}:${id}`);
  return rows
    .map((r) => {
      const changes = (r.changes ?? []) as { field: string; to?: unknown }[];
      return {
        at: r.at.toISOString(),
        kind: String(changes.find((c) => c.field === 'video')?.to ?? 'edit'),
        actor: auditActorName(r.actorUserId, null),
      };
    })
    .reverse();
}

/** Гости лендинга по видео: запусков и сумма процентов. */
export async function videoGuests(
  tx: Tx,
): Promise<Map<string, { starts: number; pctSum: number }>> {
  const rows = await tx.select().from(videoGuestStats);
  return new Map(rows.map((r) => [r.videoId, { starts: r.starts, pctSum: r.pctSum }]));
}

/* ───────────── Загрузки ───────────── */

/** Новая загрузка администратора: файл видео частями или обложка. */
export async function createVideoUpload(
  tx: Tx,
  values: {
    id: string;
    kind: 'video' | 'cover';
    storageKey: string;
    s3UploadId: string | null;
    fileName: string;
    sizeBytes: number;
    contentType: string;
    state?: 'uploading' | 'ready';
  },
): Promise<VideoUploadRecord> {
  const [row] = await tx
    .insert(videoUploads)
    .values({ ...values, createdBy: sql`app.current_user_id()` })
    .returning();
  return row!;
}

/** Своя загрузка (RLS: только создавший её администратор). */
export async function videoUpload(tx: Tx, id: string): Promise<VideoUploadRecord | null> {
  const [row] = await tx.select().from(videoUploads).where(eq(videoUploads.id, id));
  return row ?? null;
}

/** Файл собран и проверен: настоящий тип, длительность, многочастной загрузки больше нет. */
export async function videoUploadReady(
  tx: Tx,
  id: string,
  values: { contentType: string; duration: number | null },
): Promise<void> {
  await tx
    .update(videoUploads)
    .set({ state: 'ready', s3UploadId: null, ...values })
    .where(eq(videoUploads.id, id));
}

/** Загрузку забрало видео (или её отменили): строки больше нет, файл остаётся у видео. */
export async function dropVideoUpload(tx: Tx, id: string): Promise<void> {
  await tx.delete(videoUploads).where(eq(videoUploads.id, id));
}

/** Незаконченные загрузки старше `before` — для задачи по расписанию (функция миграции 0106). */
export async function staleVideoUploads(db: Db, before: Date, limit: number) {
  return db.execute<{ id: string; storage_key: string; s3_upload_id: string | null }>(
    sql`select id, storage_key, s3_upload_id from app.video_uploads_stale(${before.toISOString()}::timestamptz, ${limit})`,
  );
}

/** Убрать строки загрузок, файлы которых удалены из хранилища. */
export async function dropStaleVideoUploads(db: Db, ids: readonly string[], before: Date) {
  if (!ids.length) return 0;
  const [r] = await db.execute<{ n: number }>(
    sql`select app.video_uploads_drop(${sql`array[${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}]`}, ${before.toISOString()}::timestamptz) as n`,
  );
  return r?.n ?? 0;
}

/** Загрузки, которые нельзя оставлять: созданы раньше `before` и всё ещё здесь. */
export async function ownStaleUploads(tx: Tx, before: Date) {
  return tx.select().from(videoUploads).where(lt(videoUploads.createdAt, before));
}

/* ───────────── «Просмотры видео» ───────────── */

/** Кто и какое видео: строка «Просмотров видео» до подсчёта. */
export interface VideoViewSubject {
  orgId: string;
  orgName: string;
  userId: string;
  fullName: string;
  role: string;
  video: VideoRecord;
  view: VideoViewRecord | null;
}

/** Строка «Просмотров видео» с посчитанными значениями. */
export interface VideoViewListRow {
  id: string;
  orgName: string;
  userId: string;
  fullName: string;
  role: string;
  videoId: string;
  videoTitle: string;
  deleted: boolean;
  moduleTitle: string;
  duration: number | null;
  secs: number;
  pct: number;
  status: VideoViewStatus;
  opens: number;
  firstAt: Date | null;
  lastAt: Date | null;
}

/** Просмотры видеоинструкций (организации из контекста или все — администратору). */
export async function videoViewRecords(tx: Tx): Promise<VideoViewRecord[]> {
  return tx.select().from(videoViews);
}

/** Посчитать строку: просмотренные секунды, процент, статус (прототип `vidViewRows`). */
export function videoViewListRow(s: VideoViewSubject, t: ListTexts): VideoViewListRow {
  const segs = segsOf(s.view?.segs);
  const deleted = s.video.deletedAt !== null;
  return {
    id: `${s.orgId}|${s.userId}|${s.video.id}`,
    orgName: s.orgName,
    userId: s.userId,
    fullName: s.fullName,
    role: s.role,
    videoId: s.video.id,
    videoTitle: s.video.title + (deleted ? t('video.deleted') : ''),
    deleted,
    moduleTitle: videoModuleTitle(t, s.video.module),
    duration: s.video.duration,
    secs: Math.round(videoSecs(s.video.duration, segs) * 10) / 10,
    pct: videoPct(s.video.duration, segs),
    status: videoViewStatus(s.view ? { done: s.view.doneAt !== null, segs } : null),
    opens: s.view?.opens ?? 0,
    firstAt: s.view?.firstAt ?? null,
    lastAt: s.view?.lastAt ?? null,
  };
}

const VIEW_COLUMNS: Readonly<Record<string, RowColumn>> = {
  org: { type: 'enum', label: 'video.col.org', sqlType: 'text' },
  fullName: { type: 'text', label: 'video.col.full_name', sqlType: 'text' },
  role: { type: 'enum', label: 'video.col.role', sqlType: 'text' },
  video: { type: 'enum', label: 'video.col.video', sqlType: 'text' },
  module: { type: 'enum', label: 'video.col.module', sqlType: 'text' },
  duration: {
    type: 'text',
    label: 'video.col.duration',
    sqlType: 'text',
    sortBy: { key: 'duration_s', sqlType: 'integer' },
  },
  seen: {
    type: 'text',
    label: 'video.col.seen_secs',
    sqlType: 'text',
    sortBy: { key: 'pct', sqlType: 'integer' },
  },
  status: { type: 'enum', label: 'video.col.status', sqlType: 'text' },
  opens: { type: 'int', label: 'video.col.opens', sqlType: 'integer' },
  first: { type: 'date', label: 'video.col.first', sqlType: 'date' },
  last: {
    type: 'text',
    label: 'video.col.last',
    sqlType: 'text',
    sortBy: { key: 'last_at', sqlType: 'timestamptz' },
  },
};

/** По умолчанию — недавно смотревшие сверху (прототип `sort:{key:'last',dir:-1}`). */
export const VIDEO_VIEW_SORT: ListSort = { key: 'last', dir: 'desc' };

/** «15.03.2026 10:05» по Бишкеку. */
function dateTime(at: Date | null): string {
  if (!at) return '';
  const b = new Date(at.getTime() + 6 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(b.getUTCDate())}.${p(b.getUTCMonth() + 1)}.${b.getUTCFullYear()} ${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`;
}

function viewList(rows: readonly VideoViewListRow[], t: ListTexts, admin: boolean) {
  const defs = admin
    ? VIEW_COLUMNS
    : Object.fromEntries(Object.entries(VIEW_COLUMNS).filter(([k]) => k !== 'org'));
  return rowList(rows, defs, (r, k) => {
    switch (k) {
      case 'org':
        return r.orgName;
      case 'fullName':
        return r.fullName;
      case 'role':
        return r.role;
      case 'video':
        return r.videoTitle;
      case 'module':
        return r.moduleTitle;
      case 'duration':
        return clock(r.duration);
      case 'duration_s':
        return r.duration ?? 0;
      case 'seen':
        return `${clock(r.secs)} · ${r.pct} %`;
      case 'pct':
        return r.pct;
      case 'status':
        return t(`video.view.${r.status}`);
      case 'opens':
        return r.opens;
      case 'first':
        return r.firstAt ? bishkekDate(r.firstAt) : null;
      case 'last':
        return dateTime(r.lastAt);
      case 'last_at':
        return r.lastAt?.toISOString() ?? null;
      default:
        return null;
    }
  });
}

export function listVideoViewsPage(
  tx: Tx,
  rows: readonly VideoViewListRow[],
  query: ListQuery,
  t: ListTexts,
  admin: boolean,
) {
  return rowListPage(tx, viewList(rows, t, admin), query, VIDEO_VIEW_SORT);
}

export function listVideoViewsValues(
  tx: Tx,
  rows: readonly VideoViewListRow[],
  key: string,
  t: ListTexts,
  admin: boolean,
  q?: string,
) {
  return rowListValues(tx, viewList(rows, t, admin), key, q);
}

export function exportVideoViews(
  tx: Tx,
  rows: readonly VideoViewListRow[],
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
  admin: boolean,
) {
  return rowListExport(tx, viewList(rows, t, admin), query, keys, VIDEO_VIEW_SORT);
}

/** Сводка над «Просмотрами видео» — по всем строкам, без фильтров (прототип `renderKbVViews`). */
export function videoViewStats(rows: readonly VideoViewListRow[]) {
  const people = new Map<string, boolean>();
  for (const r of rows) {
    const k = `${r.id.split('|')[0]}|${r.userId}`;
    people.set(k, (people.get(k) ?? false) || r.status !== 'none');
  }
  const count = (s: VideoViewStatus) => rows.filter((r) => r.status === s).length;
  const done = count('done');
  return {
    videos: new Set(rows.map((r) => r.videoId)).size,
    donePct: rows.length ? Math.round((done / rows.length) * 100) : 0,
    idle: [...people.values()].filter((x) => !x).length,
    none: count('none'),
    started: count('started'),
    done,
  };
}

/** Открытия сотрудника по видео — «История просмотров». */
export async function videoSessionsOf(tx: Tx, userId: string, videoId: string) {
  return tx
    .select()
    .from(videoSessions)
    .where(and(eq(videoSessions.userId, userId), eq(videoSessions.videoId, videoId)))
    .orderBy(sql`${videoSessions.openedAt} desc`);
}

/** Просмотр сотрудника (организации из контекста; администратору — любой). */
export async function videoViewOf(tx: Tx, userId: string, videoId: string) {
  const [row] = await tx
    .select()
    .from(videoViews)
    .where(and(eq(videoViews.userId, userId), eq(videoViews.videoId, videoId)));
  return row ?? null;
}

export { segsOf as videoSegmentsOf };
