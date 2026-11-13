import type { IsoDate } from '../common/dates';
import { addMonths, monthOf, type YearMonth } from '../common/months';
import type { ReportAct, ReportPeriod } from '../platform-dicts/catalog';
import type { ReportStatus } from './rules';

/**
 * «К сдаче и к оплате по месяцам» (решение заказчика 13.11.2026, прототип v90
 * `modules/report-months.js`): одно правило для вкладки «Отчёты к сдаче» карточки контрагента, вкладки
 * «По месяцам» модуля «Отчеты для сдачи», страницы контрагента и сообщения «К оплате» клиенту в
 * Telegram. Копий правила в других модулях нет.
 */

/** На сколько месяцев конец периода позже его начала (прототип `RM_ADD`). */
export const REPORT_MONTH_SHIFT: Record<ReportPeriod, number> = { M: 0, Q: 2, H: 5, Y: 11 };

/**
 * Месяц отчёта (прототип `rmYm`) — месяц, которым заканчивается его период: НДС за 10.2026 — октябрь,
 * единый налог за III кв. — сентябрь, годовой отчёт — декабрь; у отчёта по событию — месяц события.
 */
export function reportMonth(r: {
  period: ReportPeriod;
  periodStart: IsoDate;
  eventDate?: IsoDate | null;
}): YearMonth {
  if (r.eventDate) return monthOf(r.eventDate);
  return addMonths(monthOf(r.periodStart), REPORT_MONTH_SHIFT[r.period]);
}

/** Что нужно знать об отчёте, чтобы поставить его в план месяца. Суммы — целые тыйыны. */
export type MonthPlanReport = {
  id: string;
  act: ReportAct;
  status: ReportStatus;
  period: ReportPeriod;
  periodStart: IsoDate;
  eventDate?: IsoDate | null;
  dueDate: IsoDate;
  payDue: IsoDate | null;
  /** Сумма к уплате; `null` — ещё не указана. */
  amount: number | null;
  paid: number;
  overdue: boolean;
  payOverdue: boolean;
  /** Прежняя версия после «Создать уточнённый»: в план не входит. */
  superseded?: boolean;
};

/** Строка плана (прототип `rmItem`): что по отчёту нужно сделать и что уже сделано. */
export type MonthPlanItem<R extends MonthPlanReport = MonthPlanReport> = {
  report: R;
  /** Нужно сдать: у всех видов, кроме «Уплаты». */
  submit: boolean;
  /** Нужно уплатить: у вида с суммой, если сумма не 0 (не указана — тоже нужно). */
  pay: boolean;
  submitDone: boolean;
  payDone: boolean;
  /** Сумма к уплате ещё не указана. */
  noAmount: boolean;
  /** К уплате, оплачено (не больше суммы) и осталось. */
  amount: number;
  paid: number;
  left: number;
  /** Просрочена сдача или оплата. */
  late: boolean;
  /** Ближайший срок того, что ещё не сделано; всё сделано — срок сдачи. */
  when: IsoDate;
};

export type MonthPlanOptions = {
  /** «Учёт оплаты налогов»: без него оплата не отмечается и месяц закрывает одна сдача. */
  taxpay: boolean;
};

/** Отчёт входит в план: не прежняя версия и не «Не требуется». */
export const inMonthPlan = (r: Pick<MonthPlanReport, 'status' | 'superseded'>): boolean =>
  !r.superseded && r.status !== 'not_required';

export function monthPlanItem<R extends MonthPlanReport>(
  r: R,
  options: MonthPlanOptions,
): MonthPlanItem<R> {
  const submit = r.act !== 'pay';
  const pay = r.act !== 'sub' && r.amount !== 0;
  const submitDone = !submit || r.status === 'submitted';
  const hasAmount = pay && r.amount !== null && r.amount > 0;
  const amount = hasAmount ? (r.amount as number) : 0;
  const paid = hasAmount ? Math.min(r.paid, amount) : 0;
  const payDone = !pay || !options.taxpay || (hasAmount && r.paid >= amount);
  const open = [submit && !submitDone ? r.dueDate : null, pay && !payDone ? r.payDue : null]
    .filter((d): d is IsoDate => d !== null)
    .sort();
  return {
    report: r,
    submit,
    pay,
    submitDone,
    payDone,
    noAmount: pay && r.amount === null,
    amount,
    paid,
    left: amount - paid,
    late: r.overdue || r.payOverdue,
    when: open[0] ?? r.dueDate,
  };
}

