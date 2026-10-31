import {
  ACCOUNT_PURPOSES,
  MONEY_AMOUNT_MAX,
  MONEY_HOLDER_KINDS,
  MONEY_NOTE_MAX,
  MONEY_OP_KINDS,
  REQUISITE_KINDS,
  ROLLBACK_REASON_MAX,
} from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
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
import { money, recordVersion, timestamps } from './columns';
import { contractors } from './contractors';
import { organizations } from './organizations';
import { banks } from './platform-dicts';
import { reports } from './reports';
import { appRole, currentOrgId, orgIsolation } from './rls';
import { employees } from './staff';
import { users } from './users';

/*
 * Реквизиты для переводов (задача 2.18; ТЗ «Моя организация» → «Реквизиты организации для приёма
 * денег», «Профиль пользователя» → «Мои реквизиты для переводов»): куда контрагенты переводят деньги на
 * налоги и за обслуживание. Банки — кодами справочника «Банковские провайдеры»: переименование банка в
 * справочнике не ломает реквизиты. Порядок в таблицах — порядок добавления.
 */

/** Сотрудник текущего пользователя (в своей организации — RLS у employees). */
const ownEmployee = sql.raw('select e.id from employees e where e.user_id = app.current_user_id()');

/** Значение столбца — один из постоянных кодов (без кавычек в самих кодах). */
const oneOf = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * Счета организации двух видов: «Расчётный счёт» (банк, номер, БИК) и «Перевод по номеру телефона»
 * (номер и банки, к которым он привязан). «Назначение» и по одному «Основному» для налогов и для
 * обслуживания: основной подставляется в напоминания и на страницу контрагента. Удаление счёта прошлые
 * поступления не меняет: они хранят свои реквизиты.
 */
export const orgAccounts = pgTable(
  'org_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: REQUISITE_KINDS }).notNull(),
    /** Банк расчётного счёта; у перевода по номеру — null. */
    bankCode: text('bank_code').references(() => banks.code),
    accountNo: text('account_no'),
    bik: text('bik'),
    /** Номер перевода по номеру телефона: «+996…». */
    phone: text('phone'),
    /** Банки и кошельки, к которым привязан номер, — кодами справочника. */
    phoneBanks: text('phone_banks').array().notNull().default([]),
    /** «Получатель» — так, как его видит отправитель в приложении банка. */
    holderName: text('holder_name').notNull().default(''),
    purpose: text('purpose', { enum: ACCOUNT_PURPOSES }).notNull().default('both'),
    mainTax: boolean('main_tax').notNull().default(false),
    mainFee: boolean('main_fee').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    index('org_accounts_org_idx').on(t.orgId, t.createdAt),
    // По одному «Основному» для налогов и для обслуживания (ТЗ).
    uniqueIndex('org_accounts_main_tax_key')
      .on(t.orgId)
      .where(sql`${t.mainTax}`),
    uniqueIndex('org_accounts_main_fee_key')
      .on(t.orgId)
      .where(sql`${t.mainFee}`),
    check('org_accounts_kind_check', sql`${t.kind} in (${oneOf(REQUISITE_KINDS)})`),
    check('org_accounts_purpose_check', sql`${t.purpose} in (${oneOf(ACCOUNT_PURPOSES)})`),
    check(
      'org_accounts_fields_check',
      sql`(${t.kind} = 'acc' and ${t.bankCode} is not null and ${t.accountNo} is not null and ${t.bik} ~ '^[0-9]{6}$' and ${t.phone} is null and cardinality(${t.phoneBanks}) = 0) or (${t.kind} = 'phone' and ${t.phone} ~ '^[+][0-9]{6,15}$' and cardinality(${t.phoneBanks}) between 1 and 50 and ${t.bankCode} is null and ${t.accountNo} is null and ${t.bik} is null)`,
    ),
    check(
      'org_accounts_main_check',
      sql`(not ${t.mainTax} or ${t.purpose} <> 'fee') and (not ${t.mainFee} or ${t.purpose} <> 'tax')`,
    ),
    check(
      'org_accounts_length_check',
      sql`length(coalesce(${t.accountNo}, '')) <= 40 and length(${t.holderName}) <= 200`,
    ),
    orgIsolation('org_accounts_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Реквизиты сотрудника — «виртуальный счёт» для денег на налоги (ТЗ «Виртуальные счета сотрудников»):
 * «Счёт или кошелёк» (провайдер и номер) или «Перевод по номеру телефона»; имя получателя и один
 * «Основной». Ведёт только сам сотрудник в «Мой профиль»; владелец и главный бухгалтер видят их в
 * карточке сотрудника (docs/deviations.md п. В-1).
 */
export const employeeWallets = pgTable(
  'employee_wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id').notNull(),
    kind: text('kind', { enum: REQUISITE_KINDS }).notNull(),
    bankCode: text('bank_code').references(() => banks.code),
    accountNo: text('account_no'),
    phone: text('phone'),
    phoneBanks: text('phone_banks').array().notNull().default([]),
    holderName: text('holder_name').notNull().default(''),
    isMain: boolean('is_main').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    foreignKey({
      name: 'employee_wallets_employee_fk',
      columns: [t.employeeId, t.orgId],
      foreignColumns: [employees.id, employees.orgId],
    }).onDelete('cascade'),
    index('employee_wallets_employee_idx').on(t.employeeId, t.createdAt),
    index('employee_wallets_org_idx').on(t.orgId),
    uniqueIndex('employee_wallets_main_key')
      .on(t.employeeId)
      .where(sql`${t.isMain}`),
    check('employee_wallets_kind_check', sql`${t.kind} in (${oneOf(REQUISITE_KINDS)})`),
    check(
      'employee_wallets_fields_check',
      sql`(${t.kind} = 'acc' and ${t.bankCode} is not null and ${t.accountNo} is not null and ${t.phone} is null and cardinality(${t.phoneBanks}) = 0) or (${t.kind} = 'phone' and ${t.phone} ~ '^[+][0-9]{6,15}$' and cardinality(${t.phoneBanks}) between 1 and 50 and ${t.bankCode} is null and ${t.accountNo} is null)`,
    ),
    check(
      'employee_wallets_length_check',
      sql`length(coalesce(${t.accountNo}, '')) <= 40 and length(${t.holderName}) <= 200`,
    ),
    orgIsolation('employee_wallets_isolation', t.orgId),
    // Реквизиты меняет только сам сотрудник: остальные в организации их только читают.
    pgPolicy('employee_wallets_insert_own', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: sql`${t.employeeId} in (${ownEmployee})`,
    }),
    pgPolicy('employee_wallets_update_own', {
      as: 'restrictive',
      for: 'update',
      to: appRole,
      using: sql`${t.employeeId} in (${ownEmployee})`,
      withCheck: sql`${t.employeeId} in (${ownEmployee})`,
    }),
    pgPolicy('employee_wallets_delete_own', {
      as: 'restrictive',
      for: 'delete',
      to: appRole,
      using: sql`${t.employeeId} in (${ownEmployee})`,
    }),
  ],
).enableRLS();

