import { FILE_MAX_BYTES, FILE_NAME_MAX_LENGTH } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { organizations } from './organizations';
import { appRole, currentOrgId, orgIsolation } from './rls';
import { users } from './users';

/** Состояние файла: загрузка начата, файл в хранилище и виден, удалён. */
export const FILE_STATES = ['pending', 'ready', 'deleted'] as const;
export type FileState = (typeof FILE_STATES)[number];

/**
 * Файлы организации (ТЗ «Файловый менеджер»): договоры, отчёты, квитанции, платёжки — до 20 МБ. Сам файл
 * лежит в хранилище S3 под ключом `org/<org_id>/files/<id>` (ограничение `files_key_check` не даёт
 * записи указать на чужой файл), здесь — описание и источник: к какой записи он прикреплён (вид и номер
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
     * Контрагент записи; пусто — общий файл организации. Ключ на пару (contractor_id, org_id) появится
     * вместе с таблицей контрагентов.
     */
    contractorId: uuid('contractor_id'),
    /** Имя файла, как у пользователя: «Договор_обслуживания_1851.pdf». */
    name: text('name').notNull(),
    /** Тип содержимого по расширению (`fileContentType`). */
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull().unique(),
    /** Комментарий ручной загрузки (Файловый менеджер). */
    note: text('note'),
    state: text('state', { enum: FILE_STATES }).notNull().default('pending'),
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
    check(
      'files_key_check',
      sql`${t.storageKey} = 'org/' || ${t.orgId}::text || '/files/' || ${t.id}::text`,
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
