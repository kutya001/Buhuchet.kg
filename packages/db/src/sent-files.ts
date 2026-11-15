import {
  auditActorName,
  pageVisibleSections,
  RecordChangedError,
  RecordNotFoundError,
  SENT_COMPLETE_MINUTES,
  SENT_FILE_KEEP_DAYS,
  type IsoDate,
  type ListQuery,
  type PageSection,
  type SentFileSource,
  type SentFileState,
  type SentFileStatus,
} from '@buhuchet/domain';
import { alias } from 'drizzle-orm/pg-core';
import { and, desc, eq, gt, inArray, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Tx } from './client';
import { featureSet } from './org';
import { writeHistory } from './history';
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
import {
  contractorPages,
  contractors,
  contractorSentFiles,
  employees,
  files,
  orgSettings,
} from './schema';
import { dateLiteral } from './sql-text';
import { insertPendingFile, markFileReady, type NewFile } from './files';

/*
 * «Отправленные файлы» (доработки 14.11.2026, блок 2; прототип v112 `modules/cp-sent.js`): файлы, которые
 * контрагент прислал со своей страницы или боту в Telegram. Строку создаёт загрузка без входа — в
 * контексте организации без пользователя (`withOrgContext(…, { userId: null })`): страница по коду и бот
 * знают организацию до транзакции. Принять и отклонить может только сотрудник (решение — от своего имени,
 * политика `contractor_sent_files_update_guard`). Непринятые через 30 дней удаляет задача по расписанию.
 */

/** Отправленный файл глазами сотрудника и страницы контрагента. */
export interface SentFileRecord {
  id: string;
  contractorId: string;
  source: SentFileSource;
  /** Имя в Telegram того, кто прислал; у страницы — null. */
  senderName: string | null;
  comment: string | null;
  name: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  state: SentFileState;
  status: SentFileStatus;
  rejectReason: string | null;
  decidedBy: string | null;
  /** Кто принял или отклонил: краткое ФИО. */
  decidedByName: string | null;
  decidedAt: Date | null;
  /** Файл контрагента, которым стал принятый. */
  fileId: string | null;
  /** Ключ хранилища принятого файла, пока он не удалён из файлов контрагента. */
  fileStorageKey: string | null;
  createdAt: Date;
  /** День отправки по Бишкеку. */
  sentDate: IsoDate;
  version: number;
}

const decider = alias(employees, 'sent_decider');
const accepted = alias(files, 'sent_accepted');

const SENT_DATE = sql<string>`to_char(${contractorSentFiles.createdAt} at time zone 'Asia/Bishkek', 'YYYY-MM-DD')`;

const recordFields = {
  id: contractorSentFiles.id,
  contractorId: contractorSentFiles.contractorId,
  source: contractorSentFiles.source,
  senderName: contractorSentFiles.senderName,
  comment: contractorSentFiles.comment,
  name: contractorSentFiles.name,
  contentType: contractorSentFiles.contentType,
  sizeBytes: contractorSentFiles.sizeBytes,
  storageKey: contractorSentFiles.storageKey,
  state: contractorSentFiles.state,
  status: contractorSentFiles.status,
  rejectReason: contractorSentFiles.rejectReason,
  decidedBy: contractorSentFiles.decidedBy,
  decidedByName: decider.shortName,
  decidedAt: contractorSentFiles.decidedAt,
  fileId: contractorSentFiles.fileId,
  fileStorageKey: sql<
    string | null
  >`(case when ${accepted.state} = 'ready' then ${accepted.storageKey} end)`,
  createdAt: contractorSentFiles.createdAt,
  sentDate: SENT_DATE,
  version: contractorSentFiles.version,
};

type RecordRow = Omit<SentFileRecord, 'decidedByName'> & { decidedByName: string | null };

function toRecord(r: RecordRow): SentFileRecord {
  return {
    ...r,
    sizeBytes: Number(r.sizeBytes),
    decidedByName: r.decidedBy ? auditActorName(r.decidedBy, r.decidedByName) : null,
  };
}

function fromSent(tx: Tx) {
  return tx
    .select(recordFields)
    .from(contractorSentFiles)
    .leftJoin(decider, eq(decider.userId, contractorSentFiles.decidedBy))
    .leftJoin(accepted, eq(accepted.id, contractorSentFiles.fileId))
    .$dynamic();
}

