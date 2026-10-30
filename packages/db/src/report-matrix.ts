import {
  activeSingleTax,
  assignmentRateText,
  defaultSingleTaxRates,
  dueRuleText,
  endsWithAssignment,
  gkedFitOf,
  incompatibilityText,
  isSingleTaxType,
  RecordNotFoundError,
  typeIncompatibility,
  type AssignmentEnRate,
  type CompatibilityRate,
  type ContractorRegistration,
  type CompatibilitySubject,
  type GkedRule,
  type GkedSubject,
  type IsoDate,
  type PayerKind,
  type ReportKind,
  type Translate,
} from '@buhuchet/domain';
import { and, asc, eq, inArray, isNull, ne, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { contractorGkedDicts } from './contractors';
import { searchCondition, type ListColumns } from './list';
import { reportTypeInfos, singleTaxRateRows } from './reports';
import {
  assignments,
  authorities,
  contractorBenefits,
  contractorGkedExtra,
  contractors,
  orgReportTypes,
  ownershipForms,
  reports,
  reportTypeRegimes,
  reportTypes,
  taxOffices,
  taxRegimes,
} from './schema';

/*
 * «Кто что сдаёт» и окно «Назначить отчёт нескольким контрагентам» (задача 2.15; ТЗ «Назначение отчётов
 * контрагентам» → «Массово» и «Вкладка «Кто что сдаёт»»; прототип modules/reports.js `renderMatrix`,
 * modules/contractors.js `massAssignDlg`, `unassignDlg`): контрагенты в области «Свои» без архивных,
 * виды, подключённые в организации, действующие назначения и почему вид не подходит. Назначает и
 * снимает `createAssignment` и `endAssignment`.
 */

const regime1 = alias(taxRegimes, 'mx_regime1');
const regime2 = alias(taxRegimes, 'mx_regime2');

/** Действующее назначение контрагента. */
interface ActiveAssignment {
  id: string;
  version: number;
  reportTypeCode: string;
  enRates: AssignmentEnRate[];
}

/** Контрагент сетки и окна массового назначения: всё, что нужно для проверок и ставки по ГКЭД. */
interface Assignee {
  id: string;
  name: string;
  inn: string;
  kind: string;
  regimes: { code: string; name: string }[];
  form: { code: string; declarationFor: 'org' | 'ip' };
  gked: string | null;
  gkedExtra: string[];
  benefits: string[];
  place: string;
  assignments: ActiveAssignment[];
}

/** Поиск над сеткой: название и ИНН, как поиск списков (без регистра и «ё», ИНН — и без пробелов). */
const SEARCH_COLUMNS: ListColumns = {
  name: { type: 'text', label: 'report.col.cp', value: contractors.name },
  inn: { type: 'text', label: 'report.col.inn', value: contractors.inn, compact: true },
};

/**
 * Контрагенты в области `scope` без архивных (прототип `visCps(false, 'reports')`) по названию, с
 * режимами, формой собственности, ГКЭД, статусами, местом деятельности и действующими назначениями.
 */
async function assignees(tx: Tx, scope: SQL | undefined, q?: string): Promise<Assignee[]> {
  const rows = await tx
    .select({
      id: contractors.id,
      name: contractors.name,
      inn: contractors.inn,
      kind: contractors.kind,
      formCode: contractors.formCode,
      declarationFor: ownershipForms.declarationFor,
      regime: regime1.code,
      regimeName: regime1.name,
      regime2: regime2.code,
      regime2Name: regime2.name,
      gked: contractors.gked,
      region: taxOffices.region,
      registration: contractors.registration,
    })
    .from(contractors)
    .innerJoin(ownershipForms, eq(ownershipForms.code, contractors.formCode))
    .leftJoin(regime1, eq(regime1.code, contractors.regimeCode))
    .leftJoin(regime2, eq(regime2.code, contractors.regime2Code))
    .leftJoin(taxOffices, eq(taxOffices.code, contractors.taxOfficeCode))
    .where(
      and(
        ne(contractors.serviceStatus, 'archived'),
        scope,
        q ? searchCondition(SEARCH_COLUMNS, { q, keys: [] }) : undefined,
      ),
    )
    .orderBy(asc(contractors.name), asc(contractors.id));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [extra, benefits, active] = await Promise.all([
    tx
      .select({ contractorId: contractorGkedExtra.contractorId, code: contractorGkedExtra.gked })
      .from(contractorGkedExtra)
      .where(inArray(contractorGkedExtra.contractorId, ids))
      .orderBy(asc(contractorGkedExtra.sortOrder)),
    tx
      .select({
        contractorId: contractorBenefits.contractorId,
        code: contractorBenefits.benefitCode,
      })
      .from(contractorBenefits)
      .where(inArray(contractorBenefits.contractorId, ids)),
    tx
      .select({
        id: assignments.id,
        version: assignments.version,
        contractorId: assignments.contractorId,
        reportTypeCode: assignments.reportTypeCode,
        enRates: assignments.enRates,
      })
      .from(assignments)
      .where(and(inArray(assignments.contractorId, ids), isNull(assignments.endedOn)))
      .orderBy(asc(assignments.createdAt), asc(assignments.id)),
  ]);
  const group = <T extends { contractorId: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of list) m.set(x.contractorId, [...(m.get(x.contractorId) ?? []), x]);
    return m;
  };
  const extraOf = group(extra);
  const benefitsOf = group(benefits);
  const activeOf = group(active);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    inn: r.inn,
    kind: r.kind,
    regimes: [
      ...(r.regime ? [{ code: r.regime, name: r.regimeName! }] : []),
      ...(r.regime2 ? [{ code: r.regime2, name: r.regime2Name! }] : []),
    ],
    form: { code: r.formCode, declarationFor: r.declarationFor },
    gked: r.gked,
    gkedExtra: (extraOf.get(r.id) ?? []).map((x) => x.code),
    benefits: (benefitsOf.get(r.id) ?? []).map((x) => x.code),
    place: [r.region, (r.registration as ContractorRegistration).address ?? '']
      .filter(Boolean)
      .join(' '),
    assignments: (activeOf.get(r.id) ?? []).map((a) => ({
      id: a.id,
      version: a.version,
      reportTypeCode: a.reportTypeCode,
      enRates: a.enRates as AssignmentEnRate[],
    })),
  }));
}

