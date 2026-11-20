import {
  FILE_LINK_SOURCE_KINDS,
  FILE_MAX_BYTES,
  FILE_NAME_MAX_LENGTH,
  SENT_FILE_COMMENT_MAX,
  SENT_FILE_REASON_MAX,
  SENT_FILE_SENDER_MAX,
  SENT_FILE_SOURCES,
  SENT_FILE_STATES,
  SENT_FILE_STATUSES,
} from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { contractors } from './contractors';
import { organizations } from './organizations';
import { appRole, currentOrgId, orgIsolation } from './rls';
import { users } from './users';

/** Состояние файла: загрузка начата, файл в хранилище и виден, удалён. */
export const FILE_STATES = ['pending', 'ready', 'deleted'] as const;
export type FileState = (typeof FILE_STATES)[number];

/**
 * Файлы организации (ТЗ «Файловый менеджер»): договоры, отчёты, квитанции, платёжки — до 20 МБ. Сам файл
 * лежит в хранилище S3 под ключом `org/<org_id>/files/<номер загрузки>` (ограничение `files_key_check`
 * не даёт записи указать на файл чужой организации; у заменённого файла это номер загрузки-замены —
 * прототип v95, «Изменить файл»), здесь — описание и источник: к какой записи он прикреплён (вид и номер
 * записи; «manual» — загружен вручную, без записи) и контрагент записи — для области «Свои контрагенты»
 * и Файлового менеджера.
 *
 * Загрузка идёт мимо API: запись создаётся «pending», браузер кладёт файл в хранилище по подписанной
 * ссылке, затем API проверяет размер и делает файл «ready». Удаление — отметка «deleted» с автором и
 * временем (на файл могут ссылаться «История статусов» и история записи), сам файл стирается из
 * хранилища. Незаконченные загрузки старше суток удаляет задача по расписанию — других удалений строк
 * нет (политика `files_delete_pending`).
 */
