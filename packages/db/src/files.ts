import {
  auditActorName,
  FILE_SOURCE_KINDS,
  RecordChangedError,
  RecordNotFoundError,
  type FileSourceKind,
  type ListQuery,
} from '@buhuchet/domain';
import { and, asc, eq, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
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
  type ListWindowFields,
} from './list';
import {
  contractors,
  employees,
  files,
  indicators,
  indicatorValues,
  tasks,
  type FileState,
} from './schema';
import { textLiteral } from './sql-text';

/** Описание файла организации (без комментария ручной загрузки — он у Файлового менеджера). */
export interface FileRecord {
  id: string;
  sourceKind: string;
  sourceId: string | null;
  contractorId: string | null;
  name: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  state: FileState;
  /** Пользователь, который загрузил. */
  createdBy: string;
  /** Кто загрузил: краткое ФИО сотрудника. */
  uploadedBy: string | null;
  createdAt: Date;
  version: number;
}

const columns = {
  id: files.id,
  sourceKind: files.sourceKind,
  sourceId: files.sourceId,
  contractorId: files.contractorId,
  name: files.name,
  contentType: files.contentType,
  sizeBytes: files.sizeBytes,
  storageKey: files.storageKey,
  state: files.state,
  createdBy: files.createdBy,
  createdByName: employees.shortName,
  createdAt: files.createdAt,
  version: files.version,
};

type FileRow = Omit<FileRecord, 'uploadedBy'> & { createdByName: string | null };

function record({ createdByName, ...r }: FileRow): FileRecord {
  return { ...r, uploadedBy: auditActorName(r.createdBy, createdByName) };
}

/** Начатая загрузка: запись «pending» от имени пользователя запроса (автора ставит база). */
export interface NewFile {
  id: string;
  sourceKind: string;
  sourceId: string | null;
  contractorId: string | null;
  name: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  /** Комментарий ручной загрузки (Файловый менеджер). */
  note?: string | null;
}

export async function insertPendingFile(tx: Tx, file: NewFile): Promise<void> {
  await tx.insert(files).values(file);
}

/** Файл организации в любом состоянии; чужой организации и неверный номер — null. */
export async function getFile(tx: Tx, id: string, options: { lock?: boolean } = {}) {
  const query = tx
    .select(columns)
    .from(files)
    .leftJoin(employees, eq(employees.userId, files.createdBy))
    .where(eq(files.id, id));
  const [row] = options.lock ? await query.for('update', { of: files }) : await query;
  return row ? record(row) : null;
}

/**
 * Файлы записи в блоке «Файлы»: загруженные и не удалённые, по порядку загрузки. У «Загружен вручную»
 * (записи нет) — только общие файлы организации: файл контрагента виден в его карточке и Файловом
 * менеджере, в его области.
 */
export async function listSourceFiles(
  tx: Tx,
  sourceKind: string,
  sourceId: string | null,
): Promise<FileRecord[]> {
  const rows = await tx
    .select(columns)
    .from(files)
    .leftJoin(employees, eq(employees.userId, files.createdBy))
    .where(
      and(
        eq(files.state, 'ready'),
        eq(files.sourceKind, sourceKind),
        sourceId === null ? isNull(files.sourceId) : eq(files.sourceId, sourceId),
        sourceKind === 'manual' ? isNull(files.contractorId) : undefined,
      ),
    )
    .orderBy(asc(files.createdAt), asc(files.id));
  return rows.map(record);
}

