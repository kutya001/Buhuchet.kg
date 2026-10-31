import { addDays, type IsoDate } from '../common/dates';
import type { Tyiyn } from '../common/money';
import {
  addMonths,
  daysInMonth,
  monthDay,
  monthOf,
  monthRange,
  type YearMonth,
} from '../common/months';
import type { FirstMonthMode } from '../contractors/rules';
import { inService, type ServicePeriod } from '../contractors/service';
import { tariffAt, type Tariff } from './tariffs';

/*
 * Начисления платы за обслуживание, оплаты по месяцам, аванс и долг (ТЗ «Контрагенты» → «Плата за
 * обслуживание»; прототип core/org.js `feeMonths`, `feeCharge`, `feeDue`, core/derive.js `fpAlloc`,
 * `fpAdv`, `feeAdvSplit`, `feeGot`, `derive`, вкладка «Обслуживание» карточки контрагента,
 * ui/status-scale.js `waDlg` с `fee`). Все суммы — целые тыйыны.
 */

/** Контрагент глазами платы за обслуживание. */
export interface FeeContractor {
  /** Разовый контрагент — без начислений. */
  oneOff: boolean;
  /** Дата начала обслуживания. */
  start: IsoDate;
  /** День, когда контрагента завели в программе (по Бишкеку). */
  createdOn: IsoDate;
  /** День месяца, до которого платят за обслуживание, 1–28. */
  feeDay: number;
  /** Первый неполный месяц: полный, пропорционально дням, со следующего месяца. */
  firstMonth: FirstMonthMode;
  periods: readonly ServicePeriod[];
  tariffs: readonly Tariff[];
}

/**
 * Месяцы, за которые к сегодняшнему дню есть начисление: месяцы обслуживания с месяца начала, но не
 * раньше месяца, когда контрагента завели в программе, по текущий (прототип `feeMonths`; решение
 * заказчика 27.10.2026, docs/deviations.md п. В-5). У разового контрагента начислений нет.
 */
export function feeMonths(c: FeeContractor, today: IsoDate): YearMonth[] {
  if (c.oneOff) return [];
  const first = [monthOf(c.start), monthOf(c.createdOn)].sort()[1]!;
  return monthRange(first, monthOf(today)).filter((m) => inService(c.periods, m));
}

/**
 * Начисление за месяц по действующей в нём ставке (прототип `feeCharge`): годовая — только в месяце
 * «действует с» каждый год; первый неполный месяц — полный, пропорционально оставшимся дням с днём
 * начала (с округлением до сома) или ничего.
 */
export function feeCharge(
  c: Pick<FeeContractor, 'start' | 'firstMonth' | 'tariffs'>,
  month: YearMonth,
): Tyiyn {
  const t = tariffAt(c.tariffs, month);
  if (!t) return 0;
  if (t.period === 'Y') return month.slice(5) === t.from.slice(5) ? t.amount : 0;
  const startDay = Number(c.start.slice(8));
  if (month === monthOf(c.start) && startDay !== 1) {
    if (c.firstMonth === 'next') return 0;
    if (c.firstMonth === 'prorate') {
      const days = daysInMonth(month);
      return Math.round((t.amount * (days - startDay + 1)) / (days * 100)) * 100;
    }
  }
  return t.amount;
}

/**
 * Срок оплаты за месяц — «день оплаты» этого месяца; если он раньше начала обслуживания или не позже
 * дня, когда контрагента завели, — тот же день следующего месяца (прототип `feeDue`).
 */
export function feeDue(
  c: Pick<FeeContractor, 'start' | 'createdOn' | 'feeDay'>,
  month: YearMonth,
): IsoDate {
  const due = monthDay(month, c.feeDay);
  return due < c.start || due <= c.createdOn ? monthDay(addMonths(month, 1), c.feeDay) : due;
}

/** Оплата за обслуживание: сумма и какие месяцы она закрывает; остальное — аванс. */
export interface FeePayment {
  amount: Tyiyn;
  allocation: readonly { month: YearMonth; amount: Tyiyn }[];
}

/** Аванс оплаты — всё, что сверх распределённого по месяцам (прототип `fpAdv`). */
export const paymentAdvance = (p: FeePayment): Tyiyn =>
  Math.max(0, p.amount - p.allocation.reduce((a, x) => a + x.amount, 0));

/** Оплачено за месяцы по распределению оплат (прототип `c.feePaid`). */
export function paidByMonth(payments: readonly FeePayment[]): Map<YearMonth, Tyiyn> {
  const out = new Map<YearMonth, Tyiyn>();
  for (const p of payments)
    for (const x of p.allocation) out.set(x.month, (out.get(x.month) ?? 0) + x.amount);
  return out;
}