/** Режимы контрагента словами: «ОНР + Патент» (прототип `c.regime`); пусто — не указан. */
const regimeText = (c: Assignee) => c.regimes.map((r) => r.name).join(' + ') || null;

/** Вид, подключённый в организации: подходит ли контрагенту, ставки, правило ГКЭД, орган. */
interface ConnectedType {
  code: string;
  name: string;
  shortName: string;
  active: boolean;
  payer: PayerKind;
  kind: ReportKind;
  regimes: string[];
  rates: string[];
  gked: GkedRule | null;
  organ: string;
}

/** Виды, подключённые в организации, по порядку каталога (прототип `RT.filter(… ORG.types[t.id].on)`). */
async function connectedTypes(tx: Tx, activeOnly: boolean): Promise<ConnectedType[]> {
  const rows = await tx
    .select({
      code: reportTypes.code,
      name: reportTypes.name,
      shortName: reportTypes.shortName,
      active: reportTypes.active,
      payer: reportTypes.payer,
      kind: reportTypes.kind,
      rates: reportTypes.rates,
      gked: reportTypes.gked,
      organ: authorities.name,
    })
    .from(reportTypes)
    .innerJoin(orgReportTypes, eq(orgReportTypes.reportTypeCode, reportTypes.code))
    .innerJoin(authorities, eq(authorities.code, reportTypes.authorityCode))
    .where(
      and(eq(orgReportTypes.enabled, true), activeOnly ? eq(reportTypes.active, true) : undefined),
    )
    .orderBy(asc(reportTypes.sortOrder), asc(reportTypes.code));
  if (rows.length === 0) return [];
  const regimes = await tx
    .select({ type: reportTypeRegimes.reportTypeCode, code: reportTypeRegimes.regimeCode })
    .from(reportTypeRegimes)
    .where(
      inArray(
        reportTypeRegimes.reportTypeCode,
        rows.map((r) => r.code),
      ),
    );
  return rows.map((r) => ({
    ...r,
    rates: r.rates ?? [],
    gked: r.gked ?? null,
    regimes: regimes.filter((x) => x.type === r.code).map((x) => x.code),
  }));
}

