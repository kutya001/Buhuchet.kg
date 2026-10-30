import {
  BIZ_SIZES,
  CONTRACTOR_KINDS,
  FEE_DAY_MAX,
  FEE_DAY_MIN,
  FIRST_MONTH_MODES,
  PAUSE_REASON_MAX,
  PAYS_TO,
  SERVICE_STATUSES,
  SOCFUND_FLAGS,
  SOCFUND_TARIFFS,
  TARIFF_PERIODS,
  type ContractorGkedConfirmation,
  type ContractorRegistration,
  type SocfundChoice,
  type SocfundFlags,
} from '@buhuchet/domain';
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { money, recordVersion, timestamps } from './columns';
import { organizations } from './organizations';
import { gkedItems } from './platform';
import { ownershipForms, reportBases, taxBenefits, taxOffices, taxRegimes } from './platform-dicts';
import { orgIsolation } from './rls';
import { employees } from './staff';
import { users } from './users';

/** Список ключей объекта JSON для `jsonb - text[]` (без кавычек в самих ключах). */
const jsonKeys = (keys: readonly string[]) => `array[${keys.map((k) => `'${k}'`).join(', ')}]`;

/** Значение столбца — одно из постоянных кодов (без кавычек в самих кодах). */
const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;

/**
 * Контрагенты организации (ТЗ «Контрагенты»: регистрация, обязательные и необязательные поля,
 * закрепление за сотрудником). ИНН уникален в организации среди всех контрагентов, включая архив.
 * Справочные значения — постоянными кодами справочников платформы. Основной ГКЭД может быть пуст только
 * у заведённых раньше или загруженных без него: при сохранении карточки его требует API.
 */
