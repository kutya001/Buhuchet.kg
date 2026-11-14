import { addDays, weekdayMondayFirst, type IsoDate } from '../common/dates';

/**
 * Блок «Telegram-уведомления» в «Моя организация» → «Настройки» (пакет 14.11.2026, блок 3; прототип v111
 * `modules/tg-notify.js`). Все автоматические сообщения бота одним списком; одно время — «Час напоминаний»
 * (`digestTime` учётной политики): в этот час каждый день уходят напоминания о сроках, недельная сводка
 * (в свой день) и сводка дня в общий чат. У недельной сводки — только свой день недели.
 */

/** День недельной сводки: 1 — понедельник … 7 — воскресенье (ISO). */
export type WeekDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** По умолчанию — понедельник, как было до блока (прототип `tgnWeekDay`). */
export const WEEK_DAY_DEFAULT: WeekDay = 1;

/** День сводки из базы: вне 1–7 или нет строки — понедельник. */
export function weekDayOf(value: number | null | undefined): WeekDay {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7
    ? (value as WeekDay)
    : WEEK_DAY_DEFAULT;
}

/** Сегодня — день недельной сводки организации. */
export function isWeekSummaryDay(day: IsoDate, weekDay: number): boolean {
  return weekdayMondayFirst(day) === weekDayOf(weekDay) - 1;
}

/**
 * Неделя сводки, как `weekRange` прототипа: с понедельника по воскресенье недели дня сводки, а в субботу
 * и воскресенье — следующая неделя. В понедельник — те же семь дней с этого дня, что и раньше.
 */
export function summaryWeek(day: IsoDate): { from: IsoDate; to: IsoDate } {
  const wd = weekdayMondayFirst(day);
  const monday = addDays(day, wd >= 5 ? 7 - wd : -wd);
  return { from: monday, to: addDays(monday, 6) };
}

/** Сообщения контрагентам «К оплате» и о долге уходят в 10:00 по Бишкеку (этап 1 — как было). */
export const CP_TG_TIME = '10:00';

/**
 * Строки с днями и часом: недельная сводка сотрудникам, «К оплате» и «Оплата за обслуживание»
 * контрагентам.
 */
export const TG_NOTICE_CODES = ['staff_week', 'cp_pay', 'cp_fee'] as const;
export type TgNoticeCode = (typeof TG_NOTICE_CODES)[number];

/** Галочки «за 5» … «за 1 день» до срока оплаты. */
export const TG_NOTICE_DAYS = [1, 2, 3, 4, 5] as const;