/** Месяц плана (прототип `rmGroup`): строки от ближайшего срока и итоги. */
export type MonthPlanGroup<R extends MonthPlanReport = MonthPlanReport> = {
  month: YearMonth;
  items: MonthPlanItem<R>[];
  /** Сколько нужно сдать и сколько из них сдано. */
  submitCount: number;
  submitDone: number;
  /** Сколько нужно уплатить и сколько из них оплачено. */
  payCount: number;
  payDone: number;
  /** У скольких сумма ещё не указана. */
  noAmount: number;
  amount: number;
  paid: number;
  left: number;
  /** Сколько строк с просрочкой. */
  late: number;
  /** Месяц закрыт: всё сдано и оплачено. */
  done: boolean;
  /** Первый и последний срок месяца (сдачи и оплаты); строк нет — `null`. */
  from: IsoDate | null;
  to: IsoDate | null;
};

/**
 * Итоги месяца. `order` — порядок при равном сроке (прототип — порядок видов в каталоге): число
 * меньше — выше; без него — как пришли.
 */
export function monthPlanGroup<R extends MonthPlanReport>(
  month: YearMonth,
  items: readonly MonthPlanItem<R>[],
  order?: (r: R) => number,
): MonthPlanGroup<R> {
  const sorted = items
    .map((item, i) => ({ item, i }))
    .sort(
      (a, b) =>
        (a.item.when < b.item.when ? -1 : a.item.when > b.item.when ? 1 : 0) ||
        (order ? order(a.item.report) - order(b.item.report) : 0) ||
        a.i - b.i,
    )
    .map((x) => x.item);
  const count = (f: (x: MonthPlanItem<R>) => boolean) => sorted.filter(f).length;
  const sum = (k: 'amount' | 'paid' | 'left') => sorted.reduce((a, x) => a + x[k], 0);
  const dates = sorted
    .flatMap((x) => [x.submit ? x.report.dueDate : null, x.pay ? x.report.payDue : null])
    .filter((d): d is IsoDate => d !== null)
    .sort();
  return {
    month,
    items: sorted,
    submitCount: count((x) => x.submit),
    submitDone: count((x) => x.submit && x.submitDone),
    payCount: count((x) => x.pay),
    payDone: count((x) => x.pay && x.payDone),
    noAmount: count((x) => x.noAmount),
    amount: sum('amount'),
    paid: sum('paid'),
    left: sum('left'),
    late: count((x) => x.late),
    done: sorted.every((x) => x.submitDone && x.payDone),
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
  };
}

/** План по месяцам (прототип `rmPlan`): месяцы от старых к новым, внутри — от ближайшего срока. */
export function monthPlan<R extends MonthPlanReport>(
  reports: readonly R[],
  options: MonthPlanOptions & { order?: (r: R) => number },
): MonthPlanGroup<R>[] {
  const by = new Map<YearMonth, MonthPlanItem<R>[]>();
  for (const r of reports) {
    if (!inMonthPlan(r)) continue;
    const month = reportMonth(r);
    const list = by.get(month) ?? [];
    list.push(monthPlanItem(r, options));
    by.set(month, list);
  }
  return [...by.keys()]
    .sort()
    .map((month) => monthPlanGroup(month, by.get(month) ?? [], options.order));
}

/** Быстрый фильтр плана «Все / Сдать / Уплатить» (прототип `actQ`): что ещё не сделано. */
export type MonthPlanQuick = 'all' | 'sub' | 'pay';

export function monthPlanQuick(
  r: Pick<MonthPlanReport, 'act' | 'status' | 'amount' | 'paid'>,
  quick: MonthPlanQuick,
): boolean {
  if (quick === 'all') return true;
  if (quick === 'sub')
    return r.act !== 'pay' && r.status !== 'submitted' && r.status !== 'not_required';
  if (r.act === 'sub' || r.status === 'not_required') return false;
  return r.amount === null || (r.amount > 0 && r.paid < r.amount);
}

/** Месяц, отчёты за который сдаются сейчас (прототип `rmNow`): прошлый месяц. */
export const currentPlanMonth = (today: IsoDate): YearMonth => addMonths(monthOf(today), -1);
