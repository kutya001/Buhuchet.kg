import { addMonths, monthRange, type YearMonth } from '../common/months';
import type { Tyiyn } from '../common/money';
import type { SocfundTariff } from '../contractors/socfund';
import type { ReportAct, ReportPeriod } from '../platform-dicts/catalog';
import { lineTax, reportHasAmount } from '../reports/submit';
import type { IndicatorTaxRole, IndicatorValue } from './indicators';

/*
 * Показатели в расчёте налогов (прототип v80 modules/kpi-tax.js: kTaxNeed, kRepMs, kTaxBase, kTaxSoc,
 * kRevPct, kTaxHtml): окна «Сумма к уплате» и «Отметить сданным» берут базу налога из показателей
 * контрагента за месяцы периода отчёта. Расчёт — подсказка: суммы подставляются в поля окна кнопкой
 * «Подставить», сохраняет их сотрудник. ТЗ блока ещё не описывает — docs/deviations.md п. О-62.
 *
 * Значения показателей — сотые (`IndicatorValue`): у выручки и ФОТ это тыйыны, у численности — человек
 * × 100. Суммы расчёта — тыйыны, округлённые до сома, как в прототипе.
 */

/** Виды отчётов, у которых база налога — выручка (прототип KTX_REV); у НДС выручка — справочно. */
export const TAX_REVENUE_REPORT_TYPES: readonly string[] = [
  'enq',
  'enm',
  'nspm',
  'nspq',
  'pvt',
  'nds',
];
/** Отчёт «Соцфонд»: подоходный налог и страховые взносы от ФОТ. */
export const TAX_SOCFUND_REPORT_TYPE = 'soc';
const TAX_VAT_REPORT_TYPE = 'nds';
const TAX_PVT_REPORT_TYPE = 'pvt';
/** Отчисления резидента ПВТ / ПКИ, когда ставки в назначении нет. */
const TAX_PVT_RATE = '1 %';
/** Подоходный налог у резидента ПВТ / ПКИ и общая ставка, если её нет в «Налогах и ставках». */
const INCOME_RATE_RESIDENT = 5;
const INCOME_RATE_DEFAULT = 10;

/** Процент числом: «4 %» → 4, «12,25 %» → 12.25; не число — 0 (прототип pctNum). */
const pctNumber = (pct: string) => Number.parseFloat(pct.replace(',', '.')) || 0;

/**
 * Какие показатели нужны отчёту (прототип kTaxNeed): «Соцфонд» — ФОТ и численность, виды с налогом от
 * выручки — выручка; первый — основной (без него расчёта нет). У вида без суммы и у остальных — null.
 */
export function reportTaxRoles(typeCode: string, act: ReportAct): IndicatorTaxRole[] | null {
  if (!reportHasAmount(act)) return null;
  if (typeCode === TAX_SOCFUND_REPORT_TYPE) return ['fot', 'emp'];
  return TAX_REVENUE_REPORT_TYPES.includes(typeCode) ? ['rev'] : null;
}

const PERIOD_MONTHS: Readonly<Record<ReportPeriod, number>> = { M: 1, Q: 3, H: 6, Y: 12 };

/** Месяцы периода отчёта (прототип kRepMs): период начинается не с первого числа — месяцев нет. */
export function reportTaxMonths(period: ReportPeriod, periodStart: string): YearMonth[] {
  if (!/^\d{4}-\d{2}-01$/.test(periodStart)) return [];
  const first = periodStart.slice(0, 7);
  return monthRange(first, addMonths(first, PERIOD_MONTHS[period] - 1));
}

/** Значения показателя за месяцы периода: сумма заполненных и месяцы без значения. */
export interface TaxBase {
  values: (IndicatorValue | null)[];
  sum: number;
  missing: YearMonth[];
}

export function taxBase(
  months: readonly YearMonth[],
  valueOf: (month: YearMonth) => IndicatorValue | null,
): TaxBase {
  const values = months.map(valueOf);
  return {
    values,
    sum: values.reduce<number>((a, v) => a + (v ?? 0), 0),
    missing: months.filter((_, j) => values[j] === null),
  };
}

