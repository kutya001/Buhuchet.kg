import { NOTIFY_KINDS, NOTIFY_MODES, OUTBOX_KINDS, OUTBOX_STATUSES } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordVersion } from './columns';
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

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * Журнал отправок и очередь Telegram (ТЗ «Уведомления в Telegram», Админка → «Модуль Телеграмм»:
 * журнал и повтор; прототип admin/telegram.js, `TG_LOG`; задача 2.25, docs/decisions.md, п. Б-5).
 * Напоминания и события ждут в очереди (`pending`) и уходят пачками с повторами; служебные сообщения
 * бота уходят сразу и пишутся после отправки — у кода восстановления без текста, и повторно он не
 * отправляется (docs/deviations.md, п. 12). Строки организации видны только ей (RLS); строки
 * администраторов платформы (без организации) пишет и читает только функция `app.telegram_log`
 * (миграция 0077) — экран журнала в Админке добавит задача 2.41. `dedupe_key` — одно напоминание за
 * день одному человеку, даже если расписание запустилось дважды.
 */
export const telegramOutbox = pgTable(
  'telegram_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Пусто — администратор платформы. */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    kind: text('kind', { enum: OUTBOX_KINDS }).notNull(),
    /** Текст сообщения; у кода восстановления — пусто (в журнал код не пишется). */
    text: text('text'),
    status: text('status', { enum: OUTBOX_STATUSES }).notNull().default('pending'),
    tries: integer('tries').notNull().default(0),
    /** Когда отправлять (или повторить). */
    nextAt: timestamp('next_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'telegram_outbox_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    unique('telegram_outbox_dedupe_key').on(t.dedupeKey),
    index('telegram_outbox_due_idx')
      .on(t.orgId, t.nextAt)
      .where(sql`${t.status} = 'pending'`),
    index('telegram_outbox_org_created_idx').on(t.orgId, t.createdAt),
    check('telegram_outbox_kind_check', sql`${t.kind} in (${inList(OUTBOX_KINDS)})`),
    check('telegram_outbox_status_check', sql`${t.status} in (${inList(OUTBOX_STATUSES)})`),
    check('telegram_outbox_tries_check', sql`${t.tries} >= 0`),
    check('telegram_outbox_code_text_check', sql`${t.kind} <> 'code' or ${t.text} is null`),
    orgIsolation('telegram_outbox_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Какие уведомления получает сотрудник (ТЗ «Уведомления в Telegram»; прототип modules/profile.js,
 * `notifyBox`): режим владельца и главного бухгалтера и отключённые переключатели. Нет строки —
 * «Все», всё включено.
 */
export const telegramNotifySettings = pgTable(
  'telegram_notify_settings',
  {
    userId: uuid('user_id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    mode: text('mode', { enum: NOTIFY_MODES }).notNull().default('all'),
    off: text('off')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id),
    version: recordVersion(),
  },
  (t) => [
    foreignKey({
      name: 'telegram_notify_settings_user_org_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('cascade'),
    check('telegram_notify_settings_mode_check', sql`${t.mode} in (${inList(NOTIFY_MODES)})`),
    check(
      'telegram_notify_settings_off_check',
      sql`${t.off} <@ array[${inList(NOTIFY_KINDS)}]::text[]`,
    ),
    orgIsolation('telegram_notify_settings_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Напоминания за день организации собраны (одно сообщение в день каждому): отметка дня, чтобы
 * расписание каждую минуту не собирало их заново. Дату ставит задача по Бишкеку.
 */
export const telegramDigestDays = pgTable(
  'telegram_digest_days',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    day: date('day', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'telegram_digest_days_pk', columns: [t.orgId, t.day] }),
    orgIsolation('telegram_digest_days_isolation', t.orgId),
  ],
).enableRLS();
