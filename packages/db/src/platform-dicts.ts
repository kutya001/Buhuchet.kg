import type {
  AuthorityContact,
  BenefitEffect,
  BenefitKind,
  BenefitSuggest,
  BizSize,
  CalendarEntry,
  DueFrom,
  GkedRule,
  PayerKind,
  PickGroup,
  RateAddition,
  RegimeKind,
  ReportAct,
  ReportKind,
  ReportPayment,
  ReportPeriod,
} from '@buhuchet/domain';
import { asc, eq, getTableName, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Db, Tx } from './client';
import {
  authorities,
  productionCalendar,
  reportBases,
  reportTypeBases,
  reportTypeRegimes,
  reportTypes,
  taxBenefitDueRules,
  taxBenefitOffices,
  taxBenefitReportTypes,
  taxBenefits,
  taxOffices,
  taxRegimes,
} from './schema';

/*
 * Справочники платформы для форм и списков организаций (задача #20): только чтение, по порядку
 * справочника. По умолчанию — только действующие значения: отключённое не предлагается в новых записях
 * (ТЗ «Справочники платформы» → «Общие правила»). `all` — со отключёнными: в уже созданных записях
 * значение показывается как есть, Админка видит весь справочник.
 */

export interface DictListOptions {
  /** Со отключёнными значениями. */
  all?: boolean;
}

const activeOnly = (column: AnyPgColumn, options: DictListOptions): SQL | undefined =>
  options.all ? undefined : eq(column, true);

/** Коды связанных записей по порядку справочника, на который ссылается связь. */
const codesOf = (query: SQL): SQL<string[]> => sql<string[]>`array(${query})`;

/**
 * Столбец внешней строки в подзапросе — с именем таблицы: в выборке из одной таблицы drizzle пишет
 * столбцы без него, и «code» в подзапросе нашёл бы столбец таблицы подзапроса.
 */
const outer = (column: AnyPgColumn): SQL =>
  sql.raw(`"${getTableName(column.table)}"."${column.name}"`);

export interface AuthorityRecord {
  code: string;
  name: string;
  description: string;
  contacts: AuthorityContact[];
  hours: string;
  site: string;
  contactsNote: string;
  active: boolean;
}

/** «Органы». */
export async function listAuthorities(
  db: Db | Tx,
  options: DictListOptions = {},
): Promise<AuthorityRecord[]> {
  return db
    .select({
      code: authorities.code,
      name: authorities.name,
      description: authorities.description,
      contacts: authorities.contacts,
      hours: authorities.hours,
      site: authorities.site,
      contactsNote: authorities.contactsNote,
      active: authorities.active,
    })
    .from(authorities)
    .where(activeOnly(authorities.active, options))
    .orderBy(asc(authorities.sortOrder), asc(authorities.code));
}

export interface TaxRegimeRecord {
  code: string;
  name: string;
  fullName: string;
  kind: RegimeKind;
  frees: string;
  who: string;
  how: string;
  combines: string;
  accountantNote: string;
  article: string;
  gked: GkedRule | null;
  active: boolean;
}

/** «Режимы налогообложения». */
export async function listTaxRegimes(
  db: Db | Tx,
  options: DictListOptions = {},
): Promise<TaxRegimeRecord[]> {
  return db
    .select({
      code: taxRegimes.code,
      name: taxRegimes.name,
      fullName: taxRegimes.fullName,
      kind: taxRegimes.kind,
      frees: taxRegimes.frees,
      who: taxRegimes.who,
      how: taxRegimes.how,
      combines: taxRegimes.combines,
      accountantNote: taxRegimes.accountantNote,
      article: taxRegimes.article,
      gked: taxRegimes.gked,
      active: taxRegimes.active,
    })
    .from(taxRegimes)
    .where(activeOnly(taxRegimes.active, options))
    .orderBy(asc(taxRegimes.sortOrder), asc(taxRegimes.code));
}

export interface ReportBaseRecord {
  code: string;
  name: string;
  description: string;
  note: string;
  /** Виды отчётов с этим основанием (по полю «Основание» вида), по порядку каталога. */
  reportTypes: string[];
  active: boolean;
}

/** «Основания для отчётов». */
export async function listReportBases(
  db: Db | Tx,
  options: DictListOptions = {},
): Promise<ReportBaseRecord[]> {
  return db
    .select({
      code: reportBases.code,
      name: reportBases.name,
      description: reportBases.description,
      note: reportBases.note,
      reportTypes: codesOf(
        sql`select l.report_type_code from ${reportTypeBases} l
          join ${reportTypes} t on t.code = l.report_type_code
          where l.base_code = ${outer(reportBases.code)} order by t.sort_order, t.code`,
      ),
      active: reportBases.active,
    })
    .from(reportBases)
    .where(activeOnly(reportBases.active, options))
    .orderBy(asc(reportBases.sortOrder), asc(reportBases.code));
}

