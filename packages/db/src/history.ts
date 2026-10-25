import {
  diffChanges,
  RecordChangedError,
  RecordNotFoundError,
  redactChanges,
  type HistoryAction,
  type HistoryChange,
  type HistoryEntity,
} from '@buhuchet/domain';
import { and, asc, eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { auditLog } from './schema';

export interface HistoryEntry {
  entity: HistoryEntity;
  entityId: string;
  action: HistoryAction;
  changes?: HistoryChange[];
  /** Причина, если её спрашивают (изменение суммы, удаление). */
  reason?: string | null;
  contractorId?: string | null;
  /** Секретные поля сверх общего правила `isSecretField`: их значения в историю не попадают. */
  secretFields?: readonly string[];
}

/**
 * Записать в историю в текущей транзакции: если правка откатится, исчезнет и запись истории.
 * Организация, автор и время — из контекста `withOrgContext` (app.org_id, app.user_id); без автора —
 * система. Сама запись (её «Изменил», версия) при этом не меняется — это делает `updateWithHistory`.
 */
export async function writeHistory(tx: Tx, ...entries: HistoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await tx.insert(auditLog).values(
    entries.map((e) => ({
      entity: e.entity,
      entityId: e.entityId,
      action: e.action,
      changes: redactChanges(e.changes ?? [], e.secretFields),
      reason: e.reason?.trim() || null,
      contractorId: e.contractorId ?? null,
    })),
  );
}

/** История записи по порядку: сначала старые. */
export function readHistory(tx: Tx, entity: HistoryEntity, entityId: string) {
  return tx
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, entity), eq(auditLog.entityId, entityId)))
    .orderBy(asc(auditLog.at), asc(auditLog.id));
}

/** Таблица записей с версией: version и updated_at (и, если есть, updated_by). */
type VersionedTable = PgTable & { version: PgColumn; updatedAt: PgColumn };

/** Служебные поля меняет сам помощник, правка их не задаёт. */
const SERVICE_FIELDS = [
  'id',
  'orgId',
  'version',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
] as const;
type ServiceField = (typeof SERVICE_FIELDS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VersionedUpdate<T extends VersionedTable> {
  table: T;
  entity: HistoryEntity;
  /** Значение ключа записи. */
  id: string;
  /** Ключевой столбец, если он не `id` (у учётной политики — `org_id`); только уникальный. */
  key?: PgColumn;
  /** Версия, которую видел пользователь, когда открыл запись. */
  version: number;
  /**
   * Новые значения полей — собирать из явного списка полей формы, а не из тела запроса целиком.
   * Служебные поля и поля, которых нет в таблице, — ошибка.
   */
  patch: Omit<Partial<T['$inferInsert']>, ServiceField>;
  /**
   * Изменения дочерних записей, которые вызывающий уже сохранил в этой транзакции (права и
   * области роли): они тоже поднимают версию и попадают в историю вместе с изменениями полей.
   */
  changes?: HistoryChange[];
  /**
   * Дополнительное условие доступа (область «Свои контрагенты»): запись вне него — «не найдена»,
   * как и запись чужой организации.
   */
  where?: SQL;
  reason?: string | null;
  contractorId?: string | null;
  secretFields?: readonly string[];
}

/**
 * Правка записи с защитой от одновременной правки и историей в той же транзакции (ТЗ «Общие правила
 * для всей платформы»). Запись блокируется до конца транзакции; если её версия уже не та, что видел
 * пользователь, — `RecordChangedError` (API: 409 «Запись изменена другим пользователем»), и чужая
 * правка не затирается. Нет записи, она чужой организации или вне `where` — `RecordNotFoundError`.
 * Правка без изменений ничего не пишет и версию не меняет.
 */
export async function updateWithHistory<T extends VersionedTable>(
  tx: Tx,
  update: VersionedUpdate<T>,
): Promise<T['$inferSelect']> {
  const { table, entity, id, version } = update;
  const key = update.key ?? (table as unknown as { id?: PgColumn }).id;
  if (!key) throw new Error(`updateWithHistory(${entity}): у таблицы нет столбца id, укажите key`);
  const patch = checkedPatch(table, entity, update.patch as Record<string, unknown>);
  // Неверный номер записи — «не найдена», а не ошибка базы.
  if (key.getSQLType() === 'uuid' && !UUID_RE.test(id)) throw new RecordNotFoundError(entity, id);

  const match = and(eq(key, id), update.where);
  const [current] = (await tx
    .select()
    .from(table as PgTable)
    .where(match)
    .for('update')) as Record<string, unknown>[];
  if (!current) throw new RecordNotFoundError(entity, id);
  if (current.version !== version) {
    throw new RecordChangedError(entity, id, current.version as number);
  }

  const changes = [...diffChanges(current, patch, update.secretFields), ...(update.changes ?? [])];
  if (changes.length === 0) return current as T['$inferSelect'];

  const set: Record<string, unknown> = {
    ...patch,
    version: sql`${table.version} + 1`,
    updatedAt: sql`now()`,
  };
  if ('updatedBy' in table) set.updatedBy = sql`app.current_user_id()`;
  const rows = (await tx
    .update(table)
    .set(set as PgUpdateSetSource<T>)
    .where(and(match, eq(table.version, version)))
    .returning()) as T['$inferSelect'][];
  // Запись заблокирована и версия проверена выше, так что строк не может быть ноль; больше одной —
  // значит, `key` не уникален: ошибка, транзакция откатится.
  if (rows.length !== 1) {
    throw new Error(
      `updateWithHistory(${entity}): изменено строк — ${rows.length}, ожидалась одна`,
    );
  }
  const updated = rows[0]!;

  await writeHistory(tx, {
    entity,
    entityId: id,
    action: 'update',
    changes,
    reason: update.reason ?? null,
    contractorId: update.contractorId ?? null,
    secretFields: update.secretFields ?? [],
  });
  return updated;
}

/**
 * Правка только из столбцов таблицы и без служебных полей: проверка во время работы, потому что
 * объект-переменная с лишними полями проходит проверку типов.
 */
function checkedPatch(
  table: PgTable,
  entity: string,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const columns = getTableColumns(table);
  for (const field of Object.keys(patch)) {
    if (!Object.hasOwn(columns, field) || (SERVICE_FIELDS as readonly string[]).includes(field)) {
      throw new Error(`updateWithHistory(${entity}): поле «${field}» нельзя менять правкой`);
    }
  }
  return patch;
}