/**
 * «Итого» строки показателя (при периоде длиннее месяца): у выручки и ФОТ — сумма, у численности —
 * среднее по заполненным месяцам, округлённое до человека; ни одного значения — null («—»).
 */
export function taxBaseTotal(role: IndicatorTaxRole, base: TaxBase): IndicatorValue | null {
  const filled = base.values.length - base.missing.length;
  if (filled === 0) return null;
  return role === 'emp' ? Math.round(base.sum / 100 / filled) * 100 : base.sum;
}

/** Расчёт подоходного налога и взносов по ФОТ. */
export interface SocfundTax {
  /** Подоходный налог, тыйыны (до сома). */
  incomeTax: Tyiyn;
  /** Страховые взносы, тыйыны (до сома). */
  contributions: Tyiyn;
  /** Ставка подоходного налога, %. */
  incomeRate: number;
  /** Взносы работника, % — вычитаются из базы подоходного налога. */
  workerRate: number;
  /** База хотя бы одного месяца ограничена пределом на работника. */
  capped: boolean;
  /** Предельная база на работника в месяц, тыйыны; 0 — предела у тарифа нет. */
  cap: Tyiyn;
}

/**
 * Подоходный налог и взносы по ФОТ (прототип kTaxSoc): взносы — тариф от ФОТ месяца, а если внесена
 * численность и ФОТ больше предельной базы на работника × численность — от предела; подоходный налог —
 * ставка от ФОТ за вычетом взносов работника. Ставка налога — первая из «Налогов и ставок» (`rateText`),
 * у тарифа ПВТ / ПКИ — 5 %. Стандартный вычет и вычеты на иждивенцев не учитываются. Месяц без ФОТ
 * пропускается. Считается в сомах, как в прототипе, и округляется до сома.
 */
export function socfundTax(input: {
  tariff: Pick<SocfundTariff, 'id' | 'total' | 'parts' | 'cap'>;
  /** Ставка подоходного налога из «Налогов и ставок» («10 %»); пусто — 10 %. */
  rateText: string;
  fot: readonly (IndicatorValue | null)[];
  /** Численность по месяцам; null — показателя с отметкой «Численность» нет. */
  emp: readonly (IndicatorValue | null)[] | null;
}): SocfundTax {
  const { tariff } = input;
  const incomeRate =
    tariff.id === 'pvtpki'
      ? INCOME_RATE_RESIDENT
      : pctNumber(input.rateText || `${INCOME_RATE_DEFAULT} %`) || INCOME_RATE_DEFAULT;
  const total = pctNumber(tariff.total);
  const worker = tariff.parts.find((p) => /^работник/i.test(p.payer));
  const workerRate = worker ? pctNumber(worker.rate) : 0;
  const capSom = tariff.cap?.base
    ? Number(tariff.cap.base.replace(/[^\d,.]/g, '').replace(',', '.')) || 0
    : 0;
  let contributions = 0;
  let incomeTax = 0;
  let capped = false;
  input.fot.forEach((value, j) => {
    if (value === null) return;
    const fot = value / 100;
    const people = input.emp ? (input.emp[j] ?? null) : null;
    let base = fot;
    if (capSom && people !== null && people > 0 && fot > (capSom * people) / 100) {
      base = (capSom * people) / 100;
      capped = true;
    }
    contributions += (base * total) / 100;
    incomeTax += (Math.max(0, fot - (base * workerRate) / 100) * incomeRate) / 100;
  });
  return {
    incomeTax: Math.round(incomeTax) * 100,
    contributions: Math.round(contributions) * 100,
    incomeRate,
    workerRate,
    capped,
    cap: Math.round(capSom * 100),
  };
}

/**
 * Ставка налога с выручки, когда строк по ставкам нет (прототип kRevPct): у НДС ставки нет (сумма
 * зависит от зачёта); иначе ставка назначения с числом; у отчислений ПВТ без ставки — 1 %; иначе пусто.
 */
