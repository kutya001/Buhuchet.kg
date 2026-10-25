import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { organizations } from './organizations';
import { orgIsolation } from './rls';

/** Текст без учёта регистра (расширение citext из миграции 0000). */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/**
 * Учётные записи для входа: логин и пароль без почты (ТЗ «Вход и сеансы — свои»). Сотрудник
 * организации — пользователь плюс запись в employees; администратор платформы — пользователь без
 * организации. Один пользователь — одна организация, поэтому org_id лежит прямо здесь: по нему
 * работает RLS, а сотрудник ссылается на пару (id, org_id) и не может оказаться в чужой организации.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Пусто — администратор платформы. */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'restrict' }),
    /** Уникален на всей платформе, без учёта регистра. */
    login: citext('login').notNull().unique(),
    /** Хеш argon2id; сам пароль нигде не хранится. */
    passwordHash: text('password_hash').notNull(),
    /** После входа с временным паролем пользователь обязан задать новый. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    /** Заблокирован администратором платформы: не входит, сеансы закрыты. */
    blocked: boolean('blocked').notNull().default(false),
    /** Неверные пароли подряд; на пятом вход закрывается на 15 минут, счётчик начинается заново. */
    failedLogins: integer('failed_logins').notNull().default(0),
    /** До какого момента вход закрыт после неверных паролей. */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('users_id_org_unique').on(t.id, t.orgId),
    check(
      'users_org_or_platform_admin',
      sql`(${t.isPlatformAdmin} and ${t.orgId} is null) or (not ${t.isPlatformAdmin} and ${t.orgId} is not null)`,
    ),
    orgIsolation('users_isolation', t.orgId),
  ],
).enableRLS();
