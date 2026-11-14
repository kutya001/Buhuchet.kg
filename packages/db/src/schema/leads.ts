import {
  FILE_MAX_BYTES,
  FILE_NAME_MAX_LENGTH,
  LEAD_ADDRESS_MAX,
  LEAD_DOC_CONTENT_TYPE,
  LEAD_DOC_KINDS,
  LEAD_EVENT_KINDS,
  LEAD_HEAD_MAX,
  LEAD_STATUSES,
  ORG_LEGAL_FORMS,
} from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordVersion } from './columns';
import { organizations } from './organizations';
import { users } from './users';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * Заявки с лендинга (ТЗ «Лендинг» → «Форма «Оставить заявку»», «Админка» → «Вкладка «Заявки»»;
 * прототип admin/leads.js, решение заказчика 01.11.2026). Данные платформы, а не организации, поэтому
 * без org_id: организация, созданная по заявке, — `created_org_id`. Роль приложения таблицу не видит и
 * не меняет (RLS без политик): заявку пишет только функция базы метода без входа `app.lead_submit`,
 * читает и меняет только администратор платформы — представлением `app.admin_leads` и функциями
 * `app.admin_lead_*` от владельца схемы (миграция после этой), как у `app.admin_organizations`.
 */
export const platformLeads = pgTable(
  'platform_leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** «Имя и фамилия». */
    name: text('name').notNull(),
    /** «Название фирмы». */
    firm: text('firm').notNull(),
    /** «+», код страны и цифры, как телефон сотрудника; по нему узнаётся повторная заявка. */
    phone: text('phone').notNull(),
    /** «Сколько клиентов ведёте» — вариант из словаря (`land.f.size.opts`). */
    size: text('size').notNull(),
    telegram: text('telegram'),
    /** Комментарий; повторная заявка с того же телефона дописывает свой с новой строки. */
    note: text('note'),
    status: text('status', { enum: LEAD_STATUSES }).notNull().default('new'),
    /** Статус до «Отказа»: «Снять «Отказ»» возвращает заявку в него. */
    statusBefore: text('status_before', { enum: LEAD_STATUSES }),
    /** Организация, созданная по заявке («Создать организацию»). */
    createdOrgId: uuid('created_org_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    /** «Заметка администратора» — видит только администратор платформы. */
    adminNote: text('admin_note'),
    /** Заявка с тестового стенда: в истории «Заявка с сайта (тестовый стенд)». */
    fromStand: boolean('from_stand').notNull().default(false),
    /**
     * Регистрация по документам (доработки 14.11.2026, блок 1): «Форма» и данные из выписки и
     * свидетельства, которые заявитель проверил и поправил до отправки. Название — `firm`. У заявок до
     * 14.11.2026 и без документов — пусто (у них «Создать организацию», а не «Одобрить»).
     */
    legalForm: text('legal_form', { enum: ORG_LEGAL_FORMS }),
    inn: text('inn'),
    okpo: text('okpo'),
    address: text('address'),
    head: text('head'),
    /**
     * Документы заявки: `pending` — заявка создана, файлы ещё грузятся (Админка её не показывает);
     * `ready` — все файлы загружены и проверены. Пусто — заявка без документов.
     */
    docsState: text('docs_state'),
    /**
     * Когда удалить файлы заявки: через 30 дней после отправки, после отказа — через 7 дней; после
     * «Одобрить» файлы переходят в организацию и отметка снимается.
     */
    docsPurgeAt: timestamp('docs_purge_at', { withTimezone: true }),
    /**
     * Telegram заявителя (блок 1, пункт 2): чат, нажавший «Старт» по одноразовой ссылке заявки, — туда
     * придут решение и ссылка для входа. Пусто — «Telegram не подключён», «Одобрить» недоступна.
     */
    tgChatId: bigint('tg_chat_id', { mode: 'number' }),
    tgLinkedAt: timestamp('tg_linked_at', { withTimezone: true }),
    version: recordVersion(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('platform_leads_created_idx').on(t.createdAt),
    index('platform_leads_phone_idx').on(t.phone, t.createdAt),
    check('platform_leads_status_check', sql`${t.status} in (${inList(LEAD_STATUSES)})`),
    check(
      'platform_leads_status_before_check',
      sql`${t.statusBefore} is null or ${t.statusBefore} in (${inList(LEAD_STATUSES)})`,
    ),
    check(
      'platform_leads_legal_form_check',
      sql`${t.legalForm} is null or ${t.legalForm} in (${inList(ORG_LEGAL_FORMS)})`,
    ),
    check('platform_leads_inn_check', sql`${t.inn} is null or ${t.inn} ~ '^[0-9]{14}$'`),
    check('platform_leads_okpo_check', sql`${t.okpo} is null or ${t.okpo} ~ '^[0-9]{8}$'`),
    check(
      'platform_leads_doc_fields_check',
      sql`char_length(coalesce(${t.address}, '')) <= ${sql.raw(String(LEAD_ADDRESS_MAX))} and char_length(coalesce(${t.head}, '')) <= ${sql.raw(String(LEAD_HEAD_MAX))}`,
    ),
    // Документы есть только у заявки с формой: ИП или ОсОО определяет, какие файлы нужны.
    check(
      'platform_leads_docs_state_check',
      sql`${t.docsState} is null or (${t.docsState} in ('pending', 'ready') and ${t.legalForm} is not null)`,
    ),
    check(
      'platform_leads_tg_check',
      sql`(${t.tgChatId} is null) = (${t.tgLinkedAt} is null) and (${t.tgChatId} is null or ${t.tgChatId} > 0)`,
    ),
    index('platform_leads_docs_purge_idx')
      .on(t.docsPurgeAt)
      .where(sql`${t.docsPurgeAt} is not null`),
  ],
).enableRLS();

/**
 * Документы заявки (доработки 14.11.2026, блок 1, пункт 1): ИП — «Свидетельство ГНС», ОсОО — «Выписка» и
 * «Свидетельство Минюста»; только PDF до 20 МБ. Файл лежит в хранилище под ключом
 * `leads/<заявка>/<номер файла>` — вне папок организаций, его видит только администратор платформы.
 * Загрузка идёт мимо API по подписанной ссылке: строка `pending`, после проверки размера и первых байтов
 * — `ready`. Роль приложения таблицу не видит и не меняет (RLS без политик): пишут и читают только
 * функции базы метода без входа и Админки (их добавляют задачи блока 1). Стирается вместе с заявкой.
 */
export const platformLeadDocs = pgTable(
  'platform_lead_docs',
  {
    /** Номер задаёт API до вставки: из него строится ключ хранилища. */
    id: uuid('id').primaryKey(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => platformLeads.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: LEAD_DOC_KINDS }).notNull(),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull().unique(),
    state: text('state').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Один файл каждого вида у заявки.
    unique('platform_lead_docs_kind_key').on(t.leadId, t.kind),
    check('platform_lead_docs_kind_check', sql`${t.kind} in (${inList(LEAD_DOC_KINDS)})`),
    check(
      'platform_lead_docs_name_check',
      sql`char_length(${t.name}) between 1 and ${sql.raw(String(FILE_NAME_MAX_LENGTH))}`,
    ),
    check(
      'platform_lead_docs_type_check',
      sql`${t.contentType} = '${sql.raw(LEAD_DOC_CONTENT_TYPE)}'`,
    ),
    check(
      'platform_lead_docs_size_check',
      sql`${t.sizeBytes} between 0 and ${sql.raw(String(FILE_MAX_BYTES))}`,
    ),
    check('platform_lead_docs_state_check', sql`${t.state} in ('pending', 'ready')`),
    check(
      'platform_lead_docs_key_check',
      sql`${t.storageKey} = ('leads/' || ${t.leadId}::text || '/' || ${t.id}::text)`,
    ),
  ],
).enableRLS();

