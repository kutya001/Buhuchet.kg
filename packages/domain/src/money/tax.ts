import { addDays, type IsoDate } from '../common/dates';
import { formatSomWithUnit, type Tyiyn } from '../common/money';
import type { ReportAct } from '../platform-dicts/catalog';
import { nextWorkingDay, type ProductionCalendar } from '../platform-dicts/calendar';

/*
 * Деньги по отчётам: статус оплаты налога, график оплаты, сверка денег контрагента по отчётам
 * («Получено от контрагента», «Достаточно» / «Недостача»), «Сдан» только после оплаты, окно «Отметить
 * оплаченным» (ТЗ «Отчеты для сдачи» → «Сдача после оплаты», «Оплата налога»; прототип core/derive.js
 * `derive`, core/org.js `schedule`, ui/status-scale.js `subNeedPay`, `subPayWhy`, `payDlg`).
 *
 * Все суммы — целые тыйыны. «Оплачено в бюджет» отчёта (`paid`) — сумма его отметок оплаты, в том
 * числе «Оплатил контрагент сам» (`selfPaid`); деньги контрагента на счетах — `fundsBalance` операций.
 */

/** Статус оплаты налога — шкала `payment` (`common/status.ts`). */
export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'not_required'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Сверка по отчёту: «Оплачено», «Достаточно», «Недостача» (столбец «Деньги (сверка)»). */
export const FUNDS_STATES = ['paid', 'enough', 'short'] as const;

/** Итог сверки за месяц на вкладке «Деньги». */
export const VERDICT_STATES = ['short', 'enough', 'enough_surplus', 'surplus'] as const;

/** Отчёт глазами денег. `status` — код шкалы сдачи (`todo`, `submitted`, `not_required`, …). */
export interface TaxReport {
  id: string;
  act: ReportAct;
  status: string;
  /** «К уплате»; `null` — сумма ещё не указана. */
  sum: Tyiyn | null;
  /** «Оплачено в бюджет» — все отметки оплаты, с «Оплатил контрагент сам». */
  paid: Tyiyn;
  /** Из них «Оплатил контрагент сам»: в «Получено от контрагента» и в остаток не входит. */
  selfPaid: Tyiyn;
  /** Принято под этот отчёт детализацией поступлений. */
  received: Tyiyn;
  /** Есть уточнённая версия: деньги и просрочка считаются по ней. */
  superseded: boolean;
  /** Срок оплаты — первого неоплаченного платежа графика (`schedulePayDue`). */
  payDue: IsoDate;
}

/** У отчёта есть сумма к уплате: «Уплата» и «Сдача + уплата». */
export const hasTaxSum = (act: ReportAct): boolean => act !== 'sub';

/**
 * Статус оплаты налога (прототип `derive`, `payStatus`): у «Сдача», у отчёта «Не требуется» и при
 * сумме 0 — «Не требуется»; суммы ещё нет — «Не оплачено».
 */
export function paymentStatus(
  r: Pick<TaxReport, 'act' | 'status' | 'sum' | 'paid'>,
): PaymentStatus {
  if (!hasTaxSum(r.act) || r.status === 'not_required') return 'not_required';
  if (r.sum === null) return 'unpaid';
  if (r.sum === 0) return 'not_required';
  if (r.paid >= r.sum) return 'paid';
  return r.paid > 0 ? 'partial' : 'unpaid';
}

/** У «Уплата» статус сдачи считается сам: оплачено полностью — «Сдан», иначе «К сдаче». */
export function payOnlyReportStatus(r: Pick<TaxReport, 'status' | 'sum' | 'paid'>): string {
  if (r.status === 'not_required') return r.status;
  return r.sum !== null && r.sum > 0 && r.paid >= r.sum ? 'submitted' : 'todo';
}

/** Платёж графика оплаты. */
export interface SchedulePart {
  due: IsoDate;
  amount: Tyiyn;
  paid: Tyiyn;
}

/**
 * Сроки платежей (прототип `schedule`): у вида с оплатой долями — по дням `[месяц, число]` года
 * периода отчёта, перенесённые с выходного на рабочий день; у остальных — один платёж со сроком оплаты
 * отчёта. Число больше дней месяца переходит на следующий месяц, как `Date.UTC` прототипа.
 */