/** Начатая загрузка: строка «pending» / «Новый»; номер задаёт вызывающий — из него ключ хранилища. */
export interface NewSentFile {
  id: string;
  contractorId: string;
  source: SentFileSource;
  senderName?: string | null;
  tgChatId?: number | null;
  comment: string | null;
  name: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
}

export async function insertPendingSentFiles(tx: Tx, rows: readonly NewSentFile[]): Promise<void> {
  if (!rows.length) return;
  // Организация — из контекста транзакции (у столбца нет значения по умолчанию).
  await tx
    .insert(contractorSentFiles)
    .values(rows.map((r) => ({ ...r, orgId: sql`app.current_org_id()` })));
}

/** Отправленный файл организации в любом состоянии; чужой организации и неверный номер — null. */
export async function getSentFile(
  tx: Tx,
  id: string,
  options: { lock?: boolean } = {},
): Promise<SentFileRecord | null> {
  const query = fromSent(tx).where(eq(contractorSentFiles.id, id));
  const [row] = options.lock ? await query.for('update', { of: contractorSentFiles }) : await query;
  return row ? toRecord(row as RecordRow) : null;
}

/**
 * Начатые со страницы загрузки контрагента по номерам (закончить отправку может только та же страница;
 * загрузку из Telegram сервер заканчивает сам), не старше `SENT_COMPLETE_MINUTES`.
 */
export async function pendingSentFiles(
  tx: Tx,
  contractorId: string,
  ids: readonly string[],
): Promise<SentFileRecord[]> {
  if (!ids.length) return [];
  const rows = await fromSent(tx)
    .where(
      and(
        eq(contractorSentFiles.contractorId, contractorId),
        eq(contractorSentFiles.source, 'page'),
        eq(contractorSentFiles.state, 'pending'),
        gt(
          contractorSentFiles.createdAt,
          sql`now() - make_interval(mins => ${SENT_COMPLETE_MINUTES})`,
        ),
        inArray(contractorSentFiles.id, [...ids]),
      ),
    )
    .for('update', { of: contractorSentFiles });
  return rows.map((r) => toRecord(r as RecordRow));
}

