import {
  BANK_KINDS,
  BENEFIT_EFFECTS,
  BENEFIT_KINDS,
  BIZ_SIZES,
  CALENDAR_DAY_KINDS,
  DECLARATION_FOR,
  DUE_FROM,
  PAYER_KINDS,
  PICK_GROUPS,
  REGIME_KINDS,
  REGIME_RELATIONS,
  REPORT_ACTS,
  REPORT_KINDS,
  REPORT_PERIODS,
  type AuthorityContact,
  type BenefitSuggest,
  type GkedRule,
  type RateAddition,
  type ReportPayment,
} from '@buhuchet/domain';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { recordVersion } from './columns';
import { platformReadOnly } from './rls';
import { users } from './users';

/*
 * Справочники платформы, на которые опираются контрагенты и отчёты (задача #20; ТЗ «Справочники
 * платформы»): каждый — своя таблица с внешними ключами, остальные мелкие разделы refDB.json остаются в
 * `platform_reference`. Общие для всех организаций, поэтому без org_id; приложение только читает (RLS и
 * права, миграция 0023), меняет наполнение, позже — Админка (поток Д). Ключ записи — постоянный код из
 * refDB.json: по нему сопоставляются наполнение и загрузка из Excel, переименование не создаёт дубль.
 * Значение не удаляется, а отключается (`active`): отключённое не предлагается в новых записях.
 */

/** Значение столбца — одно из списка (постоянные коды без кавычек). */
const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;

