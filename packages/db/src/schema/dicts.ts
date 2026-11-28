import {
  DICT_REQUEST_DICTS,
  REQUEST_DICT_FORMS,
  REQUEST_KINDS,
  REQUEST_STATUSES,
} from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { organizations } from './organizations';
import { reportTypes } from './platform-dicts';
import { appRole, orgIsolation } from './rls';
import { users } from './users';

/**
 * Виды отчётов, которые организация подключила из каталога платформы, и её настройки по виду (ТЗ
 * «Справочники» → «Виды отчётов»): напоминания за сколько дней до срока, «Файл при сдаче обязателен»,
 * «Квитанция о приёме обязательна». Настройки действуют только для этой организации и не меняют
 * каталог. При отключении строка остаётся с `enabled = false`: повторное подключение возвращает её
 * настройки (прототип: `ORG.types[id].on`).
 */
export const orgReportTypes = pgTable(
  'org_report_types',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    reportTypeCode: text('report_type_code')
      .notNull()
      .references(() => reportTypes.code),
    enabled: boolean('enabled').notNull().default(true),
    /** Напоминать за N дней до срока, от большего к меньшему; в день срока — всегда, здесь его нет. */
    remindDays: integer('remind_days').array().notNull(),
    needFile: boolean('need_file').notNull().default(false),
    needReceipt: boolean('need_receipt').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.reportTypeCode] }),
    index('org_report_types_type_idx').on(t.reportTypeCode),
    check(
      'org_report_types_remind_days_check',
      sql`1 <= all(${t.remindDays}) and 60 >= all(${t.remindDays})`,
    ),
    orgIsolation('org_report_types_isolation', t.orgId),
  ],
).enableRLS();

/** Значение столбца — одно из постоянных кодов (без кавычек в самих кодах). */
const oneOf = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * Запросы организации администратору платформы (доработки 28.11.2026: запросы пользователей
 * администратору; прототип v169 modules/requests.js, `REQUESTS`). Было — только «Попросить добавить»
 * (ТЗ «Справочники платформы — только просмотр»; прототип modules/dicts.js `requestDlg`); теперь виды
 * «Вопрос», «Ошибка», «Опечатка», «Добавить в справочник», сквозной номер с 1201, форма, «Где», переписка
 * (`request_messages`) и статусы «В работе», «Решён», «Отозван». Правила без базы — `@buhuchet/domain`
 * (requests/rules.ts). Организация только отправляет, отзывает «Новый», пишет и отмечает прочитанное
 * (миграция 0178, триггер `dict_change_requests_org_guard`); статусы ставит администратор платформы.
 * Прежние `what`, `answer`, `decided_*` остаются до этапа 2 пакета: на них работают «Мои запросы» и Админка.
 */