export const contractors = pgTable(
  'contractors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    inn: text('inn').notNull(),
    /** В формате +996…: код страны и цифры. */
    phone: text('phone').notNull(),
    /** Постоянное обслуживание или разовое. */
    kind: text('kind', { enum: CONTRACTOR_KINDS }).notNull().default('regular'),
    formCode: text('form_code')
      .notNull()
      .references(() => ownershipForms.code),
    regimeCode: text('regime_code').references(() => taxRegimes.code),
    regime2Code: text('regime2_code').references(() => taxRegimes.code),
    gked: text('gked').references(() => gkedItems.code),
    taxOfficeCode: text('tax_office_code').references(() => taxOffices.code),
    bizSize: text('biz_size', { enum: BIZ_SIZES }).notNull().default('small'),
    /** Ответственный бухгалтер; пусто — после блокировки сотрудника (контрагент подсвечивается). */
    responsibleEmployeeId: uuid('responsible_employee_id'),
    head: text('head').notNull().default(''),
    contact: text('contact').notNull().default(''),
    contractNo: text('contract_no').notNull().default(''),
    contractDate: date('contract_date', { mode: 'string' }),
    note: text('note').notNull().default(''),
    registration: jsonb('registration').$type<ContractorRegistration>().notNull().default({}),
    /** Начало обслуживания (у разового — дата первого обращения). */
    startDate: date('start_date', { mode: 'string' }).notNull(),
    /** «Первый неполный месяц»; без поля в форме — «Полный месяц» (docs/deviations.md п. А-1). */
    firstMonthMode: text('first_month_mode', { enum: FIRST_MONTH_MODES }).notNull().default('full'),
    /** День оплаты обслуживания в месяце. */
    feeDay: smallint('fee_day').notNull().default(10),
    /** Куда переводит деньги на налоги (поток В, задача 2.18). */
    paysTo: text('pays_to', { enum: PAYS_TO }).notNull().default('emp'),
    serviceStatus: text('service_status', { enum: SERVICE_STATUSES }).notNull().default('active'),
    /** Подтверждение права на режим по ГКЭД; действует, пока не изменился набор данных `sig`. */
    gkedConfirmation: jsonb('gked_confirmation').$type<ContractorGkedConfirmation>(),
    /** Признаки для тарифа Соцфонда: только указанные, да или нет (docs/decisions.md п. А-3). */
    socfundFlags: jsonb('socfund_flags').$type<SocfundFlags>().notNull().default({}),
    /** Тариф Соцфонда: какой, выбран ли вручную и почему; пусто — не определён. */
    socfundTariff: jsonb('socfund_tariff').$type<SocfundChoice>(),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('contractors_id_org_unique').on(t.id, t.orgId),
    uniqueIndex('contractors_org_inn_key').on(t.orgId, t.inn),
    foreignKey({
      name: 'contractors_responsible_fk',
      columns: [t.responsibleEmployeeId, t.orgId],
      foreignColumns: [employees.id, employees.orgId],
    }),
    index('contractors_responsible_idx').on(t.orgId, t.responsibleEmployeeId),
    index('contractors_service_idx').on(t.orgId, t.serviceStatus),
    check('contractors_inn_check', sql`${t.inn} ~ '^[0-9]{14}$'`),
    check('contractors_kind_check', oneOf(t.kind, CONTRACTOR_KINDS)),
    check('contractors_biz_size_check', oneOf(t.bizSize, BIZ_SIZES)),
    check('contractors_first_month_check', oneOf(t.firstMonthMode, FIRST_MONTH_MODES)),
    check('contractors_pays_to_check', oneOf(t.paysTo, PAYS_TO)),
    check('contractors_service_check', oneOf(t.serviceStatus, SERVICE_STATUSES)),
    check(
      'contractors_fee_day_check',
      sql`${t.feeDay} between ${sql.raw(String(FEE_DAY_MIN))} and ${sql.raw(String(FEE_DAY_MAX))}`,
    ),
    check(
      'contractors_regime2_check',
      sql`${t.regime2Code} is null or (${t.regimeCode} is not null and ${t.regime2Code} <> ${t.regimeCode})`,
    ),
    check(
      'contractors_socfund_flags_check',
      sql`jsonb_typeof(${t.socfundFlags}) = 'object' and ${t.socfundFlags} - ${sql.raw(jsonKeys(SOCFUND_FLAGS))} = '{}'::jsonb and ${sql.raw(
        SOCFUND_FLAGS.map(
          (k) => `coalesce(jsonb_typeof(socfund_flags -> '${k}'), 'boolean') = 'boolean'`,
        ).join(' and '),
      )}`,
    ),
    check(
      'contractors_socfund_tariff_check',
      // coalesce: без ключа id или manual проверка дала бы NULL, а CHECK с NULL проходит.
      sql`${t.socfundTariff} is null or (jsonb_typeof(${t.socfundTariff}) = 'object' and ${t.socfundTariff} - ${sql.raw(jsonKeys(['id', 'manual', 'reason']))} = '{}'::jsonb and coalesce(${t.socfundTariff} ->> 'id', '') in (${sql.raw(
        SOCFUND_TARIFFS.map((v) => `'${v}'`).join(', '),
      )}) and coalesce(jsonb_typeof(${t.socfundTariff} -> 'manual'), 'null') = 'boolean' and coalesce(jsonb_typeof(${t.socfundTariff} -> 'reason'), 'null') in ('null', 'string') and (${t.socfundTariff} -> 'manual' = 'true' or coalesce(jsonb_typeof(${t.socfundTariff} -> 'reason'), 'null') = 'null'))`,
    ),
    orgIsolation('contractors_isolation', t.orgId),
  ],
).enableRLS();

/** Ссылка дочерней записи на контрагента той же организации; удаляется вместе с ним. */
const contractorRef = (name: string, t: { contractorId: AnyPgColumn; orgId: AnyPgColumn }) =>
  foreignKey({
    name,
    columns: [t.contractorId, t.orgId],
    foreignColumns: [contractors.id, contractors.orgId],
  }).onDelete('cascade');

const orgColumn = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'restrict' });

/** Дополнительные виды деятельности (ГКЭД): сколько угодно, основной не повторяется (проверяет API). */
export const contractorGkedExtra = pgTable(
  'contractor_gked_extra',
  {
    orgId: orgColumn(),
    contractorId: uuid('contractor_id').notNull(),
    gked: text('gked')
      .notNull()
      .references(() => gkedItems.code),
    /** Порядок, в котором коды указаны. */
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.contractorId, t.gked] }),
    contractorRef('contractor_gked_extra_contractor_fk', t),
    index('contractor_gked_extra_code_idx').on(t.orgId, t.gked),
    orgIsolation('contractor_gked_extra_isolation', t.orgId),
  ],
).enableRLS();

