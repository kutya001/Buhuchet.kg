import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
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
