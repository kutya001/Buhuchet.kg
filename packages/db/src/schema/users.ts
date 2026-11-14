import { LOGIN_LOCK_REASONS } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
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

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

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
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /**
     * «Сообщения простым текстом» бота (поток Т, задача Т1): без таблиц и раскрывающихся разделов.
     * Хранится у пользователя, как в прототипе (`u.tgPlain`): отвязка и другой Telegram выбор не
     * сбрасывают. Меняет сам пользователь функцией `app.telegram_set_plain_text`.
     */
    telegramPlain: boolean('telegram_plain').notNull().default(false),
    /**
     * Неверных паролей подряд у этой учётной записи (не по набранному логину, как login_attempts): не
     * забывается со временем, снимается верным паролем и новым паролем (миграция 0095).
     */
    loginFailures: integer('login_failures').notNull().default(0),
    /**
     * Вход закрыт после ACCOUNT_LOCK_FAILURES неверных паролей подряд: снимает новый пароль от
     * владельца (сотруднику) или администратора платформы (владельцу). Пусто — вход открыт.
     */
    loginLockedAt: timestamp('login_locked_at', { withTimezone: true }),
    /**
     * Чем закрыт вход, если не неверными паролями: `not_me` — кнопкой «Это не я» под сообщением бота о
     * безопасности (поток Т, задача Т4). Пишет функция `app.telegram_not_me`, снимает новый пароль
     * (`app.auth_account_unlock`). От причины зависит только текст на странице входа и в Админке.
     */
    loginLockReason: text('login_lock_reason', { enum: LOGIN_LOCK_REASONS }),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('users_id_org_unique').on(t.id, t.orgId),
    // Поиск логина при входе (app.auth_find_login) — без citext, по lower(login::text).
    index('users_login_lower_idx').on(sql`lower(${t.login}::text)`),
    check(
      'users_org_or_platform_admin',
      sql`(${t.isPlatformAdmin} and ${t.orgId} is null) or (not ${t.isPlatformAdmin} and ${t.orgId} is not null)`,
    ),
    check(
      'users_login_lock_reason_check',
      sql`${t.loginLockReason} is null or (${t.loginLockedAt} is not null and ${t.loginLockReason} in (${inList(LOGIN_LOCK_REASONS)}))`,
    ),
    orgIsolation('users_isolation', t.orgId),
  ],
).enableRLS();