export interface TaxOfficeRecord {
  code: string;
  name: string;
  shortName: string;
  gnsCode: string | null;
  region: string;
  verify: boolean;
  note: string;
  active: boolean;
}

/** «Налоговые органы (УГНС)». */
export async function listTaxOffices(
  db: Db | Tx,
  options: DictListOptions = {},
): Promise<TaxOfficeRecord[]> {
  return db
    .select({
      code: taxOffices.code,
      name: taxOffices.name,
      shortName: taxOffices.shortName,
      gnsCode: taxOffices.gnsCode,
      region: taxOffices.region,
      verify: taxOffices.verify,
      note: taxOffices.note,
      active: taxOffices.active,
    })
    .from(taxOffices)
    .where(activeOnly(taxOffices.active, options))
    .orderBy(asc(taxOffices.sortOrder), asc(taxOffices.code));
}

export interface ReportTypeRecord {
  code: string;
  name: string;
  shortName: string;
  formCode: string;
  statIndex: string;
  respondents: string;
  authorityCode: string;
  period: ReportPeriod;
  dueDay: number;
  dueAfter: number | null;
  dueMonth: number | null;
  dueFrom: DueFrom;
  payDay: number | null;
  payAfter: number | null;
  payMonth: number | null;
  paySchedule: [number, number][] | null;
  shiftToWorkday: boolean;
  skipQuarters: number[];
  oneOff: boolean;
  eventLabel: string;
  periodPerAssignment: boolean;
  act: ReportAct;
  payments: ReportPayment[];
  kind: ReportKind;
  payer: PayerKind;
  /** «Применимые режимы». */
  regimes: string[];
  /** «Не для режимов». */
  notForRegimes: string[];
  /** «Основание». */
  bases: string[];
  rates: string[];
  rateAdditions: RateAddition[];
  notForEnRates: string[];
  bizSizes: BizSize[];
  pickGroup: PickGroup;
  preselect: boolean;
  choiceNote: string;
  pickHint: string;
  description: string;
  clientNote: string;
  article: string;
  note: string;
  source: string;
  verify: boolean;
  verifyNote: string;
  gnsCheckedAt: string | null;
  gnsCheckedBy: string;
  gked: GkedRule | null;
  active: boolean;
}

const regimesOf = (relation: 'applies' | 'excludes') =>
  codesOf(
    sql`select l.regime_code from ${reportTypeRegimes} l
      join ${taxRegimes} r on r.code = l.regime_code
      where l.report_type_code = ${outer(reportTypes.code)} and l.relation = ${sql.raw(`'${relation}'`)}
      order by r.sort_order, r.code`,
  );

/** «Виды отчётов» — единый каталог. */
export async function listReportTypes(
  db: Db | Tx,
  options: DictListOptions = {},
): Promise<ReportTypeRecord[]> {
  const rows = await db
    .select({
      code: reportTypes.code,
      name: reportTypes.name,
      shortName: reportTypes.shortName,
      formCode: reportTypes.formCode,
      statIndex: reportTypes.statIndex,
      respondents: reportTypes.respondents,
      authorityCode: reportTypes.authorityCode,
      period: reportTypes.period,
      dueDay: reportTypes.dueDay,
      dueAfter: reportTypes.dueAfter,
      dueMonth: reportTypes.dueMonth,
      dueFrom: reportTypes.dueFrom,
      payDay: reportTypes.payDay,
      payAfter: reportTypes.payAfter,
      payMonth: reportTypes.payMonth,
      paySchedule: reportTypes.paySchedule,
      shiftToWorkday: reportTypes.shiftToWorkday,
      skipQuarters: reportTypes.skipQuarters,
      oneOff: reportTypes.oneOff,
      eventLabel: reportTypes.eventLabel,
      periodPerAssignment: reportTypes.periodPerAssignment,
      act: reportTypes.act,
      payments: reportTypes.payments,
      kind: reportTypes.kind,
      payer: reportTypes.payer,
      regimes: regimesOf('applies'),
      notForRegimes: regimesOf('excludes'),
      bases: codesOf(
        sql`select l.base_code from ${reportTypeBases} l
          join ${reportBases} b on b.code = l.base_code
          where l.report_type_code = ${outer(reportTypes.code)} order by b.sort_order, b.code`,
      ),
      rates: reportTypes.rates,
      rateAdditions: reportTypes.rateAdditions,
      notForEnRates: reportTypes.notForEnRates,
      bizSizes: reportTypes.bizSizes,
      pickGroup: reportTypes.pickGroup,
      preselect: reportTypes.preselect,
      choiceNote: reportTypes.choiceNote,
      pickHint: reportTypes.pickHint,
      description: reportTypes.description,
      clientNote: reportTypes.clientNote,
      article: reportTypes.article,
      note: reportTypes.note,
      source: reportTypes.source,
      verify: reportTypes.verify,
      verifyNote: reportTypes.verifyNote,
      gnsCheckedAt: reportTypes.gnsCheckedAt,
      gnsCheckedBy: reportTypes.gnsCheckedBy,
      gked: reportTypes.gked,
      active: reportTypes.active,
    })
    .from(reportTypes)
    .where(activeOnly(reportTypes.active, options))
    .orderBy(asc(reportTypes.sortOrder), asc(reportTypes.code));
  return rows.map((r) => ({ ...r, bizSizes: r.bizSizes as BizSize[] }));
}

