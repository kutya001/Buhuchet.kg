import {
  bigint,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { orgIsolation } from './rls';
import { users } from './users';

/** Пользователь и его организация (пусто у администратора платформы) — общая пара столбцов. */
const owner = () => ({
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Пусто — администратор платформы. */
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'restrict' }),
});

/**
 * Привязанный Telegram (ТЗ «Телеграм бот для любых уведомлений»): у пользователя — один чат, а один
 * Telegram можно привязать к нескольким логинам (тогда в сообщениях указывается организация).
 * Бот пишет в чат по chat_id; имя пользователя и имя в Telegram — чтобы показать, куда привязано.
 */
export const telegramLinks = pgTable(
  'telegram_links',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'restrict' }),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    username: text('username'),
    firstName: text('first_name'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'telegram_links_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    index('telegram_links_chat_idx').on(t.chatId),
    orgIsolation('telegram_links_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Одноразовые токены ссылки t.me/бот?start=токен (15 минут). В базе — только SHA-256 токена; у
 * пользователя действует только последняя ссылка. Использованный токен остаётся с отметкой, чтобы
 * повтор того же сообщения от Telegram не ответил «ссылка недействительна».
 */
export const telegramLinkTokens = pgTable(
  'telegram_link_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    ...owner(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'telegram_link_tokens_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    index('telegram_link_tokens_user_idx').on(t.userId),
    orgIsolation('telegram_link_tokens_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Коды «Забыли пароль?» (ТЗ «Восстановление пароля через Telegram»): 10 минут, не больше 3 в час на
 * логин (поэтому строки хранятся и после использования), действует только последний код, не больше
 * 5 неверных вводов. В базе — хеш argon2id кода, не сам код.
 */
export const passwordResetCodes = pgTable(
  'password_reset_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...owner(),
    codeHash: text('code_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'password_reset_codes_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    index('password_reset_codes_user_idx').on(t.userId, t.createdAt),
    orgIsolation('password_reset_codes_isolation', t.orgId),
  ],
).enableRLS();
