import {
  BIZ_SIZES,
  calendarEntryProblem,
  DECLARATION_FOR,
  calendarKindOf,
  LAST_DAY_OF_MONTH,
  PAYER_KINDS,
  PICK_GROUPS,
  REPORT_ACTS,
  REPORT_KINDS,
  REPORT_PERIODS,
  type CalendarEntry,
} from '@buhuchet/domain';
import {
  and,
  getTableColumns,
  getTableName,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  sql,
} from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Db } from '../client';
import {
  authorities,
  dueChangeReasons,
  ownershipForms,
  productionCalendar,
  reportBases,
  reportTypeBases,
  reportTypeRegimes,
  reportTypes,
  singleTaxRates,
  taxBenefitDueRules,
  taxBenefitOffices,
  taxBenefitReportTypes,
  taxBenefits,
  taxOffices,
  taxRegimes,
} from '../schema';
import type { SeedOptions, SeedReport } from './platform';

/*
 * Справочники платформы для контрагентов и отчётов (задача #20): разделы refDB.json → свои таблицы.
 * Записи сопоставляются по постоянному коду. Без --update — только добавляются недостающие записи (и
 * связи новых записей); с --update изменившиеся записи обновляются (версия +1), связи записей
 * приводятся к refDB.json. Записи, которых нет в refDB.json, не удаляются: значение справочника только
 * отключают (ТЗ). Ссылки между разделами проверяются до записи: неизвестный код останавливает наполнение.
 */

/** Разделы refDB.json, которые лежат в своих таблицах и в `platform_reference` не копируются. */
export const TABLE_SECTIONS = [
  'reportTypes',
  'enRates',
  'holidays',
  'workingSaturdays',
  // Копии разделов, у которых таблицы уже были: ui_texts, permissions, role_templates.
  'localization',
  'permissions',
  'roleTemplates',
] as const;

/** Справочники раздела `dictionaries`, которые лежат в своих таблицах. */
export const TABLE_DICTIONARIES = [
  'organs',
  'regimes',
  'bases',
  'ugns',
  'benefits',
  'forms',
  'reasons',
] as const;

// Служебные отметки прототипа «кто и когда создал и изменил» в базу не переносятся: история продукта —
// audit_log с первой правки в Админке.
const audit = {
  _cb: z.string().optional(),
  _ca: z.string().optional(),
  _ub: z.string().optional(),
  _ua: z.string().optional(),
};

const Codes = z.array(z.string().min(1));

const GkedRuleSchema = z
  .object({
    in: Codes,
    ex: Codes,
    warn: Codes.optional(),
    ip: Codes.optional(),
    ipEx: Codes.optional(),
    itd: Codes.optional(),
    main: z.boolean().optional(),
    hint: z.boolean().optional(),
    note: z.string().optional(),
    verify: z.string().optional(),
    who: z.string().optional(),
    strict: z.string().optional(),
  })
  .strict();

// Схемы строгие: новое поле в refDB.json останавливает наполнение, пока для него нет столбца, —
// данные справочника не теряются молча.
const OrganSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    note: z.string().default(''),
    contacts: z.array(z.object({ label: z.string(), value: z.string() }).strict()).default([]),
    hours: z.string().default(''),
    site: z.string().default(''),
    contactsNote: z.string().default(''),
    active: z.boolean(),
    ...audit,
  })
  .strict();

const RegimeSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    full: z.string().min(1),
    type: z.enum(['Общий', 'Специальный']),
    frees: z.string().default(''),
    who: z.string().default(''),
    how: z.string().default(''),
    combines: z.string().default(''),
    acc: z.string().default(''),
    art: z.string().default(''),
    gked: GkedRuleSchema.optional(),
    active: z.boolean(),
    ...audit,
  })
  .strict();

const BaseSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    desc: z.string().default(''),
    note: z.string().default(''),
    // «Какие виды отчётов включает» — по полю «Основание» вида (ТЗ): связь берётся из видов отчётов.
    types: Codes,
    active: z.boolean(),
    ...audit,
  })
  .strict();

const UgnsSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    short: z.string().min(1),
    code: z.union([z.literal(''), z.string().regex(/^\d{3}$/)]),
    city: z.string().default(''),
    verify: z.boolean().default(false),
    note: z.string().default(''),
    active: z.boolean(),
    ...audit,
  })
  .strict();