/** Льготы и особые статусы контрагента со сроком действия (за 60 дней до окончания — предупреждение). */
export const contractorBenefits = pgTable(
  'contractor_benefits',
  {
    orgId: orgColumn(),
    contractorId: uuid('contractor_id').notNull(),
    benefitCode: text('benefit_code')
      .notNull()
      .references(() => taxBenefits.code),
    validFrom: date('valid_from', { mode: 'string' }),
    validTo: date('valid_to', { mode: 'string' }),
  },
  (t) => [
    primaryKey({ columns: [t.contractorId, t.benefitCode] }),
    contractorRef('contractor_benefits_contractor_fk', t),
    index('contractor_benefits_code_idx').on(t.benefitCode),
    check(
      'contractor_benefits_dates_check',
      sql`${t.validFrom} is null or ${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`,
    ),
    orgIsolation('contractor_benefits_isolation', t.orgId),
  ],
).enableRLS();

/** Основания для сквозных отчётов: что есть у контрагента (сотрудники, имущество, …). */
export const contractorBases = pgTable(
  'contractor_bases',
  {
    orgId: orgColumn(),
    contractorId: uuid('contractor_id').notNull(),
    baseCode: text('base_code')
      .notNull()
      .references(() => reportBases.code),
  },
  (t) => [
    primaryKey({ columns: [t.contractorId, t.baseCode] }),
    contractorRef('contractor_bases_contractor_fk', t),
    index('contractor_bases_code_idx').on(t.baseCode),
    orgIsolation('contractor_bases_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Периоды обслуживания контрагента (задача 2.12; ТЗ «Остановка и возобновление обслуживания»; прототип
 * `c.periods`): с месяца по месяц включительно (первые числа), у последнего конец пуст, пока обслуживание
 * не приостановлено; пауза — промежуток между периодами. В месяцы вне периодов отчёты не создаются.
 * Периоды не пересекаются — их собирают правила `@buhuchet/domain` (contractors/service.ts), а пишет
 * `setServicePeriods` целым набором вместе со статусом и версией контрагента; открытый период — один.
 * У разового контрагента периодов может не быть.
 */
export const contractorServicePeriods = pgTable(
  'contractor_service_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    contractorId: uuid('contractor_id').notNull(),
    fromMonth: date('from_month', { mode: 'string' }).notNull(),
    toMonth: date('to_month', { mode: 'string' }),
    /**
     * Причина приостановки, которая начинается после этого периода: её пишет в «Историю статусов» задача
     * по расписанию, когда наступает запланированный месяц.
     */
    pauseReason: text('pause_reason').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    contractorRef('contractor_service_periods_contractor_fk', t),
    unique('contractor_service_periods_from_key').on(t.contractorId, t.fromMonth),
    uniqueIndex('contractor_service_periods_open_key')
      .on(t.contractorId)
      .where(sql`${t.toMonth} is null`),
    index('contractor_service_periods_org_idx').on(t.orgId, t.contractorId),
    check(
      'contractor_service_periods_month_check',
      sql`${t.fromMonth} = date_trunc('month', ${t.fromMonth})::date and (${t.toMonth} is null or (${t.toMonth} = date_trunc('month', ${t.toMonth})::date and ${t.toMonth} >= ${t.fromMonth}))`,
    ),
    check(
      'contractor_service_periods_reason_check',
      sql`char_length(${t.pauseReason}) <= ${sql.raw(String(PAUSE_REASON_MAX))}`,
    ),
    orgIsolation('contractor_service_periods_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Журнал тарифов обслуживания (ТЗ «Плата за обслуживание»): сумма и периодичность с месяца. Запись
 * не меняется и не удаляется (права роли приложения — миграция); новая ставка — новая запись. Сейчас
 * пишется только первая — при создании контрагента; журнал целиком — задача 2.21 (поток В).
 */
export const contractorTariffs = pgTable(
  'contractor_tariffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    contractorId: uuid('contractor_id').notNull(),
    amount: money('amount').notNull(),
    period: text('period', { enum: TARIFF_PERIODS }).notNull().default('M'),
    /** Первый день месяца, с которого действует ставка. */
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    note: text('note').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    contractorRef('contractor_tariffs_contractor_fk', t),
    index('contractor_tariffs_contractor_idx').on(t.orgId, t.contractorId, t.validFrom),
    check('contractor_tariffs_amount_check', sql`${t.amount} >= 0`),
    check('contractor_tariffs_period_check', oneOf(t.period, TARIFF_PERIODS)),
    check(
      'contractor_tariffs_month_check',
      sql`${t.validFrom} = date_trunc('month', ${t.validFrom})::date`,
    ),
    orgIsolation('contractor_tariffs_isolation', t.orgId),
  ],
).enableRLS();
