import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { appRole, currentOrgId } from './rls';
import { users } from './users';

const currentUserId = sql`app.current_user_id()`;

/**
 * Настройки вида списков (ТЗ «Списки записей» → «Настройки вида … запоминаются для каждого
 * пользователя и каждого списка»): столбцы, порядок, ширины, плотность, сортировка, «Таблица /
 * Карточки». Строка — пользователь и список (`grid_key`, например «staff.list»); содержимое —
 * `ViewSettings` из `@buhuchet/shared`. Только своё: пользователь видит и меняет лишь свои строки в
 * своей организации; у администратора платформы организации нет. Без версии и истории: это вид
 * экрана, а не данные организации, — побеждает последнее сохранение.
 */
export const viewSettings = pgTable(
  'view_settings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Пусто — администратор платформы. */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'restrict' }),
    gridKey: text('grid_key').notNull(),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'view_settings_pk', columns: [t.userId, t.gridKey] }),
    foreignKey({
      name: 'view_settings_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    index('view_settings_org_idx').on(t.orgId),
    check(
      'view_settings_grid_key_check',
      sql`${t.gridKey} ~ '^[a-z][a-z0-9-]{0,30}\\.[a-z][a-z0-9-]{0,30}$'`,
    ),
    check('view_settings_size_check', sql`octet_length(${t.settings}::text) <= 32768`),
    pgPolicy('view_settings_isolation', {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: sql`${t.orgId} = ${currentOrgId} and ${t.userId} = ${currentUserId}`,
      withCheck: sql`${t.orgId} = ${currentOrgId} and ${t.userId} = ${currentUserId}`,
    }),
    pgPolicy('view_settings_platform_admin', {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: sql`${t.orgId} is null and ${currentOrgId} is null and ${t.userId} = ${currentUserId}`,
      withCheck: sql`${t.orgId} is null and ${currentOrgId} is null and ${t.userId} = ${currentUserId}`,
    }),
  ],
).enableRLS();
