import type { IsoDate } from '../common/dates';
import { rateVariants, type SingleTaxRateText } from '../dicts/value-guide';
import type { RateAddition, ReportAct, ReportKind, ReportPeriod } from '../platform-dicts/catalog';
import { periodInAssignment } from './due';
import { isSingleTaxType } from './rates';
import type { AssignmentEnRate } from './rules';

/*
 * Проверки полей назначения (ТЗ «Назначение отчётов контрагентам»: ставка из списка ставок вида, у
 * единого налога — строки ЕНС, у налога с продаж — основная и добавляемые; вариант срока; периодичность
 * и срок в назначении у внутренней отчётности; повторяющаяся сумма; прототип modules/contractors.js:
 * asgDlg, assignDlg; core/tax-lines.js: rtParts, enClean). Подключён ли вид, действует ли сотрудник и
 * не в архиве ли контрагент, проверяет API.
 */

/** Поля назначения, которые проверяются вместе. */
export interface AssignmentFields {
  fromMonth: IsoDate;
  untilMonth: IsoDate | null;
  rate: string | null;
  enRates: readonly AssignmentEnRate[];
  rateAdditions: readonly string[];
  dueDay: number | null;
  ownPeriod: ReportPeriod | null;
  ownDay: number | null;
  ownMonth: number | null;
  fixedAmount: number | null;
}

/** Вид отчёта для проверки назначения. */
export interface AssignmentTypeRule {
  code: string;
  kind: ReportKind;
  period: ReportPeriod;
  oneOff: boolean;
  periodPerAssignment: boolean;
  act: ReportAct;
  rates: readonly string[];
  rateAdditions: readonly Pick<RateAddition, 'k'>[];
}

export const ASSIGNMENT_PROBLEMS = [
  'until_before_from',
  'rate_invalid',
  'en_rates_invalid',
  'rate_additions_invalid',
  'due_day_not_allowed',
  'own_not_allowed',
  'own_invalid',
  'fixed_amount_sub',
] as const;
export type AssignmentProblem = (typeof ASSIGNMENT_PROBLEMS)[number];

export const ASSIGNMENT_MESSAGES: Record<AssignmentProblem, string> = {
  until_before_from: 'Период окончания раньше начала',
  rate_invalid: 'Такой ставки нет у вида отчёта',
  en_rates_invalid:
    'Строки единого налога — только у единого налога: из справочника «Ставки единого налога», без повторов',
  rate_additions_invalid: 'Добавляемые ставки — только из ставок вида отчёта',
  due_day_not_allowed: 'У этого вида вариант срока не задаётся',
  own_not_allowed:
    'Периодичность и срок в назначении задаются только у внутренней отчётности и видов с периодичностью в назначении',
  own_invalid: 'Неверная периодичность или срок в назначении',
  fixed_amount_sub: 'Повторяющаяся сумма — только у видов с уплатой',
};

/** Поле формы, к которому относится ошибка. */
const PROBLEM_FIELD: Record<AssignmentProblem, keyof AssignmentFields> = {
  until_before_from: 'untilMonth',
  rate_invalid: 'rate',
  en_rates_invalid: 'enRates',
  rate_additions_invalid: 'rateAdditions',
  due_day_not_allowed: 'dueDay',
  own_not_allowed: 'ownPeriod',
  own_invalid: 'ownPeriod',
  fixed_amount_sub: 'fixedAmount',
};

/** Вариант срока «до N-го числа» задаётся у видов с периодом по каталогу, кроме годовых и разовых. */
export const dueDayAllowed = (type: AssignmentTypeRule) =>
  !periodInAssignment(type) && type.period !== 'Y' && !type.oneOff;

/**
 * Сколько вариантов у строки ЕНС (общепит: «Бишкек и Ош — 5 %, остальная территория — 3 %»); у строки
 * «по ставкам ЕНС-NN» — у той строки. 0 — вариантов нет, номер варианта не задаётся.
 */
export function singleTaxVariantCount(code: string, rates: readonly SingleTaxRateText[]): number {
  const seen = new Set<string>();
  let x = rates.find((r) => r.code === code);
  while (x) {
    if (x.rateCashless && x.rateCash) return 0;
    const ref = /по ставкам (ЕНС-\d+)/.exec(x.rate)?.[1];
    if (!ref || ref === x.code || seen.has(ref)) return rateVariants(x.rate).length;
    seen.add(x.code);
    x = rates.find((r) => r.code === ref);
  }
  return 0;
}

/**
 * Первая ошибка полей назначения с полем формы; null — всё верно. `rates` — строки справочника «Ставки
 * единого налога» (для проверки кодов ЕНС и вариантов).
 */
export function assignmentProblem(
  fields: AssignmentFields,
  type: AssignmentTypeRule,
  rates: readonly SingleTaxRateText[],
): { problem: AssignmentProblem; field: keyof AssignmentFields } | null {
  const fail = (problem: AssignmentProblem) => ({ problem, field: PROBLEM_FIELD[problem] });
  if (fields.untilMonth && fields.untilMonth < fields.fromMonth) return fail('until_before_from');

  const single = isSingleTaxType(type.code);
  if (fields.rate !== null && (single || !type.rates.includes(fields.rate))) {
    return fail('rate_invalid');
  }
  if (fields.enRates.length) {
    const codes = fields.enRates.map((e) => e.code);
    const bad =
      !single ||
      new Set(codes).size !== codes.length ||
      fields.enRates.some((e) => {
        if (!rates.some((r) => r.code === e.code)) return true;
        if (e.variant === null) return false;
        return e.variant >= singleTaxVariantCount(e.code, rates);
      });
    if (bad) return fail('en_rates_invalid');
  }
  if (
    new Set(fields.rateAdditions).size !== fields.rateAdditions.length ||
    fields.rateAdditions.some((k) => !type.rateAdditions.some((x) => x.k === k))
  ) {
    return fail('rate_additions_invalid');
  }

  if (fields.dueDay !== null && !dueDayAllowed(type)) return fail('due_day_not_allowed');
  const own = fields.ownPeriod !== null || fields.ownDay !== null || fields.ownMonth !== null;
  if (own && !periodInAssignment(type)) return fail('own_not_allowed');
  if (own) {
    // Свой срок без своей периодичности не задаётся; месяц у годовых — 1–12, у остальных — 0–12 после конца.
    if (fields.ownPeriod === null) return fail('own_invalid');
    const year = fields.ownPeriod === 'Y';
    if (fields.ownMonth !== null && (fields.ownMonth < (year ? 1 : 0) || fields.ownMonth > 12)) {
      return fail('own_invalid');
    }
  }
  if (fields.fixedAmount !== null && type.act === 'sub') return fail('fixed_amount_sub');
  return null;
}
