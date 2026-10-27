import { redactChanges, type HistoryEntity } from '@buhuchet/domain';
import { and, asc, eq } from 'drizzle-orm';
import type { Tx } from './client';
import type { HistoryEntry } from './history';
import { platformAuditLog } from './schema';

/** Запись истории общих данных платформы: как у организации, но без контрагента. */
export type PlatformHistoryEntry = Omit<HistoryEntry, 'contractorId'>;

/**
 * Записать в историю общих данных платформы (`platform_audit_log`, миграция 0034) в текущей
 * транзакции: если правка откатится, исчезнет и запись. Автор и время — из контекста
 * (`withUserContext` администратора платформы); другому пользователю база запись не примет.
 */
export async function writePlatformHistory(
  tx: Tx,
  ...entries: PlatformHistoryEntry[]
): Promise<void> {
  if (entries.length === 0) return;
  await tx.insert(platformAuditLog).values(
    entries.map((e) => ({
      entity: e.entity,
      entityId: e.entityId,
      action: e.action,
      changes: redactChanges(e.changes ?? [], e.secretFields),
      reason: e.reason?.trim() || null,
    })),
  );
}

/** История записи платформы по порядку: сначала старые. Не администратору — пусто. */
export function readPlatformHistory(tx: Tx, entity: HistoryEntity, entityId: string) {
  return tx
    .select()
    .from(platformAuditLog)
    .where(and(eq(platformAuditLog.entity, entity), eq(platformAuditLog.entityId, entityId)))
    .orderBy(asc(platformAuditLog.at), asc(platformAuditLog.id));
}
