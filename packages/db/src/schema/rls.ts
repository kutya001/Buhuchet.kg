import { sql, type SQL } from 'drizzle-orm';
import { pgPolicy, pgRole, type AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Групповая роль приложения (создаёт миграция 0000). Политики RLS выдаются только ей: у остальных
 * ролей (на Supabase — anon и authenticated из Data API) политик нет, значит, и строк не видно.
 * RLS включается у каждой таблицы `public` — это проверяет тест.
 */
export const appRole = pgRole('buhuchet_app').existing();

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
    to: appRole,
    using: sql`${orgColumn} = ${currentOrgId}`,
    withCheck: sql`${orgColumn} = ${currentOrgId}`,
  });
}

/** Общие данные платформы (справочники): приложение только читает, меняют миграции и наполнение. */
export function platformReadOnly(name: string) {
  return pgPolicy(name, { as: 'permissive', for: 'select', to: appRole, using: sql`true` });
}

/** Служебные таблицы платформы без организации (запуски задач): приложение читает и пишет. */
export function platformService(name: string) {
  return pgPolicy(name, {
    as: 'permissive',
    for: 'all',
    to: appRole,
    using: sql`true`,
    withCheck: sql`true`,
  });
}