export const dictChangeRequests = pgTable(
  'dict_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Номер запроса, сквозной по платформе, с 1201: ставит триггер из `request_no_seq`. */
    no: integer('no')
      .notNull()
      .$defaultFn(() => 0),
    kind: text('kind', { enum: REQUEST_KINDS }).notNull().default('dict'),
    /** Тема: у вопроса — своя, у ошибки — начало «Что случилось», у справочника — что добавить. */
    topic: text('topic').notNull().default(''),
    /** Форма справочника у «Добавить в справочник» (прототип `fid`); у других видов — пусто. */
    formId: text('form_id', { enum: REQUEST_DICT_FORMS }),
    /** Значения полей формы (без пустых). */
    form: jsonb('form').$type<Record<string, string>>().notNull().default({}),
    /** «Где»: модуль → вкладка → окно, адрес экрана, версия, браузер, размер, время — без значений полей. */
    whereInfo: jsonb('where_info').$type<Record<string, string>>(),
    /** Справочник продукта у прежних запросов «Попросить добавить»; у новых форм без своего кода — пусто. */
    dict: text('dict'),
    /** Прежнее «Что добавить» (до этапа 2 пакета 28.11.2026). */
    what: text('what'),
    comment: text('comment').notNull().default(''),
    status: text('status', { enum: REQUEST_STATUSES }).notNull().default('new'),
    /** «Ждёт вашего ответа»: администратор спросил автора, ответ автора снимает отметку. */
    wait: boolean('wait').notNull().default(false),
    /** «Ведёт» — администратор платформы, взявший запрос в работу. */
    leadAdmin: uuid('lead_admin').references(() => users.id),
    /** Номер последнего прочитанного сообщения ленты: у автора и у администраторов платформы. */
    readAuthor: integer('read_author').notNull().default(0),
    readAdmin: integer('read_admin').notNull().default(0),
    /** Последнее сообщение или смена статуса — для «Последнее сообщение» и порядка списка. */
    lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Ответ администратора платформы (почему отклонено, под каким названием добавлено). */
    answer: text('answer').notNull().default(''),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('dict_change_requests_id_org_unique').on(t.id, t.orgId),
    unique('dict_change_requests_no_unique').on(t.no),
    index('dict_change_requests_org_idx').on(t.orgId, t.createdAt.desc()),
    index('dict_change_requests_open_idx')
      .on(t.status, t.lastAt)
      .where(sql`${t.status} in ('new', 'in_work')`),
    check(
      'dict_change_requests_dict_check',
      sql`${t.dict} is null or ${t.dict} in (${oneOf(DICT_REQUEST_DICTS)})`,
    ),
    check('dict_change_requests_kind_check', sql`${t.kind} in (${oneOf(REQUEST_KINDS)})`),
    check(
      'dict_change_requests_form_id_check',
      sql`case when ${t.kind} = 'dict' then ${t.formId} in (${oneOf(REQUEST_DICT_FORMS)}) else ${t.formId} is null and ${t.dict} is null end`,
    ),
    check(
      'dict_change_requests_status_check',
      sql`${t.status} in (${oneOf(REQUEST_STATUSES)})`,
    ),
    check('dict_change_requests_no_check', sql`${t.no} >= 1201`),
    check('dict_change_requests_topic_check', sql`length(btrim(${t.topic})) between 1 and 700`),
    check(
      'dict_change_requests_form_check',
      sql`jsonb_typeof(${t.form}) = 'object' and octet_length(${t.form}::text) <= 40000`,
    ),
    check(
      'dict_change_requests_where_check',
      sql`${t.whereInfo} is null or (jsonb_typeof(${t.whereInfo}) = 'object' and octet_length(${t.whereInfo}::text) <= 2000)`,
    ),
    check(
      'dict_change_requests_what_check',
      sql`${t.what} is null or length(btrim(${t.what})) between 1 and 300`,
    ),
    check('dict_change_requests_comment_check', sql`length(${t.comment}) <= 2000`),
    check('dict_change_requests_wait_check', sql`not ${t.wait} or ${t.status} = 'in_work'`),
    check(
      'dict_change_requests_closed_check',
      sql`(${t.closedAt} is null) = (${t.status} in ('new', 'in_work'))`,
    ),
    check(
      'dict_change_requests_read_check',
      sql`${t.readAuthor} >= 0 and ${t.readAdmin} >= 0`,
    ),
    orgIsolation('dict_change_requests_isolation', t.orgId),
    // Организация только отправляет запрос: автор — текущий пользователь, статус «Новый», без ответа.
    pgPolicy('dict_change_requests_insert_guard', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: sql`${t.createdBy} = app.current_user_id() and ${t.status} = 'new' and ${t.answer} = '' and ${t.decidedBy} is null and ${t.decidedAt} is null and ${t.leadAdmin} is null and not ${t.wait} and ${t.closedAt} is null and ${t.readAdmin} = 0`,
    }),
  ],
).enableRLS();

/** Сообщение ленты запроса: от автора или сотрудника, ответ и вопрос администратора, смена статуса. */
export const REQUEST_MESSAGE_KINDS = ['msg', 'ask', 'st'] as const;
export type RequestMessageKind = (typeof REQUEST_MESSAGE_KINDS)[number];

/**
 * Переписка и история запроса одной лентой (блок 4, пункты 2 и 5; прототип `r.msgs`): сообщения по
 * порядку (`n` — 1, 2, …), у смены статуса — с какого, на какой и причина. Отправленное не изменяется и
 * не удаляется (у роли приложения нет UPDATE и DELETE). Сообщение администратора — от администратора
 * платформы, остальное — от пользователя из контекста.
 */
