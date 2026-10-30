import type { IsoDate } from '../common/dates';
import type { Translate, UiTextKey } from '../l10n/texts';
import type { ReportPeriod } from '../platform-dicts/catalog';

/*
 * Периоды отчётов (ТЗ «Отчеты для сдачи» → «Отчёты к сдаче создаются автоматически»; прототип
 * core/reference.js: pstart, pend, plabel, periodList, perOfYm). Период хранится как вид (месяц,
 * квартал, полугодие, год) и первое число; у разового отчёта — ещё дата события, а период — её месяц.
 */

/** Период отчёта: вид и первое число; у разового отчёта — дата события (период — её месяц). */
export interface PeriodRef {
  period: ReportPeriod;
  start: IsoDate;
  event?: IsoDate | null;
}

const MONTHS_IN: Readonly<Record<ReportPeriod, number>> = { M: 1, Q: 3, H: 6, Y: 12 };

const two = (n: number) => String(n).padStart(2, '0');

/** Дата по году, месяцу (может выходить за 1–12) и числу; число больше дней месяца — последний день. */
export function dateOf(year: number, month: number, day: number): IsoDate {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${two(m)}-${two(Math.min(day, last))}`;
}

const yearOf = (date: IsoDate) => Number(date.slice(0, 4));
const monthOf = (date: IsoDate) => Number(date.slice(5, 7));

/** Первое число периода вида `period`, в который входит месяц даты `date` (прототип perOfYm + pstart). */
export function periodStartOf(period: ReportPeriod, date: IsoDate): IsoDate {
  const n = MONTHS_IN[period];
  const firstMonth = Math.floor((monthOf(date) - 1) / n) * n + 1;
  return dateOf(yearOf(date), firstMonth, 1);
}

/** Первое число периода через `k` периодов (k < 0 — назад). */
export function shiftPeriod(period: ReportPeriod, start: IsoDate, k: number): IsoDate {
  return dateOf(yearOf(start), monthOf(start) + k * MONTHS_IN[period], 1);
}

/** Последний день периода; у разового отчёта — дата события (прототип pend). */
export function periodEnd(ref: PeriodRef): IsoDate {
  if (ref.event) return ref.event;
  return dateOf(yearOf(ref.start), monthOf(ref.start) + MONTHS_IN[ref.period] - 1, 31);
}

/** Номер квартала (1–4) или полугодия (1–2) периода. */
const partOf = (ref: PeriodRef) => Math.ceil(monthOf(ref.start) / MONTHS_IN[ref.period]);

/** Первый и последний месяц периода по году (у годового — 1 и 12). */
export function periodMonths(ref: PeriodRef): { first: number; last: number } {
  const first = monthOf(ref.start);
  return { first, last: first + MONTHS_IN[ref.period] - 1 };
}

const ROMAN = ['I', 'II', 'III', 'IV'] as const;

/**
 * Подпись периода в списках (прототип plabel): «10.2026», «III кв. 2026», «I пол. 2026», «2026»; у
 * разового отчёта — месяц и дата события: «11.2026 · 05.11».
 */
export function periodLabel(ref: PeriodRef, t: Translate): string {
  const y = yearOf(ref.start);
  if (ref.event) {
    return `${two(monthOf(ref.event))}.${yearOf(ref.event)} · ${ref.event.slice(8, 10)}.${ref.event.slice(5, 7)}`;
  }
  switch (ref.period) {
    case 'M':
      return `${two(monthOf(ref.start))}.${y}`;
    case 'Q':
      return t('report.period.q_short', { n: ROMAN[partOf(ref) - 1]!, y });
    case 'H':
      return t('report.period.h_short', { n: ROMAN[partOf(ref) - 1]!, y });
    case 'Y':
      return String(y);
  }
}

/** Период полностью (прототип phuman): «Октябрь 2026», «III квартал 2026», «II полугодие 2026», «2026 год». */
export function periodFull(ref: Pick<PeriodRef, 'period' | 'start'>, t: Translate): string {
  const y = yearOf(ref.start);
  switch (ref.period) {
    case 'M':
      return t('report.period.m_full', {
        month: t(`report.month.${monthOf(ref.start)}` as UiTextKey),
        y,
      });
    case 'Q':
      return t('report.period.q_full', { n: ROMAN[partOf(ref) - 1]!, y });
    case 'H':
      return t('report.period.h_full', { n: ROMAN[partOf(ref) - 1]!, y });
    case 'Y':
      return t('report.period.y_full', { y });
  }
}

/**
 * Окно периодов вокруг сегодняшнего дня (прототип periodList): у месячных — три назад, текущий и
 * `ahead` вперёд; у квартальных — два назад и текущий; у полугодовых — прошлое и текущее; у годовых —
 * прошлый и текущий год. Кварталы `skipQuarters` не входят (предварительный налог без IV квартала).
 */
export function periodWindow(
  period: ReportPeriod,
  today: IsoDate,
  skipQuarters: readonly number[] = [],
  ahead = 1,
): IsoDate[] {
  const current = periodStartOf(period, today);
  const [from, to] = period === 'M' ? [-3, ahead] : period === 'Q' ? [-2, 0] : [-1, 0];
  const out: IsoDate[] = [];
  for (let k = from; k <= to; k++) out.push(shiftPeriod(period, current, k));
  return period === 'Q'
    ? out.filter((start) => !skipQuarters.includes(partOf({ period, start })))
    : out;
}

/**
 * Периоды с месяца `fromMonth` по сегодняшний, которые уже закончились, — прошлые периоды назначения
 * (прототип periodsFrom): их отчёты система предлагает создать, когда «с какого периода» в прошлом.
 * Кварталы `skipQuarters` не входят, как и в окне периодов.
 */
export function pastPeriods(
  period: ReportPeriod,
  fromMonth: IsoDate,
  today: IsoDate,
  skipQuarters: readonly number[] = [],
): IsoDate[] {
  const out: IsoDate[] = [];
  for (
    let start = periodStartOf(period, fromMonth);
    start <= today;
    start = shiftPeriod(period, start, 1)
  ) {
    const ref = { period, start };
    if (periodEnd(ref) >= today) continue;
    if (period === 'Q' && skipQuarters.includes(partOf(ref))) continue;
    out.push(start);
  }
  return out;
}
