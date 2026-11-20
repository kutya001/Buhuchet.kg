import {
  ADMIN_FILE_SRC_CODES,
  PLATFORM_ADMIN_NAME,
  type AdminFileCat,
  type AdminFileKind,
  type AdminFileState,
  type FileTrashWhy,
  type ListQuery,
  type StorageCheckList,
} from '@buhuchet/domain';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { bigint, boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
  type ListWindowFields,
} from './list';
import { storageCheckRuns } from './schema/files';
import { textLiteral } from './sql-text';

/*
 * Модуль «Файлы» Админки и вкладка «Файлы» карточки организации (доработки 20.11.2026, пакет 2,
 * блоки 3–4; прототип admin/admin-files.js; этап 1, П4–П5, поток И; миграция 0166): представления
 * `app.admin_storage_files` («Все файлы»), `app.admin_storage_check` («Проверка хранилища») — только
 * администратору платформы, в `withUserContext`. Ключей хранилища в них нет (кроме пути лишнего файла):
 * файл открывается подписанной ссылкой API, ключ для неё — `adminStorageFileKey`.
 */

const app = pgSchema('app');

export const adminStorageFilesView = app
  .view('admin_storage_files', {
    kind: text('kind').$type<AdminFileKind>().notNull(),
    id: uuid('id').notNull(),
    orgId: uuid('org_id'),
    orgName: text('org_name'),
    leadId: uuid('lead_id'),
    leadFirm: text('lead_firm'),
    contractorId: uuid('contractor_id'),
    cpName: text('cp_name'),
    cpInn: text('cp_inn'),
    cat: text('cat').$type<AdminFileCat>().notNull(),
    src: text('src').notNull(),
    linkKinds: text('link_kinds').array().notNull(),
    sourceKind: text('source_kind'),
    sourceId: uuid('source_id'),
    name: text('name').notNull(),
    contentType: text('content_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    note: text('note'),
    byUser: uuid('by_user'),
    byName: text('by_name'),
    via: text('via'),
    at: timestamp('at', { withTimezone: true }).notNull(),
    state: text('state').$type<AdminFileState>().notNull(),
    mem: boolean('mem').notNull(),
    eraseAt: timestamp('erase_at', { withTimezone: true }),
    why: text('why').$type<FileTrashWhy>(),
  })
  .existing();

const v = adminStorageFilesView;

/** Подпись кода «Источника» — тексты словаря `afiles.src.<код>` параметрами запроса. */
function srcText(code: SQL | typeof v.src, t: ListTexts): SQL {
  return sql`(case ${code} ${sql.join(
    ADMIN_FILE_SRC_CODES.map((c) => sql`when ${textLiteral(c)} then ${t(`afiles.src.${c}`)}::text`),
    sql` `,
  )} else ''::text end)`;
}

/** Код «Источника» со ссылками файла («report+receipt») — значение фильтра. */
const SRC_VALUE = sql`(${v.src} || coalesce('+' || nullif(array_to_string(array(select k from unnest(${v.linkKinds}) k where k <> ${v.src} order by k), '+'), ''), ''))`;

/** «Отчёт · Поступление» — главный источник и записи-ссылки (прототип `afUniq(src).join(' · ')`). */
function srcDisplay(t: ListTexts): SQL {
  const k = sql.raw('k');
  return sql`concat_ws(' · ', nullif(${srcText(v.src, t)}, ''), nullif((select string_agg(distinct ${srcText(k, t)}, ' · ') from unnest(${v.linkKinds}) k where k <> ${v.src}), ''))`;
}

/** «Загрузил»: сотрудник, контрагент со страницы или из Telegram, заявитель с сайта, «Система». */
function byDisplay(t: ListTexts): SQL {
  return sql`(case when ${v.byUser} is not null then coalesce(${v.byName}, ${textLiteral(PLATFORM_ADMIN_NAME)}::text) when ${v.via} = 'telegram' then ${t('afiles.by.telegram')}::text when ${v.via} is not null then ${t('afiles.by.page')}::text when ${v.cat} = 'lead' then ${t('afiles.by.lead')}::text else ${t('afiles.by.system')}::text end)`;
}

const BY_VALUE = sql`coalesce(${v.byUser}::text, case when ${v.via} is not null then 'via:' || ${v.via} when ${v.cat} = 'lead' then 'lead' else 'system' end)`;

function orgDisplay(t: ListTexts): SQL {
  return sql`coalesce(${v.orgName}, ${v.leadFirm} || ' ' || ${t('afiles.lead_suffix')}::text)`;
}

const TYPE_VALUE = sql`lower(substring(${v.name} from '\\.([A-Za-z0-9]{1,10})$'))`;

/**
 * Столбцы «Все файлы» на сервере (прототип `afCols`): ключи — как у столбцов экрана. Поиск — по
 * названию, организации, контрагенту и его ИНН (прототип `searchText`); ключей хранилища в списке нет.
 */
export function adminStorageFileColumns(t: ListTexts): ListColumns {
  return {
    name: { type: 'text', label: 'afiles.col.name', value: v.name },
    org: {
      type: 'enum',
      label: 'afiles.col.org',
      value: sql`coalesce(${v.orgId}::text, 'lead:' || ${v.leadId}::text)`,
      display: orgDisplay(t),
      sort: { value: sql`coalesce(${v.orgName}, ${v.leadFirm})`, text: true },
    },
    cp: {
      type: 'enum',
      label: 'afiles.col.cp',
      value: v.cpName,
      digits: v.cpInn,
    },
    inn: { type: 'text', label: 'afiles.col.inn', value: v.cpInn, compact: true },
    src: {
      type: 'enum',
      label: 'afiles.col.src',
      value: SRC_VALUE,
      display: srcDisplay(t),
      sort: { value: srcDisplay(t), text: true },
    },
    by: {
      type: 'enum',
      label: 'afiles.col.by',
      value: BY_VALUE,
      display: byDisplay(t),
      sort: { value: byDisplay(t), text: true },
    },
    at: {
      type: 'date',
      label: 'afiles.col.at',
      value: sql`(${v.at} at time zone 'Asia/Bishkek')::date`,
    },
    size: { type: 'int', label: 'afiles.col.size', value: v.sizeBytes, total: true },
    type: {
      type: 'enum',
      label: 'afiles.col.type',
      value: TYPE_VALUE,
      display: sql`upper(${TYPE_VALUE})`,
    },
    st: {
      type: 'enum',
      label: 'afiles.col.st',
      value: v.state,
      display: sql`(case ${v.state} when 'new' then ${t('afiles.st.new')}::text when 'rejected' then ${t('afiles.st.rejected')}::text when 'trash' then ${t('afiles.st.trash')}::text else ${t('afiles.st.ready')}::text end)`,
      sort: {
        value: sql`(case ${v.state} when 'ready' then 0 when 'new' then 1 when 'rejected' then 2 else 3 end)`,
        text: false,
      },
    },
    note: { type: 'text', label: 'afiles.col.note', value: v.note },
  };
}

/** Строка «Все файлы» для экрана: подписи — готовым текстом, как в ячейках. */
export interface AdminStorageFile {
  kind: AdminFileKind;
  id: string;
  orgId: string | null;
  /** Организация или «<фирма> (заявка)». */
  orgText: string | null;
  contractorId: string | null;
  cpName: string | null;
  cpInn: string | null;
  cat: AdminFileCat;
  src: string;
  srcText: string;
  name: string;
  contentType: string | null;
  sizeBytes: number;
  note: string | null;
  byText: string;
  at: Date;
  state: AdminFileState;
  mem: boolean;
  eraseAt: Date | null;
  why: FileTrashWhy | null;
}

const NATURAL = [v.at, v.id];

function storageFrom(tx: Tx): ListFrom {
  return (f) => tx.select(f).from(v).$dynamic();
}

/** Только файлы организации (вкладка «Файлы» карточки организации). */
export function adminStorageScope(orgId: string | undefined): SQL | undefined {
  return orgId ? eq(v.orgId, orgId) : undefined;
}

function rowFields(t: ListTexts) {
  return {
    kind: v.kind,
    id: v.id,
    orgId: v.orgId,
    orgText: orgDisplay(t),
    contractorId: v.contractorId,
    cpName: v.cpName,
    cpInn: v.cpInn,
    cat: v.cat,
    src: v.src,
    srcText: srcDisplay(t),
    name: v.name,
    contentType: v.contentType,
    sizeBytes: v.sizeBytes,
    note: v.note,
    byText: byDisplay(t),
    at: v.at,
    state: v.state,
    mem: v.mem,
    eraseAt: v.eraseAt,
    why: v.why,
  };
}

/** Страница «Все файлы»; `orgId` — только файлы организации. Не администратору — пусто. */
export async function listAdminStorageFilesPage(
  tx: Tx,
  query: ListQuery,
  t: ListTexts,
  orgId?: string,
): Promise<ListPageResult<AdminStorageFile>> {
  const fields = rowFields(t);
  const page = await selectListPage({
    query,
    columns: adminStorageFileColumns(t),
    natural: NATURAL,
    defaultSort: { key: 'at', dir: 'desc' },
    scope: adminStorageScope(orgId),
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ ...fields, ...(window as ListWindowFields) })
        .from(v)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset) as unknown as Promise<
        (AdminStorageFile & {
          listTotal: number;
          listTotals: Record<string, number> | null;
          listGroups: string[] | null;
        })[]
      >,
    from: storageFrom(tx),
  });
  return {
    ...page,
    rows: page.rows.map((r) => ({
      ...r,
      orgText: r.orgText ?? null,
      srcText: r.srcText ?? '',
      byText: r.byText ?? '',
      sizeBytes: Number(r.sizeBytes),
    })),
  };
}