const AMOUNT_MAX = sql.raw(String(MONEY_AMOUNT_MAX));

/**
 * Операции с деньгами контрагента (задача 2.19; ТЗ «Виртуальные счета сотрудников» → «Операции по
 * счёту»; прототип OPS): поступление от контрагента (`in`: `amount` — на налоги, `total` — вся сумма с
 * платой за обслуживание), оплата налога по отчёту (`pay`, «Оплатил контрагент сам» — `self` и счёт
 * `client`), списание в бонус, возвраты, корректирующая запись и перевод (задача 2.20). Счёт — организации
 * или виртуальный счёт сотрудника; деньги — всегда деньги этого контрагента. Отменённая операция
 * (откат оплаты; «Удалить», «Отменить списание» и «Отменить возврат» в окне операции — задачи 2.20 и
 * 2.22) остаётся с автором, временем и причиной отмены, в деньгах не считается.
 */
export const moneyOperations = pgTable(
  'money_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'restrict' }),
    contractorId: uuid('contractor_id').notNull(),
    kind: text('kind', { enum: MONEY_OP_KINDS }).notNull(),
    /** Тыйыны; у корректирующей записи — со знаком. */
    amount: money('amount').notNull(),
    /** Поступление: вся сумма, с частью за обслуживание; у других видов — пусто. */
    total: money('total'),
    opDate: date('op_date', { mode: 'string' }).notNull(),
    holderKind: text('holder_kind', { enum: MONEY_HOLDER_KINDS }).notNull(),
    holderEmployeeId: uuid('holder_employee_id'),
    /** Отчёт оплаты и возврата по уточнённому; у поступления отчёты — в детализации. */
    reportId: uuid('report_id'),
    /** «Оплатил контрагент сам»: в «Оплачено в бюджет», но не в деньги контрагента на счетах. */
    self: boolean('self').notNull().default(false),
    note: text('note').notNull().default(''),
    /**
     * Обратная запись — к какому поступлению (задача 2.20; прототип `ref`): «Обратные записи» в его
     * окне. У других видов пусто.
     */
    refOperationId: uuid('ref_operation_id'),
    /** Изменена в окне операции (задача 2.22; прототип `edited`): отметка «Изменена» в окне и журнале. */
    edited: boolean('edited').notNull().default(false),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('money_operations_id_org_unique').on(t.id, t.orgId),
    foreignKey({
      name: 'money_operations_ref_fk',
      columns: [t.refOperationId, t.orgId],
      foreignColumns: [t.id, t.orgId],
    }).onDelete('restrict'),
    index('money_operations_ref_idx')
      .on(t.refOperationId)
      .where(sql`${t.refOperationId} is not null`),
    check('money_operations_ref_check', sql`${t.refOperationId} is null or ${t.kind} = 'corr'`),
    foreignKey({
      name: 'money_operations_contractor_fk',
      columns: [t.contractorId, t.orgId],
      foreignColumns: [contractors.id, contractors.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'money_operations_holder_fk',
      columns: [t.holderEmployeeId, t.orgId],
      foreignColumns: [employees.id, employees.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'money_operations_report_fk',
      columns: [t.reportId, t.orgId],
      foreignColumns: [reports.id, reports.orgId],
    }).onDelete('restrict'),
    index('money_operations_contractor_idx').on(t.orgId, t.contractorId, t.opDate),
    index('money_operations_report_idx')
      .on(t.orgId, t.reportId)
      .where(sql`${t.reportId} is not null`),
    check('money_operations_kind_check', sql`${t.kind} in (${oneOf(MONEY_OP_KINDS)})`),
    check(
      'money_operations_holder_check',
      sql`${t.holderKind} in (${oneOf(MONEY_HOLDER_KINDS)}) and (${t.holderKind} = 'employee') = (${t.holderEmployeeId} is not null)`,
    ),
    check(
      'money_operations_amount_check',
      sql`abs(${t.amount}) <= ${AMOUNT_MAX} and case ${t.kind} when 'corr' then ${t.amount} <> 0 when 'in' then ${t.amount} >= 0 else ${t.amount} > 0 end`,
    ),
    check(
      'money_operations_total_check',
      sql`(${t.kind} = 'in') = (${t.total} is not null) and (${t.total} is null or (${t.total} > 0 and ${t.total} >= ${t.amount} and ${t.total} <= ${AMOUNT_MAX}))`,
    ),
    check(
      'money_operations_report_check',
      sql`(${t.kind} not in ('pay', 'back') or ${t.reportId} is not null) and (${t.kind} in ('pay', 'back') or ${t.reportId} is null)`,
    ),
    check(
      'money_operations_self_check',
      sql`(${t.self} = (${t.holderKind} = 'client')) and (not ${t.self} or ${t.kind} = 'pay')`,
    ),
    check(
      'money_operations_cancel_check',
      sql`(${t.cancelledAt} is null) = (${t.cancelledBy} is null) and (${t.cancelledAt} is null) = (${t.cancelReason} is null) and char_length(coalesce(${t.cancelReason}, '')) <= ${sql.raw(String(ROLLBACK_REASON_MAX))}`,
    ),
    check(
      'money_operations_note_check',
      sql`char_length(${t.note}) <= ${sql.raw(String(MONEY_NOTE_MAX))}`,
    ),
    orgIsolation('money_operations_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Детализация поступления: за какие отчёты и сколько (ТЗ «Поступление от контрагента: … детализация —
 * за какие отчёты и сколько»; прототип `alloc`). Эти деньги сначала идут на свой отчёт (сверка денег);
 * то, что не распределено, — аванс контрагента. Часть за обслуживание добавит задача 2.21.
 */
export const moneyAllocations = pgTable(
  'money_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'restrict' }),
    operationId: uuid('operation_id').notNull(),
    reportId: uuid('report_id').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'money_allocations_operation_fk',
      columns: [t.operationId, t.orgId],
      foreignColumns: [moneyOperations.id, moneyOperations.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'money_allocations_report_fk',
      columns: [t.reportId, t.orgId],
      foreignColumns: [reports.id, reports.orgId],
    }).onDelete('restrict'),
    uniqueIndex('money_allocations_key').on(t.operationId, t.reportId),
    index('money_allocations_report_idx').on(t.orgId, t.reportId),
    check('money_allocations_amount_check', sql`${t.amount} > 0 and ${t.amount} <= ${AMOUNT_MAX}`),
    orgIsolation('money_allocations_isolation', t.orgId),
  ],
).enableRLS();
