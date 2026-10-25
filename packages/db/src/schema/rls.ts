import { sql, type SQL } from 'drizzle-orm';
import { pgPolicy, type AnyPgColumn } from 'drizzle-orm/pg-core';

/** Текущая организация сеанса базы: задаёт API через `withOrgContext`. */
export const currentOrgId: SQL = sql`app.current_org_id()`;

/**
 * Политика изоляции организаций: строки видны и пишутся, только если их `org_id`
 * совпадает с `app.org_id` текущей транзакции.
 */
export function orgIsolation(name: string, orgColumn: AnyPgColumn) {
  return pgPolicy(name, {
    as: 'permissive',
    for: 'all',
    using: sql`${orgColumn} = ${currentOrgId}`,
    withCheck: sql`${orgColumn} = ${currentOrgId}`,
  });
}
