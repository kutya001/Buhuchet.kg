import {
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
  pgPolicy,
  pgTable,
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