/** Загрузка закончена: файл в хранилище проверен — он виден в записи. */
export async function markFileReady(tx: Tx, id: string): Promise<void> {
  const rows = await tx
    .update(files)
    .set({
      state: 'ready',
      version: sql`${files.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(and(eq(files.id, id), eq(files.state, 'pending')))
    .returning({ id: files.id });
  if (rows.length !== 1) throw new RecordNotFoundError('file', id);
}

/**
 * Удалить файл с защитой от одновременной правки: отметка «deleted» с автором и временем (ссылки из
 * «Истории статусов» остаются). Устаревшая версия — `RecordChangedError`, нет файла — `RecordNotFoundError`.
 */
export async function markFileDeleted(tx: Tx, id: string, version: number): Promise<void> {
  const current = await getFile(tx, id, { lock: true });
  if (!current || current.state !== 'ready') throw new RecordNotFoundError('file', id);
  if (current.version !== version) throw new RecordChangedError('file', id, current.version);
  await tx
    .update(files)
    .set({
      state: 'deleted',
      deletedAt: sql`now()`,
      deletedBy: sql`app.current_user_id()`,
      version: sql`${files.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(and(eq(files.id, id), eq(files.version, version)));
}

/** Убрать запись незаконченной загрузки (файл не дошёл или оказался больше предела). */
export async function dropPendingFile(tx: Tx, id: string): Promise<void> {
  await tx.delete(files).where(and(eq(files.id, id), eq(files.state, 'pending')));
}

/**
 * Незаконченные загрузки, начатые раньше `before`, — не больше `limit` за раз: задача по расписанию
 * удаляет их файлы из хранилища (если что-то дошло) и сами записи (`dropPendingFiles`).
 */
export function stalePendingFiles(
  tx: Tx,
  before: Date,
  limit: number,
): Promise<{ id: string; storageKey: string }[]> {
  return tx
    .select({ id: files.id, storageKey: files.storageKey })
    .from(files)
    .where(and(eq(files.state, 'pending'), lt(files.createdAt, before)))
    .orderBy(asc(files.createdAt))
    .limit(limit);
}

export async function dropPendingFiles(tx: Tx, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.delete(files).where(and(inArray(files.id, [...ids]), eq(files.state, 'pending')));
}

/* ───────────── Файловый менеджер (задача 2.29) ───────────── */

/*
 * Список всех файлов организации (ТЗ «Файловый менеджер»; прототип modules/files.js — `allFiles`,
 * `renderFiles`): загруженные файлы всех видов источника, которые видит сотрудник. Видимость складывается
 * из области группы «Файловый менеджер» по контрагенту файла (`files.contractor_id`; общий файл виден
 * всем с правом просмотра) и видимости записи-источника в её модуле — условие даёт источник
 * (`FileListPart`). Поиск, фильтры, сортировка, группы и выгрузка — общим механизмом списков.
 */

/** Файлы одного вида источника в списке: какие из них видны и что написать в «Источнике». */
export interface FileListPart {
  /** Условие над `files`: запись-источник видна сотруднику; undefined — видны все файлы вида. */
  visible: SQL | undefined;
  /** Источник, как на экране, — без параметров запроса (по нему группируют). */
  source: SQL;
  /** Чем ещё найти запись для «Перейти к источнику» (месяц значения показателя); нет — null. */
  ref?: SQL;
}

/** Виды источника, которые видит сотрудник; вида нет — его файлов не видно. */
export type FileListParts = Readonly<Partial<Record<FileSourceKind, FileListPart>>>;

/** «Загружен вручную»: файл без записи, виден по одной области группы «Файловый менеджер». */
export function manualFilesPart(t: ListTexts): FileListPart {
  return { visible: undefined, source: sql`${textLiteral(t('files.kind.manual'))}::text` };
}

/**
 * Файлы задач: видна задача (`access` — условие видимости задачи над `tasks` и присоединённым
 * контрагентом задачи, как у `getTask`); источник — название задачи (прототип: `t.title`).
 */
export function taskFilesPart(access: SQL | undefined): FileListPart {
  return {
    visible: sql`exists (select 1 from ${tasks} left join ${contractors} on ${contractors.id} = ${tasks.contractorId} where ${tasks.id} = ${files.sourceId} and ${access ?? sql`true`})`,
    source: sql`(select ${tasks.title} from ${tasks} where ${tasks.id} = ${files.sourceId})`,
  };
}

/**
 * Файлы значений показателей: значение контрагента в области `scope` группы «Показатели контрагентов»
 * (`contractorScope`); источник — «Показатель «Выручка» · 09.2026», для перехода — месяц значения.
 */
export function indicatorFilesPart(scope: SQL | undefined, t: ListTexts): FileListPart {
  const month = sql`(substr(${indicatorValues.month}, 6, 2) || '.' || substr(${indicatorValues.month}, 1, 4))`;
  const label = sql`replace(replace(${textLiteral(t('files.src.indicator'))}::text, '{name}', ${indicators.name}), '{month}', ${month})`;
  return {
    visible: sql`exists (select 1 from ${indicatorValues} join ${contractors} on ${contractors.id} = ${indicatorValues.contractorId} where ${indicatorValues.id} = ${files.sourceId} and ${scope ?? sql`true`})`,
    source: sql`(select ${label} from ${indicatorValues} join ${indicators} on ${indicators.id} = ${indicatorValues.indicatorId} where ${indicatorValues.id} = ${files.sourceId})`,
    ref: sql`(select ${indicatorValues.month} from ${indicatorValues} where ${indicatorValues.id} = ${files.sourceId})`,
  };
}

/** Кто смотрит список: область группы «Файловый менеджер» и видимые виды источника. */
export interface FileListOptions {
  t: ListTexts;
  /** Область «Свои контрагенты» (`contractorScope`) над присоединённым контрагентом файла. */
  scope: SQL | undefined;
  parts: FileListParts;
}

const uploader = employees;

/** Виды источника по порядку модулей ТЗ — для сортировки «Откуда». */
const KIND_ORDER = sql.raw(
  `case "files"."source_kind" ${FILE_SOURCE_KINDS.map((k, i) => `when '${k}' then ${i}`).join(' ')} else ${FILE_SOURCE_KINDS.length} end`,
);

/** Выражение по виду источника: `case files.source_kind when … then … end`. */
function byKind(parts: FileListParts, pick: (part: FileListPart) => SQL | undefined): SQL {
  const cases = Object.entries(parts).flatMap(([kind, part]) => {
    const value = pick(part);
    return value ? [sql`when ${textLiteral(kind)} then ${value}`] : [];
  });
  return cases.length
    ? sql`(case ${files.sourceKind} ${sql.join(cases, sql` `)} end)`
    : sql`null::text`;
}

/** Расширение прописными, как `fext` прототипа (`fileExtension`); нет расширения — null. */
const EXT = sql`(case when ${files.name} ~ '^.+\.[^.]+$' then upper(substring(${files.name} from '\.([^.]+)$')) end)`;

/** «37 КБ», «1,2 МБ» — как `fileSizeParts`. */
function sizeText(t: ListTexts): SQL {
  const kb = sql`replace(${t('files.size.kb')}::text, '{n}', round(${files.sizeBytes} / 1024.0)::text)`;
  const mb = sql`replace(${t('files.size.mb')}::text, '{n}', replace(round(${files.sizeBytes} / 1048576.0, 1)::text, '.', ','))`;
  return sql`case when ${files.sizeBytes} < 1048576 then ${kb} else ${mb} end`;
}

const UPLOADED_BY = auditActorValue(files.createdBy, uploader.shortName);

/**
 * Столбцы списка (прототип `renderFiles` → `grid` `files`): ключи — как у столбцов экрана. У общего файла
 * «Контрагент» пуст («(Пусто)» в фильтре), на экране — «общий файл».
 */
export function fileListColumns(o: Pick<FileListOptions, 't' | 'parts'>): ListColumns {
  const { t } = o;
  const kindText = sql`(case ${files.sourceKind} ${sql.join(
    FILE_SOURCE_KINDS.map((k) => sql`when ${k} then ${t(`files.kind.${k}`)}`),
    sql` `,
  )} end)`;
  return {
    name: { type: 'text', label: 'files.col.name', value: files.name },
    ext: {
      type: 'enum',
      label: 'files.col.ext',
      value: EXT,
      display: sql`coalesce(${EXT}, ${t('files.no_ext')})`,
    },
    kind: {
      type: 'enum',
      label: 'files.col.kind',
      value: files.sourceKind,
      display: kindText,
      sort: { value: KIND_ORDER, text: false },
    },
    src: { type: 'text', label: 'files.col.src', value: byKind(o.parts, (p) => p.source) },
    cp: {
      type: 'enum',
      label: 'files.col.cp',
      value: files.contractorId,
      display: contractors.name,
      searchDisplay: sql`coalesce(${contractors.name}, ${t('files.cp.general')})`,
      sort: { value: contractors.name, text: true },
    },
    date: {
      type: 'date',
      label: 'files.col.date',
      value: sql`(${files.createdAt} at time zone 'Asia/Bishkek')::date`,
    },
    size: {
      type: 'int',
      label: 'files.col.size',
      value: files.sizeBytes,
      display: sizeText(t),
      total: true,
    },
    by: { type: 'enum', label: 'files.col.by', value: UPLOADED_BY },
    desc: { type: 'text', label: 'files.col.desc', value: files.note },
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: files.createdAt },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: files.updatedAt },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: UPLOADED_BY },
    updatedBy: { type: 'enum', label: 'grid.col.updated_by', value: UPLOADED_BY },
  };
}

