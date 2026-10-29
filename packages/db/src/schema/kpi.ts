import {
  DUE_DAY_MAX,
  DUE_DAY_MIN,
  FILL_STATUSES,
  INDICATOR_DESCRIPTION_MAX_LENGTH,
  INDICATOR_NAME_MAX_LENGTH,
  INDICATOR_NOTE_MAX_LENGTH,
  INDICATOR_SCOPES,
  INDICATOR_TOTALS,
  INDICATOR_TYPES,
  INDICATOR_UNIT_MAX_LENGTH,
} from '@buhuchet/domain';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
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
import { recordVersion, timestamps } from './columns';
import { contractors } from './contractors';
import { organizations } from './organizations';
import { orgIsolation } from './rls';
import { users } from './users';

/*
 * Показатели контрагентов (задача 2.27; ТЗ «Показатели контрагентов»; прототип modules/kpi.js):
 * собственная настройка организации — показатели, «Кому вести», значения по месяцам и статус заполнения
 * месяца. Месяц — строка «YYYY-MM» (`YearMonth` из @buhuchet/domain).
 */

/** Значение столбца — один из постоянных кодов (без кавычек в самих кодах). */
const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;

/** Месяц «YYYY-MM». */
const isMonth = (column: AnyPgColumn): SQL => sql`${column} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`;

const orgColumn = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'restrict' });

/**
 * Показатели организации («Настройка показателей»): поля окна показателя, «Кому вести» («Всем
 * контрагентам» или «Выбранным» с «Включать новых контрагентов автоматически»), обязательность, срок
 * заполнения и «Вести с». Название уникально в организации без учёта регистра (и среди архивных).
 * Удалить можно только показатель без значений — это держит и внешний ключ значений.
 */
export const indicators = pgTable(
  'indicators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    type: text('type', { enum: INDICATOR_TYPES }).notNull(),
    /** Основной итог — какой итог показывать первым. */
    total: text('total', { enum: INDICATOR_TOTALS }).notNull().default('sum'),
    description: text('description').notNull().default(''),
    /** «Обязательно заполнять каждый месяц». */
    required: boolean('required').notNull().default(true),
    /** Срок заполнения — число следующего месяца. */
    dueDay: smallint('due_day').notNull().default(10),
    /** «Вести с» — месяц, с которого показатель требуется. */
    startMonth: text('start_month').notNull(),
    scope: text('scope', { enum: INDICATOR_SCOPES }).notNull().default('all'),
    autoNew: boolean('auto_new').notNull().default(true),
    archived: boolean('archived').notNull().default(false),
    /** Порядок в таблицах и в карточке контрагента. */
    sortOrder: integer('sort_order').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('indicators_id_org_unique').on(t.id, t.orgId),
    uniqueIndex('indicators_org_name_key').on(t.orgId, sql`lower(${t.name})`),
    index('indicators_org_order_idx').on(t.orgId, t.sortOrder),
    check('indicators_type_check', oneOf(t.type, INDICATOR_TYPES)),
    check('indicators_total_check', oneOf(t.total, INDICATOR_TOTALS)),
    check('indicators_scope_check', oneOf(t.scope, INDICATOR_SCOPES)),
    check(
      'indicators_name_check',
      sql`btrim(${t.name}) <> '' and char_length(${t.name}) <= ${sql.raw(String(INDICATOR_NAME_MAX_LENGTH))}`,
    ),
    check(
      'indicators_unit_check',
      sql`btrim(${t.unit}) <> '' and char_length(${t.unit}) <= ${sql.raw(String(INDICATOR_UNIT_MAX_LENGTH))}`,
    ),
    check(
      'indicators_description_check',
      sql`char_length(${t.description}) <= ${sql.raw(String(INDICATOR_DESCRIPTION_MAX_LENGTH))}`,
    ),
    check(
      'indicators_due_day_check',
      sql`${t.dueDay} between ${sql.raw(String(DUE_DAY_MIN))} and ${sql.raw(String(DUE_DAY_MAX))}`,
    ),
    check('indicators_start_check', isMonth(t.startMonth)),
    // При «Всем контрагентам» новые контрагенты включаются всегда.
    check('indicators_auto_new_check', sql`${t.scope} <> 'all' or ${t.autoNew}`),
    orgIsolation('indicators_isolation', t.orgId),
  ],
).enableRLS();

