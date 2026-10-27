import { auditActorName, RecordChangedError, RecordNotFoundError } from '@buhuchet/domain';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { employees, files, type FileState } from './schema';

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

/** Файлы записи в блоке «Файлы»: загруженные и не удалённые, по порядку загрузки. */
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
