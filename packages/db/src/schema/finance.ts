import { sql } from 'drizzle-orm';
import { check, date, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { currentOrgId, orgIsolation } from './rls';
import { users } from './users';

/*
 * «Финансовые операции по контрагентам» (задача 2.22; ТЗ «Финансовые операции по контрагентам», «Отчёт
 * по списаниям»; прототип modules/finance.js, modules/fin-op.js, modules/staff.js — «Списания в бонус»).
 * Операции по счёту контрагента — `money_operations`, оплаты за обслуживание — `fee_payments`; журнал
 * модуля — один запрос над ними (finance-journal.ts); здесь — закрытые месяцы.
 */

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
