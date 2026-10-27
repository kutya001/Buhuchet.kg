import { sql } from 'drizzle-orm';
import type { Db } from './client';

/** Предел частоты действия: не больше `max` за `windowSeconds`; `leaseSeconds` — ещё и одно одновременно. */
export interface RateLimit {
  kind: string;
  max: number;
  windowSeconds: number;
  /** Сколько действие считается идущим, если его не отпустили (сбой процесса); нет — не следится. */
  leaseSeconds?: number;
}

/** Итог `takeRateLimit`: можно (номер — для `releaseRateLimit`), идёт прежнее, предел за окно. */
export type RateLimitTake =
  { ok: true; ticket: number } | { ok: false; reason: 'busy' | 'limited' };

/**
 * Занять действие от `subject` по пределу (docs/decisions.md, п. 38). Вызывается на `db`, а не в
 * транзакции модуля: проверка держит блокировку субъекта до конца своей транзакции. Действие с
 * `leaseSeconds` после окончания отпускается (`releaseRateLimit`), иначе следующее начнётся только
 * через `leaseSeconds`.
 */
export async function takeRateLimit(
  db: Db,
  limit: RateLimit,
  subject: string,
): Promise<RateLimitTake> {
  const [row] = await db.execute<{ outcome: string; ticket: number | string | null }>(
    sql`select * from app.rate_limit_take(${limit.kind}, ${subject}, ${limit.max}, ${limit.windowSeconds}, ${limit.leaseSeconds ?? null})`,
  );
  if (row?.outcome === 'ok' && row.ticket !== null) return { ok: true, ticket: Number(row.ticket) };
  return { ok: false, reason: row?.outcome === 'busy' ? 'busy' : 'limited' };
}

/** Действие закончилось: можно следующее (в счёте за окно оно остаётся). */
export async function releaseRateLimit(db: Db, ticket: number): Promise<void> {
  await db.execute(sql`select app.rate_limit_release(${ticket})`);
}

/** Строки частоты хранятся сутки: окна всех пределов короче. */
export const RATE_LIMIT_KEEP_SECONDS = 86_400;

/** Удалить строки старше суток (задача по расписанию); возвращает, сколько удалено. */
export async function cleanupRateLimits(db: Db): Promise<number> {
  const [row] = await db.execute<{ removed: number }>(
    sql`select app.rate_limit_cleanup(${RATE_LIMIT_KEEP_SECONDS}) as removed`,
  );
  return row?.removed ?? 0;
}
