import { addDays, weekdayMondayFirst, type IsoDate } from '../common/dates';
import type { YearMonth } from '../common/months';

/*
 * Вкладка «Календарь» модуля «Отчеты для сдачи» (ТЗ «Вкладки модуля» → «Календарь»: «месяц сеткой, в
 * каждом дне число отчётов со сроком; клик по дню открывает список на эту дату»; прототип
 * modules/reports.js, `renderCalendar`).
 */

/** Дней в сетке месяца: шесть недель, как в прототипе (`for (i = 0; i < 42; i++)`). */
export const CALENDAR_GRID_DAYS = 42;

/** Дни сетки месяца: с понедельника недели первого числа, шесть недель подряд. */
export function calendarGrid(month: YearMonth): IsoDate[] {
  const first = `${month}-01`;
  const start = addDays(first, -weekdayMondayFirst(first));
  return Array.from({ length: CALENDAR_GRID_DAYS }, (_, i) => addDays(start, i));
}
