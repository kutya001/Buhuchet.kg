import { CP_TG_MESSAGE_KINDS, CP_TG_STATUSES, type BotMessage } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { contractorPages } from './contractor-page';
import { contractors } from './contractors';
import { organizations } from './organizations';
import { orgIsolation } from './rls';
import { users } from './users';

const orgColumn = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'restrict' });

/**
 * Telegram контрагента (доработки 13.11.2026, задача К3; прототип v92 modules/cp-telegram.js, `c.tgs`):
 * запрос на подключение и само подключение чата клиента к контрагенту. Клиент открывает одноразовую
 * ссылку со своей страницы и нажимает «Старт» в боте — появляется строка «ждёт подтверждения»;
 * подключает её только сотрудник организации. Чат запоминается по номеру чата Telegram, имя — только
 * для показа сотруднику. Строку создаёт только функция `app.contractor_telegram_start` по одноразовой
 * ссылке (у роли приложения нет INSERT и DELETE); роль приложения меняет только решение по строке.
 */
export const contractorTelegramLinks = pgTable(
  'contractor_telegram_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    contractorId: uuid('contractor_id').notNull(),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    /** Имя в Telegram на момент запроса: задаёт клиент, поэтому одной строкой и не длиннее 32 знаков. */
    name: text('name').notNull(),
    status: text('status', { enum: CP_TG_STATUSES }).notNull().default('wait'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    /** Кто решил: сотрудник (подтвердил, отклонил, отключил) или сам клиент (`byClient`). */
    decidedBy: uuid('decided_by').references(() => users.id),
    byClient: boolean('by_client').notNull().default(false),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    foreignKey({
      name: 'contractor_telegram_links_contractor_fk',
      columns: [t.contractorId, t.orgId],
      foreignColumns: [contractors.id, contractors.orgId],
    }).onDelete('cascade'),
    check(
      'contractor_telegram_links_status_check',
      sql`${t.status} in (${sql.raw(CP_TG_STATUSES.map((s) => `'${s}'`).join(', '))})`,
    ),
    check('contractor_telegram_links_name_check', sql`char_length(${t.name}) between 1 and 32`),
    index('contractor_telegram_links_contractor_idx').on(t.orgId, t.contractorId),
    // Один чат у контрагента — одна действующая строка: второй запрос не создаётся.
    uniqueIndex('contractor_telegram_links_active_key')
      .on(t.contractorId, t.chatId)
      .where(sql`${t.status} in ('wait', 'on')`),
    index('contractor_telegram_links_chat_idx')
      .on(t.chatId)
      .where(sql`${t.status} = 'on'`),
    // Для составного ключа сообщений клиенту: сообщение — только в чат своего подключения.
    uniqueIndex('contractor_telegram_links_scope_key').on(t.id, t.orgId, t.contractorId, t.chatId),
    orgIsolation('contractor_telegram_links_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Одноразовые ссылки «Подключить Telegram» (t.me/бот?start=cp_<токен>): здесь — только SHA-256 токена.
 * Ссылку выдаёт функция `app.contractor_telegram_issue` и только браузеру, где запомнен код страницы;
 * действует 24 часа и один раз. Роль приложения таблицу не видит и не меняет.
 */
export const contractorTelegramTokens = pgTable(
  'contractor_telegram_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    orgId: orgColumn(),
    contractorId: uuid('contractor_id')
      .notNull()
      .references(() => contractorPages.contractorId, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    /** Чат, который использовал ссылку: повтор того же сообщения от Telegram остаётся без ответа. */
    usedChatId: bigint('used_chat_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'contractor_telegram_tokens_contractor_fk',
      columns: [t.contractorId, t.orgId],
      foreignColumns: [contractors.id, contractors.orgId],
    }).onDelete('cascade'),
    index('contractor_telegram_tokens_contractor_idx').on(t.contractorId),
    index('contractor_telegram_tokens_expires_idx').on(t.expiresAt),
    orgIsolation('contractor_telegram_tokens_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Сообщения бота клиенту, под которыми он принимает нажатия и ответы (доработки 13.11.2026, задача К4;
 * прототип v94 `pgPayMsg`, `tgAct('cp-paid')`, `tgAct('cp-ask')`): «К оплате» за месяц и «напишите ваш
 * вопрос». Клиент — не пользователь, поэтому журнал отправок сотрудникам (`telegram_outbox`) такое
 * сообщение не хранит. Нажатие кнопки бот сверяет с этой записью: чат, номер сообщения в чате и что
 * подключение ещё действует; месяц и сумму берёт из неё, а не из данных кнопки. Роль приложения строки
 * не удаляет, меняет только отметку отправки, кнопки (`payload`) и отметку ответа.
 */
export const contractorTelegramMessages = pgTable(
  'contractor_telegram_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    contractorId: uuid('contractor_id').notNull(),
    linkId: uuid('link_id').notNull(),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    /** Номер сообщения в чате Telegram; пусто — сообщение ещё не ушло. */
    messageId: bigint('message_id', { mode: 'number' }),
    kind: text('kind', { enum: CP_TG_MESSAGE_KINDS }).notNull(),
    /** Месяц отчёта «ГГГГ-ММ» и итог в тыйынах на момент отправки — у «К оплате». */
    month: text('month'),
    total: bigint('total', { mode: 'number' }),
    /** Отправлено само, за 5 дней до срока: один раз на месяц и чат. */
    auto: boolean('auto').notNull().default(false),
    /** Описание сообщения с кнопками (`BotMessage`): нажатая кнопка в нём гаснет. */
    payload: jsonb('payload').$type<BotMessage>().notNull(),
    /** Сколько раз пробовали отправить: задача по расписанию повторяет до трёх раз. */
    attempts: smallint('attempts').notNull().default(0),
    /** «Напишите ваш вопрос»: когда клиент ответил — второй раз тот же вопрос не принимается. */
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    sentBy: uuid('sent_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Подключение, контрагент, организация и чат — одной ссылкой: сообщение не записать в чужой чат.
    foreignKey({
      name: 'contractor_telegram_messages_link_fk',
      columns: [t.linkId, t.orgId, t.contractorId, t.chatId],
      foreignColumns: [
        contractorTelegramLinks.id,
        contractorTelegramLinks.orgId,
        contractorTelegramLinks.contractorId,
        contractorTelegramLinks.chatId,
      ],
    }).onDelete('cascade'),
    check(
      'contractor_telegram_messages_kind_check',
      sql`${t.kind} in (${sql.raw(CP_TG_MESSAGE_KINDS.map((s) => `'${s}'`).join(', '))})`,
    ),
    check(
      'contractor_telegram_messages_month_check',
      sql`${t.month} is null or ${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    check(
      'contractor_telegram_messages_pay_check',
      sql`${t.kind} <> 'pay' or (${t.month} is not null and ${t.total} is not null and ${t.total} > 0)`,
    ),
    uniqueIndex('contractor_telegram_messages_chat_key')
      .on(t.chatId, t.messageId)
      .where(sql`${t.messageId} is not null`),
    // Само «К оплате» уходит один раз на месяц и чат: повтор задачи второе не создаёт.
    uniqueIndex('contractor_telegram_messages_auto_key')
      .on(t.linkId, t.month)
      .where(sql`${t.kind} = 'pay' and ${t.auto}`),
    index('contractor_telegram_messages_contractor_idx').on(t.orgId, t.contractorId, t.createdAt),
    orgIsolation('contractor_telegram_messages_isolation', t.orgId),
  ],
).enableRLS();
