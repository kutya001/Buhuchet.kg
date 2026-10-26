import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { organizations } from './organizations';
import { orgIsolation } from './rls';
import { roles } from './roles';
import { users } from './users';

/**
 * Учётная политика и настройки организации — одна строка на организацию, создаётся вместе с ней
 * (`defaultOrgPolicy` в @buhuchet/domain). Выключенный модуль скрыт у всех, данные не удаляются.
 */
export const orgSettings = pgTable(
  'org_settings',
  {
    orgId: uuid('org_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Функция → включена (tasks, calendar, fee, taxpay, accounts, telegram, files, …). */
    features: jsonb('features').$type<Record<string, boolean>>().notNull(),
    remindDays: integer('remind_days')
      .array()
      .notNull()
      .default(sql`'{7,3}'`),
    overdueRepeat: boolean('overdue_repeat').notNull().default(true),
    digestTime: time('digest_time').notNull().default('09:00'),
    timezone: text('timezone').notNull().default('Asia/Bishkek'),
    confirmWaitDays: integer('confirm_wait_days').notNull().default(3),
    defaultRoleId: uuid('default_role_id'),
    taskConfirm: boolean('task_confirm').notNull().default(true),
    reportConfirm: boolean('report_confirm').notNull().default(true),
    payBeforeSubmit: boolean('pay_before_submit').notNull().default(true),
    /** Разделы страницы контрагента по ссылке (`PAGE_SECTIONS` из @buhuchet/domain), по порядку. */
    pageSections: text('page_sections')
      .array()
      .notNull()
      .default(sql`'{pay,reports,money,fee,kpi,contacts}'`),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    foreignKey({
      name: 'org_settings_default_role_fk',
      columns: [t.defaultRoleId, t.orgId],
      foreignColumns: [roles.id, roles.orgId],
    }).onDelete('restrict'),
    orgIsolation('org_settings_isolation', t.orgId),
  ],
).enableRLS();
