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

/**
 * Сколько проходов с ошибкой (или оборванных) у строки, пока она не останется в очереди с ошибкой (видна
 * в журнале). Проход, у которого кончилось время, попыткой не считается: следующий продолжит с места.
 */
export const DUES_RECALC_ATTEMPTS = 5;

/** Строка очереди: что пересчитать, какая это попытка, чей проход и с какой организации продолжить. */
export interface DuesRecalcTask {
  id: string;
  scope: RedueScope;
  attempts: number;
  token: string;
  /** Последняя пройденная организация прошлого прохода; пусто — с начала. */
  after: string | null;
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
      claimToken: sql`gen_random_uuid()`,
      attempts: sql`${duesRecalcs.attempts} + 1`,
    })
    .where(eq(duesRecalcs.id, sql`(${next})`))
    .returning();
  if (!row?.claimToken) return null;
  const scope: RedueScope =
    row.kind === 'calendar'
      ? { kind: 'calendar' }
      : { kind: row.kind as 'types' | 'statuses', codes: row.codes };
  return {
    id: row.id,
    scope,
    attempts: row.attempts,
    token: row.claimToken,
    after: row.afterOrg,
  };
}

/**
 * Проход по строке закончен (отмечает только тот, кто её занял, — по `token`): `done` — во всех
 * организациях. Иначе строка освобождается для догона: кончилось время — сразу, с организации после
 * `after`, и проход не считается попыткой; ошибка — через `retryAfterSeconds` и с начала. Отчёты и
 * организации прохода прибавляются к прежним. Ответ — отметил ли (строку не перехватили).
 */
export async function finishDuesRecalc(
  db: Db,
  task: Pick<DuesRecalcTask, 'id' | 'token'>,
  outcome: {
    done: boolean;
    reports: number;
    orgs: number;
    error: string | null;
    after?: string | null;
    retryAfterSeconds?: number;
  },
): Promise<boolean> {
  const retry = outcome.done ? 0 : (outcome.retryAfterSeconds ?? 0);
  const rows = await db
    .update(duesRecalcs)
    .set({
      claimedUntil: retry > 0 ? sql`now() + make_interval(secs => ${retry})` : null,
      claimToken: null,
      doneAt: outcome.done ? sql`now()` : null,
      attempts:
        outcome.done || outcome.error !== null
          ? duesRecalcs.attempts
          : sql`greatest(${duesRecalcs.attempts} - 1, 0)`,
      afterOrg: outcome.done || outcome.error !== null ? null : (outcome.after ?? null),
      reports: sql`${duesRecalcs.reports} + ${outcome.reports}`,
      orgs: sql`${duesRecalcs.orgs} + ${outcome.orgs}`,
      lastError: outcome.error,
    })
    .where(and(eq(duesRecalcs.id, task.id), eq(duesRecalcs.claimToken, task.token)))
    .returning({ id: duesRecalcs.id });
  return rows.length > 0;
}

/** Выполненные строки старше `days` дней удаляются (очередь не растёт). */
export async function cleanupDuesRecalcs(db: Db, days: number): Promise<void> {
  await db
    .delete(duesRecalcs)
    .where(lt(duesRecalcs.doneAt, sql`now() - make_interval(days => ${days})`));
}
