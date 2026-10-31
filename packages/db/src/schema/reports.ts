import {
  ASSIGNMENT_DUE_DAYS,
  REPORT_ACTS,
  REPORT_LINE_KINDS,
  REPORT_PERIODS,
  REPORT_STATUSES,
  type AssignmentEnRate,
  type ReportPeriod,
} from '@buhuchet/domain';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { money, recordVersion, timestamps } from './columns';
import { contractors } from './contractors';
import { organizations } from './organizations';
import { dueChangeReasons, reportTypes } from './platform-dicts';
import { currentOrgId, orgIsolation } from './rls';
import { employees } from './staff';
import { users } from './users';

/** Значение столбца — одно из постоянных кодов (без кавычек в самих кодах). */
const oneOf = (column: AnyPgColumn, values: readonly (string | number)[]): SQL =>
  sql`${column} in (${sql.raw(values.map((v) => (typeof v === 'number' ? String(v) : `'${v}'`)).join(', '))})`;

/** Первое число месяца. */
const monthStart = (column: AnyPgColumn): SQL =>
  sql`${column} = date_trunc('month', ${column})::date`;

/** Организация записи: по умолчанию — из контекста `withOrgContext`. */
const orgColumn = () =>
  uuid('org_id')
    .notNull()
    .default(currentOrgId)
    .references(() => organizations.id, { onDelete: 'restrict' });

/**
 * Назначения отчётов контрагентам (ТЗ «Отчеты для сдачи» → «Назначение отчётов контрагентам»): вид
 * отчёта из каталога, с какого периода сдаёт, до какого, ответственный (пусто — ответственный
 * контрагента), ставка, вариант срока, повторяющаяся сумма, примечание. Снятое назначение остаётся
 * с датой окончания `ended_on`; действующее у контрагента по виду — одно.
 */