/**
 * Ставка нового назначения из сетки и окна (прототип assignTypes: `rates[Math.min(1, rates.length - 1)]`
 * — вторая ставка вида или единственная); у единого налога — строки ЕНС по ГКЭД (их ставит сервер).
 */
export function defaultAssignmentRate(type: { code: string; rates: readonly string[] }) {
  if (isSingleTaxType(type.code) || type.rates.length === 0) return null;
  return type.rates[Math.min(1, type.rates.length - 1)]!;
}

/** Контрагент для проверки «подходит ли вид». */
const compatibilityOf = (c: Assignee): CompatibilitySubject => ({
  form: c.form,
  regimes: c.regimes,
  singleTax: activeSingleTax(c.assignments.map((a) => ({ ...a, endedOn: null }))),
});

/** Почему вид не назначается контрагенту (прототип `compatible`); разовому — регулярные не назначаются. */
function whyNot(
  type: ConnectedType,
  c: Assignee,
  rates: readonly CompatibilityRate[],
  today: IsoDate,
  t: Translate,
): string | null {
  if (c.kind === 'oneoff') return t('err.contractor_oneoff');
  const why = typeIncompatibility(type, compatibilityOf(c), rates, today, t);
  return why ? incompatibilityText(why, t) : null;
}

export interface ReportMatrixResult {
  types: {
    code: string;
    name: string;
    shortName: string;
    active: boolean;
    defaultRate: string | null;
  }[];
  rows: {
    contractor: { id: string; name: string; inn: string; regime: string | null };
    cells: {
      assignment: { id: string; version: number } | null;
      why: string | null;
    }[];
  }[];
}

/**
 * Сетка «Кто что сдаёт» (прототип renderMatrix): строки — контрагенты, столбцы — подключённые виды, в
 * клетке — действующее назначение и почему вид не подходит (заштрихованная клетка).
 */
export async function reportMatrix(
  tx: Tx,
  options: { scope: SQL | undefined; q?: string; today: IsoDate; t: Translate },
): Promise<ReportMatrixResult> {
  const [types, cps, rates] = await Promise.all([
    connectedTypes(tx, false),
    assignees(tx, options.scope, options.q),
    singleTaxRateRows(tx),
  ]);
  return {
    types: types.map((x) => ({
      code: x.code,
      name: x.name,
      shortName: x.shortName,
      active: x.active,
      defaultRate: defaultAssignmentRate(x),
    })),
    rows: cps.map((c) => ({
      contractor: { id: c.id, name: c.name, inn: c.inn, regime: regimeText(c) },
      cells: types.map((type) => {
        const a = c.assignments.find((x) => x.reportTypeCode === type.code);
        return {
          assignment: a ? { id: a.id, version: a.version } : null,
          why: whyNot(type, c, rates, options.today, options.t),
        };
      }),
    })),
  };
}

export interface MassAssignOptions {
  types: { code: string; name: string; organ: string }[];
  type: {
    code: string;
    name: string;
    shortName: string;
    dueText: string;
    rates: string[];
    defaultRate: string | null;
    singleTax: boolean;
  } | null;
  contractors: {
    id: string;
    name: string;
    regime: string | null;
    assigned: boolean;
    why: string | null;
    singleTaxRate: string | null;
    gkedFit: boolean;
  }[];
}