/**
 * Какие файлы видит сотрудник: загруженные, в области группы «Файловый менеджер» (общий файл — всем),
 * только видимых ему видов источника и записей.
 */
function listScope(o: Pick<FileListOptions, 'scope' | 'parts'>): SQL {
  const kinds = Object.entries(o.parts).map(([kind, part]) =>
    and(eq(files.sourceKind, kind), part.visible),
  );
  return and(
    eq(files.state, 'ready'),
    o.scope ? or(isNull(files.contractorId), o.scope) : undefined,
    kinds.length ? or(...kinds) : sql`false`,
  )!;
}

function rowFields(parts: FileListParts) {
  return {
    id: files.id,
    name: files.name,
    contentType: files.contentType,
    sizeBytes: files.sizeBytes,
    sourceKind: files.sourceKind,
    sourceId: files.sourceId,
    source: byKind(parts, (p) => p.source),
    sourceRef: byKind(parts, (p) => p.ref),
    contractorId: files.contractorId,
    contractorName: contractors.name,
    note: files.note,
    createdBy: files.createdBy,
    createdByName: uploader.shortName,
    createdAt: files.createdAt,
    updatedAt: files.updatedAt,
    version: files.version,
  };
}

/** Файлы с контрагентом файла и тем, кто загрузил. */
function fromFiles(tx: Tx, fields: object) {
  return tx
    .select(fields as Record<string, SQL>)
    .from(files)
    .leftJoin(contractors, eq(contractors.id, files.contractorId))
    .leftJoin(uploader, eq(uploader.userId, files.createdBy))
    .$dynamic();
}

