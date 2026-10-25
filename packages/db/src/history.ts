import {
  diffChanges,
  RecordChangedError,
  RecordNotFoundError,
  type HistoryAction,
  type HistoryChange,
  type HistoryEntity,
} from '@buhuchet/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
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
}

/**
 * Записать в историю в текущей транзакции: если правка откатится, исчезнет и запись истории.
 * Организация и автор — из контекста `withOrgContext` (app.org_id, app.user_id); без автора — система.
 */
export async function writeHistory(tx: Tx, ...entries: HistoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await tx.insert(auditLog).values(
    entries.map((e) => ({
      entity: e.entity,
      entityId: e.entityId,
      action: e.action,
      changes: e.changes ?? [],
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

/** Таблица записей с версией: id, version, updated_at (и, если есть, updated_by). */
type VersionedTable = PgTable & { id: PgColumn; version: PgColumn; updatedAt: PgColumn };

/** Служебные поля меняет сам помощник, правка их не задаёт. */
type ServiceField =
  'id' | 'orgId' | 'version' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy';

export interface VersionedUpdate<T extends VersionedTable> {
  table: T;
  entity: HistoryEntity;
  id: string;
  /** Версия, которую видел пользователь, когда открыл запись. */
  version: number;
  patch: Omit<Partial<T['$inferInsert']>, ServiceField>;
  reason?: string | null;
  contractorId?: string | null;
}

/**
 * Правка записи с защитой от одновременной правки и историей в той же транзакции (ТЗ «Общие правила
 * для всей платформы»). Запись блокируется до конца транзакции; если её версия уже не та, что видел
 * пользователь, — `RecordChangedError` (API: 409 «Запись изменена другим пользователем»), и чужая
 * правка не затирается. Нет записи или она чужой организации — `RecordNotFoundError`.
 * Правка без изменений ничего не пишет и версию не меняет.
 */
export async function updateWithHistory<T extends VersionedTable>(
  tx: Tx,
  update: VersionedUpdate<T>,
): Promise<T['$inferSelect']> {
  const { table, entity, id, version } = update;
  const patch = update.patch as Record<string, unknown>;
  const [current] = (await tx
    .select()
    .from(table as PgTable)
    .where(eq(table.id, id))
    .for('update')) as Record<string, unknown>[];
  if (!current) throw new RecordNotFoundError(entity, id);
  if (current.version !== version) {
    throw new RecordChangedError(entity, id, current.version as number);
  }

  const changes = diffChanges(current, patch);
  if (changes.length === 0) return current as T['$inferSelect'];

  const set: Record<string, unknown> = {
    ...patch,
    version: sql`${table.version} + 1`,
    updatedAt: sql`now()`,
  };
  if ('updatedBy' in table) set.updatedBy = sql`app.current_user_id()`;
  const [updated] = (await tx
    .update(table)
    .set(set as PgUpdateSetSource<T>)
    .where(and(eq(table.id, id), eq(table.version, version)))
    .returning()) as T['$inferSelect'][];
  // Запись заблокирована и версия проверена выше, так что сюда попасть нельзя; на всякий случай.
  if (!updated) throw new RecordChangedError(entity, id, version + 1);

  await writeHistory(tx, {
    entity,
    entityId: id,
    action: 'update',
    changes,
    reason: update.reason ?? null,
    contractorId: update.contractorId ?? null,
  });
  return updated;
}