const DueOverrideSchema = z
  .object({
    day: z.union([z.literal('last'), z.number().int().min(1).max(LAST_DAY_OF_MONTH)]).optional(),
    after: z.number().int().min(0).max(12).optional(),
    ym: z.number().int().min(1).max(12).optional(),
    pay: z
      .object({
        day: z.union([z.literal('last'), z.number().int().min(1).max(LAST_DAY_OF_MONTH)]),
        after: z.number().int().min(0).max(12).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const BenefitSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(['status']).optional(),
    gives: z.string().default(''),
    art: z.string().default(''),
    who: z.enum(PAYER_KINDS),
    cond: z.string().default(''),
    confirm: z.string().default(''),
    combines: z.string().default(''),
    term: z.string().default(''),
    until: z.union([z.literal(''), z.iso.date()]),
    verify: z.boolean().default(false),
    verifyNote: z.string().default(''),
    gked: GkedRuleSchema.optional(),
    gkedMain: z.boolean().default(false),
    tax: z.string().default(''),
    removes: Codes,
    adds: Codes,
    suggest: z
      .object({
        basis: z.string().min(1).optional(),
        ugns: Codes.optional(),
        preselect: z.boolean().optional(),
        notWith: Codes.optional(),
        warnForms: Codes.optional(),
        note: z.string().optional(),
      })
      .strict()
      .optional(),
    dueOverride: z.record(z.string(), DueOverrideSchema).optional(),
    active: z.boolean(),
    ...audit,
  })
  .strict();

const Month = z.number().int().min(1).max(12);

const ReportTypeSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    short: z.string().min(1),
    code: z.string().default(''),
    index: z.string().default(''),
    respondents: z.string().default(''),
    organ: z.string().min(1),
    per: z.enum(REPORT_PERIODS),
    day: z.number().int().min(1),
    after: z.number().int().min(0).max(12).optional(),
    ym: Month.optional(),
    from: z.literal('start').optional(),
    pay: z
      .object({ day: z.number().int().min(1).max(31), after: z.number().int().min(0).max(12) })
      .extend({ ym: Month.optional() })
      .strict()
      .optional(),
    inst: z.array(z.tuple([Month, z.number().int().min(1).max(31)])).optional(),
    shift: z.boolean(),
    skipQ: z.array(z.number().int().min(1).max(4)).default([]),
    oneOff: z.boolean().default(false),
    evLabel: z.string().default(''),
    perAssign: z.boolean().default(false),
    act: z.enum(REPORT_ACTS),
    // Производные от «Что нужно сделать» (прототип ACTF): в базу не пишутся.
    sum: z.boolean(),
    payOnly: z.boolean(),
    pays: z.array(
      z.object({ n: z.string().min(1), to: z.string().min(1), kbk: z.string() }).strict(),
    ),
    kind: z.enum(REPORT_KINDS),
    who: z.enum(PAYER_KINDS),
    regimes: z.array(z.string().min(1)),
    regimesNot: z.array(z.string().min(1)).default([]),
    enRatesNot: Codes.default([]),
    basis: Codes,
    bizSize: z.array(z.enum(BIZ_SIZES)).default([]),
    group: z.enum(PICK_GROUPS),
    preselect: z.boolean(),
    choice: z.string().default(''),
    extra: z.string().default(''),
    rates: z.array(z.string()),
    rateAdd: z
      .array(
        z
          .object({
            k: z.string().min(1),
            name: z.string().min(1),
            short: z.string().optional(),
            rate: z.string().min(1),
            rateCashless: z.string().optional(),
            rateCash: z.string().optional(),
            art: z.string().optional(),
          })
          .strict(),
      )
      .default([]),
    desc: z.string().default(''),
    clientNote: z.string().default(''),
    art: z.string().default(''),
    note: z.string().default(''),
    source: z.string().default(''),
    verify: z.boolean(),
    verifyNote: z.string().default(''),
    gnsAt: z.union([z.literal(''), z.iso.date()]).default(''),
    gnsBy: z.string().default(''),
    gked: GkedRuleSchema.optional(),
    // Не используются прототипом: диапазон сумм для демо-данных и прежняя ставка по умолчанию.
    range: z.tuple([z.number(), z.number()]).optional(),
    rate: z.string().optional(),
    active: z.boolean(),
    ...audit,
  })
  .strict();

const FormSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    full: z.string().default(''),
    short: z.string().default(''),
    end: z.enum(DECLARATION_FOR),
    note: z.string().default(''),
    active: z.boolean(),
    ...audit,
  })
  .strict();

const EnRateSchema = z
  .object({
    code: z.string().min(1),
    activity: z.string().min(1),
    rate: z.string().min(1),
    rateCashless: z.string().default(''),
    rateCash: z.string().default(''),
    cond: z.string().default(''),
    art: z.string().default(''),
    explain: z.string().default(''),
    gked: GkedRuleSchema.optional(),
    addTo: Codes.default([]),
    active: z.boolean(),
    ...audit,
  })
  .strict();

const ReasonSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    note: z.string().default(''),
    active: z.boolean(),
    ...audit,
  })
  .strict();

const Dictionary = <T extends z.ZodType>(item: T) =>
  z.object({ title: z.string(), items: z.array(item) }).strict();

/** Раздел `platform_reference`, на коды которого ссылаются справочники (налоги и платежи). */
const CodedSection = z.array(z.object({ code: z.string() }));

const RefSections = z.object({
  dictionaries: z.object({
    organs: Dictionary(OrganSchema),
    regimes: Dictionary(RegimeSchema),
    bases: Dictionary(BaseSchema),
    ugns: Dictionary(UgnsSchema),
    benefits: Dictionary(BenefitSchema),
    forms: Dictionary(FormSchema),
    reasons: Dictionary(ReasonSchema),
  }),
  reportTypes: z.array(ReportTypeSchema),
  enRates: z.array(EnRateSchema),
  taxes: CodedSection,
  holidays: z.record(z.string(), z.string().min(1)),
  workingSaturdays: z.array(z.iso.date()),
});
type RefSections = z.infer<typeof RefSections>;

export type PlatformDictsReport = Record<
  | 'authorities'
  | 'taxRegimes'
  | 'reportBases'
  | 'taxOffices'
  | 'reportTypes'
  | 'taxBenefits'
  | 'ownershipForms'
  | 'singleTaxRates'
  | 'dueChangeReasons'
  | 'productionCalendar',
  SeedReport
>;

const blankToNull = (value: string): string | null => (value === '' ? null : value);

/** Ссылка на код другого раздела: неизвестный код — ошибка наполнения с местом. */
function lookup(map: ReadonlyMap<string, string>, key: string, where: string): string {
  const code = map.get(key);
  if (code === undefined) throw new Error(`refDB.json: ${where} — «${key}» нет в справочнике`);
  return code;
}

function unique(values: string[], where: string): void {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) throw new Error(`refDB.json: ${where} — код «${v}» повторяется`);
    seen.add(v);
  }
}

