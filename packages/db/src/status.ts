import { auditActorName, isScaleStatus, type StatusScaleKey } from '@buhuchet/domain';
import { and, asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { employees, files, statusHistory } from './schema';

/** Смена статуса на шкале — одна запись «Истории статусов». */
export interface StatusChange {
  scale: StatusScaleKey;
  entityId: string;
  /** Пусто — запись создана в этом статусе. */
  from: string | null;
  to: string;
  /** Комментарий или причина; у отката обязательна. */
  reason?: string | null;
  /** Откат — шаг назад (право «Откат статусов» проверяет API до записи). */
  rollback?: boolean;
  /** Файл к смене статуса (квитанция и т. п.) — файл этой организации, уже загруженный. */
  fileId?: string | null;
}

/**
 * Записать смену статуса в «Историю статусов» в текущей транзакции — той же, что меняет статус записи:
 * если смена откатится, исчезнет и запись истории. Организация, автор и время — из контекста
 * `withOrgContext`; без автора — система. Статус не со своей шкалы, смена «в тот же статус» и откат без
 * причины — ошибка программы (то же не пропустят ограничения таблицы).
 */
export async function writeStatusChange(tx: Tx, ...changes: StatusChange[]): Promise<void> {
  if (changes.length === 0) return;
  for (const c of changes) {
    const known =
      isScaleStatus(c.scale, c.to) && (c.from === null || isScaleStatus(c.scale, c.from));
    if (!known) throw new Error(`status_history: ${c.scale} ${c.from} → ${c.to}`);
    if (c.from === c.to) throw new Error(`status_history: ${c.scale} ${c.to} → ${c.to}`);
    if (c.rollback && (c.from === null || !c.reason?.trim()))
      throw new Error('status_history: откат без причины');
  }
  await tx.insert(statusHistory).values(
    changes.map((c) => ({
      scale: c.scale,
      entityId: c.entityId,
      fromStatus: c.from,
      toStatus: c.to,
      isRollback: c.rollback ?? false,
      reason: c.reason?.trim() || null,
      fileId: c.fileId ?? null,
    })),
  );
}

/** Запись «Истории статусов»: автор — краткое ФИО сотрудника, «Администратор платформы» или null (система). */
export interface StatusHistoryItem {
  at: Date;
  from: string | null;
  to: string;
  rollback: boolean;
  reason: string | null;
  actor: string | null;
  /** Файл к смене статуса; `available` — не удалён (его можно скачать). */
  file: { id: string; name: string; available: boolean } | null;
}

const actor = alias(employees, 'actor');

/**
 * «История статусов» записи на шкале по порядку: сначала старые (время в статусе считается до
 * следующей записи — `statusDurations`). Только своя организация (RLS); доступ к самой записи
 * (область «Свои контрагенты») модуль проверяет до чтения.
 */
export async function readStatusHistory(
  tx: Tx,
  scale: StatusScaleKey,
  entityId: string,
): Promise<StatusHistoryItem[]> {
  const rows = await tx
    .select({
      at: statusHistory.at,
      from: statusHistory.fromStatus,
      to: statusHistory.toStatus,
      rollback: statusHistory.isRollback,
      reason: statusHistory.reason,
      actorUserId: statusHistory.actorUserId,
      actorName: actor.shortName,
      fileId: files.id,
      fileName: files.name,
      fileState: files.state,
    })
    .from(statusHistory)
    .leftJoin(actor, eq(actor.userId, statusHistory.actorUserId))
    .leftJoin(files, eq(files.id, statusHistory.fileId))
    .where(and(eq(statusHistory.scale, scale), eq(statusHistory.entityId, entityId)))
    .orderBy(asc(statusHistory.at), asc(statusHistory.id));
  return rows.map(({ actorUserId, actorName, fileId, fileName, fileState, ...r }) => ({
    ...r,
    actor: auditActorName(actorUserId, actorName),
    file:
      fileId && fileName ? { id: fileId, name: fileName, available: fileState === 'ready' } : null,
  }));
}
