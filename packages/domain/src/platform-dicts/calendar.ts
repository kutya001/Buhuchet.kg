import { addDays, isIsoDate, weekdayMondayFirst, type IsoDate } from '../common/dates';

/**
 * Производственный календарь КР (ТЗ «Справочники платформы» → «Производственный календарь»; прототип
 * core/reference.js: holidayName, isWorking, shiftWork; admin/platform-dicts-edit.js: holidayRows).
 * Запись календаря — день с названием:
 * - `holiday` — праздник; ключ `MM-DD` — каждый год (государственный праздник по закону), `YYYY-MM-DD` —
 *   только в этом году (плавающие Орозо айт и Курман айт);
 * - `transfer` — нерабочий день по переносу Кабинета министров (только в этом году);
 * - `workday` — перенесённая рабочая суббота (только в этом году).
 */
export const CALENDAR_DAY_KINDS = ['holiday', 'transfer', 'workday'] as const;
export type CalendarDayKind = (typeof CALENDAR_DAY_KINDS)[number];

export interface CalendarEntry {
  /** `MM-DD` — каждый год, `YYYY-MM-DD` — только этот день. */
  day: string;
  kind: CalendarDayKind;
  name: string;
}

/** День календаря конкретного года (вкладка «Календарь» и метод API). */
export interface CalendarDay {
  date: IsoDate;
  kind: CalendarDayKind;
  name: string;
  /** Праздник повторяется каждый год (ключ `MM-DD`). */
  everyYear: boolean;
}

const MONTH_DAY = /^(\d{2})-(\d{2})$/;

/** Ключ записи календаря: `MM-DD` (существующий день, 29 февраля можно) или дата `YYYY-MM-DD`. */
export function isCalendarDay(day: string): boolean {
  const m = MONTH_DAY.exec(day);
  return m ? isIsoDate(`2024-${day}`) : isIsoDate(day);
}

/** Запись повторяется каждый год. */
export const isEveryYear = (day: string): boolean => MONTH_DAY.test(day);

/**
 * Что не так с записью календаря (для наполнения и будущей загрузки из Excel): ключ, вид и название.
 * Каждый год повторяется только праздник; у рабочей субботы — суббота.
 */
export function calendarEntryProblem(entry: CalendarEntry): string | null {
  if (!isCalendarDay(entry.day)) return `«${entry.day}» — не дата`;
  if (!CALENDAR_DAY_KINDS.includes(entry.kind)) return `«${entry.kind}» — неизвестный вид дня`;
  if (isEveryYear(entry.day) && entry.kind !== 'holiday')
    return `${entry.day}: каждый год повторяется только праздник`;
  if (entry.kind === 'workday' && weekdayMondayFirst(entry.day) !== 5)
    return `${entry.day}: рабочая суббота — не суббота`;
  if (entry.kind !== 'workday' && !entry.name.trim()) return `${entry.day}: нет названия`;
  return null;
}

/**
 * Вид дня по записи прототипа: рабочая суббота — из списка `workingSaturdays`, перенос — название
 * начинается с «Перенос» (прототип holidayRows), остальное — праздник.
 */
export function calendarKindOf(name: string, workingSaturday: boolean): CalendarDayKind {
  if (workingSaturday) return 'workday';
  return /^Перенос/.test(name) ? 'transfer' : 'holiday';
}

export interface ProductionCalendar {
  /** Нерабочие дни: ключ `MM-DD` или `YYYY-MM-DD` → название. */
  readonly offDays: ReadonlyMap<string, string>;
  readonly workingSaturdays: ReadonlySet<IsoDate>;
}

export function productionCalendar(entries: readonly CalendarEntry[]): ProductionCalendar {
  const offDays = new Map<string, string>();
  const workingSaturdays = new Set<IsoDate>();
  for (const e of entries) {
    if (e.kind === 'workday') workingSaturdays.add(e.day);
    else offDays.set(e.day, e.name);
  }
  return { offDays, workingSaturdays };
}

/** Название праздника или переноса; дата года важнее праздника «каждый год». Рабочий день — ''. */
export function holidayName(calendar: ProductionCalendar, date: IsoDate): string {
  return calendar.offDays.get(date) ?? calendar.offDays.get(date.slice(5)) ?? '';
}

/**
 * Рабочий ли день: рабочая суббота — рабочий; суббота и воскресенье — нет; праздник и перенос — нет.
 */
export function isWorkingDay(calendar: ProductionCalendar, date: IsoDate): boolean {
  if (calendar.workingSaturdays.has(date)) return true;
  if (weekdayMondayFirst(date) >= 5) return false;
  return !holidayName(calendar, date);
}

/** Сколько дней подряд срок может сдвигаться: как в прототипе (shiftWork), нерабочих дней больше не бывает. */
const MAX_SHIFT_DAYS = 20;

/**
 * Срок на нерабочем дне сдвигается на следующий день и так далее, пока не попадёт на рабочий день по
 * календарю; правило «суббота → понедельник» не используется, рабочая суббота — рабочий день (ТЗ).
 */
