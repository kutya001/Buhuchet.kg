import type { IsoDate } from '../common/dates';
import { formatSom, type Tyiyn } from '../common/money';
import { monthLabel, type YearMonth } from '../common/months';
import type { Translate } from '../l10n/texts';
import {
  advanceSplit,
  feeCharge,
  feeDue,
  feeMonths,
  paidByMonth,
  paymentAdvance,
  type FeeContractor,
  type FeePayment,
} from './charges';

/*
 * Окно «Принять оплату за обслуживание» и «Изменить оплату за обслуживание» (ТЗ «Плата за
 * обслуживание» → «Принять оплату за обслуживание», «Финансовые операции по контрагентам» → «Окно
 * оплаты»; прототип modules/contractor-card.js `feePayDlg`, `fpWhat`). Сумма по умолчанию — долг,
 * делится на неоплаченные начисления от старых к новым, излишек — аванс.
 */

/** Куда поступила оплата за обслуживание: на счёт организации или владельцу (прототип `fpTo`). */
export const FEE_TO_KINDS = ['org', 'owner'] as const;
export type FeeToKind = (typeof FEE_TO_KINDS)[number];

export type Allocation = readonly { month: YearMonth; amount: Tyiyn }[];

export interface FeePaymentMonth {
  month: YearMonth;
  charge: Tyiyn;
  /** «Уже оплачено» — без этой оплаты: другие оплаты месяца и аванс других оплат. */
  got: Tyiyn;
  /** Сколько ещё можно распределить на месяц. */
  left: Tyiyn;
  /** «просрочено»: срок оплаты прошёл, а месяц не оплачен. */
  overdue: boolean;
}

export interface FeePaymentForm {
  /** Строки «За какие месяцы»: неоплаченные месяцы и месяцы, которые эта оплата уже закрывала. */
  months: FeePaymentMonth[];
  /** Неоплаченное по этим месяцам. */
  unpaid: Tyiyn;
  /** Порядок «От старых к новым»; при изменении — сначала месяцы, которые оплата уже закрывала. */
  order: YearMonth[];
  /** Сумма по умолчанию: у новой — долг, если его нет — неоплаченное, иначе пусто. */
  amount: Tyiyn | null;
  /** Распределение по умолчанию. */
  allocation: Allocation;
}

/**
 * Что показывает окно оплаты. `payments` — оплаты контрагента (без удалённых), `edit` — изменяемая из
 * них (её распределение не считается «уже оплаченным»), `debt` — долг контрагента.
 */
export function feePaymentForm<P extends FeePayment>(
  c: FeeContractor,
  payments: readonly P[],
  debt: Tyiyn,
  today: IsoDate,
  edit: P | null = null,
): FeePaymentForm {
  const own = paidByMonth(edit ? [edit] : []);
  const paid = paidByMonth(payments);
  const base = (m: YearMonth) => (paid.get(m) ?? 0) - (own.get(m) ?? 0);
  const all = feeMonths(c, today);
  const others = payments.filter((p) => p !== edit);
  const split = advanceSplit(
    all,
    (m) => feeCharge(c, m),
    base,
    others.reduce((a, p) => a + paymentAdvance(p), 0),
  );
  const rows = all
    .map((month): FeePaymentMonth => {
      const charge = feeCharge(c, month);
      const got = base(month) + (split.use.get(month) ?? 0);
      const left = Math.max(0, charge - got);
      return { month, charge, got, left, overdue: feeDue(c, month) < today && left > 0 };
    })
    .filter((r) => r.left > 0 || own.has(r.month));
  const unpaid = rows.reduce((a, r) => a + r.left, 0);
  const order = edit
    ? [...rows.filter((r) => own.has(r.month)), ...rows.filter((r) => !own.has(r.month))]
    : rows;
  const amount = edit ? edit.amount : debt || unpaid || null;
  return {
    months: rows,
    unpaid,
    order: order.map((r) => r.month),
    amount,
    allocation: edit
      ? [...own].map(([month, a]) => ({ month, amount: a }))
      : autoAllocate(rows, amount ?? 0),
  };
}

