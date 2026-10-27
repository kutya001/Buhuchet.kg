import { ACCOUNT_PURPOSES, REQUISITE_KINDS } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { organizations } from './organizations';
import { banks } from './platform-dicts';
import { appRole, orgIsolation } from './rls';
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
 * карточке сотрудника (docs/deviations.md п. 49).
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