export const requestMessages = pgTable(
  'request_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').notNull(),
    n: integer('n').notNull(),
    kind: text('kind', { enum: REQUEST_MESSAGE_KINDS }).notNull(),
    byAdmin: boolean('by_admin').notNull().default(false),
    authorUserId: uuid('author_user_id')
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => users.id),
    text: text('text').notNull().default(''),
    fromStatus: text('from_status', { enum: REQUEST_STATUSES }),
    toStatus: text('to_status', { enum: REQUEST_STATUSES }),
    why: text('why').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('request_messages_id_org_unique').on(t.id, t.orgId),
    unique('request_messages_n_unique').on(t.requestId, t.n),
    foreignKey({
      name: 'request_messages_request_fk',
      columns: [t.requestId, t.orgId],
      foreignColumns: [dictChangeRequests.id, dictChangeRequests.orgId],
    }).onDelete('cascade'),
    index('request_messages_org_idx').on(t.orgId, t.createdAt),
    check('request_messages_kind_check', sql`${t.kind} in (${oneOf(REQUEST_MESSAGE_KINDS)})`),
    check('request_messages_n_check', sql`${t.n} >= 1`),
    check('request_messages_text_check', sql`length(${t.text}) <= 4000`),
    check('request_messages_why_check', sql`length(${t.why}) <= 4000`),
    check(
      'request_messages_st_check',
      sql`case when ${t.kind} = 'st' then ${t.toStatus} in (${oneOf(REQUEST_STATUSES)}) and ${t.fromStatus} in (${oneOf(REQUEST_STATUSES)}) and ${t.fromStatus} <> ${t.toStatus} else ${t.toStatus} is null and ${t.fromStatus} is null and ${t.why} = '' end`,
    ),
    check('request_messages_ask_check', sql`${t.kind} <> 'ask' or ${t.byAdmin}`),
    orgIsolation('request_messages_isolation', t.orgId),
    // От своего имени и с настоящим временем; «от администратора» — только администратор платформы.
    // Организация пишет сообщение и смену статуса только «Отозван» и «В работе» (ответ в закрытый).
    pgPolicy('request_messages_insert_own', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: sql`${t.authorUserId} = app.current_user_id() and ${t.createdAt} = now() and ${t.byAdmin} = app.is_platform_admin() and (${t.byAdmin} or ${t.kind} = 'msg' or (${t.kind} = 'st' and ${t.toStatus} in ('withdrawn', 'in_work')))`,
    }),
  ],
).enableRLS();

/**
 * Снимки экрана к запросу или сообщению (блок 2, пункт 4): PNG или JPG до 5 МБ, до 3 штук, в
 * хранилище платформы (в память организации не засчитываются). Пишет загрузка этапа 3 пакета; видят те,
 * кто видит запрос, и администраторы платформы — по временной ссылке.
 */
export const requestShots = pgTable(
  'request_shots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').notNull(),
    /** Сообщение, к которому снимок; пусто — к самому запросу. */
    messageId: uuid('message_id'),
    storageKey: text('storage_key').notNull(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    mime: text('mime').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('request_shots_storage_key_unique').on(t.storageKey),
    foreignKey({
      name: 'request_shots_request_fk',
      columns: [t.requestId, t.orgId],
      foreignColumns: [dictChangeRequests.id, dictChangeRequests.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'request_shots_message_fk',
      columns: [t.messageId, t.orgId],
      foreignColumns: [requestMessages.id, requestMessages.orgId],
    }).onDelete('cascade'),
    index('request_shots_request_idx').on(t.orgId, t.requestId),
    check('request_shots_size_check', sql`${t.size} between 1 and 5242880`),
    check('request_shots_mime_check', sql`${t.mime} in ('image/png', 'image/jpeg')`),
    check('request_shots_name_check', sql`length(btrim(${t.name})) between 1 and 200`),
    check('request_shots_key_check', sql`length(${t.storageKey}) between 1 and 300`),
    orgIsolation('request_shots_isolation', t.orgId),
    pgPolicy('request_shots_insert_own', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: sql`${t.createdBy} = app.current_user_id() and ${t.createdAt} = now()`,
    }),
  ],
).enableRLS();

/**
 * «Заметки» администратора платформы в запросе (прототип `k: 'note'`): видит и пишет только
 * администратор платформы, организации они не отдаются ни одним методом (блок 7, пункт 3) — ни роли
 * приложения в контексте организации, ни ролям «Витрины данных» (`DM_CLOSED_TABLES`).
 */
export const requestNotes = pgTable(
  'request_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').notNull(),
    authorUserId: uuid('author_user_id')
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => users.id),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'request_notes_request_fk',
      columns: [t.requestId, t.orgId],
      foreignColumns: [dictChangeRequests.id, dictChangeRequests.orgId],
    }).onDelete('cascade'),
    index('request_notes_request_idx').on(t.orgId, t.requestId, t.createdAt),
    check('request_notes_text_check', sql`length(btrim(${t.text})) between 1 and 4000`),
    orgIsolation('request_notes_isolation', t.orgId),
    pgPolicy('request_notes_admin_only', {
      as: 'restrictive',
      for: 'all',
      to: appRole,
      using: sql`app.is_platform_admin()`,
      withCheck: sql`app.is_platform_admin() and ${t.authorUserId} = app.current_user_id() and ${t.createdAt} = now()`,
    }),
  ],
).enableRLS();