const fileListFrom =
  (tx: Tx): ListFrom =>
  (fields) =>
    fromFiles(tx, fields);

/** Строка Файлового менеджера. */
export interface FileManagerRow {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  sourceKind: string;
  sourceId: string | null;
  /** Источник, как на экране. */
  source: string;
  /** Чем ещё найти запись-источник (месяц значения показателя). */
  sourceRef: string | null;
  contractor: { id: string; name: string } | null;
  note: string | null;
  createdBy: string;
  uploadedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

type RowData = Record<keyof ReturnType<typeof rowFields>, unknown>;

function toRow(r: RowData): FileManagerRow {
  const contractorId = r.contractorId as string | null;
  return {
    id: r.id as string,
    name: r.name as string,
    contentType: r.contentType as string,
    sizeBytes: Number(r.sizeBytes),
    sourceKind: r.sourceKind as string,
    sourceId: (r.sourceId as string | null) ?? null,
    source: (r.source as string | null) ?? '',
    sourceRef: (r.sourceRef as string | null) ?? null,
    contractor: contractorId
      ? { id: contractorId, name: (r.contractorName as string | null) ?? '' }
      : null,
    note: (r.note as string | null) ?? null,
    createdBy: r.createdBy as string,
    uploadedBy: auditActorName(r.createdBy as string, r.createdByName as string | null),
    createdAt: r.createdAt as Date,
    updatedAt: r.updatedAt as Date,
    version: r.version as number,
  };
}

const FILE_NATURAL = [files.createdAt, files.id];

/** Страница Файлового менеджера: сортировка, страница, фильтры, поиск и группы — на сервере. */
export async function listFilesPage(
  tx: Tx,
  query: ListQuery,
  o: FileListOptions,
): Promise<ListPageResult<FileManagerRow>> {
  const fields = rowFields(o.parts);
  const page = await selectListPage({
    query,
    columns: fileListColumns(o),
    natural: FILE_NATURAL,
    scope: listScope(o),
    select: ({ window, where, orderBy, limit, offset }) =>
      fromFiles(tx, { ...fields, ...window } as typeof fields & ListWindowFields)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset) as unknown as Promise<
        (RowData & {
          listTotal: number;
          listTotals: Record<string, number> | null;
          listGroups: string[] | null;
        })[]
      >,
    from: fileListFrom(tx),
  });
  return { ...page, rows: page.rows.map((r) => toRow(r as RowData)) };
}