export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    contractorId: uuid('contractor_id').notNull(),
    reportTypeCode: text('report_type_code')
      .notNull()
      .references(() => reportTypes.code),
    /** «С какого периода»: первое число месяца. */
    fromMonth: date('from_month', { mode: 'string' }).notNull(),
    /** «До какого периода» (необязательно): первое число месяца. */
    untilMonth: date('until_month', { mode: 'string' }),
    /** Снято: дата, с которой контрагент вид не сдаёт. */
    endedOn: date('ended_on', { mode: 'string' }),
    /** Пусто — ответственный контрагента. */
    responsibleEmployeeId: uuid('responsible_employee_id'),
    /** Ставка из «Ставок» вида (не у единого налога). */
    rate: text('rate'),
    /** Строки «Ставок единого налога» у единого налога: код ЕНС и вариант ставки. */
    enRates: jsonb('en_rates').$type<AssignmentEnRate[]>().notNull().default([]),
    /** Отмеченные добавляемые ставки (налог с продаж). */
    rateAdditions: text('rate_additions').array().notNull().default([]),
    /** «Вариант срока»: до N-го числа, 31 — до последнего дня; пусто — как в каталоге. */
    dueDay: smallint('due_day'),
    /** Периодичность и срок в назначении (внутренняя отчётность, патент); пусто — как в каталоге. */
    ownPeriod: text('own_period', { enum: REPORT_PERIODS }).$type<ReportPeriod>(),
    ownDay: smallint('own_day'),
    /** Месяц после конца периода, у годовых — месяц срока. */
    ownMonth: smallint('own_month'),
    /** Повторяющаяся сумма к уплате, тыйыны: подставляется в новые отчёты. */
    fixedAmount: money('fixed_amount'),
    note: text('note').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('assignments_id_org_unique').on(t.id, t.orgId),
    foreignKey({
      name: 'assignments_contractor_fk',
      columns: [t.contractorId, t.orgId],
      foreignColumns: [contractors.id, contractors.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'assignments_responsible_fk',
      columns: [t.responsibleEmployeeId, t.orgId],
      foreignColumns: [employees.id, employees.orgId],
    }),
    uniqueIndex('assignments_active_key')
      .on(t.orgId, t.contractorId, t.reportTypeCode)
      .where(sql`${t.endedOn} is null`),
    index('assignments_type_idx').on(t.orgId, t.reportTypeCode),
    check('assignments_from_check', monthStart(t.fromMonth)),
    check(
      'assignments_until_check',
      sql`${t.untilMonth} is null or (${monthStart(t.untilMonth)} and ${t.untilMonth} >= ${t.fromMonth})`,
    ),
    check(
      'assignments_due_day_check',
      sql`${t.dueDay} is null or ${oneOf(t.dueDay, ASSIGNMENT_DUE_DAYS)}`,
    ),
    check(
      'assignments_own_check',
      sql`(${t.ownPeriod} is null and ${t.ownDay} is null and ${t.ownMonth} is null) or (${oneOf(t.ownPeriod, REPORT_PERIODS)} and ${t.ownDay} between 1 and 31 and ${t.ownMonth} between case when ${t.ownPeriod} = 'Y' then 1 else 0 end and 12)`,
    ),
    check('assignments_en_rates_check', sql`jsonb_typeof(${t.enRates}) = 'array'`),
    check('assignments_fixed_check', sql`${t.fixedAmount} is null or ${t.fixedAmount} >= 0`),
    orgIsolation('assignments_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Отчёты к сдаче (ТЗ «Отчёты к сдаче создаются автоматически»): один контрагент + вид + период + версия =
 * один отчёт; у разового вида период — месяц даты события, отчётов за месяц может быть несколько, но
 * одна дата события — один отчёт. Уточнённые — версии 1, 2, … того же периода; прежняя версия
 * помечается `superseded`. Отчёт ссылается на контрагента с `ON DELETE RESTRICT`: контрагента с
 * отчётами удалить нельзя (docs/decisions.md п. А-1). Поля сдачи и подтверждения задача 2.06 заполняет
 * только у прошлых периодов, отмеченных сданными при назначении; окно «Сдан» — задача 2.14, оплата —
 * 2.19.
 */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    contractorId: uuid('contractor_id').notNull(),
    reportTypeCode: text('report_type_code')
      .notNull()
      .references(() => reportTypes.code),
    /** Назначение, по которому создан; пусто — разовый отчёт, созданный вручную. */
    assignmentId: uuid('assignment_id'),
    /** Вид периода на момент создания (у видов с периодичностью в назначении — из назначения). */
    period: text('period', { enum: REPORT_PERIODS }).$type<ReportPeriod>().notNull(),
    /** Первое число периода; у разового — первое число месяца даты события. */
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    /** Дата события у разового вида («Дата ввоза»). */
    eventDate: date('event_date', { mode: 'string' }),
    /**
     * «Что сделать» на момент создания (прототип r.act): отчёт сохраняет его, даже если вид потом
     * поменяли в каталоге.
     */
    act: text('act', { enum: REPORT_ACTS }).notNull(),
    /** Номер уточнения: 0 — первичный, 1, 2, … — уточнённые. */
    revision: smallint('revision').notNull().default(0),
    /** Есть более новая версия: в списке по умолчанию не показывается. */
    superseded: boolean('superseded').notNull().default(false),
    /** Срок по закону — до переноса с нерабочего дня. */
    dueBase: date('due_base', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    /** Срок изменён вручную: не пересчитывается при изменении правил и календаря. */
    dueManual: boolean('due_manual').notNull().default(false),
    /** Срок оплаты; у вида «Сдача» — пусто. */
    payDue: date('pay_due', { mode: 'string' }),
    status: text('status', { enum: REPORT_STATUSES }).notNull().default('todo'),
    /** Дата сдачи («Сдан»): у прошлых периодов, отмеченных при назначении, — срок по закону. */
    submittedOn: date('submitted_on', { mode: 'string' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedBy: uuid('submitted_by').references(() => users.id),
    /** Отметка «Подтверждено» на шаге «Сдан»: кто, когда, комментарий (окно сдачи — задача 2.14). */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by').references(() => users.id),
    confirmNote: text('confirm_note').notNull().default(''),
    /** Сумма к уплате, тыйыны; пусто — ещё не указана. */
    amount: money('amount'),
    /** Сумма подставлена из повторяющейся суммы назначения. */
    amountAuto: boolean('amount_auto').notNull().default(false),
    /**
     * «Оплачено в бюджет», тыйыны: отметки оплаты (`money_operations` вида `pay`), с «Оплатил контрагент
     * сам», минус возвраты по уточнённому; уточнённая версия начинает с оплаченного по прежней
     * (прототип createRevision). Меняется в той же транзакции, что и операция (задача 2.19).
     */
    paid: money('paid').notNull().default(0),
    responsibleEmployeeId: uuid('responsible_employee_id'),
    /** Пусто — создан задачей по расписанию. */
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('reports_id_org_unique').on(t.id, t.orgId),
    unique('reports_period_key')
      .on(t.orgId, t.contractorId, t.reportTypeCode, t.periodStart, t.eventDate, t.revision)
      .nullsNotDistinct(),
    foreignKey({
      name: 'reports_contractor_fk',
      columns: [t.contractorId, t.orgId],
      foreignColumns: [contractors.id, contractors.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'reports_assignment_fk',
      columns: [t.assignmentId, t.orgId],
      foreignColumns: [assignments.id, assignments.orgId],
    }),
    foreignKey({
      name: 'reports_responsible_fk',
      columns: [t.responsibleEmployeeId, t.orgId],
      foreignColumns: [employees.id, employees.orgId],
    }),
    index('reports_due_idx').on(t.orgId, t.dueDate),
    index('reports_contractor_idx').on(t.orgId, t.contractorId, t.reportTypeCode),
    index('reports_responsible_idx').on(t.orgId, t.responsibleEmployeeId),
    check('reports_period_check', oneOf(t.period, REPORT_PERIODS)),
    check('reports_period_start_check', monthStart(t.periodStart)),
    check(
      'reports_event_check',
      sql`${t.eventDate} is null or date_trunc('month', ${t.eventDate})::date = ${t.periodStart}`,
    ),
    check('reports_revision_check', sql`${t.revision} >= 0`),
    check('reports_act_check', oneOf(t.act, REPORT_ACTS)),
    check('reports_status_check', oneOf(t.status, REPORT_STATUSES)),
    check('reports_amount_check', sql`${t.amount} is null or ${t.amount} >= 0`),
    check('reports_paid_check', sql`${t.paid} >= 0`),
    orgIsolation('reports_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Изменения срока отчёта вручную (ТЗ «Изменить срок»: новый срок, причина из справочника платформы,
 * комментарий) и причина ручного создания отчёта («Создан вручную (причина)»: прежнего срока нет).
 * Записи не меняются и не удаляются (права роли приложения — миграция); автор и время — из контекста.
 */
export const reportDueChanges = pgTable(
  'report_due_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    reportId: uuid('report_id').notNull(),
    /** Прежний срок; пусто — отчёт создан вручную. */
    fromDue: date('from_due', { mode: 'string' }),
    toDue: date('to_due', { mode: 'string' }).notNull(),
    reasonCode: text('reason_code')
      .notNull()
      .references(() => dueChangeReasons.code),
    comment: text('comment').notNull().default(''),
    createdBy: uuid('created_by')
      .default(sql`app.current_user_id()`)
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'report_due_changes_report_fk',
      columns: [t.reportId, t.orgId],
      foreignColumns: [reports.id, reports.orgId],
    }).onDelete('cascade'),
    index('report_due_changes_report_idx').on(t.orgId, t.reportId, t.createdAt),
    orgIsolation('report_due_changes_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Строки суммы к уплате (ТЗ «Сумма при нескольких ставках»; прототип r.lines, r.parts): по ставкам —
 * выручка за период и налог (единый налог, налог с продаж с добавленными строками), по платежам «Что
 * уплачивается» — сумма платежа (Соцфонд: подоходный налог и страховые взносы). Сумма к уплате отчёта
 * — итог строк одного вида. Строки заменяются целиком при «Сдан» и «Указать сумму»; сумма из массовой
 * сдачи и повторяющаяся сумма строки удаляют.
 */
export const reportTaxLines = pgTable(
  'report_tax_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    reportId: uuid('report_id').notNull(),
    kind: text('kind', { enum: REPORT_LINE_KINDS }).notNull(),
    /** «ЕНС-04:cl», «main:r», «pay:0». */
    lineKey: text('line_key').notNull(),
    /** Подпись на момент ввода: «ЕНС-04 · безналичная выручка, 4 %», «Подоходный налог». */
    label: text('label').notNull(),
    /** Ставка строки «4 %»; у строки платежа — пусто. */
    rate: text('rate').notNull().default(''),
    /** Наличная выручка — да, безналичная — нет, без деления — пусто. */
    cash: boolean('cash'),
    /** Выручка за период, тыйыны; пусто — ввели сразу налог. */
    revenue: money('revenue'),
    tax: money('tax').notNull(),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'report_tax_lines_report_fk',
      columns: [t.reportId, t.orgId],
      foreignColumns: [reports.id, reports.orgId],
    }).onDelete('cascade'),
    unique('report_tax_lines_key').on(t.orgId, t.reportId, t.kind, t.lineKey),
    check('report_tax_lines_kind_check', oneOf(t.kind, REPORT_LINE_KINDS)),
    check(
      'report_tax_lines_amounts_check',
      sql`${t.tax} >= 0 and (${t.revenue} is null or ${t.revenue} >= 0)`,
    ),
    orgIsolation('report_tax_lines_isolation', t.orgId),
  ],
).enableRLS();
