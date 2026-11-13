import type { IsoDate } from '../common/dates';
import type { Tyiyn } from '../common/money';
import type { FIN_MESSAGES } from '../money/fin-messages';
import { MONEY_AMOUNT_MAX } from '../money/tax';
import { servicePaid } from './services';

/*
 * Бонусы сотрудников (прототип v84 и v87, просьба заказчика 12.11.2026; modules/services.js —
 * `bonusLog`, `bonusSum`, `svcBonusOn`, `serviceDlg`, `bonusOutDlg`, `bonusUndo`; modules/staff.js —
 * вкладка «Бонусы»; docs/deviations.md п. О-75). Начисления: остаток контрагента, списанный в бонус
 * (операция «Списание в бонус» со счёта сотрудника), и бонус за разовую услугу (строки «сотрудник —
 * сумма» в услуге). Бонус за услугу начисляется, когда услуга оплачена полностью, датой последней
 * оплаты; до этого он «Ожидает оплаты услуги» и в остаток не входит. Начисленное копится как остаток
 * бонусов сотрудника; выплата — отдельным списанием с основанием, его можно отменить.
 */

type BonusMessageKey = keyof typeof FIN_MESSAGES;

/** Строк «сотрудник — сумма» в одной услуге — не больше. */
export const SERVICE_BONUS_LINES_MAX = 50;
/** Длина основания списания бонуса. */
export const BONUS_NOTE_MAX = 300;

/** Виды записей журнала «Начисления и списания» (прототип `bonusLog`: `kind`). */
export const BONUS_LOG_KINDS = ['cp', 'svc', 'wait', 'out'] as const;
export type BonusLogKind = (typeof BONUS_LOG_KINDS)[number];

export interface ServiceBonusLine {
  employeeId: string;
  amount: Tyiyn;
}

/**
 * Дата начисления бонуса за услугу (прототип `svcBonusOn`): день, когда услуга оплачена полностью, —
 * дата последней действующей оплаты; null — ещё не оплачена.
 */
export function serviceBonusOn(
  amount: Tyiyn,
  payments: readonly { amount: Tyiyn; date: IsoDate; deleted: boolean }[],
): IsoDate | null {
  const live = payments.filter((p) => !p.deleted);
  if (!(amount > 0) || servicePaid(live) < amount) return null;
  return live.reduce<IsoDate | null>(
    (last, p) => (last === null || p.date > last ? p.date : last),
    null,
  );
}

/** Сумма бонусов услуги (прототип `svcBonus`). */
export const serviceBonusTotal = (lines: readonly { amount: Tyiyn }[]): Tyiyn =>
  lines.reduce((sum, b) => sum + b.amount, 0);

const validAmount = (n: Tyiyn | null): n is Tyiyn =>
  n !== null && Number.isInteger(n) && n > 0 && n <= MONEY_AMOUNT_MAX;

export interface BonusProblem {
  problem: BonusMessageKey;
  /** Сумма для текста отказа (`{amount}`), в тыйынах. */
  amount?: Tyiyn;
}

/**
 * Блок «Бонусы сотрудникам» окна услуги (прототип `serviceDlg`): сотрудник и сумма в каждой строке,
 * сотрудники не повторяются, в сумме не больше стоимости услуги. `cost` — null, если стоимость не
 * введена (её отказ покажет своё поле).
 */
export function serviceBonusProblem(
  lines: readonly { employeeId: string | null; amount: Tyiyn | null }[],
  cost: Tyiyn | null,
): BonusProblem | null {
  if (lines.some((b) => !b.employeeId)) return { problem: 'bonus_employee_required' };
  if (lines.some((b) => !validAmount(b.amount))) return { problem: 'bonus_amount_required' };
  if (new Set(lines.map((b) => b.employeeId)).size < lines.length)
    return { problem: 'bonus_employee_twice' };
  const total = lines.reduce((sum, b) => sum + (b.amount ?? 0), 0);
  if (cost !== null && total > cost) return { problem: 'bonus_over_cost', amount: total };
  return null;
}

/** Накопления сотрудника (прототип `bonusSum`). */
export interface BonusBalance {
  /** Из остатков контрагентов: списания в бонус со счёта сотрудника. */
  cp: Tyiyn;
  /** За разовые услуги, оплаченные полностью. */
  svc: Tyiyn;
  /** Ожидает оплаты услуг: в остаток не входит. */
  wait: Tyiyn;
  /** Списано (выплачено). */
  out: Tyiyn;
  /** Остаток бонусов: начислено минус списано. */
  bal: Tyiyn;
}

export const bonusBalance = (
  p: Pick<BonusBalance, 'cp' | 'svc' | 'wait' | 'out'>,
): BonusBalance => ({
  ...p,
  bal: p.cp + p.svc - p.out,
});

export const EMPTY_BONUS_BALANCE: BonusBalance = { cp: 0, svc: 0, wait: 0, out: 0, bal: 0 };

/**
 * Правка услуги не уводит уже списанный бонус в минус (прототип `serviceDlg`: `bad`). `was` — бонус
 * услуги был начислен (услуга оплачена полностью), `will` — останется начисленным при новой стоимости.
 * Отказ называет сотрудника, его остаток и что мешает: `less` — уменьшить настолько нельзя, `wait` —
 * услуга перестанет быть оплаченной, и бонус уйдёт в ожидание.
 */
export function serviceBonusEditBlock(o: {
  was: boolean;
  will: boolean;
  prev: readonly ServiceBonusLine[];
  next: readonly ServiceBonusLine[];
  balanceOf: (employeeId: string) => Tyiyn;
}): { employeeId: string; balance: Tyiyn; variant: 'less' | 'wait' } | null {
  for (const old of o.prev) {
    const before = o.was ? old.amount : 0;
    const after = o.will ? (o.next.find((b) => b.employeeId === old.employeeId)?.amount ?? 0) : 0;
    const balance = o.balanceOf(old.employeeId);
    if (after < before && balance - (before - after) < 0)
      return { employeeId: old.employeeId, balance, variant: o.will ? 'less' : 'wait' };
  }
  return null;
}

export interface BonusOutProblem extends BonusProblem {
  field: 'amount' | 'date' | 'note';
}

/**
 * «Списать бонус» (прототип `bonusOutDlg`): сумма больше нуля и не больше остатка, дата не позже
 * сегодняшней, основание обязательно. Все отказы сразу — у полей.
 */
export function bonusOutProblems(
  f: { amount: Tyiyn | null; date: IsoDate | ''; note: string },
  ctx: { balance: Tyiyn; today: IsoDate },
): BonusOutProblem[] {
  const out: BonusOutProblem[] = [];
  if (!validAmount(f.amount)) out.push({ field: 'amount', problem: 'bonus_out_amount_required' });
  else if (f.amount > ctx.balance)
    out.push({ field: 'amount', problem: 'bonus_out_over', amount: Math.max(0, ctx.balance) });
  if (!f.date) out.push({ field: 'date', problem: 'bonus_out_date_required' });
  else if (f.date > ctx.today) out.push({ field: 'date', problem: 'bonus_out_date_future' });
  if (!f.note.trim()) out.push({ field: 'note', problem: 'bonus_out_note_required' });
  return out;
}