/** Строки таблиц из разделов refDB.json; ссылки между разделами проверены. */
export function platformDictRows(refDB: unknown) {
  const ref: RefSections = RefSections.parse(refDB);
  const d = ref.dictionaries;
  unique(
    d.organs.items.map((x) => x.code),
    'organs',
  );
  unique(
    d.regimes.items.map((x) => x.code),
    'regimes',
  );
  unique(
    d.bases.items.map((x) => x.code),
    'bases',
  );
  unique(
    d.ugns.items.map((x) => x.id),
    'ugns',
  );
  unique(
    d.benefits.items.map((x) => x.code),
    'benefits',
  );
  unique(
    ref.reportTypes.map((x) => x.id),
    'reportTypes',
  );
  unique(
    d.forms.items.map((x) => x.code),
    'forms',
  );
  unique(
    ref.enRates.map((x) => x.code),
    'enRates',
  );
  unique(
    d.reasons.items.map((x) => x.code),
    'reasons',
  );

  const authorityByName = new Map(d.organs.items.map((o) => [o.name, o.code]));
  const regimeByName = new Map(d.regimes.items.map((r) => [r.name, r.code]));
  const baseCodes = new Map(d.bases.items.map((b) => [b.code, b.code]));
  const officeIds = new Map(d.ugns.items.map((u) => [u.id, u.id]));
  const typeCodes = new Map(ref.reportTypes.map((t) => [t.id, t.id]));
  const benefitCodes = new Map(d.benefits.items.map((b) => [b.code, b.code]));
  const codesIn = (items: { code: string }[]) => new Map(items.map((x) => [x.code, x.code]));
  const enRateCodes = codesIn(ref.enRates);
  const formCodes = codesIn(d.forms.items);
  const taxCodes = codesIn(ref.taxes);

  const authorityRows = d.organs.items.map((o, i) => ({
    code: o.code,
    name: o.name,
    description: o.note,
    contacts: o.contacts,
    hours: o.hours,
    site: o.site,
    contactsNote: o.contactsNote,
    active: o.active,
    sortOrder: i + 1,
  }));

  const regimeRows = d.regimes.items.map((r, i) => ({
    code: r.code,
    name: r.name,
    fullName: r.full,
    kind: r.type === 'Общий' ? ('general' as const) : ('special' as const),
    frees: r.frees,
    who: r.who,
    how: r.how,
    combines: r.combines,
    accountantNote: r.acc,
    article: r.art,
    gked: r.gked ?? null,
    active: r.active,
    sortOrder: i + 1,
  }));

  const baseRows = d.bases.items.map((b, i) => ({
    code: b.code,
    name: b.name,
    description: b.desc,
    note: b.note,
    active: b.active,
    sortOrder: i + 1,
  }));
  for (const b of d.bases.items)
    for (const t of b.types) lookup(typeCodes, t, `bases.${b.code}.types`);

  const officeRows = d.ugns.items.map((u, i) => ({
    code: u.id,
    name: u.name,
    shortName: u.short,
    gnsCode: blankToNull(u.code),
    region: u.city,
    verify: u.verify,
    note: u.note,
    active: u.active,
    sortOrder: i + 1,
  }));

  const typeRows = ref.reportTypes.map((t, i) => ({
    code: t.id,
    name: t.name,
    shortName: t.short,
    formCode: t.code,
    statIndex: t.index,
    respondents: t.respondents,
    authorityCode: lookup(authorityByName, t.organ, `reportTypes.${t.id}.organ`),
    period: t.per,
    dueDay: t.day,
    dueAfter: t.after ?? null,
    dueMonth: t.ym ?? null,
    dueFrom: t.from ?? ('end' as const),
    payDay: t.pay?.day ?? null,
    payAfter: t.pay?.after ?? null,
    payMonth: t.pay?.ym ?? null,
    paySchedule: t.inst ?? null,
    shiftToWorkday: t.shift,
    skipQuarters: t.skipQ,
    oneOff: t.oneOff,
    eventLabel: t.evLabel,
    periodPerAssignment: t.perAssign,
    act: t.act,
    payments: t.pays.map((p) => ({
      name: p.n,
      authority: lookup(authorityByName, p.to, `reportTypes.${t.id}.pays`),
      kbk: p.kbk,
    })),
    kind: t.kind,
    payer: t.who,
    rates: t.rates,
    rateAdditions: t.rateAdd,
    notForEnRates: t.enRatesNot.map((c) =>
      lookup(enRateCodes, c, `reportTypes.${t.id}.enRatesNot`),
    ),
    bizSizes: t.bizSize,
    pickGroup: t.group,
    preselect: t.preselect,
    choiceNote: t.choice,
    pickHint: t.extra,
    description: t.desc,
    clientNote: t.clientNote,
    article: t.art,
    note: t.note,
    source: t.source,
    verify: t.verify,
    verifyNote: t.verifyNote,
    gnsCheckedAt: blankToNull(t.gnsAt),
    gnsCheckedBy: t.gnsBy,
    gked: t.gked ?? null,
    active: t.active,
    sortOrder: i + 1,
  }));
  const typeRegimeRows = ref.reportTypes.flatMap((t) => [
    ...t.regimes.map((r) => ({
      reportTypeCode: t.id,
      regimeCode: lookup(regimeByName, r, `reportTypes.${t.id}.regimes`),
      relation: 'applies' as const,
    })),
    ...t.regimesNot.map((r) => ({
      reportTypeCode: t.id,
      regimeCode: lookup(regimeByName, r, `reportTypes.${t.id}.regimesNot`),
      relation: 'excludes' as const,
    })),
  ]);
  unique(
    typeRegimeRows.map((r) => `${r.reportTypeCode}/${r.regimeCode}`),
    'reportTypes.regimes',
  );
  const typeBaseRows = ref.reportTypes.flatMap((t) =>
    t.basis.map((b) => ({
      reportTypeCode: t.id,
      baseCode: lookup(baseCodes, b, `reportTypes.${t.id}.basis`),
    })),
  );

  const benefitRows = d.benefits.items.map((b, i) => {
    const { ugns: _offices, ...suggest } = b.suggest ?? {};
    if (suggest.basis) lookup(baseCodes, suggest.basis, `benefits.${b.code}.suggest.basis`);
    for (const c of suggest.notWith ?? []) lookup(benefitCodes, c, `benefits.${b.code}.notWith`);
    for (const c of suggest.warnForms ?? []) lookup(formCodes, c, `benefits.${b.code}.warnForms`);
    if (b.tax) lookup(taxCodes, b.tax, `benefits.${b.code}.tax`);
    return {
      code: b.code,
      name: b.name,
      kind: b.kind ?? ('benefit' as const),
      gives: b.gives,
      article: b.art,
      payer: b.who,
      conditions: b.cond,
      confirmation: b.confirm,
      combines: b.combines,
      term: b.term,
      validUntil: blankToNull(b.until),
      verify: b.verify,
      verifyNote: b.verifyNote,
      gked: b.gked ?? null,
      gkedMainOnly: b.gkedMain,
      taxCode: b.tax,
      suggest: b.suggest ? suggest : null,
      active: b.active,
      sortOrder: i + 1,
    };
  });
  const benefitTypeRows = d.benefits.items.flatMap((b) => [
    ...b.adds.map((t) => ({
      benefitCode: b.code,
      reportTypeCode: lookup(typeCodes, t, `benefits.${b.code}.adds`),
      effect: 'adds' as const,
    })),
    ...b.removes.map((t) => ({
      benefitCode: b.code,
      reportTypeCode: lookup(typeCodes, t, `benefits.${b.code}.removes`),
      effect: 'removes' as const,
    })),
  ]);
  unique(
    benefitTypeRows.map((r) => `${r.benefitCode}/${r.reportTypeCode}`),
    'benefits.adds/removes',
  );
  const benefitOfficeRows = d.benefits.items.flatMap((b) =>
    (b.suggest?.ugns ?? []).map((u) => ({
      benefitCode: b.code,
      taxOfficeCode: lookup(officeIds, u, `benefits.${b.code}.suggest.ugns`),
    })),
  );
  const dayOf = (v: number | 'last' | undefined) =>
    v === undefined ? null : v === 'last' ? LAST_DAY_OF_MONTH : v;
  const benefitDueRows = d.benefits.items.flatMap((b) =>
    Object.entries(b.dueOverride ?? {}).map(([type, o]) => ({
      benefitCode: b.code,
      reportTypeCode: lookup(typeCodes, type, `benefits.${b.code}.dueOverride`),
      dueDay: dayOf(o.day),
      dueAfter: o.after ?? null,
      dueMonth: o.ym ?? null,
      payDay: dayOf(o.pay?.day),
      payAfter: o.pay?.after ?? null,
    })),
  );

  const formRows = d.forms.items.map((f, i) => ({
    code: f.code,
    name: f.name,
    fullName: f.full,
    shortName: f.short,
    declarationFor: f.end,
    note: f.note,
    active: f.active,
    sortOrder: i + 1,
  }));

  const enRateRows = ref.enRates.map((r, i) => {
    for (const c of r.addTo) {
      if (c === r.code)
        throw new Error(`refDB.json: enRates.${r.code}.addTo — ставка у самой себя`);
      lookup(enRateCodes, c, `enRates.${r.code}.addTo`);
    }
    return {
      code: r.code,
      activity: r.activity,
      rate: r.rate,
      rateCashless: r.rateCashless,
      rateCash: r.rateCash,
      conditions: r.cond,
      article: r.art,
      explanation: r.explain,
      gked: r.gked ?? null,
      addsTo: r.addTo,
      active: r.active,
      sortOrder: i + 1,
    };
  });

  const reasonRows = d.reasons.items.map((r, i) => ({
    code: r.code,
    name: r.name,
    note: r.note,
    active: r.active,
    sortOrder: i + 1,
  }));

  const workingSaturdays = new Set(ref.workingSaturdays);
  const calendarRows: CalendarEntry[] = [
    ...Object.entries(ref.holidays).map(([day, name]) => ({
      day,
      kind: calendarKindOf(name, false),
      name,
    })),
    ...ref.workingSaturdays.map((day) => ({ day, kind: calendarKindOf('', true), name: '' })),
  ];
  for (const e of calendarRows) {
    const problem = calendarEntryProblem(e);
    if (problem) throw new Error(`refDB.json: производственный календарь — ${problem}`);
    if (e.kind !== 'workday' && workingSaturdays.has(e.day))
      throw new Error(`refDB.json: ${e.day} — и праздник, и рабочая суббота`);
  }

  return {
    authorities: authorityRows,
    taxRegimes: regimeRows,
    reportBases: baseRows,
    taxOffices: officeRows,
    reportTypes: typeRows,
    reportTypeRegimes: typeRegimeRows,
    reportTypeBases: typeBaseRows,
    taxBenefits: benefitRows,
    taxBenefitReportTypes: benefitTypeRows,
    taxBenefitOffices: benefitOfficeRows,
    taxBenefitDueRules: benefitDueRows,
    ownershipForms: formRows,
    singleTaxRates: enRateRows,
    dueChangeReasons: reasonRows,
    productionCalendar: calendarRows,
  };
}

