import type { IsoDate } from '../common/dates';
import type { Tyiyn } from '../common/money';
import { MONEY_AMOUNT_MAX, type MoneyMessageKey } from '../money/tax';

/*
 * Разовые услуги (задача 2.22; ТЗ «Финансовые операции по контрагентам» → «Ручная операция «Разовая
 * услуга»»; прототип modules/services.js — `serviceDlg`, `svcPay`, `serviceCard`, `svcPaid`,
 * `svcStatus`, `tranchDlg`; modules/fin-op.js — `opMax` для `sp`). Услуга — одна операция со статусом
 * оплаты; её оплаты — отдельные записи, удалённые (с причиной) в «получено» и статус не входят. Статус
 * оплаты — `serviceStatus`, длины полей — `SERVICE_NAME_MAX` и `SERVICE_DESCRIPTION_MAX` (money/ops.ts);
 * коды отказов — `FIN_MESSAGES` (часть `MONEY_MESSAGES`, тексты словаря `err.<код>`).
 */

/** Получено по услуге: действующие оплаты (прототип `sumPays`: удалённые не входят). */
export const servicePaid = (payments: readonly { amount: Tyiyn; deleted: boolean }[]): Tyiyn =>
  payments.reduce((sum, p) => (p.deleted ? sum : sum + p.amount), 0);

export interface ServiceProblem {
  field: 'name' | 'date' | 'amount' | 'reason';
  problem: MoneyMessageKey;
  /** Сумма для текста отказа (`{amount}`), в тыйынах. */
  amount?: Tyiyn;
}

/** Поля услуги в окне «Разовая услуга» и «Изменить разовую услугу». */
export interface ServiceFields {
  name: string;
  date: IsoDate | '';
  /** Стоимость в тыйынах; null — не введена или не число. */
  amount: Tyiyn | null;
}

const validAmount = (n: Tyiyn | null): n is Tyiyn =>
  n !== null && Number.isInteger(n) && n > 0 && n <= MONEY_AMOUNT_MAX;

/**
 * Проверки окна услуги (прототип `serviceDlg`): название, дата, стоимость больше нуля; при изменении —
 * не меньше уже полученного и причина, если меняются стоимость или дата. Все отказы сразу — у полей.
 */
export function serviceProblems(
  f: ServiceFields,
  edit?: { paid: Tyiyn; amount: Tyiyn; date: IsoDate; reason: string },
): ServiceProblem[] {
  const out: ServiceProblem[] = [];
  if (!f.name.trim()) out.push({ field: 'name', problem: 'service_name_required' });
  if (!f.date) out.push({ field: 'date', problem: 'service_date_required' });
  if (!validAmount(f.amount)) out.push({ field: 'amount', problem: 'service_amount_required' });
  else if (edit && f.amount < edit.paid)
    out.push({ field: 'amount', problem: 'service_amount_less', amount: edit.paid });
  if (edit && serviceChangesMoney(edit, f) && !edit.reason.trim())
    out.push({ field: 'reason', problem: 'service_reason_required' });
  return out;
}

/** Меняются ли стоимость или дата — то, для чего нужна причина (прототип `serviceDlg`: `ch`). */
export const serviceChangesMoney = (
  prev: { amount: Tyiyn; date: IsoDate },
  next: { amount: Tyiyn | null; date: IsoDate | '' },
): boolean => (next.amount !== null && next.amount !== prev.amount) || next.date !== prev.date;

/**
 * Новая оплата услуги (прототип `svcPay` → `tranchDlg`): сумма больше нуля и не больше остатка.
 * Дата — не позже сегодняшней (`money_date_future`, проверяет вызывающий).
 */
export function servicePaymentProblem(
  amount: Tyiyn | null,
  left: Tyiyn,
): { problem: MoneyMessageKey; amount?: Tyiyn } | null {
  if (!validAmount(amount)) return { problem: 'op_amount_required' };
  if (amount > left) return { problem: 'service_pay_over', amount: Math.max(0, left) };
  return null;
}
