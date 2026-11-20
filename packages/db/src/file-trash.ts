import type { FileLinkSourceKind } from '@buhuchet/domain';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { bigint, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Db, Tx } from './client';
import { fileTrash, type FileTrashReason } from './schema/files';

/*
 * «Ждут удаления» (доработки 20.11.2026, пакет 2, блок 5, пункты 3–4; этап 1, П6; миграции 0165, 0168,
 * docs/decisions.md п. И-11): удалённый файл стирается из хранилища не сразу, а через сутки. Строку
 * ставит тот, кто удалил, в своей транзакции (`insertFileTrash`); стирает задача «Файлы: стирание
 * удалённых» (`fileTrashDue` → хранилище → `fileTrashDone`, без вошедшего пользователя); «Вернуть» —
 * администратор платформы (`restoreFileTrash`), лишний файл хранилища удаляет он же
 * (`adminStorageExtraDelete`).
 */

type Exec = Db | Tx;

/** Ссылка удалённого файла на запись (`file_links`) — «Вернуть» ставит её снова. */
export interface FileTrashLink {
  sourceKind: FileLinkSourceKind;
  sourceId: string;
  createdBy: string;
  createdAt: string;
}

/** Строка «Ждут удаления» от сотрудника или задачи (лишний файл — только `adminStorageExtraDelete`). */
export interface FileTrashInsert {
  why: Exclude<FileTrashReason, 'extra'>;
  /** Удалённый файл — у `del`. */
  fileId?: string;
  storageKey: string;
  contractorId: string | null;
  name: string;
  sizeBytes: number;
  /** Откуда файл — код источника «Все файлы» (`card`, `report`, `sent`…). */
  source: string | null;
  links?: readonly FileTrashLink[];
}

/**
 * Поставить файлы в «Ждут удаления» — в транзакции организации того, кто удалил (задача — без
 * пользователя). Удалённый файл (`del`) — после `markFileDeleted` (политика вставки сверяет ключ с уже
 * удалённым файлом), прежний ключ после замены (`rep`) — после `changeFile`.
 */
export async function insertFileTrash(tx: Tx, rows: readonly FileTrashInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(fileTrash).values(
    rows.map((r) => ({
      why: r.why,
      fileId: r.fileId ?? null,
      storageKey: r.storageKey,
      contractorId: r.contractorId,
      contractorBound: r.contractorId !== null,
      name: r.name.slice(0, 255) || '—',
      sizeBytes: Math.max(0, Math.round(r.sizeBytes)),
      source: r.source ? r.source.slice(0, 100) : null,
      links: [...(r.links ?? [])].slice(0, 500),
    })),
  );
}

/** Сколько строк задача стирает за запуск. */
export const FILE_TRASH_BATCH = 500;

/**
 * Что стереть сейчас (срок — по часам базы). Ключ, который снова нужен живой записи, функция закрывает
 * без стирания и не отдаёт. Только без вошедшего пользователя — иначе пусто.
 */
export async function fileTrashDue(
  db: Exec,
  limit = FILE_TRASH_BATCH,
): Promise<{ id: string; storageKey: string }[]> {
  const rows = await db.execute<{ id: string; storage_key: string }>(
    sql`select id, storage_key from app.file_trash_due(${limit})`,
  );
  return rows.map((r) => ({ id: r.id, storageKey: r.storage_key }));
}

const uuidArray = (items: readonly string[]) =>
  items.length
    ? sql`array[${sql.join(
        items.map((k) => sql`${k}::uuid`),
        sql`, `,
      )}]::uuid[]`
    : sql`'{}'::uuid[]`;

/**
 * Итог попытки: стёртые отмечаются, у остальных — ещё одна попытка с ошибкой «storage». Ответ — сколько
 * строк после срока ещё ждёт стирания и сколько из них не стёрто `stuck` раз и больше.
 */
export async function fileTrashDone(
  db: Exec,
  o: { done: readonly string[]; failed: readonly string[]; stuck: number },
): Promise<{ left: number; stuck: number }> {
  const rows = await db.execute<{ left_count: number; stuck_count: number }>(sql`
    select left_count, stuck_count from app.file_trash_done(${uuidArray(o.done)},
      ${uuidArray(o.failed)}, ${o.stuck})`);
  return { left: Number(rows[0]?.left_count ?? 0), stuck: Number(rows[0]?.stuck_count ?? 0) };
}

const app = pgSchema('app');