const SERVICE_COLUMNS = new Set(['created_at', 'created_by', 'updated_by', 'updated_at', 'version']);

/**
 * Записи справочника по ключу: новые добавляются; с `update` изменившиеся обновляются (версия +1,
 * время правки), одинаковые и поправленные в Админке (`updated_by` задан) не трогаются. Возвращает
 * счёт и ключи записей, связи которых ведёт наполнение: без `update` — добавленных, с `update` — всех
 * из refDB.json, кроме поправленных в Админке.
 */
async function upsertDict(
  db: Db,
  table: PgTable,
  key: PgColumn,
  rows: readonly object[],
  update: boolean,
): Promise<{ report: SeedReport; seeded: string[] }> {
  if (!rows.length) return { report: { inserted: 0, updated: 0, unchanged: 0 }, seeded: [] };
  const all = Object.values(getTableColumns(table));
  const columns = all.filter((c) => c.name !== key.name && !SERVICE_COLUMNS.has(c.name));
  const own = (name: string) => sql.raw(`"${getTableName(table)}"."${name}"`);
  const excluded = (c: PgColumn) => sql.raw(`excluded."${c.name}"`);
  const hasVersion = all.some((c) => c.name === 'version');
  const insert = db.insert(table).values(rows as Record<string, unknown>[]);
  const result = update
    ? await insert
        .onConflictDoUpdate({
          target: key,
          set: {
            ...Object.fromEntries(
              Object.entries(getTableColumns(table))
                .filter(([, c]) => columns.includes(c))
                .map(([name, c]) => [name, excluded(c)]),
            ),
            updatedAt: sql`now()`,
            ...(hasVersion ? { version: sql`${own('version')} + 1` } : {}),
          },
          setWhere: sql`${own('updated_by')} is null and (${sql.join(
            columns.map((c) => own(c.name)),
            sql`, `,
          )}) is distinct from (${sql.join(columns.map(excluded), sql`, `)})`,
        })
        .returning({ key, inserted: sql<boolean>`(xmax = 0)` })
    : await insert.onConflictDoNothing().returning({ key, inserted: sql<boolean>`true` });
  const inserted = result.filter((r) => r.inserted).map((r) => String(r.key));
  const report = {
    inserted: inserted.length,
    updated: result.length - inserted.length,
    unchanged: rows.length - result.length,
  };
  if (!update) return { report, seeded: inserted };
  const edited = new Set(
    (
      await db
        .select({ key })
        .from(table)
        .where(isNotNull(own('updated_by')))
    ).map((r) => String(r.key)),
  );
  const keyName = Object.entries(getTableColumns(table)).find(([, c]) => c === key)![0];
  const seeded = (rows as Record<string, unknown>[])
    .map((r) => String(r[keyName]))
    .filter((k) => !edited.has(k));
  return { report, seeded };
}