/** Ссылка на показатель своей организации. */
const indicatorRef = (
  name: string,
  t: { indicatorId: AnyPgColumn; orgId: AnyPgColumn },
  onDelete: 'cascade' | 'restrict',
) =>
  foreignKey({
    name,
    columns: [t.indicatorId, t.orgId],
    foreignColumns: [indicators.id, indicators.orgId],
  }).onDelete(onDelete);

/** Ссылка на контрагента своей организации; удаляется вместе с ним. */
const contractorRef = (name: string, t: { contractorId: AnyPgColumn; orgId: AnyPgColumn }) =>
  foreignKey({
    name,
    columns: [t.contractorId, t.orgId],
    foreignColumns: [contractors.id, contractors.orgId],
  }).onDelete('cascade');

/**
 * «Кому вести» у контрагента: ведётся ли показатель, свой месяц «с <месяц>» и месяц выключения («Не
 * ведётся с <месяц>»). Строка есть только там, где она что-то меняет (правила `applyWho`, `toggleTarget`
 * из @buhuchet/domain): нет строки — контрагент для показателя новый.
 */
export const indicatorTargets = pgTable(
  'indicator_targets',
  {
    orgId: orgColumn(),
    indicatorId: uuid('indicator_id').notNull(),
    contractorId: uuid('contractor_id').notNull(),
    enabled: boolean('enabled').notNull(),
    fromMonth: text('from_month'),
    offSince: text('off_since'),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.indicatorId, t.contractorId] }),
    indicatorRef('indicator_targets_indicator_fk', t, 'cascade'),
    contractorRef('indicator_targets_contractor_fk', t),
    index('indicator_targets_contractor_idx').on(t.orgId, t.contractorId),
    check('indicator_targets_from_check', sql`${t.fromMonth} is null or ${isMonth(t.fromMonth)}`),
    check('indicator_targets_off_check', sql`${t.offSince} is null or ${isMonth(t.offSince)}`),
    orgIsolation('indicator_targets_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Значения: одно на контрагента, показатель и месяц. Значение — целые сотые; пусто (null) — «не
 * заполнено», 0 — «внесено, равно нулю». Строка остаётся, когда значение стирают: у неё история, комментарий
 * и файлы (источник файлов `indicator_value`).
 */
export const indicatorValues = pgTable(
  'indicator_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    contractorId: uuid('contractor_id').notNull(),
    indicatorId: uuid('indicator_id').notNull(),
    month: text('month').notNull(),
    value: bigint('value', { mode: 'number' }),
    note: text('note').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('indicator_values_id_org_unique').on(t.id, t.orgId),
    uniqueIndex('indicator_values_key').on(t.contractorId, t.indicatorId, t.month),
    contractorRef('indicator_values_contractor_fk', t),
    // Показатель со значениями не удаляется (только в архив), даже если строка значения пустая.
    indicatorRef('indicator_values_indicator_fk', t, 'restrict'),
    index('indicator_values_indicator_idx').on(t.orgId, t.indicatorId),
    index('indicator_values_month_idx').on(t.orgId, t.month),
    check('indicator_values_month_check', isMonth(t.month)),
    check(
      'indicator_values_note_check',
      sql`char_length(${t.note}) <= ${sql.raw(String(INDICATOR_NOTE_MAX_LENGTH))}`,
    ),
    orgIsolation('indicator_values_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Статус заполнения месяца по контрагенту (шкала `indicator`: Не заполнено → Заполнено → Проверено).
 * Строки нет — «Не заполнено» без даты; «Заполнено» ставится само, «Проверено» — правом «Проверять
 * показатели». История статусов — `status_history` по `id` строки.
 */
export const indicatorMonths = pgTable(
  'indicator_months',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    contractorId: uuid('contractor_id').notNull(),
    month: text('month').notNull(),
    status: text('status', { enum: FILL_STATUSES }).notNull().default('empty'),
    /** Когда установлен статус — под шкалой. */
    statusAt: timestamp('status_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('indicator_months_id_org_unique').on(t.id, t.orgId),
    uniqueIndex('indicator_months_key').on(t.contractorId, t.month),
    contractorRef('indicator_months_contractor_fk', t),
    index('indicator_months_month_idx').on(t.orgId, t.month),
    check('indicator_months_month_check', isMonth(t.month)),
    check('indicator_months_status_check', oneOf(t.status, FILL_STATUSES)),
    orgIsolation('indicator_months_isolation', t.orgId),
  ],
).enableRLS();
