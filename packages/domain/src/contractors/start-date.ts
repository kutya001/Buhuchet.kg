import type { IsoDate } from '../common/dates';
import type { YearMonth } from '../common/months';

/*
 * Исправление даты начала обслуживания в «Изменить контрагента» (прототип v84,
 * modules/contractor-form.js — `cpStartWhy`, `cpSetStart`; у разового контрагента это «Дата первого
 * обращения»). Вместе с датой сдвигается начало первого периода обслуживания; начисления за
 * обслуживание и месяцы показателей считаются от новой даты сами. Уже созданные отчёты и записанные
 * оплаты не меняются — поэтому позже первой оплаты обслуживания или первого сданного отчёта дату
 * поставить нельзя.
 */

/** Раньше этого года дату не ставят (прототип: «Проверьте год»). */
export const START_DATE_MIN: IsoDate = '2000-01-01';

/** Причина изменения даты — не длиннее. */
export const START_REASON_MAX = 300;

/** Что мешает новой дате: считается по контрагенту под новую дату. */
export interface StartDateFacts {
  today: IsoDate;
  /** Последний месяц первого периода обслуживания; null — период открыт или периодов нет. */
  firstPeriodTo: YearMonth | null;
  /** Самый ранний месяц с неудалённой оплатой обслуживания раньше месяца новой даты. */
  paidMonth: YearMonth | null;
  /** Самый ранний отчёт, сданный раньше новой даты. */
  report: { name: string; submittedOn: IsoDate } | null;
}

export type StartDateProblem =
  | { code: 'future' }
  | { code: 'year' }
  | { code: 'period'; month: YearMonth }
  | { code: 'paid'; month: YearMonth }
  | { code: 'report'; name: string; date: IsoDate };

/** Почему нельзя поставить дату `next` (прототип `cpStartWhy`, порядок проверок тот же); null — можно. */
export function startDateProblem(next: IsoDate, facts: StartDateFacts): StartDateProblem | null {
  if (next > facts.today) return { code: 'future' };
  if (next < START_DATE_MIN) return { code: 'year' };
  if (facts.firstPeriodTo && next.slice(0, 7) > facts.firstPeriodTo) {
    return { code: 'period', month: facts.firstPeriodTo };
  }
  if (facts.paidMonth && facts.paidMonth < next.slice(0, 7)) {
    return { code: 'paid', month: facts.paidMonth };
  }
  if (facts.report && facts.report.submittedOn < next) {
    return { code: 'report', name: facts.report.name, date: facts.report.submittedOn };
  }
  return null;
}

/**
 * Начало первого периода обслуживания после смены даты (прототип `cpSetStart`): сдвигается, только
 * если период начинался в месяце прежней даты; иначе остаётся как был (null — не менять).
 */
export function shiftedPeriodStart(
  firstPeriodFrom: YearMonth | null,
  was: IsoDate,
  next: IsoDate,
): YearMonth | null {
  if (!firstPeriodFrom || firstPeriodFrom !== was.slice(0, 7)) return null;
  const month = next.slice(0, 7) as YearMonth;
  return month === firstPeriodFrom ? null : month;
}