/** «От старых к новым»: сумма заполняет месяцы по порядку, сколько осталось по каждому. */
export function autoAllocate(
  order: readonly Pick<FeePaymentMonth, 'month' | 'left'>[],
  total: Tyiyn,
): Allocation {
  const out: { month: YearMonth; amount: Tyiyn }[] = [];
  let t = total;
  for (const r of order) {
    const x = Math.min(t, r.left);
    if (x > 0) {
      out.push({ month: r.month, amount: x });
      t -= x;
    }
  }
  return out;
}

/** «Станет» у строки месяца: больше долга, оплачено, частично; пусто — на месяц ничего. */
export function allocationRowState(
  row: Pick<FeePaymentMonth, 'charge' | 'got' | 'left'>,
  amount: Tyiyn,
): 'over' | 'paid' | 'partial' | null {
  if (!amount) return null;
  if (amount > row.left) return 'over';
  return row.got + amount >= row.charge ? 'paid' : 'partial';
}

/** Строка под таблицей: распределено больше суммы, остаток — аванс, сходится. */
export function allocationBalance(
  total: Tyiyn,
  allocation: Allocation,
):
  | { state: 'over'; amount: Tyiyn }
  | { state: 'advance'; amount: Tyiyn }
  | { state: 'even' }
  | null {
  const d = allocation.reduce((a, x) => a + x.amount, 0);
  if (d > total) return { state: 'over', amount: d - total };
  if (total > d) return { state: 'advance', amount: total - d };
  return total > 0 ? { state: 'even' } : null;
}

export const FEE_PAYMENT_PROBLEMS = [
  'amount_required',
  'row_over_debt',
  'allocated_over_amount',
  'date_required',
  'date_future',
] as const;
export type FeePaymentProblem = (typeof FEE_PAYMENT_PROBLEMS)[number];

/** Проверка окна оплаты (прототип `fp-ok`): сумма, строки месяцев, распределение, дата. */
export function feePaymentProblem(
  months: readonly Pick<FeePaymentMonth, 'month' | 'left'>[],
  amount: Tyiyn | null,
  allocation: Allocation,
  date: IsoDate | null,
  today: IsoDate,
): { field: 'amount' | 'date'; problem: FeePaymentProblem; over?: Tyiyn } | null {
  if (amount === null || amount <= 0) return { field: 'amount', problem: 'amount_required' };
  const leftOf = new Map(months.map((r) => [r.month, r.left]));
  if (allocation.some((x) => x.amount < 0 || x.amount > (leftOf.get(x.month) ?? 0)))
    return { field: 'amount', problem: 'row_over_debt' };
  const d = allocation.reduce((a, x) => a + x.amount, 0);
  if (d > amount) return { field: 'amount', problem: 'allocated_over_amount', over: d - amount };
  if (!date) return { field: 'date', problem: 'date_required' };
  if (date > today) return { field: 'date', problem: 'date_future' };
  return null;
}

/** Код ошибки окна оплаты для API: `fee_<проблема>`, тексты — `err.fee_<проблема>`. */
export const feePaymentErrorCode = (problem: FeePaymentProblem) => `fee_${problem}` as const;

/** Сохраняемое распределение: месяцы с суммой больше 0, по порядку месяцев. */
export const savedAllocation = (allocation: Allocation): Allocation =>
  allocation
    .filter((x) => x.amount > 0)
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

/** Целые сомы без копеек (прототип `fmtM(n, false)`). */
const wholeSom = (t: Tyiyn) => formatSom(Math.round(t / 100) * 100, 'auto');

/** «сентябрь 2026 — 14 000, аванс — 2 000» — что закрыла оплата (прототип `txt`). */
export function allocationText(t: Translate, total: Tyiyn, allocation: Allocation): string {
  const d = allocation.reduce((a, x) => a + x.amount, 0);
  const parts = allocation.map((x) =>
    t('fee.alloc.item', { month: monthLabel(x.month), amount: wholeSom(x.amount) }),
  );
  if (total > d) parts.push(t('fee.alloc.advance', { amount: wholeSom(total - d) }));
  return parts.join(', ');
}
