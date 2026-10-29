import { randomBytes } from 'node:crypto';
import {
  compareNews,
  diffChanges,
  newsHistoryKinds,
  NEWS_TYPES,
  type IsoDate,
  type ListQuery,
  type NewsAudience,
  type NewsHistoryKind,
  type NewsStatus,
  type NewsType,
} from '@buhuchet/domain';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import {
  auditActorValue,
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
} from './list';
import { writePlatformHistory } from './platform-history';
import { news, newsReads, platformAuditLog } from './schema';

/*
 * «Новости» Базы знаний (задача 2.32, docs/decisions.md п. Г-3): лента и прочитанность пользователя,
 * окно «Что нового», список и правка новостей в Админке. Лента читается в контексте пользователя
 * (`withOrgContext` сотрудника или `withUserContext` администратора платформы): что видно, решает
 * политика `news_read`, здесь — те же условия явно, чтобы администратор в своей ленте не видел черновики.
 */

/** Ссылка «Подробнее»: статья или модуль Базы знаний. */
export interface NewsLinkRef {
  kind: 'art' | 'mod';
  id: string;
}

export interface NewsRecord {
  id: string;
  title: string;
  type: NewsType;
  release: string | null;
  date: IsoDate;
  short: string;
  md: string;
  link: NewsLinkRef | null;
  pinned: boolean;
  showOnLogin: boolean;
  audience: NewsAudience;
  status: NewsStatus;
  off: boolean;
  publishedAt: Date | null;
  editedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Новость в ленте пользователя: с отметкой «прочитана». */
export interface NewsFeedRecord extends NewsRecord {
  read: boolean;
}

/** Момент, с которого новость видна: дата публикации в 09:00 по Бишкеку. */
const SHOW_AT = sql`((${news.publishDate} + time '09:00') at time zone 'Asia/Bishkek')`;

/** Опубликована, не снята, дата наступила (ТЗ: «появится сама в этот день в 09:00 по Бишкеку»). */
const LIVE = sql`(${news.status} = 'published' and not ${news.off} and ${SHOW_AT} <= now())`;

/** Для всех или «Только режим Админка» — администратору платформы. */
const FOR_ME = sql`(${news.audience} = 'all' or (${news.audience} = 'adm' and app.is_platform_admin()))`;

/**
 * Прочитана вошедшим: открыл, видел в окне «Что нового» или отметил все; новость, вышедшая до появления
 * его учётной записи, — тоже (docs/deviations.md п. Г-3).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Г-3
const READ = sql`(exists (select 1 from ${newsReads} where ${newsReads.newsId} = ${news.id} and ${newsReads.userId} = app.current_user_id()) or greatest(${news.publishedAt}, ${SHOW_AT}) <= app.current_user_created_at())`;

const fields = {
  id: news.id,
  title: news.title,
  type: news.type,
  release: news.release,
  date: news.publishDate,
  short: news.short,
  md: news.md,
  linkKind: news.linkKind,
  linkId: news.linkId,
  pinned: news.pinned,
  showOnLogin: news.showOnLogin,
  audience: news.audience,
  status: news.status,
  off: news.off,
  publishedAt: news.publishedAt,
  editedAt: news.editedAt,
  version: news.version,
  createdAt: news.createdAt,
  updatedAt: news.updatedAt,
};

interface Row {
  id: string;
  title: string;
  type: string;
  release: string | null;
  date: string;
  short: string;
  md: string;
  linkKind: string | null;
  linkId: string | null;
  pinned: boolean;
  showOnLogin: boolean;
  audience: string;
  status: string;
  off: boolean;
  publishedAt: Date | null;
  editedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(r: Row): NewsRecord {
  return {
    id: r.id,
    title: r.title,
    type: r.type as NewsType,
    release: r.release,
    date: r.date,
    short: r.short,
    md: r.md,
    link: r.linkKind && r.linkId ? { kind: r.linkKind as NewsLinkRef['kind'], id: r.linkId } : null,
    pinned: r.pinned,
    showOnLogin: r.showOnLogin,
    audience: r.audience as NewsAudience,
    status: r.status as NewsStatus,
    off: r.off,
    publishedAt: r.publishedAt,
    editedAt: r.editedAt,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function omitMd({ md: _md, ...rest }: NewsRecord): Omit<NewsRecord, 'md'> {
  return rest;
}

const byFeedOrder = (a: NewsRecord, b: NewsRecord) =>
  compareNews(
    { date: a.date, publishedAt: a.publishedAt, version: a.release },
    { date: b.date, publishedAt: b.publishedAt, version: b.release },
  );

/* ───────────── Лента пользователя ───────────── */

/** Лента «Новостей» вошедшего (прототип newsVis + newsRead): от новых к старым, с отметкой «прочитана». */
export async function newsFeed(tx: Tx): Promise<NewsFeedRecord[]> {
  const rows = await tx
    .select({ ...fields, read: sql<boolean>`${READ}` })
    .from(news)
    .where(and(LIVE, FOR_ME));
  return rows.map((r) => ({ ...toRecord(r), read: r.read })).sort(byFeedOrder);
}

/** Сколько непрочитанных новостей у вошедшего — счётчик у вкладки и у модуля «База знаний». */
export async function newsUnreadCount(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::integer` })
    .from(news)
    .where(and(LIVE, FOR_ME, sql`not ${READ}`));
  return row?.n ?? 0;
}

/**
 * Окно «Что нового» (прототип whatsNew): непрочитанные новости «Показывать при входе» от новых к
 * старым; `first` — у пользователя ещё нет ни одной прочитанной новости (окно впервые — с
 * приветствием и «Открыть Базу знаний»).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Г-4
export async function newsWhatsNew(tx: Tx): Promise<{ items: NewsRecord[]; first: boolean }> {
  const rows = await tx
    .select(fields)
    .from(news)
    .where(and(LIVE, FOR_ME, eq(news.showOnLogin, true), sql`not ${READ}`));
  const [seen] = await tx
    .select({ n: sql<number>`count(*)::integer` })
    .from(newsReads)
    .where(sql`${newsReads.userId} = app.current_user_id()`);
  return { items: rows.map(toRecord).sort(byFeedOrder), first: (seen?.n ?? 0) === 0 };
}

/**
 * Отметить новости прочитанными вошедшим (открыл новость, «Понятно» в окне «Что нового»). Только
 * видимые ему непрочитанные новости: уже прочитанные (и вышедшие до его учётной записи) не
 * трогаются. `all` — все видимые («Отметить все прочитанными»). Отвечает, сколько отметок добавлено.
 */
export async function markNewsRead(tx: Tx, ids: readonly string[] | 'all'): Promise<number> {
  const only: SQL = ids === 'all' ? sql`true` : inArray(news.id, [...ids]);
  if (ids !== 'all' && ids.length === 0) return 0;
  const rows = await tx.execute<{ news_id: string }>(sql`
    insert into ${newsReads} (user_id, news_id)
    select app.current_user_id(), ${news.id} from ${news} where ${LIVE} and ${FOR_ME} and not ${READ} and ${only}
    on conflict do nothing
    returning news_id`);
  return rows.length;
}

/* ───────────── Админка: список ───────────── */

const READS = sql`(select count(*)::integer from ${newsReads} where ${newsReads.newsId} = ${news.id})`;
const STATE = sql`case when ${news.status} = 'draft' then 'draft' when ${news.off} then 'off' when ${SHOW_AT} <= now() then 'live' else 'scheduled' end`;
const CREATED_BY = auditActorValue(news.createdBy, sql`null`);
const UPDATED_BY = sql`coalesce(${auditActorValue(news.updatedBy, sql`null`)}, ${CREATED_BY})`;

/**
 * Столбцы списка новостей в Админке (прототип admin/news.js, renderNewsAdm): дата публикации, версия,
 * тип, заголовок, статус, для кого; в «Столбцах» — код, «Закреплено», «Изменено» (правка
 * опубликованной), «Прочитали» и служебные «Создал», «Изменил», «Создано», «Изменено».
 */
export function newsAdminColumns(t: ListTexts): ListColumns {
  const typeName = sql.join(
    NEWS_TYPES.map((code) => sql`when ${code} then ${t(`news.type.${code}`)}`),
    sql` `,
  );
  return {
    id: { type: 'text', label: 'news.col.id', value: news.id },
    date: { type: 'date', label: 'news.col.date', value: news.publishDate },
    release: {
      type: 'enum',
      label: 'news.col.release',
      value: sql`coalesce(${news.release}, '')`,
      display: sql`coalesce(nullif(${news.release}, ''), '—')`,
    },
    type: {
      type: 'enum',
      label: 'news.col.type',
      value: news.type,
      display: sql`case ${news.type} ${typeName} end`,
      sort: {
        value: sql`array_position(${sql.raw(`array[${NEWS_TYPES.map((c) => `'${c}'`).join(', ')}]`)}::text[], ${news.type})`,
        text: false,
      },
    },
    title: { type: 'text', label: 'news.col.title', value: news.title },
    status: {
      type: 'enum',
      label: 'news.col.status',
      value: STATE,
      display: sql`case ${STATE} when 'draft' then ${t('news.state.draft')} when 'off' then ${t('news.state.off')} when 'live' then ${t('news.state.live')} else replace(${t('news.state.scheduled')}, '{date}', to_char(${news.publishDate}, 'DD.MM.YYYY')) end`,
    },
    audience: {
      type: 'enum',
      label: 'news.col.audience',
      value: news.audience,
      display: sql`case when ${news.audience} = 'adm' then ${t('news.aud.adm')} else ${t('news.aud.all')} end`,
    },
    pinned: {
      type: 'enum',
      label: 'news.col.pinned',
      value: sql`case when ${news.pinned} then 'yes' else 'no' end`,
      display: sql`case when ${news.pinned} then ${t('news.yes')} else ${t('news.no')} end`,
    },
    edited: {
      type: 'date',
      label: 'news.col.edited',
      value: sql`(${news.editedAt} at time zone 'Asia/Bishkek')::date`,
    },
    reads: { type: 'int', label: 'news.col.reads', value: READS },
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: news.createdAt },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: news.updatedAt },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: CREATED_BY },
    updatedBy: {
      type: 'enum',
      label: 'grid.col.updated_by',
      value: UPDATED_BY,
    },
  };
}

/**
 * Новость в списке Админки: без подробного описания (его берёт окно новости), с состоянием на сейчас,
 * числом прочитавших и «Создал» / «Изменил» для экрана.
 */
export interface NewsAdminRecord extends Omit<NewsRecord, 'md'> {
  state: 'draft' | 'off' | 'scheduled' | 'live';
  reads: number;
  createdBy: string | null;
  updatedBy: string | null;
}

/**
 * По умолчанию, как во всех списках, — от новых к старым по «Создано» (прототип defSort): у истории
 * версий из наполнения «Создано» — момент публикации, поэтому она идёт от новых версий к старым.
 */
const NATURAL = [news.publishDate, news.publishedAt, news.id];

const adminFrom =
  (tx: Tx): ListFrom =>
  (f) =>
    tx.select(f).from(news).$dynamic();

const adminFields = {
  ...fields,
  md: sql<string>`''`,
  state: sql<NewsAdminRecord['state']>`${STATE}`,
  reads: sql<number>`${READS}`,
  createdBy: sql<string | null>`${CREATED_BY}`,
  updatedBy: sql<string | null>`${UPDATED_BY}`,
};

/** Страница списка новостей Админки. Не администратору — только опубликованные (политика `news_read`). */
export async function listNewsAdminPage(
  tx: Tx,
  query: ListQuery,
  t: ListTexts,
): Promise<ListPageResult<NewsAdminRecord>> {
  const page = await selectListPage({
    query,
    columns: newsAdminColumns(t),
    natural: NATURAL,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ ...adminFields, ...window })
        .from(news)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: adminFrom(tx),
  });
  return {
    ...page,
    rows: page.rows.map((r) => ({
      ...omitMd(toRecord(r)),
      state: r.state,
      reads: r.reads,
      createdBy: r.createdBy,
      updatedBy: r.updatedBy,
    })),
  };
}

/** Значения столбца списка новостей для фильтра-галочек; `q` — «Найти значение». */
export function listNewsAdminValues(tx: Tx, key: string, t: ListTexts, q?: string) {
  return selectListValues({
    columns: newsAdminColumns(t),
    key,
    scope: undefined,
    from: adminFrom(tx),
    q,
  });
}

/** Новости для выгрузки в Excel: все под поиском и фильтрами, столбцы `keys`. */
export function exportNewsAdmin(tx: Tx, query: ListQuery, keys: readonly string[], t: ListTexts) {
  return selectListExport({
    query,
    columns: newsAdminColumns(t),
    keys,
    natural: NATURAL,
    scope: undefined,
    from: adminFrom(tx),
  });
}

/* ───────────── Админка: правка ───────────── */

/** Поля новости из окна «Новость». */
export interface NewsInput {
  title: string;
  type: NewsType;
  release: string | null;
  date: IsoDate;
  short: string;
  md: string;
  link: NewsLinkRef | null;
  pinned: boolean;
  showOnLogin: boolean;
  audience: NewsAudience;
}

const inputColumns = (v: NewsInput) => ({
  title: v.title,
  type: v.type,
  release: v.release,
  publishDate: v.date,
  short: v.short,
  md: v.md,
  linkKind: v.link?.kind ?? null,
  linkId: v.link?.id ?? null,
  pinned: v.pinned,
  showOnLogin: v.showOnLogin,
  audience: v.audience,
});

/** Одна новость (администратору — любая, пользователю — только видимая ему). */
export async function getNews(tx: Tx, id: string): Promise<NewsRecord | null> {
  const [row] = await tx.select(fields).from(news).where(eq(news.id, id));
  return row ? toRecord(row) : null;
}

/** Код новой новости: «n» и 12 случайных знаков. */
export function newNewsId(): string {
  return `n${randomBytes(6).toString('hex')}`;
}

/** Поля новости в истории платформы («было → стало»); моменты публикации и правки видны в списке. */
const historyFields = (n: NewsRecord) => ({
  title: n.title,
  type: n.type,
  release: n.release,
  date: n.date,
  short: n.short,
  md: n.md,
  link: n.link ? `${n.link.kind}:${n.link.id}` : null,
  pinned: n.pinned,
  showOnLogin: n.showOnLogin,
  audience: n.audience,
  status: n.status,
  off: n.off,
});

/** Новая новость черновиком или сразу опубликованной (прототип: «Сохранить черновик», «Опубликовать»). */
export async function createNews(
  tx: Tx,
  input: NewsInput,
  options: { publish: boolean },
): Promise<NewsRecord> {
  const [row] = await tx
    .insert(news)
    .values({
      id: newNewsId(),
      ...inputColumns(input),
      status: options.publish ? 'published' : 'draft',
      publishedAt: options.publish ? sql`now()` : null,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning(fields);
  const record = toRecord(row!);
  await writePlatformHistory(tx, {
    entity: 'news',
    entityId: record.id,
    action: 'create',
    changes: Object.entries(historyFields(record))
      .filter(([, to]) => to !== null && to !== '')
      .map(([field, to]) => ({ field, to })),
  });
  return record;
}

export type NewsSaveResult =
  | { ok: true; before: NewsRecord; record: NewsRecord }
  /** `not_draft` — уже опубликована, `not_published` — ещё черновик (снимать с публикации нечего). */
  | { ok: false; reason: 'not_found' | 'not_draft' | 'not_published' }
  /** `current` — версия записи в базе сейчас (для «Перечитать»). */
  | { ok: false; reason: 'changed'; current: number };

/**
 * Правка с проверкой версии; «было → стало» — в историю платформы (`news`) в той же транзакции
 * (`withUserContext` администратора платформы).
 */
async function updateNews(
  tx: Tx,
  id: string,
  version: number,
  patch: (before: NewsRecord) => PgUpdateSetSource<typeof news> | 'not_draft' | 'not_published',
): Promise<NewsSaveResult> {
  const [locked] = await tx.select(fields).from(news).where(eq(news.id, id)).for('update');
  if (!locked) return { ok: false, reason: 'not_found' };
  const before = toRecord(locked);
  if (before.version !== version) return { ok: false, reason: 'changed', current: before.version };
  const set = patch(before);
  if (set === 'not_draft' || set === 'not_published') return { ok: false, reason: set };
  const [row] = await tx
    .update(news)
    .set({
      ...set,
      version: sql`${news.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(and(eq(news.id, id), eq(news.version, version)))
    .returning(fields);
  if (!row) return { ok: false, reason: 'changed', current: before.version };
  const record = toRecord(row);
  await writePlatformHistory(tx, {
    entity: 'news',
    entityId: id,
    action: 'update',
    changes: diffChanges(historyFields(before), historyFields(record)),
  });
  return { ok: true, before, record };
}

/**
 * Сохранить правку (прототип newsEditDlg → save): у черновика — «Сохранить черновик» или
 * «Опубликовать»; опубликованная исправляется с отметкой «Изменено» (ТЗ «видно «Изменено
 * ДД.ММ.ГГГГ»»).
 */
export function saveNews(
  tx: Tx,
  id: string,
  version: number,
  input: NewsInput,
  options: { publish: boolean },
): Promise<NewsSaveResult> {
  return updateNews(tx, id, version, (before) => ({
    ...inputColumns(input),
    ...(before.status === 'published'
      ? { editedAt: sql`now()` }
      : options.publish
        ? { status: 'published', publishedAt: sql`now()` }
        : {}),
  }));
}

/** «Опубликовать» черновик из меню записи. Уже опубликованная — `not_draft`. */
export function publishNews(tx: Tx, id: string, version: number): Promise<NewsSaveResult> {
  return updateNews(tx, id, version, (before) =>
    before.status === 'draft' ? { status: 'published', publishedAt: sql`now()` } : 'not_draft',
  );
}

/** «Снять с публикации» и «Вернуть в публикацию». Черновик — `not_published`: снимать нечего. */
export function setNewsOff(
  tx: Tx,
  id: string,
  version: number,
  off: boolean,
): Promise<NewsSaveResult> {
  return updateNews(tx, id, version, (before) =>
    before.status === 'published' ? { off } : 'not_published',
  );
}

/** Удалить черновик (опубликованную — только снять с публикации; так же не даст политика базы). */
export async function deleteNewsDraft(
  tx: Tx,
  id: string,
  version: number,
): Promise<
  | { ok: true; before: NewsRecord }
  | { ok: false; reason: 'not_found' | 'not_draft' }
  | { ok: false; reason: 'changed'; current: number }
> {
  const before = await getNews(tx, id);
  if (!before) return { ok: false, reason: 'not_found' };
  if (before.status !== 'draft') return { ok: false, reason: 'not_draft' };
  const rows = await tx
    .delete(news)
    .where(and(eq(news.id, id), eq(news.version, version), eq(news.status, 'draft')))
    .returning({ id: news.id });
  if (!rows.length) return { ok: false, reason: 'changed', current: before.version };
  // Заголовок удалённого черновика — в самой записи истории («черновик «…» удалён»): новости уже нет.
  await writePlatformHistory(tx, {
    entity: 'news',
    entityId: id,
    action: 'delete',
    changes: [{ field: 'title', from: before.title }],
  });
  return { ok: true, before };
}

/** Сколько последних записей видно в «Истории изменений» (прототип pdHistHtml: `h.slice(0, 12)`). */
export const NEWS_HISTORY_SHOWN = 12;

export interface NewsHistoryItem {
  /** Номер записи истории; у сразу опубликованной новости он общий у двух строк. */
  id: number;
  at: Date;
  newsId: string;
  kind: NewsHistoryKind;
  /** Заголовок на момент записи: из неё самой, из прошлой записи с заголовком или нынешний. */
  title: string;
}

/**
 * «История изменений · N» под списком новостей в Админке: всего строк и последние 12, новые сверху
 * (история платформы, сущность `news`; читает только администратор платформы — политика таблицы).
 * Новость, созданная сразу опубликованной, — одна запись истории, но две строки (`newsHistoryKinds`).
 * Состояние до правки — последнее записанное `status` этой новости; у новостей начального наполнения
 * записи о создании нет — для них нынешнее.
 */
export async function newsAdminHistory(
  tx: Tx,
): Promise<{ total: number; items: NewsHistoryItem[] }> {
  const [count] = await tx
    .select({
      total: sql<number>`(count(*) + count(*) filter (where ${platformAuditLog.action} = 'create' and ${platformAuditLog.changes} @> '[{"field":"status","to":"published"}]'::jsonb))::int`,
    })
    .from(platformAuditLog)
    .where(eq(platformAuditLog.entity, 'news'));
  const rows = await tx.execute<{
    id: number | string;
    at: Date | string;
    news_id: string;
    action: string;
    changes: { field: string; from?: unknown; to?: unknown }[];
    status_before: string | null;
    title: string | null;
  }>(sql`
    select h.id, h.at, h.entity_id as news_id, h.action, h.changes,
      coalesce(
        (select c->>'to' from platform_audit_log p cross join lateral jsonb_array_elements(p.changes) c
          where p.entity = 'news' and p.entity_id = h.entity_id and p.id < h.id and c->>'field' = 'status'
          order by p.id desc limit 1),
        n.status
      ) as status_before,
      coalesce(
        (select coalesce(c->>'to', c->>'from') from jsonb_array_elements(h.changes) c
          where c->>'field' = 'title' limit 1),
        (select c->>'to' from platform_audit_log p cross join lateral jsonb_array_elements(p.changes) c
          where p.entity = 'news' and p.entity_id = h.entity_id and p.id < h.id and c->>'field' = 'title'
          order by p.id desc limit 1),
        n.title
      ) as title
    from platform_audit_log h
    left join news n on n.id = h.entity_id
    where h.entity = 'news'
    order by h.at desc, h.id desc
    limit ${NEWS_HISTORY_SHOWN}`);
  return {
    total: count?.total ?? 0,
    items: [...rows]
      .flatMap((r) =>
        newsHistoryKinds(
          r.action,
          r.changes,
          r.status_before === 'published' || r.status_before === 'draft' ? r.status_before : null,
        ).map((kind) => ({
          id: Number(r.id),
          at: new Date(r.at),
          newsId: r.news_id,
          kind,
          title: r.title ?? '',
        })),
      )
      .slice(0, NEWS_HISTORY_SHOWN),
  };
}