export async function listAdminStorageFileValues(
  tx: Tx,
  key: string,
  t: ListTexts,
  q?: string,
  orgId?: string,
) {
  return selectListValues({
    columns: adminStorageFileColumns(t),
    key,
    scope: adminStorageScope(orgId),
    from: storageFrom(tx),
    ...(q !== undefined ? { q } : {}),
  });
}

export async function exportAdminStorageFiles(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
  orgId?: string,
) {
  return selectListExport({
    query,
    columns: adminStorageFileColumns(t),
    keys,
    natural: NATURAL,
    defaultSort: { key: 'at', dir: 'desc' },
    scope: adminStorageScope(orgId),
    from: storageFrom(tx),
  });
}

/** Сколько и какого объёма (байт). */
export interface CountBytes {
  n: number;
  bytes: number;
}

/** Строка «По организациям» (прототип: Файлов, Объём, Последняя загрузка; предел — из подписки). */
export interface AdminStorageOrgRow extends CountBytes {
  orgId: string;
  name: string;
  /** Последняя загрузка, день по Бишкеку. */
  last: string | null;
}

/** «Хранилище» (блок 3, пункт 3; прототип `renderAFStore`): плашки, месяцы, организации. */
export interface AdminStorageSummary {
  org: CountBytes;
  sent: CountBytes;
  lead: CountBytes;
  rcpt: CountBytes;
  trash: CountBytes;
  /** Видео платформы (байт — только у файлов видео: размер обложек и логотипов не хранится). */
  platform: CountBytes;
  /** Расхождений сверки и когда была последняя. */
  diff: number;
  checkedAt: Date | null;
  /** Загружено по месяцам `ГГГГ-ММ` (по Бишкеку), байт. */
  months: { month: string; bytes: number }[];
  orgs: AdminStorageOrgRow[];
}

