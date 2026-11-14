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
    /** 1 день с последнего обращения (`SESSION_TTL_DAYS`). */
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
 * Журнал сеансов входа (ТЗ «Админка» → «Карточка пользователя», вкладка «Сеансы»; прототип
 * demoDB.sessions): начало, последняя активность, «действует до», устройство (браузер и система по
 * заголовку браузера, без адреса IP), чем сеанс закончился. Сам сеанс живёт в `sessions` и при
 * выходе удаляется, поэтому журнал ведёт триггер на `sessions` (миграция 0112): строка появляется
 * вместе с сеансом, повторяет его продление и закрывается при удалении. Токена сеанса в журнале нет.
 * Роль приложения таблицу не видит и не меняет: читает только администратор платформы через
 * представление `app.admin_sessions`.
 */
export const sessionLog = pgTable(
  'session_log',
  {
    /** Тот же id, что был у сеанса. */
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Пусто — сеанс администратора платформы. */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'restrict' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** «Chrome 130 · Windows 10 или 11» (`sessionDevice`); пусто — браузер не узнан. */
    device: text('device'),
    /** Пусто — сеанс не закрыт (открыт или истёк по сроку `expiresAt`). */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** Чем закрыт: `SESSION_END_REASONS` (logout, expired, admin, blocked, password, closed). */
    endReason: text('end_reason'),
  },
  (t) => [
    index('session_log_user_idx').on(t.userId, t.startedAt),
    // Входы организации за период: «Главная» → «Активность» (docs/decisions.md п. О-43).
    index('session_log_org_started_idx').on(t.orgId, t.startedAt),
    // Прав на таблицу у роли приложения нет; политика — вторая преграда, как у всех таблиц с org_id.
    orgIsolation('session_log_isolation', t.orgId),
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

/**
 * Код из Telegram при входе администратора платформы (ревью безопасности 06.11.2026, п. Р-2, решение
 * заказчика 07.11.2026 «А»; docs/deviations.md п. О-13): после верного пароля бот присылает 6 цифр,
 * сеанс начинается только после кода. В базе — хеш кода (argon2) и SHA-256 токена шага входа; токен
 * знает только тот, кто ввёл верный пароль. Роль приложения таблицу не видит и не меняет: только
 * функции app.admin_code_* (миграция 0098).
 */
export const adminLoginCodes = pgTable(
  'admin_login_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    codeHash: text('code_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /**
     * Отпечаток пароля, после которого выдан код (md5 хеша пароля): сменили пароль — код не действует
     * и в пределы кодов больше не считается.
     */
    passwordTag: text('password_tag').notNull(),
    /** Сколько раз вводили код; после ADMIN_CODE_MAX_ATTEMPTS он не действует. */
    attempts: integer('attempts').notNull().default(0),
    /** Код подошёл или выдан следующий — больше не действует. */
    usedAt: timestamp('used_at', { withTimezone: true }),
    /** Код подошёл и начался сеанс: такие коды в суточный предел не считаются. */
    signedInAt: timestamp('signed_in_at', { withTimezone: true }),
  },
  (t) => [index('admin_login_codes_user_idx').on(t.userId, t.createdAt)],
).enableRLS();

/**
 * Одноразовые ссылки «задать пароль» (доработки 14.11.2026, блок 1, пункт 3): после «Одобрить» бот
 * присылает владельцу новой организации ссылку, по которой он задаёт пароль; действует 7 дней, истекла —
 * администратор платформы отправляет новую из карточки организации. Здесь — только SHA-256 токена.
 * Роль приложения таблицу не видит и не меняет (RLS без политик): страница ссылки открывается без входа,
 * поэтому выдают и проверяют ссылку только функции базы (их добавляют задачи блока 1).
 */
export const passwordSetupTokens = pgTable(
  'password_setup_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id').notNull(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Пароль задан или выдана новая ссылка — эта больше не действует. */
    usedAt: timestamp('used_at', { withTimezone: true }),
    /** Администратор платформы, выдавший ссылку; пусто — выдана при «Одобрить». */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'password_setup_tokens_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    index('password_setup_tokens_user_idx').on(t.userId, t.createdAt),
    index('password_setup_tokens_expires_idx').on(t.expiresAt),
    // У роли приложения прав на таблицу нет (миграция 0147); политика — как у всех таблиц с org_id.
    orgIsolation('password_setup_tokens_isolation', t.orgId),
  ],
).enableRLS();
