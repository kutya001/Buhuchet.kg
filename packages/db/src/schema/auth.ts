import { foreignKey, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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

/**
 * Неверные пароли по набранному логину (ТЗ: «После нескольких неверных паролей вход временно
 * блокируется»; docs/deviations.md, п. 4, решение Б). Счёт ведётся по логину, как его ввели, есть
 * такой логин на платформе или нет: «вход закрыт» одинаков для любого логина и не выдаёт, какие
 * логины есть. Поэтому строка не связана с пользователем и организацией. Роль приложения таблицу не
 * видит и не меняет: только функции app.auth_login_* (миграция 0013).
 */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    /** Логин в нижнем регистре, без пробелов по краям. */
    login: text('login').primaryKey(),
    /** Неверные пароли подряд; на пятом вход закрывается на 15 минут, счёт начинается заново. */
    failures: integer('failures').notNull().default(0),
    /** До какого момента вход закрыт. */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /** Последняя попытка: через час после неё счёт забывается, строку удаляет задача очистки. */
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('login_attempts_last_attempt_idx').on(t.lastAttemptAt)],
).enableRLS();
