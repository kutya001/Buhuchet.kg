import { autoAllocate, formatSomWithUnit } from '@buhuchet/domain';
import type { FeePaymentForm } from '@buhuchet/shared';
import type { Translate } from '../l10n/translate';

/** Что подставить в «Принять оплату за обслуживание» по чеку из Telegram: сумма и примечание. */
export type FeePaymentPreset = { amount: number | null; note: string };

/** Месяцы окна в порядке распределения суммы (от старых к новым, как прислал сервер). */
export function feeOrderedMonths(form: FeePaymentForm) {
  const byMonth = new Map(form.months.map((m) => [m.month, m]));
  return form.order.map((m) => byMonth.get(m)).filter((m): m is NonNullable<typeof m> => !!m);
}

/**
 * Сумма чека из Telegram (прототип v115 `feePayDlg` с `pre.sum`): только у новой оплаты и только больше
 * нуля; иначе — null, окно открывается как обычно.
 */
export function feePresetSum(preset: FeePaymentPreset | null, editing: boolean): number | null {
  return !editing && preset?.amount != null && preset.amount > 0 ? preset.amount : null;
}

/** Строки «За какие месяцы» по сумме чека — от старых к новым (прототип `feePayDlg`, как «От старых к новым»). */
export function feePresetAllocation(form: FeePaymentForm, sum: number) {
  return autoAllocate(feeOrderedMonths(form), sum);
}

/**
 * Подсказка у «Суммы»: по чеку — «Подставлена сумма из сообщения в Telegram: …» (прототип v115
 * `feePayDlg`, `pre`), иначе — долг.
 */
export function feePayAmountHint(
  t: Translate,
  presetSum: number | null,
  debt: number,
): string | undefined {
  if (presetSum != null)
    return t('fee.pay.amount_hint_tg', { amount: formatSomWithUnit(presetSum) });
  return debt ? t('fee.pay.amount_hint', { amount: formatSomWithUnit(debt) }) : undefined;
}