/** Все элементы массива — из списка. */
const allOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} <@ array[${sql.raw(values.map((v) => `'${v}'`).join(', '))}]::text[]`;

/** Кто завёл и кто поправил значение в Админке; null — значение из наполнения. */
const auditColumns = () => ({
  createdBy: uuid('created_by').references(() => users.id),
  /** Поправленное в Админке значение `db:seed --update` не затирает. */
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

const dictColumns = () => ({
  active: boolean('active').notNull().default(true),
  /** Порядок справочника («№», «Выше» / «Ниже»). */
  sortOrder: integer('sort_order').notNull(),
  ...auditColumns(),
  version: recordVersion(),
});

/** «Органы»: куда сдают отчёты и платят (ГНС, Соцфонд, Нацстатком, …). */
export const authorities = pgTable(
  'authorities',
  {
    /** ОРГ-01 … */
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    /** «Что это и что туда сдают». */
    description: text('description').notNull().default(''),
    contacts: jsonb('contacts').$type<AuthorityContact[]>().notNull().default([]),
    hours: text('hours').notNull().default(''),
    site: text('site').notNull().default(''),
    /** Откуда взяты контакты («сверить»). */
    contactsNote: text('contacts_note').notNull().default(''),
    ...dictColumns(),
  },
  (t) => [uniqueIndex('authorities_name_key').on(t.name), platformReadOnly('authorities_read')],
).enableRLS();

/** «Режимы налогообложения» (ст. 46 НК КР): общий и специальные. */
export const taxRegimes = pgTable(
  'tax_regimes',
  {
    /** РЕЖ-01 … */
    code: text('code').primaryKey(),
    /** Краткое название («ОНР», «Единый налог»): так режим назван у контрагента и в видах отчётов. */
    name: text('name').notNull(),
    fullName: text('full_name').notNull(),
    kind: text('kind', { enum: REGIME_KINDS }).notNull(),
    /** «Освобождает от». */
    frees: text('frees').notNull().default(''),
    /** «Кто применяет». */
    who: text('who').notNull().default(''),
    /** «Как переходят». */
    how: text('how').notNull().default(''),
    /** «Совмещается с». */
    combines: text('combines').notNull().default(''),
    /** «Для бухгалтера». */
    accountantNote: text('accountant_note').notNull().default(''),
    article: text('article').notNull().default(''),
    gked: jsonb('gked').$type<GkedRule>(),
    ...dictColumns(),
  },
  (t) => [
    uniqueIndex('tax_regimes_name_key').on(t.name),
    check('tax_regimes_kind_check', oneOf(t.kind, REGIME_KINDS)),
    platformReadOnly('tax_regimes_read'),
  ],
).enableRLS();

/** «Основания для отчётов»: признаки контрагента, при которых нужны сквозные отчёты. */
export const reportBases = pgTable(
  'report_bases',
  {
    /** employees, property, … */
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    note: text('note').notNull().default(''),
    ...dictColumns(),
  },
  (t) => [uniqueIndex('report_bases_name_key').on(t.name), platformReadOnly('report_bases_read')],
).enableRLS();

/** «Налоговые органы (УГНС)»: контрагент связан с управлением по постоянному ключу, код ГНС может быть пуст. */
export const taxOffices = pgTable(
  'tax_offices',
  {
    /** Постоянный ключ: ugns-large, ugns-bishkek-lenin, … */
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    shortName: text('short_name').notNull(),
    /** Код ГНС (три цифры); null — пока администратор не сверил его с ГНС. */
    gnsCode: text('gns_code'),
    /** «Город или область». */
    region: text('region').notNull().default(''),
    verify: boolean('verify').notNull().default(false),
    note: text('note').notNull().default(''),
    ...dictColumns(),
  },
  (t) => [
    uniqueIndex('tax_offices_gns_code_key')
      .on(t.gnsCode)
      .where(sql`${t.gnsCode} is not null`),
    check('tax_offices_gns_code_check', sql`${t.gnsCode} is null or ${t.gnsCode} ~ '^[0-9]{3}$'`),
    platformReadOnly('tax_offices_read'),
  ],
).enableRLS();

/** «Виды отчётов» — единый каталог для всех организаций, главный справочник «Отчетов для сдачи». */
export const reportTypes = pgTable(
  'report_types',
  {
    /** Постоянный код вида: nds, nspm, t1m, … */
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    shortName: text('short_name').notNull(),
    /** Код формы ГНС (STI-062) или Нацстаткома; «—», если формы нет. */
    formCode: text('form_code').notNull().default(''),
    /** Индекс формы Нацстаткома. */
    statIndex: text('stat_index').notNull().default(''),
    /** «Кто сдаёт» текстом. */
    respondents: text('respondents').notNull().default(''),
    authorityCode: text('authority_code')
      .notNull()
      .references(() => authorities.code),
    period: text('period', { enum: REPORT_PERIODS }).notNull(),
    /**
     * Срок сдачи правилом (прототип ruleDate): `due_day`-е число (31 — последний день) `due_after`-го
     * месяца после конца периода (`due_from` = start — от его начала); у годовых — месяц `due_month`
     * следующего года (от начала — того же). У разового вида — дней от даты события.
     */
    dueDay: smallint('due_day').notNull(),
    dueAfter: smallint('due_after'),
    dueMonth: smallint('due_month'),
    dueFrom: text('due_from', { enum: DUE_FROM }).notNull().default('end'),
    /** Срок оплаты своим правилом; пусто — как срок сдачи. */
    payDay: smallint('pay_day'),
    payAfter: smallint('pay_after'),
    payMonth: smallint('pay_month'),
    /** График оплаты: [месяц, число] каждого платежа (налог на имущество — 4 платежа). */
    paySchedule: jsonb('pay_schedule').$type<[number, number][]>(),
    /** Переносить срок с нерабочего дня на следующий рабочий. */
    shiftToWorkday: boolean('shift_to_workday').notNull().default(true),
    /** Кварталы, за которые отчёт не создаётся (предварительный налог на прибыль — без IV квартала). */
    skipQuarters: smallint('skip_quarters').array().notNull().default([]),
    /** «Разовый»: отчёты создаются только через «Разовый отчёт», срок — от даты события. */
    oneOff: boolean('one_off').notNull().default(false),
    /** «Название даты события» у разового вида. */
    eventLabel: text('event_label').notNull().default(''),
    /** Периодичность и срок задаются в назначении контрагенту (как у внутренней отчётности). */
    periodPerAssignment: boolean('period_per_assignment').notNull().default(false),
    act: text('act', { enum: REPORT_ACTS }).notNull(),
    payments: jsonb('payments').$type<ReportPayment[]>().notNull().default([]),
    kind: text('kind', { enum: REPORT_KINDS }).notNull(),
    /** «Для кого». */
    payer: text('payer', { enum: PAYER_KINDS }).notNull(),
    rates: text('rates').array().notNull().default([]),
    rateAdditions: jsonb('rate_additions').$type<RateAddition[]>().notNull().default([]),
    /** «Не для ставок ЕН»: коды строк «Ставок единого налога» (ЕНС-…). */
    notForEnRates: text('not_for_en_rates').array().notNull().default([]),
    bizSizes: text('biz_sizes').array().notNull().default([]),
    pickGroup: text('pick_group', { enum: PICK_GROUPS }).notNull(),
    /** «Отмечать заранее». */
    preselect: boolean('preselect').notNull().default(true),
    /** «Пояснение выбора». */
    choiceNote: text('choice_note').notNull().default(''),
    /** Подсказка под описанием в «Подборе отчётов». */
    pickHint: text('pick_hint').notNull().default(''),
    description: text('description').notNull().default(''),
    /** «Пояснение для контрагента». */
    clientNote: text('client_note').notNull().default(''),
    article: text('article').notNull().default(''),
    note: text('note').notNull().default(''),
    /** «Источник» — ссылка, откуда взяты сведения. */
    source: text('source').notNull().default(''),
    verify: boolean('verify').notNull().default(false),
    verifyNote: text('verify_note').notNull().default(''),
    /** Последняя сверка с ГНС: когда и кто. */
    gnsCheckedAt: date('gns_checked_at', { mode: 'string' }),
    gnsCheckedBy: text('gns_checked_by').notNull().default(''),
    gked: jsonb('gked').$type<GkedRule>(),
    ...dictColumns(),
  },
  (t) => [
    index('report_types_authority_idx').on(t.authorityCode),
    check('report_types_period_check', oneOf(t.period, REPORT_PERIODS)),
    check('report_types_due_from_check', oneOf(t.dueFrom, DUE_FROM)),
    check('report_types_act_check', oneOf(t.act, REPORT_ACTS)),
    check('report_types_kind_check', oneOf(t.kind, REPORT_KINDS)),
    check('report_types_payer_check', oneOf(t.payer, PAYER_KINDS)),
    check('report_types_pick_group_check', oneOf(t.pickGroup, PICK_GROUPS)),
    check('report_types_biz_sizes_check', allOf(t.bizSizes, BIZ_SIZES)),
    check(
      'report_types_rule_check',
      sql`${t.dueDay} >= 1 and (${t.dueAfter} is null or ${t.dueAfter} between 0 and 12)
        and (${t.dueMonth} is null or ${t.dueMonth} between 1 and 12)
        and (${t.payDay} is null or ${t.payDay} between 1 and 31)
        and (${t.payAfter} is null or ${t.payAfter} between 0 and 12)
        and (${t.payMonth} is null or ${t.payMonth} between 1 and 12)
        and ${t.skipQuarters} <@ array[1, 2, 3, 4]::smallint[]`,
    ),
    platformReadOnly('report_types_read'),
  ],
).enableRLS();

/** «Применимые режимы» вида отчёта и «Не для режимов» (правило подбора). */
export const reportTypeRegimes = pgTable(
  'report_type_regimes',
  {
    reportTypeCode: text('report_type_code')
      .notNull()
      .references(() => reportTypes.code, { onDelete: 'cascade' }),
    regimeCode: text('regime_code')
      .notNull()
      .references(() => taxRegimes.code),
    relation: text('relation', { enum: REGIME_RELATIONS }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.reportTypeCode, t.regimeCode] }),
    index('report_type_regimes_regime_idx').on(t.regimeCode),
    check('report_type_regimes_relation_check', oneOf(t.relation, REGIME_RELATIONS)),
    platformReadOnly('report_type_regimes_read'),
  ],
).enableRLS();

/**
 * «Основание» сквозного вида отчёта: достаточно любого из оснований. Связь одна на обе стороны — у
 * основания «какие виды отчётов включает» читается отсюда же (ТЗ: «по полю «Основание» вида»).
 */
export const reportTypeBases = pgTable(
  'report_type_bases',
  {
    reportTypeCode: text('report_type_code')
      .notNull()
      .references(() => reportTypes.code, { onDelete: 'cascade' }),
    baseCode: text('base_code')
      .notNull()
      .references(() => reportBases.code),
  },
  (t) => [
    primaryKey({ columns: [t.reportTypeCode, t.baseCode] }),
    index('report_type_bases_base_idx').on(t.baseCode),
    platformReadOnly('report_type_bases_read'),
  ],
).enableRLS();

/** «Налоговые льготы и особые статусы»: признаки контрагента, от которых зависят ставки и набор отчётов. */
export const taxBenefits = pgTable(
  'tax_benefits',
  {
    /** ЛЬГ-01 … */
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind', { enum: BENEFIT_KINDS }).notNull().default('benefit'),
    /** «Что даёт». */
    gives: text('gives').notNull().default(''),
    article: text('article').notNull().default(''),
    /** «Кто может применять». */
    payer: text('payer', { enum: PAYER_KINDS }).notNull(),
    /** «Условия». */
    conditions: text('conditions').notNull().default(''),
    /** «Как подтверждается». */
    confirmation: text('confirmation').notNull().default(''),
    /** «Совмещается с». */
    combines: text('combines').notNull().default(''),
    /** Срок действия текстом. */
    term: text('term').notNull().default(''),
    /** Дата окончания льготы по кодексу: за 60 дней — предупреждение. */
    validUntil: date('valid_until', { mode: 'string' }),
    verify: boolean('verify').notNull().default(false),
    verifyNote: text('verify_note').notNull().default(''),
    gked: jsonb('gked').$type<GkedRule>(),
    /** Проверяется только основной ГКЭД. */
    gkedMainOnly: boolean('gked_main_only').notNull().default(false),
    /** Налог или платёж «Налогов и ставок» (НАЛ-…, ПЛТ-…), к которому относится тариф. */
    taxCode: text('tax_code').notNull().default(''),
    suggest: jsonb('suggest').$type<BenefitSuggest>(),
    ...dictColumns(),
  },
  (t) => [
    uniqueIndex('tax_benefits_name_key').on(t.name),
    check('tax_benefits_kind_check', oneOf(t.kind, BENEFIT_KINDS)),
    check('tax_benefits_payer_check', oneOf(t.payer, PAYER_KINDS)),
    platformReadOnly('tax_benefits_read'),
  ],
).enableRLS();

/** Какие виды отчётов статус добавляет и какие делает ненужными. */
export const taxBenefitReportTypes = pgTable(
  'tax_benefit_report_types',
  {
    benefitCode: text('benefit_code')
      .notNull()
      .references(() => taxBenefits.code, { onDelete: 'cascade' }),
    reportTypeCode: text('report_type_code')
      .notNull()
      .references(() => reportTypes.code),
    effect: text('effect', { enum: BENEFIT_EFFECTS }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.benefitCode, t.reportTypeCode] }),
    index('tax_benefit_report_types_type_idx').on(t.reportTypeCode),
    check('tax_benefit_report_types_effect_check', oneOf(t.effect, BENEFIT_EFFECTS)),
    platformReadOnly('tax_benefit_report_types_read'),
  ],
).enableRLS();

/** «Ставится по УГНС»: управления ГНС, при которых статус отмечается у контрагента сам. */
export const taxBenefitOffices = pgTable(
  'tax_benefit_offices',
  {
    benefitCode: text('benefit_code')
      .notNull()
      .references(() => taxBenefits.code, { onDelete: 'cascade' }),
    taxOfficeCode: text('tax_office_code')
      .notNull()
      .references(() => taxOffices.code),
  },
  (t) => [
    primaryKey({ columns: [t.benefitCode, t.taxOfficeCode] }),
    index('tax_benefit_offices_office_idx').on(t.taxOfficeCode),
    platformReadOnly('tax_benefit_offices_read'),
  ],
).enableRLS();

/**
 * «Меняет сроки»: у контрагента со статусом отчёты вида получают свой срок сдачи и (или) оплаты тем же
 * правилом, что у вида (пусто — как у вида; день 31 — последний день месяца).
 */
export const taxBenefitDueRules = pgTable(
  'tax_benefit_due_rules',
  {
    benefitCode: text('benefit_code')
      .notNull()
      .references(() => taxBenefits.code, { onDelete: 'cascade' }),
    reportTypeCode: text('report_type_code')
      .notNull()
      .references(() => reportTypes.code),
    dueDay: smallint('due_day'),
    dueAfter: smallint('due_after'),
    dueMonth: smallint('due_month'),
    payDay: smallint('pay_day'),
    payAfter: smallint('pay_after'),
  },
  (t) => [
    primaryKey({ columns: [t.benefitCode, t.reportTypeCode] }),
    check(
      'tax_benefit_due_rules_rule_check',
      sql`(${t.dueDay} is null or ${t.dueDay} between 1 and 31)
        and (${t.dueAfter} is null or ${t.dueAfter} between 0 and 12)
        and (${t.dueMonth} is null or ${t.dueMonth} between 1 and 12)
        and (${t.payDay} is null or ${t.payDay} between 1 and 31)
        and (${t.payAfter} is null or ${t.payAfter} between 0 and 12)`,
    ),
    platformReadOnly('tax_benefit_due_rules_read'),
  ],
).enableRLS();

/**
 * Производственный календарь КР: праздники (`MM-DD` — каждый год, `YYYY-MM-DD` — только в этом году),
 * переносы Кабинета министров и рабочие субботы. Правила — `@buhuchet/domain` (`isWorkingDay`,
 * `nextWorkingDay`, `calendarYear`).
 */
export const productionCalendar = pgTable(
  'production_calendar',
  {
    day: text('day').primaryKey(),
    kind: text('kind', { enum: CALENDAR_DAY_KINDS }).notNull(),
    name: text('name').notNull().default(''),
    ...auditColumns(),
    version: recordVersion(),
  },
  (t) => [
    check(
      'production_calendar_day_check',
      sql`${t.day} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (${t.day} ~ '^[0-9]{2}-[0-9]{2}$' and ${t.kind} = 'holiday')`,
    ),
    check('production_calendar_kind_check', oneOf(t.kind, CALENDAR_DAY_KINDS)),
    platformReadOnly('production_calendar_read'),
  ],
).enableRLS();

/*
 * Формы собственности, ставки единого налога и причины изменения срока (задача 2.01): прежде лежали
 * копиями разделов refDB.json в `platform_reference`, теперь — свои таблицы с тем же устройством.
 */

/** «Формы собственности»: организационно-правовые формы по ГК КР. */
export const ownershipForms = pgTable(
  'ownership_forms',
  {
    /** ФС-01 … */
    code: text('code').primaryKey(),
    /** Название, которым форма показывается у контрагента («ОсОО», «ИП»). */
    name: text('name').notNull(),
    /** «Полное название». */
    fullName: text('full_name').notNull().default(''),
    /** «Краткое название». */
    shortName: text('short_name').notNull().default(''),
    /** «Для ЕНД»: контрагенту доступна ЕНД для организаций или ЕНД для ИП. */
    declarationFor: text('declaration_for', { enum: DECLARATION_FOR }).notNull().default('org'),
    /** «Что меняет в налогах» — пояснение, которое видят все организации. */
    note: text('note').notNull().default(''),
    ...dictColumns(),
  },
  (t) => [
    uniqueIndex('ownership_forms_name_key').on(t.name),
    check('ownership_forms_declaration_for_check', oneOf(t.declarationFor, DECLARATION_FOR)),
    platformReadOnly('ownership_forms_read'),
  ],
).enableRLS();

/**
 * «Ставки единого налога» (ст. 423 НК КР): у ЕН в назначении контрагента хранится код строки, а не
 * процент — безналичная и наличная ставки строки действуют вместе.
 */
export const singleTaxRates = pgTable(
  'single_tax_rates',
  {
    /** ЕНС-01 … */
    code: text('code').primaryKey(),
    /** «Деятельность». */
    activity: text('activity').notNull(),
    /** «Ставка» текстом, как в кодексе («2 % безнал + 4 % нал»). */
    rate: text('rate').notNull(),
    /** Ставки безналичной и наличной выручки; пусто — одна ставка `rate` на всю выручку. */
    rateCashless: text('rate_cashless').notNull().default(''),
    rateCash: text('rate_cash').notNull().default(''),
    /** «Условие». */
    conditions: text('conditions').notNull().default(''),
    article: text('article').notNull().default(''),
    /** «Когда применяется» — пояснение ставки, которое видят все организации. */
    explanation: text('explanation').notNull().default(''),
    gked: jsonb('gked').$type<GkedRule>(),
    /**
     * «Добавляется к ставкам»: коды строк, к которым строка добавляется (ЕНС-16 — к ЕНС-01, 02, …);
     * пусто — самостоятельная ставка. Коды проверяет наполнение (и Админка — поток Д).
     */
    addsTo: text('adds_to').array().notNull().default([]),
    ...dictColumns(),
  },
  (t) => [
    check('single_tax_rates_adds_to_check', sql`not (${t.code} = any(${t.addsTo}))`),
    platformReadOnly('single_tax_rates_read'),
  ],
).enableRLS();

/** «Причины изменения срока отчёта»: выбираются при ручном отчёте и изменении срока. */
export const dueChangeReasons = pgTable(
  'due_change_reasons',
  {
    /** ПРЧ-001 … */
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    /** «Пояснение». */
    note: text('note').notNull().default(''),
    ...dictColumns(),
  },
  (t) => [
    uniqueIndex('due_change_reasons_name_key').on(t.name),
    platformReadOnly('due_change_reasons_read'),
  ],
).enableRLS();

/**
 * «Банковские провайдеры» (задача 2.18; ТЗ «Справочники платформы» → «Банковские провайдеры»): банки и
 * электронные кошельки для реквизитов организации и сотрудников. В «Переводе по номеру телефона»
 * выбираются только провайдеры с «Переводы по номеру телефона».
 */
export const banks = pgTable(
  'banks',
  {
    /** БНК-01 … — банки, КШЛ-01 … — кошельки. */
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind', { enum: BANK_KINDS }).notNull(),
    /** «Переводы по номеру телефона». */
    byPhone: boolean('by_phone').notNull().default(false),
    /** «Пояснение». */
    note: text('note').notNull().default(''),
    ...dictColumns(),
  },
  (t) => [
    uniqueIndex('banks_name_key').on(t.name),
    check('banks_kind_check', oneOf(t.kind, BANK_KINDS)),
    platformReadOnly('banks_read'),
  ],
).enableRLS();

/**
 * «Категории задач» (задача 2.23; ТЗ «Справочники платформы» → «Категории задач»): категория ручной
 * задачи в форме задачи. Раньше — раздел `dictionaries.cats` в `platform_reference`.
 */
export const taskCategories = pgTable(
  'task_categories',
  {
    /** КАТ-001 … */
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    /** «Пояснение» (Админка, прототип `valueDlg`): видят все организации. */
    note: text('note').notNull().default(''),
    ...dictColumns(),
  },
  (t) => [
    uniqueIndex('task_categories_name_key').on(t.name),
    platformReadOnly('task_categories_read'),
  ],
).enableRLS();