export const files = pgTable(
  'files',
  {
    /** Номер задаёт API до вставки: из него строится ключ хранилища. */
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** Вид записи-источника: `FileSourceKind` из @buhuchet/domain. */
    sourceKind: text('source_kind').notNull(),
    /** Номер записи-источника; пусто — у «Загружен вручную». Ссылку проверяет модуль записи. */
    sourceId: uuid('source_id'),
    /**
     * Контрагент записи; пусто — общий файл организации. Ключ на пару (contractor_id, org_id) с
     * ON DELETE SET NULL (contractor_id) — в миграции 0040 (контрагенты): Drizzle не умеет SET NULL части ключа.
     */
    contractorId: uuid('contractor_id'),
    /** Имя файла, как у пользователя: «Договор_обслуживания_1851.pdf». */
    name: text('name').notNull(),
    /** Тип содержимого по расширению (`fileContentType`). */
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull().unique(),
    /** Примечание к файлу (прототип v95): необязательное, меняется в окне «Изменить файл». */
    note: text('note'),
    /**
     * Загрузка-замена (прототип v95, «Изменить файл» → «Заменить файл»): номер файла, который она
     * заменит. Есть только у начатой загрузки: при замене её ключ хранилища, размер и тип переходят к
     * файлу, а сама строка стирается. Обычным «закончить загрузку» такая строка файлом не становится.
     */
    replacesId: uuid('replaces_id'),
    /** Когда и кто заменил файл; пусто — файл не заменяли. */
    replacedAt: timestamp('replaced_at', { withTimezone: true }),
    replacedBy: uuid('replaced_by').references(() => users.id),
    state: text('state', { enum: FILE_STATES }).notNull().default('pending'),
    /**
     * Скрыт со страницы контрагента («Скрыть со страницы контрагента», решение заказчика 06.11.2026):
     * раздел «Файлы» и файлы отчётов страницы его не показывают (прототип v74 хранит скрытые по имени
     * у контрагента — `c.pgHide`; здесь — у самого файла, чтобы файл с тем же именем не прятался).
     */
    pageHidden: boolean('page_hidden').notNull().default(false),
    /** Кто загрузил — пользователь запроса (политика `files_insert_guard`). */
    createdBy: uuid('created_by')
      .notNull()
      .default(sql`app.current_user_id()`),
    updatedBy: uuid('updated_by').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('files_id_org_unique').on(t.id, t.orgId),
    // Для составного ключа принятого отправленного файла: файл — того же контрагента.
    unique('files_id_org_contractor_unique').on(t.id, t.orgId, t.contractorId),
    foreignKey({
      name: 'files_created_by_fk',
      columns: [t.createdBy, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('restrict'),
    check('files_source_kind_check', sql`${t.sourceKind} ~ '^[a-z_]{1,40}$'`),
    check('files_state_check', sql`${t.state} in ('pending', 'ready', 'deleted')`),
    check('files_size_check', sql`${t.sizeBytes} between 0 and ${sql.raw(String(FILE_MAX_BYTES))}`),
    check(
      'files_name_check',
      sql`char_length(${t.name}) between 1 and ${sql.raw(String(FILE_NAME_MAX_LENGTH))}`,
    ),
    foreignKey({
      name: 'files_replaces_fk',
      columns: [t.replacesId, t.orgId],
      foreignColumns: [t.id, t.orgId],
    }).onDelete('cascade'),
    // Замену начинают только для загруженного файла, и она остаётся начатой загрузкой.
    check('files_replaces_check', sql`${t.replacesId} is null or ${t.state} = 'pending'`),
    check('files_replaced_check', sql`(${t.replacedAt} is null) = (${t.replacedBy} is null)`),
    check(
      'files_key_check',
      sql`${t.storageKey} ~ ('^org/' || ${t.orgId}::text || '/files/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')`,
    ),
    check(
      'files_deleted_check',
      sql`(${t.state} = 'deleted') = (${t.deletedAt} is not null and ${t.deletedBy} is not null)`,
    ),
    index('files_source_idx')
      .on(t.orgId, t.sourceKind, t.sourceId, t.createdAt)
      .where(sql`${t.state} = 'ready'`),
    index('files_contractor_idx')
      .on(t.orgId, t.contractorId)
      .where(sql`${t.contractorId} is not null`),
    index('files_pending_idx')
      .on(t.orgId, t.createdAt)
      .where(sql`${t.state} = 'pending'`),
    // Занятая память организации (`app.org_usage`): сумма размеров загруженных файлов без чтения строк;
    // документы заявки в память не входят (прототип `afOrgRows`: `mem` у них нет).
    index('files_usage_idx')
      .on(t.orgId, t.sizeBytes)
      .where(sql`${t.state} = 'ready' and ${t.sourceKind} <> 'lead'`),
    orgIsolation('files_isolation', t.orgId),
    // Загрузил тот, кто вошёл: подставить другого автора (и обойти «свой файл в течение суток») нельзя.
    pgPolicy('files_insert_guard', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: sql`${t.createdBy} = app.current_user_id() and ${t.state} = 'pending'`,
    }),
    // Удалённый файл не возвращается; удаляет тот, кто вошёл.
    pgPolicy('files_update_guard', {
      as: 'restrictive',
      for: 'update',
      to: appRole,
      using: sql`${t.state} <> 'deleted'`,
      withCheck: sql`${t.state} <> 'deleted' or ${t.deletedBy} = app.current_user_id()`,
    }),
    // Строку можно удалить, только пока загрузка не закончена.
    pgPolicy('files_delete_pending', {
      as: 'restrictive',
      for: 'delete',
      to: appRole,
      using: sql`${t.state} = 'pending'`,
    }),
  ],
).enableRLS();

const oneOf = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * Ещё одна ссылка файла — на запись контрагента, без копии (доработки 16.11.2026, блок 2; общая основа
 * пакета — этап 0, миграция 0157): принятый чек, накладная, акт, сверка контрагента — один файл в
 * хранилище и одна строка в «Файловом менеджере», источник — «От контрагента», а ссылки ведут ещё и к
 * записям этого контрагента (`FILE_LINK_SOURCE_KINDS`: деньги, операции, проекты, отчёты). «Открепить» и
 * удаление записи удаляют только ссылку (историю пишет модуль записи); файл уходит из хранилища, когда
 * у него не осталось ни одной ссылки.
 *
 * Роль приложения ставит ссылку только от своего имени и только на загруженный файл самого контрагента —
 * «От контрагента», «Из свидетельства и выписки», загруженный вручную к контрагенту, а не файл чужой
 * записи (задачи, оплаты за обслуживание…) (триггер `file_links_file_guard`); не меняет её (нет UPDATE),
 * удалить может. Что запись — того же контрагента,
 * что её видно сотруднику (право и область модуля записи) и что файл оплаты за обслуживание виден только
 * с правом «Видеть плату за обслуживание», проверяет API.
 */
export const fileLinks = pgTable(
  'file_links',
  {
    orgId: uuid('org_id')
      .notNull()
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'restrict' }),
    fileId: uuid('file_id').notNull(),
    /** Вид записи: `FileLinkSourceKind` из @buhuchet/domain. */
    sourceKind: text('source_kind').notNull(),
    /** Номер записи; ссылку проверяет модуль записи, как у `files.source_id`. */
    sourceId: uuid('source_id').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .default(sql`app.current_user_id()`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'file_links_pk', columns: [t.fileId, t.sourceKind, t.sourceId] }),
    foreignKey({
      name: 'file_links_file_fk',
      columns: [t.fileId, t.orgId],
      foreignColumns: [files.id, files.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'file_links_created_by_fk',
      columns: [t.createdBy, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('restrict'),
    index('file_links_source_idx').on(t.orgId, t.sourceKind, t.sourceId),
    check(
      'file_links_source_kind_check',
      sql`${t.sourceKind} in (${oneOf(FILE_LINK_SOURCE_KINDS)})`,
    ),
    orgIsolation('file_links_isolation', t.orgId),
    // Ссылку ставит тот, кто вошёл (автора не подставить).
    pgPolicy('file_links_insert_guard', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: sql`${t.createdBy} = app.current_user_id()`,
    }),
  ],
).enableRLS();

/**
 * Файлы от контрагентов — «Отправленные файлы» (доработки 14.11.2026, блок 2): контрагент присылает
 * файл со своей страницы или боту в Telegram, сотрудник принимает или отклоняет с причиной. Файл лежит в
 * хранилище под ключом `org/<org_id>/sent/<номер>`. Принятый копируется в обычный файл контрагента
 * (`files`, источник «От контрагента») — `file_id`; непринятые («Новый», «Отклонён») через 30 дней после
 * отправки удаляются вместе с файлом в хранилище.
 *
 * Строку создаёт загрузка без входа (страница по коду, бот) — функциями базы задачи блока 2; роль
 * приложения вставляет только начатую новую загрузку, меняет только загрузку и решение по новому файлу
 * (права на столбцы — в миграции 0147), принятый файл не удаляет.
 */
export const contractorSentFiles = pgTable(
  'contractor_sent_files',
  {
    /** Номер задаёт API до вставки: из него строится ключ хранилища. */
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    contractorId: uuid('contractor_id').notNull(),
    source: text('source', { enum: SENT_FILE_SOURCES }).notNull(),
    /** Имя в Telegram того, кто прислал (у страницы — пусто: «Контрагент»). */
    senderName: text('sender_name'),
    /** Чат Telegram, из которого прислан файл. */
    tgChatId: bigint('tg_chat_id', { mode: 'number' }),
    /** «Комментарий» со страницы или подпись к файлу в Telegram. */
    comment: text('comment'),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull().unique(),
    state: text('state', { enum: SENT_FILE_STATES }).notNull().default('pending'),
    status: text('status', { enum: SENT_FILE_STATUSES }).notNull().default('new'),
    /** Причина «Отклонить» — обязательна; контрагент видит её у себя. */
    rejectReason: text('reject_reason'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Файл контрагента, которым стал принятый. */
    fileId: uuid('file_id'),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('contractor_sent_files_id_org_unique').on(t.id, t.orgId),
    // Для составного ключа чека «Я оплатил»: чек — отправленный файл того же контрагента.
    unique('contractor_sent_files_scope_unique').on(t.id, t.orgId, t.contractorId),
    foreignKey({
      name: 'contractor_sent_files_contractor_fk',
      columns: [t.contractorId, t.orgId],
      foreignColumns: [contractors.id, contractors.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'contractor_sent_files_decided_by_fk',
      columns: [t.decidedBy, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('restrict'),
    // Принятый — файл того же контрагента своей организации.
    foreignKey({
      name: 'contractor_sent_files_file_fk',
      columns: [t.fileId, t.orgId, t.contractorId],
      foreignColumns: [files.id, files.orgId, files.contractorId],
    }),
    check('contractor_sent_files_source_check', sql`${t.source} in (${oneOf(SENT_FILE_SOURCES)})`),
    check(
      'contractor_sent_files_tg_check',
      sql`(${t.source} = 'telegram') = (${t.tgChatId} is not null) and char_length(coalesce(${t.senderName}, '')) <= ${sql.raw(String(SENT_FILE_SENDER_MAX))}`,
    ),
    check(
      'contractor_sent_files_comment_check',
      sql`char_length(coalesce(${t.comment}, '')) <= ${sql.raw(String(SENT_FILE_COMMENT_MAX))}`,
    ),
    check(
      'contractor_sent_files_name_check',
      sql`char_length(${t.name}) between 1 and ${sql.raw(String(FILE_NAME_MAX_LENGTH))}`,
    ),
    check(
      'contractor_sent_files_size_check',
      sql`${t.sizeBytes} between 0 and ${sql.raw(String(FILE_MAX_BYTES))}`,
    ),
    check(
      'contractor_sent_files_key_check',
      sql`${t.storageKey} = ('org/' || ${t.orgId}::text || '/sent/' || ${t.id}::text)`,
    ),
    check('contractor_sent_files_state_check', sql`${t.state} in (${oneOf(SENT_FILE_STATES)})`),
    check(
      'contractor_sent_files_status_check',
      sql`${t.status} in (${oneOf(SENT_FILE_STATUSES)}) and (${t.status} = 'new' or ${t.state} = 'ready')`,
    ),
    check(
      'contractor_sent_files_reason_check',
      sql`(${t.status} = 'rejected') = (${t.rejectReason} is not null) and (${t.rejectReason} is null or char_length(${t.rejectReason}) between 1 and ${sql.raw(String(SENT_FILE_REASON_MAX))})`,
    ),
    check(
      'contractor_sent_files_decided_check',
      sql`(${t.status} = 'new') = (${t.decidedAt} is null) and (${t.decidedAt} is null) = (${t.decidedBy} is null)`,
    ),
    check(
      'contractor_sent_files_accepted_check',
      sql`(${t.status} = 'accepted') = (${t.fileId} is not null)`,
    ),
    index('contractor_sent_files_contractor_idx').on(t.orgId, t.contractorId, t.createdAt.desc()),
    // Один файл контрагента — из одного принятого; и поиск по ключу при удалении строки `files`.
    uniqueIndex('contractor_sent_files_file_key')
      .on(t.fileId)
      .where(sql`${t.fileId} is not null`),
    // Удаление непринятых через 30 дней.
    index('contractor_sent_files_purge_idx')
      .on(t.orgId, t.createdAt)
      .where(sql`${t.status} <> 'accepted'`),
    orgIsolation('contractor_sent_files_isolation', t.orgId),
    // Роль приложения вставляет только начатую загрузку нового файла.
    pgPolicy('contractor_sent_files_insert_guard', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: sql`${t.state} = 'pending' and ${t.status} = 'new'`,
    }),
    // Меняется только новый файл (загрузка и решение): принятый и отклонённый — окончательно, на них
    // ссылаются файл контрагента и история. Решает тот, кто вошёл. Загруженный не становится снова
    // незаконченным — триггер `contractor_sent_files_state_guard` (миграция 0147).
    pgPolicy('contractor_sent_files_update_guard', {
      as: 'restrictive',
      for: 'update',
      to: appRole,
      using: sql`${t.status} = 'new'`,
      withCheck: sql`${t.status} = 'new' or ${t.decidedBy} = app.current_user_id()`,
    }),
    // Стираются только непринятые (через 30 дней) и незаконченные загрузки.
    pgPolicy('contractor_sent_files_delete_guard', {
      as: 'restrictive',
      for: 'delete',
      to: appRole,
      using: sql`${t.status} <> 'accepted'`,
    }),
  ],
).enableRLS();

/** Номер в ключе хранилища: uuid строчными. */
const KEY_UUID = '[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}';

/**
 * Какие ключи можно поставить на повторное удаление: файлы с публичных загрузок — документы заявок с
 * лендинга (`leads/upload/<номер>`, `leads/<заявка>/<номер>`) и отправленные контрагентом
 * (`org/<организация>/sent/<номер>`, его загрузка `.up` и проверочная копия `.chk-<номер>`), а также
 * копия принятого файла (`org/<организация>/files/<номер>`). Другие ключи функция не принимает. Ключ, на
 * который ещё ссылается живая строка (файл, отправленный файл, документ или загрузка заявки), задача не
 * удаляет, а снимает с повтора (`app.storage_retry_due`).
 */
export const STORAGE_RETRY_KEY_RE = `^(leads/upload/${KEY_UUID}|leads/${KEY_UUID}/${KEY_UUID}|org/${KEY_UUID}/(sent/${KEY_UUID}(\\.up|\\.chk-${KEY_UUID})?|files/${KEY_UUID}))$`;

/**
 * Файлы, которые не удалось удалить из хранилища (доработки 14.11.2026, этап 3, «удаление убирает и
 * сам файл»): строки заявки и отправленного файла к этому моменту уже стёрты или файл больше им не
 * нужен, поэтому ключ запоминается здесь, и задача `files.storage-retry` повторяет удаление, пока оно
 * не удастся. Таблица общая для платформы: в ней только ключи, без данных организаций; роль приложения
 * её не видит — только функции `app.storage_retry_*` (миграция 0155).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#И-10
export const storageDeleteRetries = pgTable(
  'storage_delete_retries',
  {
    key: text('key').primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Сколько раз задача пробовала удалить; 0 — ещё ни разу. */
    attempts: integer('attempts').notNull().default(0),
    triedAt: timestamp('tried_at', { withTimezone: true }),
  },
  (t) => [
    index('storage_delete_retries_created_idx').on(t.createdAt),
    check(
      'storage_delete_retries_key_check',
      sql`${t.key} ~ ${sql.raw(`'${STORAGE_RETRY_KEY_RE}'`)}`,
    ),
  ],
).enableRLS();

/**
 * Что нашла сверка хранилища (пакет 2, блок 3, «Проверка хранилища»; прототип `DB.storage.check`):
 * «Есть в базе, нет в хранилище», «Лишний в хранилище», «Зависшая загрузка», «Не стёрт».
 */
export const STORAGE_CHECK_KINDS = ['missing', 'extra', 'stuck', 'failed'] as const;
export type StorageCheckKind = (typeof STORAGE_CHECK_KINDS)[number];
export const STORAGE_CHECK_RUN_STATES = ['running', 'done', 'failed'] as const;

/**
 * Почему файл ждёт стирания (прототип `FT_WHY`): удалён сотрудником, прежняя версия после «Изменить
 * файл», не принят от контрагента за 30 дней, лишний файл хранилища — удалён администратором.
 */
export const FILE_TRASH_REASONS = ['del', 'rep', 'auto', 'extra'] as const;
export type FileTrashReason = (typeof FILE_TRASH_REASONS)[number];
/** Через сколько часов после удаления файл стирается из хранилища (прототип `FT_HOURS`). */
export const FILE_TRASH_HOURS = 24;

const currentUserId = sql`app.current_user_id()`;
const isPlatformAdmin = sql`app.is_platform_admin()`;
const adminOutsideOrg = sql`${currentOrgId} is null and ${isPlatformAdmin}`;

/**
 * «Ждут удаления» (доработки 20.11.2026, пакет 2, блок 5, пункты 3–4; прототип `DB.storage.trash`;
 * миграция 0165): объект хранилища стирается не сразу, а через сутки (`erase_at`); до этого
 * администратор платформы видит его в Админке → «Файлы» → «Хранилище» и может «Вернуть» удалённый
 * сотрудником файл (`del`, строка файла — `file_id`) и лишний файл хранилища (`extra`). Удалённый файл
 * сразу пропадает из списков и из памяти организации (`files.state = 'deleted'`). Ставит строку тот, кто
 * удалил: сотрудник и задача — в контексте своей организации, администратор — лишний файл вне её; стирает
 * задача «Файлы: стирание удалённых» функциями этапа 1. Своей «Корзины» у организации нет.
 */
export const fileTrash = pgTable(
  'file_trash',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Организация файла; пусто — лишний файл хранилища без организации. */
    orgId: uuid('org_id')
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'cascade' }),
    why: text('why', { enum: FILE_TRASH_REASONS }).notNull(),
    /** Удалённый файл (`del`) — для «Вернуть». */
    fileId: uuid('file_id'),
    /**
     * Ключ хранилища: у организации — только в её папке `org/<org_id>/`, без `.` и `..` в пути; кроме
     * лишнего файла — ключ файла или присланного файла (`files/<номер>`, `sent/<номер>` с `.up`, `.chk-…`);
     * у `del` — ключ файла `file_id`.
     */
    storageKey: text('storage_key').notNull(),
    /**
     * Контрагент файла: составной внешний ключ (contractor_id, org_id) на контрагента своей организации с
     * ON DELETE SET NULL (contractor_id) — в миграции 0165 (Drizzle не умеет SET NULL части ключа).
     */
    contractorId: uuid('contractor_id'),
    name: text('name').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** Откуда файл — как в «Все файлы»: «Отчёт», «Поступление», «Лишний файл хранилища»… */
    source: text('source'),
    /**
     * Ссылки файла на записи до удаления (`file_links`: `[{ sourceKind, sourceId }]`) — «Вернуть»
     * возвращает и их (прототип `ftRestore`); пишет удаление этапа 1.
     */
    links: jsonb('links')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** «Не удалось стереть» (прототип): сколько раз задача пыталась и последняя ошибка без ключей. */
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** Кто удалил; пусто — система (не принят за 30 дней). */
    deletedBy: uuid('deleted_by')
      .default(currentUserId)
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
    /** Когда стереть — через сутки после удаления; раньше нельзя (`file_trash_erase_check`). */
    eraseAt: timestamp('erase_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '${sql.raw(String(FILE_TRASH_HOURS))} hours'`),
    erasedAt: timestamp('erased_at', { withTimezone: true }),
    restoredAt: timestamp('restored_at', { withTimezone: true }),
    restoredBy: uuid('restored_by').references(() => users.id),
  },
  (t) => [
    foreignKey({
      name: 'file_trash_file_fk',
      columns: [t.fileId, t.orgId],
      foreignColumns: [files.id, files.orgId],
    }).onDelete('cascade'),
    check(
      'file_trash_fields_check',
      sql`${t.why} in (${oneOf(FILE_TRASH_REASONS)}) and (${t.why} = 'del') = (${t.fileId} is not null) and (${t.why} = 'extra' or ${t.orgId} is not null) and char_length(${t.name}) between 1 and ${sql.raw(String(FILE_NAME_MAX_LENGTH))} and char_length(${t.storageKey}) between 1 and 300 and (${t.orgId} is null or starts_with(${t.storageKey}, 'org/' || ${t.orgId}::text || '/')) and ${t.storageKey} !~ '(^|/)[.]{1,2}(/|$)' and (${t.why} = 'extra' or ${t.storageKey} ~ ('^org/' || ${t.orgId}::text || '/(files|sent)/${sql.raw(KEY_UUID)}([.]up|[.]chk-${sql.raw(KEY_UUID)})?$')) and (${t.orgId} is not null or ${t.contractorId} is null) and char_length(coalesce(${t.source}, '')) <= 100 and ${t.sizeBytes} >= 0`,
    ),
    check(
      'file_trash_erase_try_check',
      sql`${t.attempts} >= 0 and char_length(coalesce(${t.lastError}, '')) <= 500 and case when jsonb_typeof(${t.links}) = 'array' then jsonb_array_length(${t.links}) <= 500 else false end`,
    ),
    // Не раньше суток — у всех: «стереть сразу» через эту таблицу нельзя.
    check(
      'file_trash_erase_check',
      sql`${t.eraseAt} >= ${t.deletedAt} + interval '${sql.raw(String(FILE_TRASH_HOURS))} hours'`,
    ),
    check(
      'file_trash_restore_check',
      sql`(${t.restoredAt} is null) = (${t.restoredBy} is null) and (${t.restoredAt} is null or (${t.why} in ('del', 'extra') and ${t.erasedAt} is null))`,
    ),
    // Один и тот же объект ждёт стирания один раз.
    uniqueIndex('file_trash_live_key')
      .on(t.storageKey)
      .where(sql`${t.erasedAt} is null and ${t.restoredAt} is null`),
    index('file_trash_erase_idx')
      .on(t.eraseAt)
      .where(sql`${t.erasedAt} is null and ${t.restoredAt} is null`),
    index('file_trash_org_idx').on(t.orgId, t.deletedAt),
    orgIsolation('file_trash_isolation', t.orgId),
    pgPolicy('file_trash_admin', {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: adminOutsideOrg,
      withCheck: adminOutsideOrg,
    }),
    // Ставит тот, кто вошёл (задача — без пользователя), сейчас — значит, не раньше суток от сейчас;
    // лишний файл — только администратор; удалённый файл (`del`) — только с ключом этого файла своей
    // организации, уже удалённого (под RLS: чужой файл не виден); прежняя версия и непринятый
    // присланный (`rep`, `auto`) — не ключ живого файла: «Изменить файл» сначала меняет ключ файла.
    pgPolicy('file_trash_insert_guard', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: sql`${t.deletedBy} is not distinct from ${currentUserId} and ${t.deletedAt} between now() - interval '5 minutes' and now() + interval '5 minutes' and ${t.erasedAt} is null and ${t.restoredAt} is null and ${t.attempts} = 0 and ${t.lastError} is null and (${t.why} <> 'extra' or ${isPlatformAdmin}) and (${t.why} <> 'del' or exists (select 1 from public.files f where f.id = ${t.fileId} and f.org_id = ${t.orgId} and f.storage_key = ${t.storageKey} and f.state = 'deleted')) and (${t.why} = 'del' or not exists (select 1 from public.files f where f.storage_key = ${t.storageKey} and f.state <> 'deleted'))`,
    }),
    // «Вернуть» — только администратор платформы, от своего имени; меняются только отметки «Вернуть»
    // (права на столбцы, миграция 0165), стирание и попытки пишут функции задачи этапа 1.
    pgPolicy('file_trash_update_guard', {
      as: 'restrictive',
      for: 'update',
      to: appRole,
      using: sql`${isPlatformAdmin} and ${t.erasedAt} is null and ${t.restoredAt} is null`,
      withCheck: sql`${isPlatformAdmin} and ${t.restoredBy} = ${currentUserId}`,
    }),
  ],
).enableRLS();

/**
 * Запуски сверки хранилища с базой (пакет 2, блок 3; задача `files.storage-reconcile`, раз в день;
 * миграция 0165): когда, чем кончилась и сколько чего найдено. Данные платформы: читает только
 * администратор платформы, пишут функции задачи (этап 1).
 */
export const storageCheckRuns = pgTable(
  'storage_check_runs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    state: text('state', { enum: STORAGE_CHECK_RUN_STATES }).notNull().default('running'),
    /** Сколько объектов хранилища просмотрено. */
    objects: integer('objects').notNull().default(0),
    missing: integer('missing').notNull().default(0),
    extra: integer('extra').notNull().default(0),
    stuck: integer('stuck').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    /** Почему не закончилась — без ключей и адресов. */
    error: text('error'),
  },
  (t) => [
    check(
      'storage_check_runs_state_check',
      sql`${t.state} in (${oneOf(STORAGE_CHECK_RUN_STATES)}) and (${t.state} = 'running') = (${t.finishedAt} is null) and char_length(coalesce(${t.error}, '')) <= 500`,
    ),
    check(
      'storage_check_runs_counts_check',
      sql`${t.objects} >= 0 and ${t.missing} >= 0 and ${t.extra} >= 0 and ${t.stuck} >= 0 and ${t.failed} >= 0`,
    ),
    index('storage_check_runs_started_idx').on(t.startedAt.desc()),
    pgPolicy('storage_check_runs_admin_read', {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: isPlatformAdmin,
    }),
  ],
).enableRLS();