/** Загрузка закончена: файл в хранилище проверен — он «Новый» у контрагента. */
export async function markSentFilesReady(tx: Tx, ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const rows = await tx
    .update(contractorSentFiles)
    .set({
      state: 'ready',
      version: sql`${contractorSentFiles.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(inArray(contractorSentFiles.id, [...ids]), eq(contractorSentFiles.state, 'pending')))
    .returning({ id: contractorSentFiles.id });
  if (rows.length !== ids.length) throw new RecordNotFoundError('sent_file', ids.join(','));
}

/** Стереть незаконченные загрузки (файл не тот или не дошёл); загруженные не трогаются. */
export async function dropPendingSentFiles(tx: Tx, ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  await tx
    .delete(contractorSentFiles)
    .where(
      and(inArray(contractorSentFiles.id, [...ids]), eq(contractorSentFiles.state, 'pending')),
    );
}

/**
 * Отправки одного контрагента — по одной до конца транзакции: две одновременные не обойдут лимит
 * «20 в сутки» (проверка и вставка — под этой блокировкой).
 */
export async function lockSentFilesOf(tx: Tx, contractorId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('sent_files:' || ${contractorId}, 0))`,
  );
}

/**
 * Сколько файлов контрагент отправил за последние 24 часа — со страницы и из Telegram вместе (ТЗ: «не
 * больше 20 файлов в сутки от одного контрагента»), вместе с начатыми загрузками: незаконченная занимает
 * место, пока задача по расписанию не удалила её вместе с файлами в хранилище (`SENT_PENDING_TTL_MS`).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#И-7
export async function sentFilesLastDay(tx: Tx, contractorId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(contractorSentFiles)
    .where(
      and(
        eq(contractorSentFiles.contractorId, contractorId),
        gt(contractorSentFiles.createdAt, sql`now() - interval '24 hours'`),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Можно ли контрагенту отправлять файлы сейчас (прототип `sntUpOn`): страница включена, не закрыта,
 * контрагент не в архиве, раздел «Файлы» ему показан, галочки учётной политики и контрагента включены.
 * Нет контрагента — null.
 */
export async function sentUploadState(
  tx: Tx,
  contractorId: string,
): Promise<{
  pageOpen: boolean;
  sections: PageSection[];
  orgUpload: boolean;
  contractorUpload: boolean;
} | null> {
  const [row] = await tx
    .select({
      archived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
      enabled: contractorPages.enabled,
      closedAt: contractorPages.closedAt,
      hidden: contractorPages.hiddenSections,
      contractorUpload: contractorPages.filesUpload,
      orgSections: orgSettings.pageSections,
      features: orgSettings.features,
      orgUpload: orgSettings.cpFilesUpload,
    })
    .from(contractors)
    .innerJoin(orgSettings, eq(orgSettings.orgId, contractors.orgId))
    .leftJoin(contractorPages, eq(contractorPages.contractorId, contractors.id))
    .where(eq(contractors.id, contractorId));
  if (!row) return null;
  const features = featureSet(row.features);
  return {
    pageOpen: features.cppage && row.enabled === true && row.closedAt === null && !row.archived,
    sections: pageVisibleSections(
      row.orgSections as PageSection[],
      features,
      (row.hidden ?? []) as PageSection[],
    ),
    orgUpload: row.orgUpload,
    contractorUpload: row.contractorUpload ?? true,
  };
}

/** Контрагент раздела «Отправленные файлы»: название и ответственный (для области «Свои»). */
export async function sentContractor(
  tx: Tx,
  id: string,
): Promise<{
  id: string;
  name: string;
  responsibleEmployeeId: string | null;
  /** В архиве: деньги по чеку от него сразу не принимаются (прототип v115 `pgRcptMoney`). */
  archived: boolean;
} | null> {
  const [row] = await tx
    .select({
      id: contractors.id,
      name: contractors.name,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
      serviceStatus: contractors.serviceStatus,
    })
    .from(contractors)
    .where(eq(contractors.id, id));
  if (!row) return null;
  const { serviceStatus, ...rest } = row;
  return { ...rest, archived: serviceStatus === 'archived' };
}

/** Загруженные отправленные файлы контрагента — от новых к старым (раздел карточки и страница). */
export async function listContractorSentFiles(
  tx: Tx,
  contractorId: string,
): Promise<SentFileRecord[]> {
  const rows = await fromSent(tx)
    .where(
      and(
        eq(contractorSentFiles.contractorId, contractorId),
        eq(contractorSentFiles.state, 'ready'),
      ),
    )
    .orderBy(desc(contractorSentFiles.createdAt), desc(contractorSentFiles.id));
  return rows.map((r) => toRecord(r as RecordRow));
}

/**
 * Сколько новых (не принятых и не отклонённых) файлов у контрагентов в области `scope` группы
 * «Файловый менеджер» — счётчик у пункта меню и вкладки (прототип `sntNew`).
 */
export async function sentFilesNewCount(tx: Tx, scope: SQL | undefined): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(contractorSentFiles)
    .innerJoin(contractors, eq(contractors.id, contractorSentFiles.contractorId))
    .where(
      and(eq(contractorSentFiles.state, 'ready'), eq(contractorSentFiles.status, 'new'), scope),
    );
  return row?.n ?? 0;
}

/**
 * Имена документов контрагента (загруженные вручную, из свидетельства и выписки, принятые от него) — для
 * «Имя (2).pdf» у принятого (прототип `sntAccept`: `c.files`).
 */
export async function contractorDocumentNames(tx: Tx, contractorId: string): Promise<string[]> {
  const rows = await tx
    .select({ name: files.name })
    .from(files)
    .where(
      and(
        eq(files.contractorId, contractorId),
        eq(files.state, 'ready'),
        inArray(files.sourceKind, ['manual', 'contractor', 'sent_file']),
      ),
    );
  return rows.map((r) => r.name);
}

/** Решение по новому файлу уже принято (или файл ещё загружается) — «Файл уже принят или отклонён». */
export class SentFileDecidedError extends Error {
  constructor(readonly id: string) {
    super(`Отправленный файл ${id} уже принят или отклонён`);
    this.name = 'SentFileDecidedError';
  }
}

