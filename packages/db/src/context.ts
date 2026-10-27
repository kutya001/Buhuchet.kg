import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client';

/**
 * Вид работы — свой предел времени каждого запроса к базе в транзакции (`statement_timeout`):
 * `request` — обычные методы и списки (поиск, фильтры, группы), `export` — выгрузка «В Excel»,
 * `job` — задачи по расписанию и worker. Запрос дольше предела база прерывает (`queryTimedOut`),
 * а пользователь видит «Запрос выполнялся слишком долго» (docs/decisions.md, п. 38).
 */
export type QueryKind = 'request' | 'export' | 'job';

/**
 * Пределы в миллисекундах. Задачи — 4 минуты, а не 5 (план): функция Vercel, которая их запускает,
 * живёт не дольше 300 с, и задача должна упасть с записью в журнал раньше, чем платформа её оборвёт.
 */
export const QUERY_TIMEOUT_MS: Readonly<Record<QueryKind, number>> = {
  request: 15_000,
  export: 60_000,
  job: 240_000,
};

export interface OrgContext {
  orgId: string;
  userId?: string | null;
  /** Вид работы — предел времени запросов; по умолчанию `request`. */
  kind?: QueryKind;
}

/**
 * Транзакция от имени организации: задаёт `app.org_id` и `app.user_id` (как SET LOCAL),
 * по которым работают политики RLS, и предел времени запросов по виду работы. Все запросы к данным
 * организаций идут только так.
 */
export async function withOrgContext<T>(
  db: Db,
  ctx: OrgContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${ctx.orgId}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true), ${timeoutSetting(ctx.kind)}`,
    );
    return fn(tx);
  });
}

/** `set_config` предела времени запросов до конца транзакции. */
export function timeoutSetting(kind: QueryKind = 'request') {
  return sql`set_config('statement_timeout', ${String(QUERY_TIMEOUT_MS[kind])}, true)`;
}
