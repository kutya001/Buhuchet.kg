import { addDays, weekdayMondayFirst, type IsoDate } from '../common/dates';
import { addMonths, lastDayOf, monthOf } from '../common/months';

/*
 * «Главная» → «Активность» (прототип v84, modules/activity.js): сотрудники организации за день, неделю,
 * месяц или год с листанием назад. Входы и выходы — из журнала сеансов, действия — из истории
 * изменений и «Истории статусов»; сданные отчёты, контрагенты и задачи — по данным организации. Здесь —
 * период, дни, строки списка, плашки и столбики; сами числа считает база (`@buhuchet/db`, activity.ts).
 */

/** День, неделя, месяц, год (прототип `ACT_K`). */
export const ACTIVITY_KINDS = ['d', 'w', 'm', 'y'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Период: вид и сдвиг назад от текущего (0 — текущий, −1 — прошлый). */
export interface ActivityPeriod {
  k: ActivityKind;
  off: number;
}

/** По умолчанию — текущий месяц (прототип `S.act = {k: 'm', off: 0}`). */
export const ACTIVITY_DEFAULT: ActivityPeriod = { k: 'm', off: 0 };

/** Дальше стольких периодов назад сервер не листает. */
export const ACTIVITY_MAX_BACK = 400;

/** Другой вид периода — снова текущий (прототип: `p.k = …; p.off = 0`). */
export const activityKindChosen = (k: ActivityKind): ActivityPeriod => ({ k, off: 0 });

/**
 * Листание: «Раньше» (−1), «Позже» (+1, не дальше текущего), «К текущему» (0) — прототип `actBind`.
 */
export function activityShift(p: ActivityPeriod, step: -1 | 0 | 1): ActivityPeriod {
  if (step === 0) return { k: p.k, off: 0 };
  return { k: p.k, off: Math.max(-ACTIVITY_MAX_BACK, Math.min(0, p.off + step)) };
}

export interface ActivityRange {
  from: IsoDate;
  to: IsoDate;
}

/** Границы периода (прототип `actRange`): неделя — с понедельника, месяц и год — целиком. */
export function activityRange(p: ActivityPeriod, today: IsoDate): ActivityRange {
  if (p.k === 'd') {
    const d = addDays(today, p.off);
    return { from: d, to: d };
  }
  if (p.k === 'w') {
    const monday = addDays(today, -weekdayMondayFirst(today) + 7 * p.off);
    return { from: monday, to: addDays(monday, 6) };
  }
  if (p.k === 'm') {
    const month = addMonths(monthOf(today), p.off);
    return { from: `${month}-01`, to: lastDayOf(month) };
  }
  const year = String(Number(today.slice(0, 4)) + p.off).padStart(4, '0');
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Последний день периода, который уже наступил (прототип `actDays`: `d <= rg.to && d <= TODAY`). */
export const activityLastDay = (range: ActivityRange, today: IsoDate): IsoDate =>
  range.to < today ? range.to : today;

/** День сотрудника: действия, входы, выходы, первый вход и последняя активность («ЧЧ:ММ» по Бишкеку). */
export interface ActivityDay {
  day: IsoDate;
  n: number;
  in: number;
  out: number;
  first: string | null;
  last: string;
}

/** Числа сотрудника по данным организации (прототип `actEmp`). */
export interface ActivityCounters {
  /** Отчётов сдано в периоде (кто сдал, а если не записано — ответственный; без «Уплаты»). */
  sub: number;
  /** Из них позже срока. */
  late: number;
  /** Отчётов со сроком в периоде, где он ответственный (без «Не требуется», прежних версий и «Уплаты»). */
  due: number;
  /** Просрочено сейчас. */
  over: number;
  /** Контрагентов в ответственности, не в архиве. */
  cps: number;
  /** Задач выполнено в периоде. */
  tasks: number;
}

export const NO_ACTIVITY_COUNTERS: ActivityCounters = {
  sub: 0,
  late: 0,
  due: 0,
  over: 0,
  cps: 0,
  tasks: 0,
};

export interface ActivityEmployee {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

/** Строка списка «Активности». `last` — «ГГГГ-ММ-ДД ЧЧ:ММ» по Бишкеку или null — «не было». */
export interface ActivityRow extends ActivityCounters {
  id: string;
  name: string;
  role: string;
  active: boolean;
  last: string | null;
  in: number;
  out: number;
  days: number;
  n: number;
}

/** Момент последней активности из дней сотрудника (прототип: `ld.d + ' ' + ld.last`). */
export function activityLast(days: readonly ActivityDay[]): string | null {
  let last: ActivityDay | null = null;
  for (const d of days) if (!last || d.day > last.day) last = d;
  return last ? `${last.day} ${last.last}` : null;
}

const sumOf = <T>(list: readonly T[], get: (x: T) => number) =>
  list.reduce((a, x) => a + get(x), 0);

/** Сводка сотрудника за период (прототип `actEmp`). */
export function activityRow(
  e: ActivityEmployee,
  days: readonly ActivityDay[],
  counters: ActivityCounters = NO_ACTIVITY_COUNTERS,
): ActivityRow {
  return {
    id: e.id,
    name: e.name,
    role: e.role,
    active: e.active,
    last: activityLast(days),
    in: sumOf(days, (d) => d.in),
    out: sumOf(days, (d) => d.out),
    days: days.length,
    n: sumOf(days, (d) => d.n),
    ...counters,
  };
}

/**
 * Строки списка (прототип `renderHomeAct`): действующие сотрудники, а заблокированный — только с
 * активностью или сданными отчётами в периоде.
 */
export function activityRows(
  employees: readonly ActivityEmployee[],
  days: ReadonlyMap<string, readonly ActivityDay[]>,
  counters: ReadonlyMap<string, ActivityCounters>,
): ActivityRow[] {
  return employees
    .map((e) => activityRow(e, days.get(e.id) ?? [], counters.get(e.id)))
    .filter((r) => r.active || r.days > 0 || r.sub > 0);
}

/** Плашки (прототип `renderHomeAct`): работали из стольких, входы и выходы, действия, сдано, задачи. */
export interface ActivityTotals {
  staff: number;
  active: number;
  in: number;
  out: number;
  n: number;
  sub: number;
  late: number;
  tasks: number;
}

export function activityTotals(rows: readonly ActivityRow[]): ActivityTotals {
  return {
    staff: rows.length,
    active: rows.filter((r) => r.days > 0).length,
    in: sumOf(rows, (r) => r.in),
    out: sumOf(rows, (r) => r.out),
    n: sumOf(rows, (r) => r.n),
    sub: sumOf(rows, (r) => r.sub),
    late: sumOf(rows, (r) => r.late),
    tasks: sumOf(rows, (r) => r.tasks),
  };
}

/** Столбик графика: день `ГГГГ-ММ-ДД` или месяц `ГГГГ-ММ` (за год) и число действий. */
export interface ActivityBucket {
  key: string;
  value: number;
}

/**
 * Столбики «Действия по дням» (за год — «по месяцам»; прототип `actBuckets`): все дни периода, у дней
 * после сегодняшнего — ноль; за день графика нет.
 */
export function activityBuckets(
  p: ActivityPeriod,
  range: ActivityRange,
  today: IsoDate,
  byDay: ReadonlyMap<IsoDate, number>,
): ActivityBucket[] {
  if (p.k === 'd') return [];
  if (p.k === 'y') {
    const year = range.from.slice(0, 4);
    const months = Array.from({ length: 12 }, (_, i) => ({
      key: `${year}-${String(i + 1).padStart(2, '0')}`,
      value: 0,
    }));
    for (const [day, n] of byDay) {
      if (day >= range.from && day <= range.to && day <= today) {
        months[Number(day.slice(5, 7)) - 1]!.value += n;
      }
    }
    return months;
  }
  const out: ActivityBucket[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    out.push({ key: d, value: d <= today ? (byDay.get(d) ?? 0) : 0 });
  }
  return out;
}

/**
 * Подпись под столбиком дня месяца (прототип `actBuckets`): в коротком периоде — у каждого, иначе у
 * каждого пятого и у последнего.
 */
export const activityBucketLabeled = (index: number, total: number): boolean =>
  total <= 14 || index % 5 === 0 || index === total - 1;

/** Высота столбика в процентах (прототип `actChart`): ненулевой — не ниже 2 %. */
export function activityBarHeight(value: number, max: number): number {
  if (value <= 0) return 0;
  return Math.max(2, Math.round((value / Math.max(1, max)) * 100));
}

/** Действия по дням всех сотрудников — для столбиков. */
export function activityByDay(
  days: ReadonlyMap<string, readonly ActivityDay[]>,
  ids: Iterable<string>,
): Map<IsoDate, number> {
  const out = new Map<IsoDate, number>();
  for (const id of ids) {
    for (const d of days.get(id) ?? []) out.set(d.day, (out.get(d.day) ?? 0) + d.n);
  }
  return out;
}
