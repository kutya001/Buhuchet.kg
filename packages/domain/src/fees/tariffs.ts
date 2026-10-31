import type { IsoDate } from '../common/dates';
import type { Tyiyn } from '../common/money';
import { addMonths, monthLabelGen, monthOf, type YearMonth } from '../common/months';
import type { TariffPeriod } from '../contractors/rules';
import type { Translate } from '../l10n/texts';

/*
 * Журнал тарифов платы за обслуживание (ТЗ «Контрагенты» → «Плата за обслуживание»; прототип
 * core/org.js `tariffAt`, `curTariff`, modules/contractor-card.js `tariffDlg`). Записи не удаляются и
 * не переписываются: новая ставка — новая запись, действует с 1-го числа месяца `from`.
 */

export interface Tariff {
  /** Сумма за период, тыйыны; 0 допустим. */
  amount: Tyiyn;
  /** В месяц (`M`) или в год (`Y`: одна оплата в месяце «действует с»). */
  period: TariffPeriod;
  /** Месяц, с которого действует ставка. */
  from: YearMonth;
}

/** Ставка, действующая в месяце: последняя по «действует с», не позже месяца (прототип `tariffAt`). */
export function tariffAt<T extends Tariff>(tariffs: readonly T[], month: YearMonth): T | null {
  let found: T | null = null;
  for (const t of [...tariffs].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)))
    if (t.from <= month) found = t;
  return found;
}

/** Текущая ставка (прототип `curTariff`). */
export const currentTariff = <T extends Tariff>(tariffs: readonly T[], today: IsoDate): T | null =>
  tariffAt(tariffs, monthOf(today));

/**
 * Что подставлено в окне «Новая ставка»: сумма и периодичность текущей ставки, месяц — следующий,
 * примечание «Повышение с <месяц>»; самый ранний месяц — следующий, у первой ставки — текущий.
 */
export function tariffDefaults(tariffs: readonly Tariff[], today: IsoDate, t: Translate) {
  const next = addMonths(monthOf(today), 1);
  const current = currentTariff(tariffs, today);
  return {
    amount: current?.amount ?? null,
    period: current?.period ?? ('M' as TariffPeriod),
    from: next,
    minFrom: tariffs.length ? next : monthOf(today),
    note: t('fee.tariff.note_default', { month: monthLabelGen(next).split(' ')[0]! }),
  };
}

export const TARIFF_PROBLEMS = [
  'amount_required',
  'month_required',
  'month_taken',
  'month_past',
  'month_current',
] as const;
export type TariffProblem = (typeof TARIFF_PROBLEMS)[number];

/**
 * Проверка новой ставки (прототип `tariffDlg`): сумма не меньше 0; ставка меняется не чаще раза в
 * месяц; прошлые месяцы не меняются; если ставка уже есть — только со следующего месяца.
 */
export function tariffProblem(
  tariffs: readonly Tariff[],
  amount: Tyiyn | null,
  from: YearMonth | null,
  today: IsoDate,
): TariffProblem | null {
  if (amount === null || amount < 0) return 'amount_required';
  if (!from) return 'month_required';
  if (tariffs.some((t) => t.from === from)) return 'month_taken';
  if (from < monthOf(today)) return 'month_past';
  if (tariffs.length && from === monthOf(today)) return 'month_current';
  return null;
}

/** Коды ошибок окна «Новая ставка» для API: `tariff_<проблема>`, тексты — `err.tariff_<проблема>`. */
export const tariffErrorCode = (problem: TariffProblem) => `tariff_${problem}` as const;
