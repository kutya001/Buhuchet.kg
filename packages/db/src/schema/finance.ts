import {
  MONEY_AMOUNT_MAX,
  MONEY_NOTE_MAX,
  OP_REASON_MAX,
  SERVICE_DESCRIPTION_MAX,
  SERVICE_NAME_MAX,
} from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { money, recordVersion, timestamps } from './columns';
import { contractors } from './contractors';
import { organizations } from './organizations';
import { currentOrgId, orgIsolation } from './rls';
import { employees } from './staff';
import { users } from './users';

/*
 * «Финансовые операции по контрагентам» (задача 2.22; ТЗ «Финансовые операции по контрагентам», «Отчёт
 * по списаниям»; прототип modules/finance.js, modules/fin-op.js, modules/staff.js — «Списания в бонус»).
 * Операции по счёту контрагента — `money_operations`, оплаты за обслуживание — `fee_payments`; журнал
 * модуля — один запрос над ними (finance-journal.ts); здесь — закрытые месяцы и разовые услуги.
 */

const AMOUNT_MAX = sql.raw(String(MONEY_AMOUNT_MAX));
const REASON_MAX = sql.raw(String(OP_REASON_MAX));

/**
 * Закрытый месяц (прототип `CLOSED`; ТЗ «Отчёт по списаниям»: «Закрыть <месяц>» во вкладке «Списания в
 * бонус» закрывает прошлый месяц): оплаты налогов, списания и возвраты этого месяца больше не меняются
 * и не удаляются — только корректирующей записью. Месяц — первое число; закрытие не отменяется.
 */
export const closedMonths = pgTable(
  'closed_months',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'restrict' }),
    month: date('month', { mode: 'string' }).notNull(),
    closedBy: uuid('closed_by').references(() => users.id),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('closed_months_org_month_unique').on(t.orgId, t.month),
    check('closed_months_month_check', sql`${t.month} = date_trunc('month', ${t.month})::date`),
    orgIsolation('closed_months_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Разовая услуга (ТЗ «Ручная операция «Разовая услуга»»; прототип SERVICES, modules/services.js
 * `serviceDlg`): контрагент, название, дата, стоимость, исполнитель, описание. Одна операция журнала со
 * статусом оплаты — его считают по действующим оплатам (`one_off_service_payments`). Не стирается:
 * «Удалить» — отметка с причиной, удалённая уходит из итогов вместе со своими оплатами.
 */
export const oneOffServices = pgTable(
  'one_off_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'restrict' }),
    contractorId: uuid('contractor_id').notNull(),
    name: text('name').notNull(),
    serviceDate: date('service_date', { mode: 'string' }).notNull(),
    amount: money('amount').notNull(),
    /** Исполнитель (прототип `resp`); удаление сотрудника услугу не меняет. */
    performerEmployeeId: uuid('performer_employee_id'),
    description: text('description').notNull().default(''),
    /** Изменены стоимость или дата (прототип `edited`): отметка «Изменена». */
    edited: boolean('edited').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id),
    deleteReason: text('delete_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('one_off_services_id_org_unique').on(t.id, t.orgId),
    foreignKey({
      name: 'one_off_services_contractor_fk',
      columns: [t.contractorId, t.orgId],
      foreignColumns: [contractors.id, contractors.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'one_off_services_performer_fk',
      columns: [t.performerEmployeeId, t.orgId],
      foreignColumns: [employees.id, employees.orgId],
    }).onDelete('restrict'),
    index('one_off_services_contractor_idx').on(t.orgId, t.contractorId, t.serviceDate),
    check('one_off_services_amount_check', sql`${t.amount} > 0 and ${t.amount} <= ${AMOUNT_MAX}`),
    check(
      'one_off_services_text_check',
      sql`char_length(btrim(${t.name})) > 0 and char_length(${t.name}) <= ${sql.raw(String(SERVICE_NAME_MAX))} and char_length(${t.description}) <= ${sql.raw(String(SERVICE_DESCRIPTION_MAX))}`,
    ),
    check(
      'one_off_services_delete_check',
      sql`(${t.deletedAt} is null) = (${t.deletedBy} is null) and (${t.deletedAt} is null) = (${t.deleteReason} is null) and char_length(coalesce(${t.deleteReason}, '')) <= ${REASON_MAX}`,
    ),
    orgIsolation('one_off_services_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Оплата разовой услуги (прототип `s.pays`, `svcPay` → `tranchDlg`): сумма, дата, примечание. Сумма
 * действующих оплат не больше стоимости (проверяет сервер под блокировкой услуги). Не стирается:
 * «Удалить» — отметка с причиной.
 */
export const oneOffServicePayments = pgTable(
  'one_off_service_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'restrict' }),
    serviceId: uuid('service_id').notNull(),
    amount: money('amount').notNull(),
    paidOn: date('paid_on', { mode: 'string' }).notNull(),
    note: text('note').notNull().default(''),
    edited: boolean('edited').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id),
    deleteReason: text('delete_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('one_off_service_payments_id_org_unique').on(t.id, t.orgId),
    foreignKey({
      name: 'one_off_service_payments_service_fk',
      columns: [t.serviceId, t.orgId],
      foreignColumns: [oneOffServices.id, oneOffServices.orgId],
    }).onDelete('restrict'),
    index('one_off_service_payments_service_idx').on(t.serviceId, t.paidOn),
    check(
      'one_off_service_payments_amount_check',
      sql`${t.amount} > 0 and ${t.amount} <= ${AMOUNT_MAX}`,
    ),
    check(
      'one_off_service_payments_note_check',
      sql`char_length(${t.note}) <= ${sql.raw(String(MONEY_NOTE_MAX))}`,
    ),
    check(
      'one_off_service_payments_delete_check',
      sql`(${t.deletedAt} is null) = (${t.deletedBy} is null) and (${t.deletedAt} is null) = (${t.deleteReason} is null) and char_length(coalesce(${t.deleteReason}, '')) <= ${REASON_MAX}`,
    ),
    orgIsolation('one_off_service_payments_isolation', t.orgId),
  ],
).enableRLS();
