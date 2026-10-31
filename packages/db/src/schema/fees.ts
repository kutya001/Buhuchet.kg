import { FEE_TO_KINDS, MONEY_AMOUNT_MAX, MONEY_NOTE_MAX, OP_REASON_MAX } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { money, recordVersion, timestamps } from './columns';
import { contractors } from './contractors';
import { moneyOperations } from './money';
import { organizations } from './organizations';
import { currentOrgId, orgIsolation } from './rls';
import { users } from './users';

/*
 * Плата за обслуживание (задача 2.21; ТЗ «Контрагенты» → «Плата за обслуживание»; прототип FEEPAYS,
 * core/derive.js `fpAlloc`, `fpAdv`). Ставки — журнал `contractor_tariffs`; начисления не хранятся: их
 * считает домен по журналу и периодам обслуживания (`packages/domain/src/fees/charges.ts`, docs/decisions.md
 * п. В-7). Здесь — оплаты и их распределение по месяцам; нераспределённое — аванс.
 */

const AMOUNT_MAX = sql.raw(String(MONEY_AMOUNT_MAX));
const oneOf = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * Оплата за обслуживание: сумма, дата, куда поступили деньги (счёт организации — его название на момент
 * оплаты — или владельцу), примечание. Часть за обслуживание из общего поступления от контрагента —
 * оплаты по месяцам со ссылкой на это поступление (`operation_id`; прототип: запись `FEEPAYS` на месяц).
 */
export const feePayments = pgTable(
  'fee_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'restrict' }),
    contractorId: uuid('contractor_id').notNull(),
    amount: money('amount').notNull(),
    paidOn: date('paid_on', { mode: 'string' }).notNull(),
    /** Куда поступили деньги: счёт организации или владельцу организации. */
    toKind: text('to_kind', { enum: FEE_TO_KINDS }).notNull(),
    /** Счёт организации с назначением «Обслуживание», если выбран; удаление счёта оплату не меняет. */
    toAccountId: uuid('to_account_id'),
    /** Как назывался счёт при оплате: «Счёт организации · Мбанк · по номеру +996…». */
    toLabel: text('to_label').notNull().default(''),
    /** Общее поступление от контрагента, частью которого была оплата. */
    operationId: uuid('operation_id'),
    note: text('note').notNull().default(''),
    /**
     * Удалена в окне операции вместе с общим поступлением (задача 2.20) или сама (задача 2.22): запись
     * остаётся с причиной, в долг и итоги не входит.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id),
    deleteReason: text('delete_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('fee_payments_id_org_unique').on(t.id, t.orgId),
    foreignKey({
      name: 'fee_payments_contractor_fk',
      columns: [t.contractorId, t.orgId],
      foreignColumns: [contractors.id, contractors.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fee_payments_operation_fk',
      columns: [t.operationId, t.orgId],
      foreignColumns: [moneyOperations.id, moneyOperations.orgId],
    }).onDelete('restrict'),
    index('fee_payments_contractor_idx').on(t.orgId, t.contractorId, t.paidOn),
    index('fee_payments_operation_idx')
      .on(t.operationId)
      .where(sql`${t.operationId} is not null`),
    check('fee_payments_amount_check', sql`${t.amount} > 0 and ${t.amount} <= ${AMOUNT_MAX}`),
    check(
      'fee_payments_to_check',
      sql`${t.toKind} in (${oneOf(FEE_TO_KINDS)}) and (${t.toKind} = 'org' or ${t.toAccountId} is null) and char_length(${t.toLabel}) <= 300`,
    ),
    check(
      'fee_payments_note_check',
      sql`char_length(${t.note}) <= ${sql.raw(String(MONEY_NOTE_MAX))}`,
    ),
    check(
      'fee_payments_delete_check',
      sql`(${t.deletedAt} is null) = (${t.deletedBy} is null) and (${t.deletedAt} is null) = (${t.deleteReason} is null) and char_length(coalesce(${t.deleteReason}, '')) <= ${sql.raw(String(OP_REASON_MAX))}`,
    ),
    orgIsolation('fee_payments_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Распределение оплаты по месяцам (прототип `alloc`): какой месяц и сколько; месяц — первое число.
 * Сумма месяцев не больше суммы оплаты, остальное — аванс (проверяет сервер при записи).
 */
export const feeAllocations = pgTable(
  'fee_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'restrict' }),
    paymentId: uuid('payment_id').notNull(),
    month: date('month', { mode: 'string' }).notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fee_allocations_payment_fk',
      columns: [t.paymentId, t.orgId],
      foreignColumns: [feePayments.id, feePayments.orgId],
    }).onDelete('cascade'),
    uniqueIndex('fee_allocations_key').on(t.paymentId, t.month),
    check('fee_allocations_amount_check', sql`${t.amount} > 0 and ${t.amount} <= ${AMOUNT_MAX}`),
    check('fee_allocations_month_check', sql`${t.month} = date_trunc('month', ${t.month})::date`),
    orgIsolation('fee_allocations_isolation', t.orgId),
  ],
).enableRLS();