export interface BenefitDueRule {
  reportType: string;
  dueDay: number | null;
  dueAfter: number | null;
  dueMonth: number | null;
  payDay: number | null;
  payAfter: number | null;
}

export interface TaxBenefitRecord {
  code: string;
  name: string;
  kind: BenefitKind;
  gives: string;
  article: string;
  payer: PayerKind;
  conditions: string;
  confirmation: string;
  combines: string;
  term: string;
  validUntil: string | null;
  verify: boolean;
  verifyNote: string;
  gked: GkedRule | null;
  gkedMainOnly: boolean;
  taxCode: string;
  suggest: BenefitSuggest | null;
  /** Виды отчётов, которые статус добавляет. */
  adds: string[];
  /** Виды отчётов, которые статус делает ненужными. */
  removes: string[];
  /** «Ставится по УГНС». */
  taxOffices: string[];
  /** «Меняет сроки». */
  dueRules: BenefitDueRule[];
  active: boolean;
}

const typesOf = (effect: BenefitEffect) =>
  codesOf(
    sql`select l.report_type_code from ${taxBenefitReportTypes} l
      join ${reportTypes} t on t.code = l.report_type_code
      where l.benefit_code = ${outer(taxBenefits.code)} and l.effect = ${sql.raw(`'${effect}'`)}
      order by t.sort_order, t.code`,
  );

/** «Налоговые льготы и особые статусы». */
export async function listTaxBenefits(
  db: Db | Tx,
  options: DictListOptions = {},
): Promise<TaxBenefitRecord[]> {
  return db
    .select({
      code: taxBenefits.code,
      name: taxBenefits.name,
      kind: taxBenefits.kind,
      gives: taxBenefits.gives,
      article: taxBenefits.article,
      payer: taxBenefits.payer,
      conditions: taxBenefits.conditions,
      confirmation: taxBenefits.confirmation,
      combines: taxBenefits.combines,
      term: taxBenefits.term,
      validUntil: taxBenefits.validUntil,
      verify: taxBenefits.verify,
      verifyNote: taxBenefits.verifyNote,
      gked: taxBenefits.gked,
      gkedMainOnly: taxBenefits.gkedMainOnly,
      taxCode: taxBenefits.taxCode,
      suggest: taxBenefits.suggest,
      adds: typesOf('adds'),
      removes: typesOf('removes'),
      taxOffices: codesOf(
        sql`select l.tax_office_code from ${taxBenefitOffices} l
          join ${taxOffices} o on o.code = l.tax_office_code
          where l.benefit_code = ${outer(taxBenefits.code)} order by o.sort_order, o.code`,
      ),
      dueRules: sql<BenefitDueRule[]>`coalesce((select json_agg(json_build_object(
          'reportType', l.report_type_code, 'dueDay', l.due_day, 'dueAfter', l.due_after,
          'dueMonth', l.due_month, 'payDay', l.pay_day, 'payAfter', l.pay_after
        ) order by t.sort_order, t.code)
        from ${taxBenefitDueRules} l join ${reportTypes} t on t.code = l.report_type_code
        where l.benefit_code = ${outer(taxBenefits.code)}), '[]'::json)`,
      active: taxBenefits.active,
    })
    .from(taxBenefits)
    .where(activeOnly(taxBenefits.active, options))
    .orderBy(asc(taxBenefits.sortOrder), asc(taxBenefits.code));
}

/** Производственный календарь целиком: правила — `isWorkingDay`, `nextWorkingDay`, `calendarYear`. */
export async function productionCalendarEntries(db: Db | Tx): Promise<CalendarEntry[]> {
  return db
    .select({
      day: productionCalendar.day,
      kind: productionCalendar.kind,
      name: productionCalendar.name,
    })
    .from(productionCalendar)
    .orderBy(asc(productionCalendar.day));
}