/**
 * Новый загруженный файл под блокировкой с проверкой версии; иначе — ошибки решения. Принятый и
 * отклонённый блокировкой не читаются (политика правки пропускает только «Новый»), поэтому сначала —
 * чтение без блокировки: так «уже решён» отличается от «нет такого».
 */
async function lockNew(tx: Tx, id: string, version: number): Promise<SentFileRecord> {
  const seen = await getSentFile(tx, id);
  if (!seen || seen.state !== 'ready') throw new RecordNotFoundError('sent_file', id);
  if (seen.status !== 'new') throw new SentFileDecidedError(id);
  const current = await getSentFile(tx, id, { lock: true });
  if (!current || current.status !== 'new') throw new SentFileDecidedError(id);
  if (current.version !== version) throw new RecordChangedError('sent_file', id, current.version);
  return current;
}

/**
 * «Принять» (прототип `sntAccept`): файл контрагента `file` (источник «От контрагента», копия в
 * хранилище уже сделана) становится видимым, отправленный — «Принят» со ссылкой на него, решение — от
 * имени того, кто вошёл. Ответ — отправленный файл до решения.
 */
export async function acceptSentFile(
  tx: Tx,
  input: { id: string; version: number; file: NewFile },
): Promise<SentFileRecord> {
  const current = await lockNew(tx, input.id, input.version);
  await insertPendingFile(tx, input.file);
  await markFileReady(tx, input.file.id);
  await tx
    .update(contractorSentFiles)
    .set({
      status: 'accepted',
      fileId: input.file.id,
      decidedBy: sql`app.current_user_id()`,
      decidedAt: sql`now()`,
      version: sql`${contractorSentFiles.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(contractorSentFiles.id, input.id));
  return current;
}

/** «Отклонить» с причиной (прототип `sntRejectDlg`); ответ — отправленный файл до решения. */
export async function rejectSentFile(
  tx: Tx,
  input: { id: string; version: number; reason: string },
): Promise<SentFileRecord> {
  const current = await lockNew(tx, input.id, input.version);
  await tx
    .update(contractorSentFiles)
    .set({
      status: 'rejected',
      rejectReason: input.reason,
      decidedBy: sql`app.current_user_id()`,
      decidedAt: sql`now()`,
      version: sql`${contractorSentFiles.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(contractorSentFiles.id, input.id));
  return current;
}

/** Что удалит задача по расписанию: строка и её файл в хранилище. */
export interface StaleSentFile {
  id: string;
  contractorId: string;
  name: string;
  storageKey: string;
  state: SentFileState;
}

/**
 * Непринятые файлы, отправленные `upTo` по Бишкеку и раньше (`sentFilePurgeUpTo`), и незаконченные
 * загрузки старше `pendingBefore` — не больше `limit`. Принятые не удаляются никогда.
 */
export async function staleSentFiles(
  tx: Tx,
  o: { upTo: IsoDate; pendingBefore: Date; limit: number },
): Promise<StaleSentFile[]> {
  return tx
    .select({
      id: contractorSentFiles.id,
      contractorId: contractorSentFiles.contractorId,
      name: contractorSentFiles.name,
      storageKey: contractorSentFiles.storageKey,
      state: contractorSentFiles.state,
    })
    .from(contractorSentFiles)
    .where(
      and(
        ne(contractorSentFiles.status, 'accepted'),
        or(
          and(
            eq(contractorSentFiles.state, 'ready'),
            lte(
              sql`(${contractorSentFiles.createdAt} at time zone 'Asia/Bishkek')::date`,
              dateLiteral(o.upTo),
            ),
          ),
          and(
            eq(contractorSentFiles.state, 'pending'),
            lt(contractorSentFiles.createdAt, o.pendingBefore),
          ),
        ),
      ),
    )
    .orderBy(contractorSentFiles.createdAt, contractorSentFiles.id)
    .limit(o.limit);
}

/**
 * Удалить строки, файлы которых уже убраны из хранилища (прототип `sntPurge`): у загруженного — запись
 * в историю контрагента от имени системы. Принятый (решение успели принять между выборкой и удалением)
 * и строка, которая сменила состояние после выборки, не удаляются. Ответ — сколько удалено.
 */
export async function dropSentFiles(tx: Tx, stale: readonly StaleSentFile[]): Promise<number> {
  if (!stale.length) return 0;
  const inState = (state: SentFileState) => {
    const ids = stale.filter((s) => s.state === state).map((s) => s.id);
    return ids.length
      ? and(inArray(contractorSentFiles.id, ids), eq(contractorSentFiles.state, state))
      : undefined;
  };
  const gone = await tx
    .delete(contractorSentFiles)
    .where(
      and(or(inState('pending'), inState('ready')), ne(contractorSentFiles.status, 'accepted')),
    )
    .returning({
      id: contractorSentFiles.id,
      contractorId: contractorSentFiles.contractorId,
      name: contractorSentFiles.name,
      state: contractorSentFiles.state,
    });
  for (const row of gone) {
    if (row.state !== 'ready') continue;
    await writeHistory(tx, {
      entity: 'sent_file',
      entityId: row.id,
      action: 'sent_file_purge',
      contractorId: row.contractorId,
      changes: [{ field: 'file', to: row.name }],
      reason: null,
    });
  }
  return gone.length;
}

/* ═════════════ Вкладка «Файлы от контрагентов» Файлового менеджера ═════════════ */

/** Кто смотрит вкладку: область группы «Файловый менеджер», тексты словаря и «сегодня» по Бишкеку. */
export interface SentFileListOptions {
  t: ListTexts;
  scope: SQL | undefined;
  today: IsoDate;
}

const responsible = alias(employees, 'sent_responsible');

/** Сколько дней до удаления непринятого (как `sentFileDaysLeft`); у принятого — null. */
function daysLeft(today: IsoDate): SQL {
  return sql`(case when ${contractorSentFiles.status} = 'accepted' then null else greatest(0, ${SENT_FILE_KEEP_DAYS} - (${dateLiteral(today)} - (${contractorSentFiles.createdAt} at time zone 'Asia/Bishkek')::date)) end)`;
}

/** «Порядок: новые сначала» (прототип `ord`): «Новый» выше, внутри — от новых к старым. */
const ORDER = sql`((case when ${contractorSentFiles.status} = 'new' then '2' else '1' end) || to_char(${contractorSentFiles.createdAt} at time zone 'UTC', 'YYYYMMDDHH24MISSUS'))`;

/**
 * Столбцы вкладки (прототип `renderSent` → `grid` `files-sent`): ключи — как у столбцов экрана. Тексты
 * словаря — только в `display`: по `value` группируют `group by`.
 */
export function sentFileListColumns(o: Pick<SentFileListOptions, 't' | 'today'>): ListColumns {
  const { t } = o;
  const status = contractorSentFiles.status;
  const source = contractorSentFiles.source;
  const who = sql`(case when ${source} = 'page' then ${t('files.sent.who.page')} else coalesce(${contractorSentFiles.senderName}, ${t('files.sent.src.telegram')}) end)`;
  return {
    name: { type: 'text', label: 'files.sent.col.name', value: contractorSentFiles.name },
    cp: {
      type: 'enum',
      label: 'files.sent.col.cp',
      value: contractorSentFiles.contractorId,
      display: contractors.name,
      sort: { value: contractors.name, text: true },
      digits: contractors.inn,
    },
    st: {
      type: 'enum',
      label: 'files.sent.col.st',
      value: status,
      display: sql`(case ${status} when 'new' then ${t('files.sent.st.new')} when 'accepted' then ${t('files.sent.st.accepted')} else ${t('files.sent.st.rejected')} end)`,
      sort: {
        value: sql`(case ${status} when 'new' then 0 when 'accepted' then 1 else 2 end)`,
        text: false,
      },
    },
    src: {
      type: 'enum',
      label: 'files.sent.col.src',
      value: source,
      display: sql`(case ${source} when 'page' then ${t('files.sent.src.page')} else ${t('files.sent.src.telegram')} end)`,
    },
    who: {
      type: 'text',
      label: 'files.sent.col.who',
      value: sql`(case when ${source} = 'page' then null else ${contractorSentFiles.senderName} end)`,
      display: who,
    },
    at: {
      type: 'date',
      label: 'files.sent.col.at',
      value: sql`(${contractorSentFiles.createdAt} at time zone 'Asia/Bishkek')::date`,
    },
    note: { type: 'text', label: 'files.sent.col.note', value: contractorSentFiles.comment },
    resp: {
      type: 'enum',
      label: 'files.sent.col.resp',
      value: contractors.responsibleEmployeeId,
      display: responsible.shortName,
      sort: { value: responsible.shortName, text: true },
    },
    left: {
      type: 'int',
      label: 'files.sent.col.left',
      value: daysLeft(o.today),
    },
    ord: { type: 'text', label: 'files.sent.col.ord', value: ORDER },
  };
}

/** Видны загруженные файлы контрагентов в области группы «Файловый менеджер». */
function sentListScope(scope: SQL | undefined): SQL {
  return and(eq(contractorSentFiles.state, 'ready'), scope)!;
}

function sentRowFields(today: IsoDate) {
  return {
    ...recordFields,
    contractorName: contractors.name,
    contractorResponsible: contractors.responsibleEmployeeId,
    responsibleName: responsible.shortName,
    daysLeft: daysLeft(today),
  };
}

function fromSentList(tx: Tx, fields: object) {
  return tx
    .select(fields as Record<string, SQL>)
    .from(contractorSentFiles)
    .innerJoin(contractors, eq(contractors.id, contractorSentFiles.contractorId))
    .leftJoin(responsible, eq(responsible.id, contractors.responsibleEmployeeId))
    .leftJoin(decider, eq(decider.userId, contractorSentFiles.decidedBy))
    .leftJoin(accepted, eq(accepted.id, contractorSentFiles.fileId))
    .$dynamic();
}

const sentListFrom =
  (tx: Tx): ListFrom =>
  (fields) =>
    fromSentList(tx, fields);

/** Строка вкладки «Файлы от контрагентов». */
export interface SentFileListRow extends SentFileRecord {
  contractor: { id: string; name: string; responsibleEmployeeId: string | null };
  responsibleName: string | null;
}

type SentRowData = Record<keyof ReturnType<typeof sentRowFields>, unknown>;

function toListRow(r: SentRowData): SentFileListRow {
  const base = toRecord(r as unknown as RecordRow);
  return {
    ...base,
    contractor: {
      id: base.contractorId,
      name: (r.contractorName as string | null) ?? '',
      responsibleEmployeeId: (r.contractorResponsible as string | null) ?? null,
    },
    responsibleName: (r.responsibleName as string | null) ?? null,
  };
}

const SENT_NATURAL = [contractorSentFiles.createdAt, contractorSentFiles.id];

/** Страница вкладки: сортировка, страница, фильтры, поиск и группы — на сервере. */
export async function listSentFilesPage(
  tx: Tx,
  query: ListQuery,
  o: SentFileListOptions,
): Promise<ListPageResult<SentFileListRow>> {
  const fields = sentRowFields(o.today);
  const page = await selectListPage({
    query,
    columns: sentFileListColumns(o),
    natural: SENT_NATURAL,
    scope: sentListScope(o.scope),
    select: ({ window, where, orderBy, limit, offset }) =>
      fromSentList(tx, { ...fields, ...window } as typeof fields & ListWindowFields)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset) as unknown as Promise<
        (SentRowData & {
          listTotal: number;
          listTotals: Record<string, number> | null;
          listGroups: string[] | null;
        })[]
      >,
    from: sentListFrom(tx),
  });
  return { ...page, rows: page.rows.map((r) => toListRow(r as SentRowData)) };
}

/** Значения столбца для фильтра-галочек — среди видимых файлов. */
export function listSentFileValues(tx: Tx, key: string, o: SentFileListOptions, q?: string) {
  return selectListValues({
    columns: sentFileListColumns(o),
    key,
    scope: sentListScope(o.scope),
    from: sentListFrom(tx),
    q,
  });
}

/** Файлы для выгрузки в Excel: все под поиском и фильтрами. */
export function exportSentFiles(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  o: SentFileListOptions,
) {
  return selectListExport({
    query,
    columns: sentFileListColumns(o),
    keys,
    natural: SENT_NATURAL,
    scope: sentListScope(o.scope),
    from: sentListFrom(tx),
  });
}