const cb = (n: unknown, b: unknown): CountBytes => ({ n: Number(n ?? 0), bytes: Number(b ?? 0) });

/** Сводка «Хранилища» администратору платформы (`withUserContext`); не администратору — нули. */
export async function adminStorageSummary(tx: Tx, since: string): Promise<AdminStorageSummary> {
  const [cats] = await tx.execute<Record<string, string | number | null>>(sql`
    select
      count(*) filter (where cat = 'org') as org_n, sum(size_bytes) filter (where cat = 'org') as org_b,
      count(*) filter (where cat = 'sent') as sent_n, sum(size_bytes) filter (where cat = 'sent') as sent_b,
      count(*) filter (where cat = 'lead') as lead_n, sum(size_bytes) filter (where cat = 'lead') as lead_b,
      count(*) filter (where cat = 'rcpt') as rcpt_n, sum(size_bytes) filter (where cat = 'rcpt') as rcpt_b
    from app.admin_storage_files`);
  const [trash] = await tx.execute<{ n: number; b: string | null }>(
    sql`select count(*) as n, sum(size_bytes) as b from app.admin_file_trash`,
  );
  const [pf] = await tx.execute<{ n: number; b: string | null }>(
    sql`select files as n, bytes as b from app.admin_platform_storage()`,
  );
  const [diff] = await tx.execute<{ n: number }>(
    sql`select count(*) as n from app.admin_storage_check`,
  );
  const [run] = await tx
    .select({ at: storageCheckRuns.finishedAt })
    .from(storageCheckRuns)
    .where(eq(storageCheckRuns.state, 'done'))
    .orderBy(desc(storageCheckRuns.startedAt))
    .limit(1);
  const months = await tx.execute<{ month: string; b: string | null }>(sql`
    select to_char(at at time zone 'Asia/Bishkek', 'YYYY-MM') as month, sum(size_bytes) as b
    from app.admin_storage_files
    where cat <> 'trash' and (at at time zone 'Asia/Bishkek')::date >= ${since}::date
    group by 1 order by 1`);
  const orgs = await tx.execute<{
    org_id: string;
    name: string;
    n: number;
    b: string | null;
    last: string | null;
  }>(sql`
    select o.id as org_id, o.name, count(f.id) as n, coalesce(sum(f.size_bytes), 0) as b,
      max((f.at at time zone 'Asia/Bishkek')::date)::text as last
    from app.admin_organizations o
    left join app.admin_storage_files f on f.org_id = o.id and f.mem
    group by o.id, o.name`);
  return {
    org: cb(cats?.org_n, cats?.org_b),
    sent: cb(cats?.sent_n, cats?.sent_b),
    lead: cb(cats?.lead_n, cats?.lead_b),
    rcpt: cb(cats?.rcpt_n, cats?.rcpt_b),
    trash: cb(trash?.n, trash?.b),
    platform: cb(pf?.n, pf?.b),
    diff: Number(diff?.n ?? 0),
    checkedAt: run?.at ?? null,
    months: months.map((m) => ({ month: m.month, bytes: Number(m.b ?? 0) })),
    orgs: orgs.map((o) => ({
      orgId: o.org_id,
      name: o.name,
      n: Number(o.n),
      bytes: Number(o.b ?? 0),
      last: o.last,
    })),
  };
}