/**
 * Связи записей (виды отчётов → режимы, основания; льготы → виды, УГНС, сроки) у записей `scope`:
 * становятся как в refDB.json (прежние удаляются, недостающие добавляются).
 */
async function syncLinks(
  db: Db,
  table: PgTable,
  owner: PgColumn,
  rows: readonly object[],
  scope: string[],
): Promise<void> {
  if (!scope.length) return;
  const ownerKey = Object.entries(getTableColumns(table)).find(([, c]) => c === owner)![0];
  const wanted = (rows as Record<string, unknown>[]).filter((r) =>
    scope.includes(String(r[ownerKey])),
  );
  await db.delete(table).where(inArray(owner, scope));
  if (wanted.length) await db.insert(table).values(wanted).onConflictDoNothing();
}

/** Справочники для контрагентов и отчётов из refDB.json → свои таблицы. */
export async function seedPlatformDicts(
  db: Db,
  refDB: unknown,
  options: SeedOptions,
): Promise<PlatformDictsReport> {
  const rows = platformDictRows(refDB);
  const { update } = options;
  const authority = await upsertDict(db, authorities, authorities.code, rows.authorities, update);
  const regime = await upsertDict(db, taxRegimes, taxRegimes.code, rows.taxRegimes, update);
  const base = await upsertDict(db, reportBases, reportBases.code, rows.reportBases, update);
  const office = await upsertDict(db, taxOffices, taxOffices.code, rows.taxOffices, update);
  const type = await upsertDict(db, reportTypes, reportTypes.code, rows.reportTypes, update);
  await syncLinks(
    db,
    reportTypeRegimes,
    reportTypeRegimes.reportTypeCode,
    rows.reportTypeRegimes,
    type.seeded,
  );
  await syncLinks(
    db,
    reportTypeBases,
    reportTypeBases.reportTypeCode,
    rows.reportTypeBases,
    type.seeded,
  );
  const benefit = await upsertDict(db, taxBenefits, taxBenefits.code, rows.taxBenefits, update);
  await syncLinks(
    db,
    taxBenefitReportTypes,
    taxBenefitReportTypes.benefitCode,
    rows.taxBenefitReportTypes,
    benefit.seeded,
  );
  await syncLinks(
    db,
    taxBenefitOffices,
    taxBenefitOffices.benefitCode,
    rows.taxBenefitOffices,
    benefit.seeded,
  );
  await syncLinks(
    db,
    taxBenefitDueRules,
    taxBenefitDueRules.benefitCode,
    rows.taxBenefitDueRules,
    benefit.seeded,
  );
  const form = await upsertDict(
    db,
    ownershipForms,
    ownershipForms.code,
    rows.ownershipForms,
    update,
  );
  const enRate = await upsertDict(
    db,
    singleTaxRates,
    singleTaxRates.code,
    rows.singleTaxRates,
    update,
  );
  const reason = await upsertDict(
    db,
    dueChangeReasons,
    dueChangeReasons.code,
    rows.dueChangeReasons,
    update,
  );
  const calendar = await upsertDict(
    db,
    productionCalendar,
    productionCalendar.day,
    rows.productionCalendar,
    update,
  );
  if (update) {
    // Календарь сопоставляется по дате: перенесённая в refDB.json дата (например, предварительная дата
    // айта) не должна остаться праздником. Удаляются только дни из наполнения — не заведённые и не
    // поправленные в Админке.
    const removed = await db
      .delete(productionCalendar)
      .where(
        and(
          isNull(productionCalendar.createdBy),
          isNull(productionCalendar.updatedBy),
          notInArray(
            productionCalendar.day,
            rows.productionCalendar.map((r) => r.day),
          ),
        ),
      )
      .returning({ day: productionCalendar.day });
    calendar.report.removed = removed.length;
  }
  return {
    authorities: authority.report,
    taxRegimes: regime.report,
    reportBases: base.report,
    taxOffices: office.report,
    reportTypes: type.report,
    taxBenefits: benefit.report,
    ownershipForms: form.report,
    singleTaxRates: enRate.report,
    dueChangeReasons: reason.report,
    productionCalendar: calendar.report,
  };
}
