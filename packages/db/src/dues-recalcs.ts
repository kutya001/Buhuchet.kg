import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import type { RedueScope } from './reports-redue';
import { duesRecalcs } from './schema';

/*
 * Очередь пересчёта сроков после правки каталога (задача 2.37; docs/decisions.md п. Д-9): правка
 * ставит область в очередь своей транзакцией, обработчик (сразу после сохранения или задача по
 * расписанию) занимает строку арендой, пересчитывает и отмечает её выполненной. Пересчёт безопасен при
 * повторе, поэтому строка, которую не довели до конца, просто проходится заново.
 */

/** Сколько раз строка проходится, пока не останется в очереди с ошибкой (видна в журнале). */
export const DUES_RECALC_ATTEMPTS = 5;

/** Строка очереди: что пересчитать и какая это попытка. */
export interface DuesRecalcTask {
  id: string;
  scope: RedueScope;
  attempts: number;
}

/** Поставить пересчёт в очередь — в транзакции правки, чтобы правка без пересчёта не сохранилась. */
export async function enqueueDuesRecalc(tx: Tx, scope: RedueScope): Promise<string> {
  const [row] = await tx
    .insert(duesRecalcs)
    .values({ kind: scope.kind, codes: scope.kind === 'calendar' ? [] : [...scope.codes] })
    .returning({ id: duesRecalcs.id });
  return row!.id;
}

/**
 * Занять строку очереди на `leaseSeconds`: с номером `id` — её (сразу после сохранения правки), без —
 * самую старую из поставленных раньше `olderThanSeconds` (задача по расписанию не перебивает обработку
 * сразу после сохранения). Занятая, выполненная и исчерпавшая попытки не выдаются.
 */
export async function claimDuesRecalc(
  db: Db,
  options: { id?: string; leaseSeconds: number; olderThanSeconds?: number },
): Promise<DuesRecalcTask | null> {
  const free = and(
    isNull(duesRecalcs.doneAt),
    lt(duesRecalcs.attempts, DUES_RECALC_ATTEMPTS),
    or(isNull(duesRecalcs.claimedUntil), lt(duesRecalcs.claimedUntil, sql`now()`)),
    options.id ? eq(duesRecalcs.id, options.id) : undefined,
    options.olderThanSeconds !== undefined
      ? lt(duesRecalcs.createdAt, sql`now() - make_interval(secs => ${options.olderThanSeconds})`)
      : undefined,
  );
  const next = db
    .select({ id: duesRecalcs.id })
    .from(duesRecalcs)
    .where(free)
    .orderBy(asc(duesRecalcs.createdAt))
    .limit(1)
    .for('update', { skipLocked: true });
  const [row] = await db
    .update(duesRecalcs)
    .set({
      claimedUntil: sql`now() + make_interval(secs => ${options.leaseSeconds})`,
      attempts: sql`${duesRecalcs.attempts} + 1`,
    })
    .where(eq(duesRecalcs.id, sql`(${next})`))
    .returning();
  if (!row) return null;
  const scope: RedueScope =
    row.kind === 'calendar'
      ? { kind: 'calendar' }
      : { kind: row.kind as 'types' | 'statuses', codes: row.codes };
  return { id: row.id, scope, attempts: row.attempts };
}

/**
 * Проход по строке закончен: `done` — во всех организациях, иначе строка освобождается для догона —
 * сразу или через `retryAfterSeconds` (после ошибки). Отчёты и организации прохода прибавляются к
 * прежним.
 */
export async function finishDuesRecalc(
  db: Db,
  id: string,
  outcome: {
    done: boolean;
    reports: number;
    orgs: number;
    error: string | null;
    retryAfterSeconds?: number;
  },
): Promise<void> {
  const retry = outcome.done ? 0 : (outcome.retryAfterSeconds ?? 0);
  await db
    .update(duesRecalcs)
    .set({
      claimedUntil: retry > 0 ? sql`now() + make_interval(secs => ${retry})` : null,
      doneAt: outcome.done ? sql`now()` : null,
      reports: sql`${duesRecalcs.reports} + ${outcome.reports}`,
      orgs: sql`${duesRecalcs.orgs} + ${outcome.orgs}`,
      lastError: outcome.error,
    })
    .where(eq(duesRecalcs.id, id));
}

/** Выполненные строки старше `days` дней удаляются (очередь не растёт). */
export async function cleanupDuesRecalcs(db: Db, days: number): Promise<void> {
  await db
    .delete(duesRecalcs)
    .where(lt(duesRecalcs.doneAt, sql`now() - make_interval(days => ${days})`));
}
