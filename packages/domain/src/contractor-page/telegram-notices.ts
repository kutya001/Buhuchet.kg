import { bishkekDate, bishkekTime, diffDays, type IsoDate } from '../common/dates';
import { addMonths, monthOf, type YearMonth } from '../common/months';
import type { Tyiyn } from '../common/money';
import type { FeeMonth } from '../fees/charges';
import type { BotButton, BotMessage } from '../telegram/bot-message';
import { weekDayOf, type WeekDay } from '../telegram/notices';
import type { TransferBlock } from './telegram-requisite';
import { CP_TG_PAID_ACTION, CP_TG_RECEIPT_ACTION } from './telegram-pay';

/*
 * Строки «К оплате» и «Оплата за обслуживание» блока «Telegram-уведомления» (доработки 14.11.2026, блок 3,
 * этап 2; прототип v115 modules/cp-telegram.js: `PG_DAYS`, `pgDaysOf`, `pgPayDays`, `pgFeeDays`,
 * `pgPayAt`, `pgFeeAt`, `pgDebtWd`, `pgFeeSoon`, `pgFeeSoonMsg`, `pgFeeBtns`). «К оплате» уходит в каждый
 * отмеченный день («за 5» … «за 1 день» до ближайшего срока оплаты месяца) в своё время, пока месяц не
 * оплачен; «Оплата за обслуживание до …» — в отмеченные дни до дня оплаты обслуживания, после срока —
 * напоминание о долге раз в неделю в выбранный день. Время одно на оба сообщения строки «Оплата за
 * обслуживание». После «Оплатил» или принятия денег за месяц оставшиеся сообщения этого месяца не уходят.
 */

/** Галочки строки по порядку — «за 5» … «за 1 день» (прототип `PG_DAYS`). */
export const CP_NOTICE_DAYS = [5, 4, 3, 2, 1] as const;

/** Нет строки или ни одной галочки — «за 5 дней» (прототип `pgDaysOf`). */
export const CP_NOTICE_DAYS_DEFAULT = 5;

/** Время по умолчанию, по Бишкеку (прототип `PG_AT`). */
export const CP_NOTICE_AT_DEFAULT = '10:00';

/** Задачи «К оплате» и «Оплата за обслуживание» идут раз в столько минут. */
export const CP_NOTICE_SLOT_MINUTES = 5;

/** Время «ЧЧ:ММ» с 00:00 до 23:59. */
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Отмеченные дни по порядку строки; пусто или не дни — «за 5» (прототип `pgDaysOf`). */
export function cpNoticeDays(value: readonly number[] | null | undefined): number[] {
  const list = Array.isArray(value) ? CP_NOTICE_DAYS.filter((d) => value.includes(d)) : [];
  return list.length ? list : [CP_NOTICE_DAYS_DEFAULT];
}

/** Время отправки «ЧЧ:ММ»: из базы приходит «ЧЧ:ММ:СС»; нет или не время — 10:00. */
export function cpNoticeAt(value: string | null | undefined): string {
  const hm = typeof value === 'string' ? value.slice(0, 5) : '';
  return HM.test(hm) ? hm : CP_NOTICE_AT_DEFAULT;
}

/** Строки «К оплате» и «Оплата за обслуживание»: дни, время и день напоминания о долге. */
export interface CpNoticeSettings {
  payDays: number[];
  payAt: string;
  feeDays: number[];
  feeAt: string;
  /** День напоминания о долге: 1 — понедельник … 7 — воскресенье (прототип `pgDebtWd`). */
  debtWeekDay: WeekDay;
}

/** Строка таблицы `org_telegram_notices`; нет строки — значения по умолчанию. */
export interface CpNoticeRow {
  days: readonly number[];
  atTime: string | null;
  weekday: number | null;
}

