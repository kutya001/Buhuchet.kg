import { foreignKey, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { orgIsolation } from './rls';
import { users } from './users';

/**
 * Сеансы входа (ТЗ «Вход и сеансы — свои»): случайный токен лежит только в cookie, в базе — его
 * SHA-256. Сеанс ищется по токену до того, как известна организация, поэтому вход, проверка сеанса
 * и выход идут через функции app.auth_* (миграция 0009); в контексте организации её сеансы видны
 * обычной политикой. Выход удаляет сеанс, смена пароля — все остальные сеансы пользователя.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Пусто — сеанс администратора платформы. */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** 30 дней с последнего обращения. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'sessions_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
    orgIsolation('sessions_isolation', t.orgId),
  ],
).enableRLS();