/**
 * Что нашла сверка — строка списка «Проверки хранилища». Одна открытая строка на вид и ключ: найдено
 * снова — обновляется `last_*`; пропало или решено («Удалить» лишнего — строка `file_trash` с `extra`)
 * — `resolved_at`. Организация (`key_org_id`) — из ключа, без внешнего ключа: объект может пережить свою
 * организацию; строки сверки — данные платформы, не организации.
 */
export const storageCheckItems = pgTable(
  'storage_check_items',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    kind: text('kind', { enum: STORAGE_CHECK_KINDS }).notNull(),
    key: text('key').notNull(),
    keyOrgId: uuid('key_org_id'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    /** Когда объект появился в хранилище (у «Есть в базе, нет в хранилище» — пусто). */
    objectAt: timestamp('object_at', { withTimezone: true }),
    firstRunId: bigint('first_run_id', { mode: 'number' })
      .notNull()
      .references(() => storageCheckRuns.id, { onDelete: 'restrict' }),
    lastRunId: bigint('last_run_id', { mode: 'number' })
      .notNull()
      .references(() => storageCheckRuns.id, { onDelete: 'restrict' }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'storage_check_items_kind_check',
      sql`${t.kind} in (${oneOf(STORAGE_CHECK_KINDS)}) and char_length(${t.key}) between 1 and 300 and (${t.sizeBytes} is null or ${t.sizeBytes} >= 0)`,
    ),
    uniqueIndex('storage_check_items_open_key')
      .on(t.kind, t.key)
      .where(sql`${t.resolvedAt} is null`),
    index('storage_check_items_open_idx')
      .on(t.kind, t.firstSeenAt)
      .where(sql`${t.resolvedAt} is null`),
    pgPolicy('storage_check_items_admin_read', {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: isPlatformAdmin,
    }),
  ],
).enableRLS();