export function cpNoticeSettings(rows: {
  pay?: CpNoticeRow | null;
  fee?: CpNoticeRow | null;
}): CpNoticeSettings {
  return {
    payDays: cpNoticeDays(rows.pay?.days),
    payAt: cpNoticeAt(rows.pay?.atTime),
    feeDays: cpNoticeDays(rows.fee?.days),
    feeAt: cpNoticeAt(rows.fee?.atTime),
    debtWeekDay: weekDayOf(rows.fee?.weekday),
  };
}

/**
 * День по Бишкеку, на который приходится время отправки в этот запуск задачи; null — не в этот запуск.
 * Задача идёт раз в `CP_NOTICE_SLOT_MINUTES` минут и отвечает за промежуток (`slot` − 5 минут, `slot`];
 * каждый запуск расписания выполняется один раз (пропущенный догоняется со своим временем), поэтому
 * каждое время попадает ровно в один запуск за день. Время 23:57 приходится на запуск 00:00 — и на
 * прошлый день.
 */
export function cpNoticeDay(at: string, slot: Date): IsoDate | null {
  const hm = cpNoticeAt(at);
  const start = Math.floor(slot.getTime() / 60_000) * 60_000;
  for (let i = 0; i < CP_NOTICE_SLOT_MINUTES; i++) {
    const moment = new Date(start - i * 60_000);
    if (bishkekTime(moment) === hm) return bishkekDate(moment);
  }
  return null;
}

/** Сегодня — отмеченный день до срока: до `due` ровно столько дней, сколько у одной из галочек. */
export function cpNoticeDayDue(today: IsoDate, due: IsoDate, days: readonly number[]): boolean {
  return days.includes(diffDays(due, today));
}

/**
 * Ближайшее неоплаченное начисление за обслуживание для «Оплата за обслуживание до …» (прототип
 * `pgFeeSoon`): этот месяц или следующий, в периоде обслуживания, срок ещё не наступил, остаток больше
 * нуля и клиент не нажал «Оплатил» за этот месяц. `months` — начисления с запасом до конца следующего
 * месяца (`contractorFees` на его последний день); у разового контрагента их нет.
 */
export function feeSoon(
  months: readonly Pick<FeeMonth, 'month' | 'charge' | 'got' | 'due'>[],
  today: IsoDate,
  paid: ReadonlySet<YearMonth>,
): { month: YearMonth; due: IsoDate; sum: Tyiyn } | null {
  const m0 = monthOf(today);
  for (const month of [m0, addMonths(m0, 1)]) {
    const row = months.find((m) => m.month === month);
    if (!row) continue;
    const left = row.charge - row.got;
    if (row.due > today && left > 0 && !paid.has(month)) return { month, due: row.due, sum: left };
  }
  return null;
}

/**
 * «Оплата за обслуживание до …» (прототип v115 `pgFeeSoonMsg`, `pgFeeBtns`): заголовок со сроком,
 * контрагент, текст шаблона `tgCpFeeSoon` и блок реквизитов для обслуживания, если они есть; под ним —
 * кнопка копирования, «Оплатил» и «Прислать чек» (когда контрагент может отправлять файлы через бота).
 * Месяц и сумму бот берёт из своей записи сообщения, а не из данных кнопок.
 */
export function feeSoonBotMessage(o: {
  heading: string;
  contractor: string;
  text: string;
  requisite: TransferBlock | null;
  paid: string;
  /** Подпись «Прислать чек»; null — кнопки нет. */
  receipt: string | null;
}): BotMessage {
  const buttons: BotButton[][] = [
    ...(o.requisite?.copy ? [[o.requisite.copy]] : []),
    [
      { text: o.paid, action: CP_TG_PAID_ACTION, arg: 'fee' },
      ...(o.receipt ? [{ text: o.receipt, action: CP_TG_RECEIPT_ACTION, arg: 'fee' }] : []),
    ],
  ];
  return {
    heading: o.heading,
    sub: o.contractor,
    text: o.requisite ? `${o.text}\n\n${o.requisite.text}` : o.text,
    buttons,
  };
}