/**
 * Одноразовые ссылки «Подключить Telegram» заявителя (доработки 14.11.2026, блок 1, пункт 2): здесь —
 * только SHA-256 токена; ссылка действует 24 часа и один раз. Роль приложения таблицу не видит и не
 * меняет (RLS без политик): только функции базы метода без входа и бота.
 */
export const platformLeadTgTokens = pgTable(
  'platform_lead_tg_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => platformLeads.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    /** Чат, который использовал ссылку: повтор того же сообщения от Telegram остаётся без ответа. */
    usedChatId: bigint('used_chat_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('platform_lead_tg_tokens_lead_idx').on(t.leadId),
    index('platform_lead_tg_tokens_expires_idx').on(t.expiresAt),
    check(
      'platform_lead_tg_tokens_used_check',
      sql`${t.usedChatId} is null or ${t.usedAt} is not null`,
    ),
  ],
).enableRLS();

/**
 * История заявки: кто, когда, с какого статуса на какой, причина или комментарий (ТЗ «В историю заявки
 * пишется…»). Хранится вместе с заявкой и стирается с ней («Удалить» — заявка стирается полностью).
 * `actor_user_id` пусто — запись гостя с лендинга.
 */
export const platformLeadEvents = pgTable(
  'platform_lead_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => platformLeads.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: LEAD_EVENT_KINDS }).notNull(),
    fromStatus: text('from_status', { enum: LEAD_STATUSES }),
    toStatus: text('to_status', { enum: LEAD_STATUSES }),
    /** Причина отката и отказа, название созданной организации; у повторной заявки — её комментарий. */
    text: text('text'),
    /**
     * Откуда сделана запись, если не с сайта: `telegram` — кнопкой или ответом в чате бота («через
     * Telegram»; поток Т, задача Т6). Ставит база из отметки транзакции `app.via` (`markViaTelegram`).
     */
    via: text('via').default(sql`nullif(current_setting('app.via', true), '')`),
  },
  (t) => [
    index('platform_lead_events_lead_idx').on(t.leadId, t.at),
    check('platform_lead_events_kind_check', sql`${t.kind} in (${inList(LEAD_EVENT_KINDS)})`),
    check('platform_lead_events_via_check', sql`${t.via} is null or ${t.via} = 'telegram'`),
  ],
).enableRLS();