export function nextWorkingDay(calendar: ProductionCalendar, date: IsoDate): IsoDate {
  let day = date;
  for (let n = 0; n < MAX_SHIFT_DAYS && !isWorkingDay(calendar, day); n++) day = addDays(day, 1);
  return day;
}

/** Дни календаря года по дате: праздники «каждый год» на этот год и записи этого года. */
export function calendarYear(entries: readonly CalendarEntry[], year: number): CalendarDay[] {
  const y = String(year).padStart(4, '0');
  return entries
    .flatMap((e): CalendarDay[] => {
      const everyYear = isEveryYear(e.day);
      const date = everyYear ? `${y}-${e.day}` : e.day;
      // 29 февраля «каждый год» в невисокосном году не наступает.
      if (!date.startsWith(`${y}-`) || !isIsoDate(date)) return [];
      return [{ date, kind: e.kind, name: e.name, everyYear }];
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind < b.kind ? -1 : 1));
}

/* ───────────── Админка → «Справочники платформы» → «Календарь» (задача 2.36) ───────────── */

/**
 * Тип в окне «Нерабочий день» (прототип holidayDlg): «Праздник или перенос» — нерабочий день только в этом
 * году (перенос — если название начинается с «Перенос»), «Рабочая суббота» — рабочий день.
 */
export const CALENDAR_ADD_TYPES = ['off', 'workday'] as const;
export type CalendarAddType = (typeof CALENDAR_ADD_TYPES)[number];

/** Вид дня, который добавляет окно «Нерабочий день». */
export function calendarAddKind(type: CalendarAddType, name: string): CalendarDayKind {
  return calendarKindOf(name.trim(), type === 'workday');
}

/** Годы вкладки «Календарь»: текущий по Бишкеку и следующий (прототип: holidayRows(y) и holidayRows(y + 1)). */
export function calendarAdminYears(today: IsoDate): readonly [number, number] {
  const year = Number(today.slice(0, 4));
  return [year, year + 1];
}

export interface CalendarAddInput {
  date: string;
  type: CalendarAddType;
  name: string;
}

export type CalendarAddProblem =
  | { field: 'date'; code: 'date_required' | 'date_year' | 'not_saturday' | 'date_taken' }
  | { field: 'name'; code: 'name_required' };

// ОТКЛОНЕНИЕ: docs/deviations.md#Д-5
/**
 * Что не так с новым днём календаря: дата обязательна и — в годах вкладки (иначе её не будет видно в
 * списке); рабочая суббота — суббота; у праздника — название (прототип «Введите название праздника»);
 * дата, которая уже есть в календаре этого года (в том числе праздник «каждый год»), — повтор.
 */
export function calendarAddProblems(
  input: CalendarAddInput,
  entries: readonly CalendarEntry[],
  today: IsoDate,
): CalendarAddProblem[] {
  const problems: CalendarAddProblem[] = [];
  const date = input.date.trim();
  if (!isIsoDate(date)) problems.push({ field: 'date', code: 'date_required' });
  else if (!calendarAdminYears(today).includes(Number(date.slice(0, 4)))) {
    problems.push({ field: 'date', code: 'date_year' });
  } else if (input.type === 'workday' && weekdayMondayFirst(date) !== 5) {
    problems.push({ field: 'date', code: 'not_saturday' });
  } else if (calendarYear(entries, Number(date.slice(0, 4))).some((d) => d.date === date)) {
    problems.push({ field: 'date', code: 'date_taken' });
  }
  if (input.type === 'off' && !input.name.trim())
    problems.push({ field: 'name', code: 'name_required' });
  return problems;
}

/** День, который «Календарь на следующий год копированием» перенесёт на год вперёд. */
export interface CalendarCopyItem {
  from: IsoDate;
  to: IsoDate;
  kind: CalendarDayKind;
  name: string;
}

// ОТКЛОНЕНИЕ: docs/deviations.md#Д-5
/**
 * Что скопировать из года `year` в следующий (прототип calCopyDlg): праздники «каждый год» уже есть в
 * следующем году, копируются записи «только в этом году» — переносы, плавающие праздники и рабочие
 * субботы — на ту же дату следующего года. Не копируется день, дата которого в следующем году уже есть
 * в календаре (одна запись на дату; прототип сверял дату с типом), и 29 февраля в невисокосный год.
 */
export function calendarCopyPlan(
  entries: readonly CalendarEntry[],
  year: number,
): CalendarCopyItem[] {
  const taken = new Set(calendarYear(entries, year + 1).map((d) => d.date));
  return calendarYear(entries, year)
    .filter((d) => !d.everyYear)
    .map((d) => ({ from: d.date, to: `${year + 1}${d.date.slice(4)}`, kind: d.kind, name: d.name }))
    .filter((x) => isIsoDate(x.to) && !taken.has(x.to));
}
