/**
 * Даты платформы: «сегодня» считается по Бишкеку (UTC+6, без перехода на летнее время).
 * Сроки — строки `YYYY-MM-DD`; на экране — «15.03.2026». Арифметика — как в прототипе (data.js: D, addDays, diffDays).
 */

/** Дата без времени в виде `YYYY-MM-DD`. */
export type IsoDate = string;

export const BISHKEK_UTC_OFFSET_MINUTES = 6 * 60;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): value is IsoDate {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.toISOString().slice(0, 10) === value;
}

function toUtcDate(value: IsoDate): Date {
  if (!isIsoDate(value)) throw new RangeError(`Не дата YYYY-MM-DD: ${value}`);
  return new Date(`${value}T00:00:00Z`);
}

/** Календарная дата в Бишкеке для момента времени `now`. */
export function bishkekDate(now: Date): IsoDate {
  return new Date(now.getTime() + BISHKEK_UTC_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** Время «ЧЧ:ММ» в Бишкеке для момента `now`. */
export function bishkekTime(now: Date): string {
  return new Date(now.getTime() + BISHKEK_UTC_OFFSET_MINUTES * 60_000).toISOString().slice(11, 16);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Сколько дней от `b` до `a` (a − b). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcDate(a).getTime() - toUtcDate(b).getTime()) / 86_400_000);
}

/** «15.03.2026». */
export function formatDateRu(date: IsoDate): string {
  toUtcDate(date);
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

/** День недели: 0 — понедельник … 6 — воскресенье. */
export function weekdayMondayFirst(date: IsoDate): number {
  return (toUtcDate(date).getUTCDay() + 6) % 7;
}
