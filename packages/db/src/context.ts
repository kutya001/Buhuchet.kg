import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client';

export interface OrgContext {
  orgId: string;
  userId?: string | null;
}

/**
 * Транзакция от имени организации: задаёт `app.org_id` и `app.user_id` (как SET LOCAL),
 * по которым работают политики RLS. Все запросы к данным организаций идут только так.
 */
export async function withOrgContext<T>(
  db: Db,
  ctx: OrgContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${ctx.orgId}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}