/** «Ждут удаления» для Админки (миграция 0168): живые строки, только администратору платформы. */
export const adminFileTrashView = app
  .view('admin_file_trash', {
    id: uuid('id').notNull(),
    orgId: uuid('org_id'),
    orgName: text('org_name'),
    why: text('why').$type<FileTrashReason>().notNull(),
    fileId: uuid('file_id'),
    contractorId: uuid('contractor_id'),
    cpName: text('cp_name'),
    name: text('name').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    source: text('source'),
    links: integer('links').notNull(),
    attempts: integer('attempts').notNull(),
    lastError: text('last_error'),
    deletedBy: uuid('deleted_by'),
    deletedByName: text('deleted_by_name'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull(),
    eraseAt: timestamp('erase_at', { withTimezone: true }).notNull(),
  })
  .existing();

export type AdminFileTrashRow = typeof adminFileTrashView.$inferSelect;

/** Сколько строк «Ждут удаления» отдаётся окну за раз (за сутки их обычно единицы). */
export const ADMIN_TRASH_ROWS = 2000;

/** Строки «Ждут удаления» (организация — только её); не администратору — пусто. */
export async function adminFileTrash(
  tx: Tx,
  o: { orgId?: string } = {},
): Promise<{ rows: AdminFileTrashRow[]; total: number }> {
  const v = adminFileTrashView;
  const where = o.orgId ? eq(v.orgId, o.orgId) : undefined;
  const rows = await tx
    .select()
    .from(v)
    .where(where)
    .orderBy(asc(v.eraseAt), asc(v.id))
    .limit(ADMIN_TRASH_ROWS + 1);
  const total =
    rows.length > ADMIN_TRASH_ROWS
      ? Number(
          (
            await tx
              .select({ n: sql<number>`count(*)` })
              .from(v)
              .where(where)
          )[0]?.n ?? rows.length,
        )
      : rows.length;
  return { rows: rows.slice(0, ADMIN_TRASH_ROWS), total };
}

/** Одна строка «Ждут удаления» глазами администратора; нет или не администратор — null. */
export async function adminFileTrashRow(tx: Tx, id: string): Promise<AdminFileTrashRow | null> {
  const v = adminFileTrashView;
  const [row] = await tx.select().from(v).where(eq(v.id, id)).limit(1);
  return row ?? null;
}

/**
 * Строка удалённого файла с его ссылками — в контексте организации файла (RLS), для проверок «Вернуть»:
 * файл, его запись и контрагент, ссылки до удаления.
 */
export async function fileTrashForRestore(
  tx: Tx,
  id: string,
): Promise<{
  why: FileTrashReason;
  fileId: string | null;
  contractorId: string | null;
  /** Был файлом контрагента (контрагента с тех пор могли удалить). */
  contractorBound: boolean;
  links: FileTrashLink[];
  live: boolean;
} | null> {
  const [row] = await tx
    .select({
      why: fileTrash.why,
      fileId: fileTrash.fileId,
      contractorId: fileTrash.contractorId,
      contractorBound: fileTrash.contractorBound,
      links: fileTrash.links,
      live: sql<boolean>`${fileTrash.erasedAt} is null and ${fileTrash.restoredAt} is null and ${fileTrash.eraseAt} > now()`,
    })
    .from(fileTrash)
    .where(and(eq(fileTrash.id, id), isNull(fileTrash.erasedAt)))
    .limit(1);
  if (!row) return null;
  const links = Array.isArray(row.links) ? (row.links as FileTrashLink[]) : [];
  return { ...row, links };
}

export type FileTrashRestoreOutcome = 'ok' | 'denied' | 'missing' | 'gone' | 'kind' | 'record';

/**
 * «Вернуть» (функция базы `app.file_trash_restore`): удалённый файл — в контексте его организации от
 * имени администратора платформы, лишний файл — вне организации. `links` — ссылки, которые сервер
 * проверил (запись жива, тот же контрагент): только они и ставятся снова.
 */
export async function restoreFileTrash(
  tx: Tx,
  id: string,
  links: readonly { kind: string; id: string }[],
): Promise<FileTrashRestoreOutcome> {
  const rows = await tx.execute<{ outcome: FileTrashRestoreOutcome }>(sql`
    select app.file_trash_restore(${id}::uuid, ${JSON.stringify(links)}::jsonb) as outcome`);
  return rows[0]?.outcome ?? 'missing';
}

export type StorageExtraDeleteOutcome =
  'ok' | 'denied' | 'missing' | 'platform' | 'young' | 'in_use' | 'waiting';

/** Лишний файл старше стольких часов можно «Удалить» (загрузка может идти прямо сейчас). */
export const STORAGE_EXTRA_MIN_HOURS = 24;

/**
 * «Удалить» лишний файл хранилища — администратор платформы вне организации (функция
 * `app.admin_storage_extra_delete`): строка сверки, ещё одна проверка базы, строка «Ждут удаления».
 */
export async function adminStorageExtraDelete(
  tx: Tx,
  itemId: number,
): Promise<{ outcome: StorageExtraDeleteOutcome; trashId: string | null }> {
  const rows = await tx.execute<{
    outcome: StorageExtraDeleteOutcome;
    trash_id: string | null;
  }>(sql`
    select outcome, trash_id from app.admin_storage_extra_delete(${itemId}::bigint,
      ${STORAGE_EXTRA_MIN_HOURS})`);
  return { outcome: rows[0]?.outcome ?? 'missing', trashId: rows[0]?.trash_id ?? null };
}