/** «Объём по категориям» карточки организации (прототип `ocFilesGrids`): источник → файлов и байт. */
export async function adminOrgFileCategories(
  tx: Tx,
  orgId: string,
): Promise<{ src: string; n: number; bytes: number }[]> {
  const rows = await tx.execute<{ src: string; n: number; b: string | null }>(sql`
    select case when cat = 'trash' then 'trash' else src end as src, count(*) as n,
      sum(size_bytes) as b
    from app.admin_storage_files where org_id = ${orgId}::uuid
    group by 1`);
  return rows.map((r) => ({ src: r.src, n: Number(r.n), bytes: Number(r.b ?? 0) }));
}

/** Ключ хранилища строки «Все файлы» — только для подписанной ссылки; не администратору — null. */
export async function adminStorageFileKey(
  tx: Tx,
  kind: AdminFileKind,
  id: string,
): Promise<{
  storageKey: string;
  name: string;
  contentType: string | null;
  orgId: string | null;
  cat: AdminFileCat;
} | null> {
  const rows = await tx.execute<{
    storage_key: string;
    name: string;
    content_type: string | null;
    org_id: string | null;
    cat: AdminFileCat;
  }>(sql`select storage_key, name, content_type, org_id, cat
    from app.admin_storage_file_key(${kind}, ${id}::uuid)`);
  const r = rows[0];
  return r
    ? {
        storageKey: r.storage_key,
        name: r.name,
        contentType: r.content_type,
        orgId: r.org_id,
        cat: r.cat,
      }
    : null;
}

export const adminStorageCheckView = app
  .view('admin_storage_check', {
    id: bigint('id', { mode: 'number' }).notNull(),
    kind: text('kind').$type<StorageCheckList>().notNull(),
    path: text('path'),
    orgId: uuid('org_id'),
    orgName: text('org_name'),
    name: text('name'),
    contractorId: uuid('contractor_id'),
    cpName: text('cp_name'),
    src: text('src'),
    byUser: uuid('by_user'),
    byName: text('by_name'),
    via: text('via'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    at: timestamp('at', { withTimezone: true }),
    attempts: integer('attempts'),
    lastError: text('last_error'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  })
  .existing();

export type AdminStorageCheckRow = typeof adminStorageCheckView.$inferSelect;

/** Строк одного списка «Проверки хранилища» за раз. */
export const STORAGE_CHECK_ROWS = 1000;

/** «Проверка хранилища»: четыре списка расхождений и последняя сверка; не администратору — пусто. */
export async function adminStorageCheck(tx: Tx): Promise<{
  lists: Record<StorageCheckList, { rows: AdminStorageCheckRow[]; total: number }>;
  checkedAt: Date | null;
}> {
  const c = adminStorageCheckView;
  const lists = {} as Record<StorageCheckList, { rows: AdminStorageCheckRow[]; total: number }>;
  for (const kind of ['missing', 'extra', 'stuck', 'failed'] as const) {
    const rows = await tx
      .select()
      .from(c)
      .where(eq(c.kind, kind))
      .orderBy(desc(c.firstSeenAt), desc(c.id))
      .limit(STORAGE_CHECK_ROWS + 1);
    const total =
      rows.length > STORAGE_CHECK_ROWS
        ? Number(
            (
              await tx
                .select({ n: sql<number>`count(*)` })
                .from(c)
                .where(eq(c.kind, kind))
            )[0]?.n ?? 0,
          )
        : rows.length;
    lists[kind] = { rows: rows.slice(0, STORAGE_CHECK_ROWS), total };
  }
  const [run] = await tx
    .select({ at: storageCheckRuns.finishedAt })
    .from(storageCheckRuns)
    .where(and(eq(storageCheckRuns.state, 'done')))
    .orderBy(desc(storageCheckRuns.startedAt))
    .limit(1);
  return { lists, checkedAt: run?.at ?? null };
}

/** Одна открытая строка «Проверки хранилища» (для истории «Удалить»); не администратору — null. */
export async function adminStorageCheckItem(
  tx: Tx,
  id: number,
): Promise<AdminStorageCheckRow | null> {
  const c = adminStorageCheckView;
  const [row] = await tx.select().from(c).where(eq(c.id, id)).limit(1);
  return row ?? null;
}