/**
 * Окно «Назначить отчёт нескольким контрагентам» (прототип massAssignDlg): подключённые действующие
 * виды, выбранный (по умолчанию — НДС, иначе первый) и контрагенты: уже сдаёт, не подходит (причина),
 * какие строки ЕНС встанут у единого налога, подходит ли вид по ГКЭД.
 */
export async function massAssignOptions(
  tx: Tx,
  code: string | undefined,
  options: { scope: SQL | undefined; today: IsoDate; t: Translate },
): Promise<MassAssignOptions> {
  const types = await connectedTypes(tx, true);
  const type =
    types.find((x) => x.code === code) ??
    (code ? undefined : (types.find((x) => x.code === 'nds') ?? types[0]));
  const list = types.map((x) => ({ code: x.code, name: x.name, organ: x.organ }));
  if (!type) return { types: list, type: null, contractors: [] };
  const [cps, rates, info] = await Promise.all([
    assignees(tx, options.scope),
    singleTaxRateRows(tx),
    reportTypeInfos(tx, [type.code]),
  ]);
  const singleTax = isSingleTaxType(type.code);
  const dicts = await contractorGkedDicts(tx, [
    ...new Set(cps.flatMap((c) => [c.gked, ...c.gkedExtra].filter((x): x is string => !!x))),
  ]);
  return {
    types: list,
    type: {
      code: type.code,
      name: type.name,
      shortName: type.shortName,
      dueText: dueRuleText(info.get(type.code)!, options.t),
      rates: type.rates,
      defaultRate: defaultAssignmentRate(type),
      singleTax,
    },
    contractors: cps.map((c) => {
      const assigned = c.assignments.some((a) => a.reportTypeCode === type.code);
      const why = assigned ? null : whyNot(type, c, rates, options.today, options.t);
      const free = !assigned && !why;
      const subject: GkedSubject = {
        gked: c.gked,
        gkedExtra: c.gkedExtra,
        form: c.form,
        regimes: c.regimes.map((r) => r.code),
        benefits: c.benefits,
      };
      return {
        id: c.id,
        name: c.name,
        regime: regimeText(c),
        assigned,
        why,
        singleTaxRate:
          free && singleTax
            ? assignmentRateText(
                {
                  reportTypeCode: type.code,
                  rate: null,
                  rateAdditions: [],
                  enRates: defaultSingleTaxRates(c, dicts.rates, dicts.index),
                },
                { rateAdditions: [] },
                rates,
                { date: options.today, short: true },
                options.t,
              )
            : null,
        gkedFit: free && !!gkedFitOf(type.gked, subject, dicts.index).fit?.length,
      };
    }),
  };
}

/**
 * Сколько будущих несданных отчётов получат «Не требуется», если снять назначение сегодня (прототип
 * unassignDlg: «Будущих несданных отчётов: N»), — то же условие, что у `endAssignment`.
 */
export async function assignmentEndPreview(
  tx: Tx,
  id: string,
  options: { scope: SQL | undefined; today: IsoDate },
): Promise<number> {
  const [a] = await tx
    .select({ contractorId: assignments.contractorId, code: assignments.reportTypeCode })
    .from(assignments)
    .innerJoin(contractors, eq(contractors.id, assignments.contractorId))
    .where(and(eq(assignments.id, id), options.scope));
  if (!a) throw new RecordNotFoundError('assignment', id);
  const list = await tx
    .select({ status: reports.status, dueDate: reports.dueDate })
    .from(reports)
    .where(
      and(
        eq(reports.contractorId, a.contractorId),
        eq(reports.reportTypeCode, a.code),
        eq(reports.superseded, false),
      ),
    );
  return list.filter((r) => endsWithAssignment(r, options.today)).length;
}