export function revenuePct(typeCode: string, assignmentRate: string | null): string {
  if (typeCode === TAX_VAT_REPORT_TYPE) return '';
  if (assignmentRate && /\d/.test(assignmentRate)) return assignmentRate;
  return typeCode === TAX_PVT_REPORT_TYPE ? TAX_PVT_RATE : '';
}

/** Налог от выручки по ставке, до сома (прототип: Math.round(B.sum * pct / 100)). */
export const revenueTax = (revenue: Tyiyn, pct: string): Tyiyn =>
  Math.round(((revenue / 100) * pctNumber(pct)) / 100) * 100;

/** Итог блока «Расчёт по показателям» — что показать под таблицей показателей. */
export type TaxResult =
  /** Нет показателя с отметкой основной роли — только подсказка, где его отметить. */
  | { kind: 'no_indicator' }
  /** Нет значения основного показателя за месяцы. */
  | { kind: 'missing'; indicator: string; months: YearMonth[] }
  /** Тариф Соцфонда у контрагента не определён. */
  | { kind: 'no_tariff' }
  | ({ kind: 'socfund'; tariff: string; total: string } & SocfundTax)
  /** Одна строка по ставке: выручка идёт в неё, налог считает окно. */
  | { kind: 'line'; key: string; label: string; revenue: Tyiyn; tax: Tyiyn }
  /** Несколько строк по ставкам: выручку подставляют в нужную строку. */
  | { kind: 'lines'; revenue: Tyiyn; lines: { key: string; label: string }[] }
  /** Ставки нет: сумму вписывают сами (`vat` — НДС, зависит от зачёта). */
  | { kind: 'no_rate'; revenue: Tyiyn; vat: boolean }
  | { kind: 'rate'; pct: string; revenue: Tyiyn; amount: Tyiyn };

/**
 * Итог блока (прототип kTaxHtml после таблицы): `main` — база основного показателя (null — показателя с
 * отметкой нет); у «Соцфонда» — тариф контрагента (выбранный или по условиям) и численность; у налога
 * от выручки — строки по ставкам отчёта, иначе ставка назначения.
 */
export function taxResult(input: {
  typeCode: string;
  main: { name: string; base: TaxBase } | null;
  socfund?: {
    tariff: (Pick<SocfundTariff, 'id' | 'total' | 'parts' | 'cap'> & { short: string }) | null;
    rateText: string;
    emp: TaxBase | null;
  };
  rateLines: readonly { key: string; label: string; pct: string }[];
  assignmentRate: string | null;
}): TaxResult {
  const { main } = input;
  if (!main) return { kind: 'no_indicator' };
  if (main.base.missing.length) {
    return { kind: 'missing', indicator: main.name, months: main.base.missing };
  }
  if (input.typeCode === TAX_SOCFUND_REPORT_TYPE) {
    const tariff = input.socfund?.tariff;
    if (!tariff) return { kind: 'no_tariff' };
    return {
      kind: 'socfund',
      tariff: tariff.short,
      total: tariff.total,
      ...socfundTax({
        tariff,
        rateText: input.socfund!.rateText,
        fot: main.base.values,
        emp: input.socfund!.emp?.values ?? null,
      }),
    };
  }
  const revenue = main.base.sum;
  const [first] = input.rateLines;
  if (input.rateLines.length === 1 && first) {
    return {
      kind: 'line',
      key: first.key,
      label: first.label,
      revenue,
      tax: lineTax(revenue, first.pct),
    };
  }
  if (input.rateLines.length > 1) {
    return {
      kind: 'lines',
      revenue,
      lines: input.rateLines.map((l) => ({ key: l.key, label: l.label })),
    };
  }
  const pct = revenuePct(input.typeCode, input.assignmentRate);
  if (!pct) return { kind: 'no_rate', revenue, vat: input.typeCode === TAX_VAT_REPORT_TYPE };
  return { kind: 'rate', pct, revenue, amount: revenueTax(revenue, pct) };
}