/**
 * Аванс сам засчитывается в неоплаченные начисления от старых к новым (решение заказчика 24.10.2026;
 * прототип `feeAdvSplit`): сколько аванса пошло на каждый месяц и сколько осталось.
 */
export function advanceSplit(
  months: readonly YearMonth[],
  chargeOf: (m: YearMonth) => Tyiyn,
  paidOf: (m: YearMonth) => Tyiyn,
  advance: Tyiyn,
): { use: Map<YearMonth, Tyiyn>; left: Tyiyn } {
  const use = new Map<YearMonth, Tyiyn>();
  let left = advance;
  for (const m of months) {
    const need = chargeOf(m) - paidOf(m);
    if (left > 0 && need > 0) {
      const x = Math.min(need, left);
      use.set(m, x);
      left -= x;
    }
  }
  return { use, left };
}

/** Статус оплаты начисления — шкала `payment` (`common/status.ts`). */
export type FeeMonthStatus = 'unpaid' | 'partial' | 'paid';

export interface FeeMonth {
  month: YearMonth;
  charge: Tyiyn;
  /** Оплачено распределением оплат. */
  paid: Tyiyn;
  /** Засчитано из аванса. */
  fromAdvance: Tyiyn;
  /** Всего получено за месяц: `paid` + `fromAdvance`. */
  got: Tyiyn;
  due: IsoDate;
  status: FeeMonthStatus;
  /** Срок оплаты прошёл, а оплачено не всё («просрочено»). */
  overdue: boolean;
}

export interface ContractorFees {
  months: FeeMonth[];
  /** Долг: недоплата по начислениям, срок оплаты которых наступил (сегодня или раньше). */
  debt: Tyiyn;
  /** Аванс, ещё не засчитанный в начисления. */
  advance: Tyiyn;
}

/** Начисления и оплаты контрагента по месяцам, долг и аванс (прототип `derive`, вкладка «Обслуживание»). */
export function contractorFees(
  c: FeeContractor,
  payments: readonly FeePayment[],
  today: IsoDate,
): ContractorFees {
  const months = feeMonths(c, today);
  const paid = paidByMonth(payments);
  const paidOf = (m: YearMonth) => paid.get(m) ?? 0;
  const charges = new Map(months.map((m) => [m, feeCharge(c, m)]));
  const split = advanceSplit(
    months,
    (m) => charges.get(m)!,
    paidOf,
    payments.reduce((a, p) => a + paymentAdvance(p), 0),
  );
  let debt = 0;
  const rows = months.map((month): FeeMonth => {
    const charge = charges.get(month)!;
    const fromAdvance = split.use.get(month) ?? 0;
    const got = paidOf(month) + fromAdvance;
    const due = feeDue(c, month);
    if (due <= today) debt += Math.max(0, charge - got);
    return {
      month,
      charge,
      paid: paidOf(month),
      fromAdvance,
      got,
      due,
      status: got >= charge ? 'paid' : got > 0 ? 'partial' : 'unpaid',
      overdue: got < charge && due < today,
    };
  });
  return { months: rows, debt, advance: split.left };
}

/**
 * «Принять оплату за обслуживание» есть у контрагента с начислениями: не разового, не в архиве, хотя
 * бы одно начисление больше 0 (прототип `feeAccOk`; включённая функция и права проверяет сервер).
 */
export const canAcceptFeePayment = (
  c: Pick<FeeContractor, 'oneOff'>,
  archived: boolean,
  fees: Pick<ContractorFees, 'months'>,
): boolean => !c.oneOff && !archived && fees.months.some((m) => m.charge > 0);

/**
 * Подстановки напоминания о долге за обслуживание в WhatsApp (прототип `waDlg` с `fee`): {месяц} —
 * месяцы долга (решение заказчика 27.10.2026, docs/deviations.md п. В-6), {сумма} — долг, {дата} — день оплаты месяца после
 * последнего из них, но не раньше завтрашнего дня.
 */
export function feeReminder(
  fees: ContractorFees,
  feeDay: number,
  today: IsoDate,
): { months: YearMonth[]; amount: Tyiyn; payBy: IsoDate } {
  const months = fees.months.filter((m) => m.charge > m.got && m.due <= today).map((m) => m.month);
  const last = months.at(-1);
  const payBy = last ? monthDay(addMonths(last, 1), feeDay) : today;
  return { months, amount: fees.debt, payBy: payBy < today ? addDays(today, 1) : payBy };
}