export function scheduleDues(
  installments: readonly (readonly [number, number])[] | null,
  year: number,
  payDue: IsoDate,
  calendar: ProductionCalendar,
): IsoDate[] {
  if (!installments || installments.length === 0) return [payDue];
  return installments.map(([m, d]) => {
    const first = `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
    return nextWorkingDay(calendar, addDays(first, d - 1));
  });
}

/**
 * График оплаты (прототип `schedule`): несколько платежей — равные доли, округлённые вниз до 10 сом,
 * остаток — в последнем; оплаченное раскладывается по платежам от первого. Без суммы к уплате — 0.
 */
export function paymentSchedule(
  sum: Tyiyn | null,
  paid: Tyiyn,
  dues: readonly IsoDate[],
): SchedulePart[] {
  const total = sum ?? 0;
  const n = dues.length;
  const each = n > 1 ? Math.floor(total / n / 1000) * 1000 : total;
  let left = paid;
  return dues.map((due, i) => {
    const amount = i < n - 1 ? each : total - each * (n - 1);
    const p = Math.min(left, amount);
    left -= p;
    return { due, amount, paid: p };
  });
}

/** Срок оплаты отчёта: первого неоплаченного платежа, а если оплачено всё — последнего. */
export function schedulePayDue(parts: readonly SchedulePart[], fallback: IsoDate): IsoDate {
  const open = parts.find((x) => x.paid < x.amount);
  return open?.due ?? parts.at(-1)?.due ?? fallback;
}

/**
 * Оплата просрочена (прототип `payOverdue`): не оплачено или оплачено частично, сумма больше 0, срок
 * оплаты прошёл; у приостановленного контрагента и у заменённой уточнённой версии просрочки нет.
 */
export function paymentOverdue(
  r: Pick<TaxReport, 'act' | 'status' | 'sum' | 'paid' | 'superseded' | 'payDue'>,
  today: IsoDate,
  contractorPaused: boolean,
): boolean {
  const s = paymentStatus(r);
  return (
    !contractorPaused &&
    !r.superseded &&
    (s === 'unpaid' || s === 'partial') &&
    (r.sum ?? 0) > 0 &&
    r.payDue < today
  );
}

/**
 * Виды операций по счёту контрагента (журнал «Финансовые операции», прототип OPK): поступление, оплата
 * налога, списание в бонус, возврат контрагенту, возврат по уточнённому расчёту, корректирующая запись,
 * перевод со счёта организации на счёт сотрудника. Поступление и оплата — задача 2.19, остальные — 2.20.
 */
export const MONEY_OP_KINDS = ['in', 'pay', 'bonus', 'refund', 'back', 'corr', 'xfer'] as const;
export type MoneyOpKind = (typeof MONEY_OP_KINDS)[number];

/**
 * Чей счёт: организации, сотрудника (его виртуальный счёт) или «Оплатил контрагент сам» — деньги мимо
 * наших счетов (прототип holder: 'org', номер сотрудника, 'client').
 */
export const MONEY_HOLDER_KINDS = ['org', 'employee', 'client'] as const;
export type MoneyHolderKind = (typeof MONEY_HOLDER_KINDS)[number];

/** Примечание операции — не длиннее. */
export const MONEY_NOTE_MAX = 500;
/** Строк детализации в одном поступлении — не больше (форма показывает неоплаченные отчёты контрагента). */
export const RECEIPT_ROWS_MAX = 500;
/** Сумма одной операции — не больше 10 млрд сом (тыйыны): защита от опечатки и переполнения итогов. */
export const MONEY_AMOUNT_MAX = 1_000_000_000_000;

/**
 * Деньги контрагента на счетах — сотрудника и организации вместе (прототип `derive`, `c.avail`):
 * поступления, возвраты по уточнённому и обратные записи прибавляют, оплаты, списания в бонус и
 * возвраты контрагенту — вычитают; «Оплатил контрагент сам» и перевод между счетами остаток не меняют.
 */
export function fundsBalance(
  ops: readonly { kind: MoneyOpKind; amount: Tyiyn; self?: boolean }[],
): Tyiyn {
  let total = 0;
  for (const o of ops) {
    if (o.kind === 'xfer' || o.self) continue;
    total += o.kind === 'in' || o.kind === 'back' || o.kind === 'corr' ? o.amount : -o.amount;
  }
  return total;
}

/** Сверка по отчёту: столбец «Деньги» — «Оплачено», «Достаточно», «Недостача». */
export type ReportFunds =
  | { state: 'paid' }
  | { state: 'enough'; need: Tyiyn }
  | { state: 'short'; need: Tyiyn; short: Tyiyn };

export interface ReportMoney {
  /** `null` — сверки нет: «Сдача», без суммы или 0, «Не требуется», заменённая уточнённая версия. */
  funds: ReportFunds | null;
  /** «Получено от контрагента»: его деньги, уже оплаченные по отчёту, и отложенные под него. */
  received: Tyiyn;
  /** Отложено именно под этот отчёт из принятого под него (в сверке за месяц — «Отложено под …»). */
  reserved: Tyiyn;
}

export interface ContractorMoney {
  /** Деньги контрагента на счетах (`fundsBalance`). */
  available: Tyiyn;
  /** Свободный остаток после всех неоплаченных отчётов: «Списать» и «Вернуть остаток». */
  free: Tyiyn;
  reports: Map<string, ReportMoney>;
}

/**
 * Сверка денег контрагента по отчётам (прототип `derive`): сначала под каждый отчёт резервируются
 * деньги, принятые именно за него, потом свободный остаток идёт на отчёты по сроку оплаты (при равном —
 * в порядке списка). Налог контрагента — только из его денег.
 */
export function contractorMoney(available: Tyiyn, reports: readonly TaxReport[]): ContractorMoney {
  const out = new Map<string, ReportMoney>();
  for (const r of reports) {
    out.set(r.id, { funds: null, received: Math.max(0, r.paid - r.selfPaid), reserved: 0 });
  }
  const pending = reports
    .map((r, i) => ({ r, i }))
    .filter(
      ({ r }) =>
        hasTaxSum(r.act) && (r.sum ?? 0) > 0 && r.status !== 'not_required' && !r.superseded,
    )
    .sort((a, b) => (a.r.payDue < b.r.payDue ? -1 : a.r.payDue > b.r.payDue ? 1 : a.i - b.i))
    .map(({ r }) => r);
  let left = available;
  for (const r of pending) {
    const sum = r.sum!;
    if (r.paid >= sum) continue;
    const reserved = Math.max(0, Math.min(sum - r.paid, r.received - r.paid, left));
    out.get(r.id)!.reserved = reserved;
    left -= reserved;
  }
  for (const r of pending) {
    const m = out.get(r.id)!;
    const sum = r.sum!;
    if (r.paid >= sum) {
      m.funds = { state: 'paid' };
      continue;
    }
    const need = sum - r.paid;
    const rest = need - m.reserved;
    m.received += m.reserved + Math.min(rest, Math.max(0, left));
    if (left >= rest) {
      m.funds = { state: 'enough', need };
      left -= rest;
    } else {
      m.funds = { state: 'short', need, short: rest - left };
      left = 0;
    }
  }
  return { available, free: left, reports: out };
}

/** «Осталось оплатить». */
export const leftToPay = (r: Pick<TaxReport, 'sum' | 'paid'>): Tyiyn =>
  Math.max(0, (r.sum ?? 0) - r.paid);

/**
 * «Сдан» только после оплаты (прототип `subNeedPay`, решение заказчика 25.10.2026): у «Сдача + уплата»
 * с суммой к уплате больше 0 «Сдан» ставится, когда оплачено хоть что-то. Не действует при выключенных
 * «Учёте оплаты налогов» или «Сдаче отчёта только после оплаты», у «Не требуется» и у заменённой
 * уточнённой версии. `sum` — сумма из окна «Сдан», если её там ввели.
 */
export function submitNeedsPayment(
  r: Pick<TaxReport, 'act' | 'status' | 'sum' | 'paid' | 'superseded'>,
  payFirst: boolean,
  sum: Tyiyn | null = r.sum,
): boolean {
  if (!payFirst || r.superseded || r.status === 'not_required' || r.act !== 'both') return false;
  return (sum ?? 0) > 0 && !(r.paid > 0);
}

/** Причина «Сначала оплатите налог: к уплате 5 000 сом, оплачено 0 сом» (прототип `subPayWhy`). */
export function submitPaymentReason(
  r: Pick<TaxReport, 'act' | 'status' | 'sum' | 'paid' | 'superseded'>,
  payFirst: boolean,
  sum: Tyiyn | null = r.sum,
): string {
  if (!submitNeedsPayment(r, payFirst, sum)) return '';
  return `Сначала оплатите налог: к уплате ${formatSomWithUnit(sum ?? 0)}, оплачено ${formatSomWithUnit(r.paid)}`;
}

/**
 * Окно «Отметить оплаченным» (прототип `payDlg`): сумма по умолчанию — остаток ближайшего неоплаченного
 * платежа графика (нет графика — остаток к уплате); «Оплатил контрагент сам» включён сразу, если денег
 * контрагента на этот отчёт не хватает (сверка не «Достаточно»).
 */
export function paymentDefaults(
  r: Pick<TaxReport, 'sum' | 'paid'>,
  parts: readonly SchedulePart[],
  funds: ReportFunds | null,
): { amount: Tyiyn; self: boolean } {
  const next = parts.find((x) => x.paid < x.amount);
  return {
    amount: next ? next.amount - next.paid : (r.sum ?? 0) - r.paid,
    self: funds?.state !== 'enough',
  };
}

export const PAYMENT_PROBLEMS = ['amount_required', 'not_enough'] as const;
export type PaymentProblem = (typeof PAYMENT_PROBLEMS)[number];

/**
 * Проверка оплаты: сумма больше 0; без «Оплатил контрагент сам» — только деньгами контрагента: сверка
 * по отчёту «Достаточно» и сумма не больше денег на счетах. Оплатить больше суммы к уплате можно (пеня).
 */
export function paymentProblem(
  amount: Tyiyn,
  self: boolean,
  funds: ReportFunds | null,
  available: Tyiyn,
): PaymentProblem | null {
  if (!(amount > 0)) return 'amount_required';
  if (!self && (funds?.state !== 'enough' || amount > available)) return 'not_enough';
  return null;
}

/**
 * Текст ошибки оплаты (прототип `payDlg`): «Денег контрагента на этот отчёт не хватает: 2 000 сом.
 * Примите деньги или отметьте «Оплатил контрагент сам»», при «Достаточно», но сумме больше денег —
 * «…: доступно 1 000 сом. …».
 */
export function paymentProblemText(
  problem: PaymentProblem,
  funds: ReportFunds | null,
  available: Tyiyn,
): string {
  if (problem === 'amount_required') return 'Введите сумму больше нуля';
  const how =
    funds?.state === 'short'
      ? `: ${formatSomWithUnit(funds.short)}`
      : funds?.state === 'enough' || !funds
        ? `: доступно ${formatSomWithUnit(available)}`
        : '';
  return `Денег контрагента на этот отчёт не хватает${how}. Примите деньги или отметьте «Оплатил контрагент сам»`;
}

/** Итог сверки денег по контрагенту за месяц. */
export type ReconciliationVerdict =
  | { state: 'short'; amount: Tyiyn }
  | { state: 'enough' }
  | { state: 'enough_surplus'; amount: Tyiyn }
  | { state: 'surplus'; amount: Tyiyn };

export interface MonthReconciliation {
  /** «Нужно оплатить»: неоплаченные отчёты со сроком оплаты до конца месяца, по сроку. */
  due: string[];
  dueSum: Tyiyn;
  /** «Поступило и не потрачено». */
  available: Tyiyn;
  /** «Отложено под отчёты с более поздним сроком»: отчёты и сумма. */
  later: string[];
  laterSum: Tyiyn;
  verdict: ReconciliationVerdict;
}

/**
 * Сверка денег по контрагенту на вкладке «Деньги» (прототип contractor-card.js, вкладка `money`):
 * нужно оплатить по сроку оплаты до конца месяца `monthEnd`, поступило и не потрачено, отложено под
 * отчёты с более поздним сроком; излишек — только из свободных денег.
 */
export function monthReconciliation(
  money: ContractorMoney,
  reports: readonly TaxReport[],
  monthEnd: IsoDate,
): MonthReconciliation {
  const byDue = (list: TaxReport[]) =>
    list
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (a.r.payDue < b.r.payDue ? -1 : a.r.payDue > b.r.payDue ? 1 : a.i - b.i))
      .map(({ r }) => r);
  const due = byDue(
    reports.filter(
      (r) =>
        !r.superseded &&
        hasTaxSum(r.act) &&
        (r.sum ?? 0) > 0 &&
        r.paid < r.sum! &&
        r.status !== 'not_required' &&
        r.payDue <= monthEnd,
    ),
  );
  const reservedOf = (r: TaxReport) => money.reports.get(r.id)?.reserved ?? 0;
  const later = byDue(reports.filter((r) => reservedOf(r) > 0 && r.payDue > monthEnd));
  const dueSum = due.reduce((a, r) => a + r.sum! - r.paid, 0);
  const laterSum = later.reduce((a, r) => a + reservedOf(r), 0);
  const diff = money.available - laterSum - dueSum;
  const verdict: ReconciliationVerdict =
    diff < 0
      ? { state: 'short', amount: -diff }
      : diff === 0
        ? { state: 'enough' }
        : { state: dueSum ? 'enough_surplus' : 'surplus', amount: diff };
  return {
    due: due.map((r) => r.id),
    dueSum,
    available: money.available,
    later: later.map((r) => r.id),
    laterSum,
    verdict,
  };
}

/**
 * Почему «Списать в бонус» и «Вернуть остаток» неактивны (прототип `noFree`); пусто — свободный
 * остаток есть.
 */
export function noFreeBalanceReason(money: Pick<ContractorMoney, 'available' | 'free'>): string {
  if (money.free > 0) return '';
  if (money.available > 0) {
    const needed = money.available - Math.max(0, money.free);
    return `Свободного остатка нет: ${formatSomWithUnit(needed)} нужны на неоплаченные налоги`;
  }
  return 'Свободного остатка нет: денег контрагента на счёте нет';
}

/**
 * Тексты отказов денежных действий (прототип inDlg, payDlg, rollbackDlg('pay')); `{amount}` и `{date}` —
 * подстановки из `details` ответа API. Ключ с точкой — вариант текста (`details.variant`).
 */
export const MONEY_MESSAGES = {
  taxpay_off: 'Учёт оплаты налогов выключен в учётной политике',
  // Текст словаря `err.contractor_archived` — общий с карточкой контрагента.
  contractor_archived: 'Контрагент в архиве — сначала верните его из архива',
  receipt_total_less: 'Общая сумма должна быть не меньше суммы строк детализации',
  receipt_row_invalid: 'Строка детализации — не неоплаченный отчёт этого контрагента',
  receipt_row_over: 'В строке сумма больше, чем нужно оплатить',
  // Часть за обслуживание в поступлении (задача 2.21).
  receipt_fee_invalid: 'Строка обслуживания — не неоплаченный месяц этого контрагента',
  one_sum_one_off: 'У разового контрагента нет платы за обслуживание',
  receipt_file_required:
    'Прикрепите файл: для этого контрагента поступление без файла не сохраняется',
  money_file_not_found: 'Файл не найден: загрузите его ещё раз',
  money_date_future: 'Укажите дату не позже сегодняшней',
  payment_not_allowed: 'Этот отчёт не ждёт оплаты',
  payment_not_enough:
    'Денег контрагента на этот отчёт не хватает. Примите деньги или отметьте «Оплатил контрагент сам»',
  'payment_not_enough.short':
    'Денег контрагента на этот отчёт не хватает: {amount}. Примите деньги или отметьте «Оплатил контрагент сам»',
  'payment_not_enough.available':
    'Денег контрагента на этот отчёт не хватает: доступно {amount}. Примите деньги или отметьте «Оплатил контрагент сам»',
  payment_none: 'Оплат по отчёту нет: отменять нечего',
  payment_superseded: 'Сначала откатите уточнённую версию отчёта',
  payment_bonus_after: 'Сначала отмените списание остатка от {date}: оно сделано после этой оплаты',
} as const;
export type MoneyMessageKey = keyof typeof MONEY_MESSAGES;

/**
 * Вариант текста «не хватает» (прототип payDlg): при «Недостаче» — сколько не хватает, иначе — сколько
 * доступно на счетах.
 */
export function paymentShortage(
  funds: ReportFunds | null,
  available: Tyiyn,
): { variant: 'short' | 'available'; amount: Tyiyn } {
  return funds?.state === 'short'
    ? { variant: 'short', amount: funds.short }
    : { variant: 'available', amount: available };
}
