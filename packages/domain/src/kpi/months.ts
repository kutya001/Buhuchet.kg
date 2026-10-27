import type { IsoDate } from '../common/dates';

/**
 * Месяц показателей — строка `YYYY-MM` (как `ym` прототипа, core/data.js): месяц значения, «Вести с»,
 * месяцы обслуживания контрагента. Строки сравниваются как числа: «2026-01» < «2026-10».
 */
export type YearMonth = string;

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isYearMonth(value: string): value is YearMonth {
  return YEAR_MONTH.test(value);
}

function parts(month: YearMonth): [number, number] {
  const m = YEAR_MONTH.exec(month);
  if (!m) throw new RangeError(`Не месяц YYYY-MM: ${month}`);
  return [Number(m[1]), Number(m[2])];
}

/** Месяц даты `YYYY-MM-DD`. */
export const monthOf = (date: IsoDate): YearMonth => date.slice(0, 7);

/** Месяц через `n` месяцев (n < 0 — назад; прототип `addMonths`). */
export function addMonths(month: YearMonth, n: number): YearMonth {
  const [y, m] = parts(month);
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Месяцы с `from` по `to` включительно, по порядку (прототип `kMonths`); `from` > `to` — пусто. */
export function monthRange(from: YearMonth, to: YearMonth): YearMonth[] {
  parts(from);
  parts(to);
  const out: YearMonth[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** «09.2026» — месяц в таблицах и подсказках (прототип `ymN`). */
export function monthText(month: YearMonth): string {
  const [y, m] = parts(month);
  return `${String(m).padStart(2, '0')}.${y}`;
}

/** Дата `day`-го числа месяца (`day` от 1 до 28 — в любом месяце есть). */
export function monthDay(month: YearMonth, day: number): IsoDate {
  parts(month);
  return `${month}-${String(day).padStart(2, '0')}`;
}
