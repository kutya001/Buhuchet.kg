import { DICT_REQUEST_DICTS, DICT_REQUEST_STATUSES } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { organizations } from './organizations';
import { reportTypes } from './platform-dicts';
import { orgIsolation } from './rls';
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
 * Запросы организации «Попросить добавить» (ТЗ «Если нужного значения нет, кнопка «Попросить добавить»
 * отправляет запрос администратору платформы»; прототип modules/dicts.js `requestDlg`): в какой
 * справочник, что добавить, комментарий. Администратор платформы отвечает «Добавлено» или
 * «Отклонено» (Админка → «Запросы», задача 2.36). Организация запрос не меняет и не удаляет.
 */
export const dictChangeRequests = pgTable(
  'dict_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    dict: text('dict').notNull(),
    what: text('what').notNull(),
    comment: text('comment').notNull().default(''),
    status: text('status').notNull().default('new'),
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
    index('dict_change_requests_org_idx').on(t.orgId, t.createdAt.desc()),
    check('dict_change_requests_dict_check', sql`${t.dict} in (${oneOf(DICT_REQUEST_DICTS)})`),
    check(
      'dict_change_requests_status_check',
      sql`${t.status} in (${oneOf(DICT_REQUEST_STATUSES)})`,
    ),
    check('dict_change_requests_what_check', sql`length(btrim(${t.what})) between 1 and 300`),
    check('dict_change_requests_comment_check', sql`length(${t.comment}) <= 2000`),
    orgIsolation('dict_change_requests_isolation', t.orgId),
  ],
).enableRLS();