/** Значения столбца для фильтра-галочек — среди видимых файлов. */
export function listFileValues(tx: Tx, key: string, o: FileListOptions, q?: string) {
  return selectListValues({
    columns: fileListColumns(o),
    key,
    scope: listScope(o),
    from: fileListFrom(tx),
    q,
  });
}

/** Файлы для выгрузки в Excel: все под поиском и фильтрами. */
export function exportFiles(tx: Tx, query: ListQuery, keys: readonly string[], o: FileListOptions) {
  return selectListExport({
    query,
    columns: fileListColumns(o),
    keys,
    natural: FILE_NATURAL,
    scope: listScope(o),
    from: fileListFrom(tx),
  });
}

/**
 * Плашки и «Хранилище файлов»: видимые файлы по видам источника и их общий объём (прототип: плашки
 * `renderFiles`, «Занято … · файлов: N» в «Моя организация» → «Настройки»).
 */
export async function fileKindCounts(
  tx: Tx,
  o: Pick<FileListOptions, 'scope' | 'parts'>,
): Promise<{ kinds: Partial<Record<string, number>>; bytes: number; count: number }> {
  const rows = await tx
    .select({
      kind: files.sourceKind,
      count: sql<number>`count(*)::int`,
      bytes: sql<string>`coalesce(sum(${files.sizeBytes}), 0)::text`,
    })
    .from(files)
    .leftJoin(contractors, eq(contractors.id, files.contractorId))
    .where(listScope(o))
    .groupBy(files.sourceKind);
  return {
    kinds: Object.fromEntries(rows.map((r) => [r.kind, r.count])),
    bytes: rows.reduce((sum, r) => sum + Number(r.bytes), 0),
    count: rows.reduce((sum, r) => sum + r.count, 0),
  };
}

/** Контрагент файла: для области «Свои контрагенты» и запрета загрузки к архивному. */
export async function fileContractor(
  tx: Tx,
  id: string,
): Promise<{ id: string; responsibleEmployeeId: string | null; archived: boolean } | null> {
  const [row] = await tx
    .select({
      id: contractors.id,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
      archived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
    })
    .from(contractors)
    .where(eq(contractors.id, id));
  return row ?? null;
}

/** Контрагентов в окне «Загрузить файл» — не больше стольких (как в форме задачи). */
export const FILE_FORM_CONTRACTORS_MAX = 5000;

/**
 * Контрагенты окна «Загрузить файл» (прототип `visCps(false, 'files')`): не в архиве, в области
 * группы «Файловый менеджер», по названию.
 */
export function fileFormContractors(
  tx: Tx,
  scope: SQL | undefined,
): Promise<{ id: string; name: string }[]> {
  return tx
    .select({ id: contractors.id, name: contractors.name })
    .from(contractors)
    .where(and(ne(contractors.serviceStatus, 'archived'), scope))
    .orderBy(sql`${contractors.name} collate app.ru_natural`, asc(contractors.id))
    .limit(FILE_FORM_CONTRACTORS_MAX);
}
