import type { IsoDate } from '../common/dates';
import type { Tyiyn } from '../common/money';
import { addMonths, monthLabelGen, monthOf, type YearMonth } from '../common/months';
import type { FirstMonthMode, TariffPeriod } from '../contractors/rules';
import type { Translate } from '../l10n/texts';

/*
 * Журнал тарифов платы за обслуживание (ТЗ «Контрагенты» → «Плата за обслуживание»; прототип
 * core/org.js `tariffAt`, `curTariff`, modules/contractor-card.js `tariffDlg`, `tariffEditDlg`). Новая
 * ставка — новая запись, действует с 1-го числа месяца `from`. Ошибочно внесённую ставку можно
 * изменить с причиной, а ещё не начавшую действовать — удалить (прототип v86).
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

/* ───────────── «Изменить ставку обслуживания» (прототип v86 `tariffEditDlg`) ───────────── */

/** Запись журнала тарифов, которую правят. */
export interface TariffEntry extends Tariff {
  id: string;
}

/** Первая ставка журнала — самая ранняя по «действует с» (прототип `first`). */
export function isFirstTariff(tariffs: readonly TariffEntry[], id: string): boolean {
  const first = [...tariffs].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))[0];
  return first?.id === id;
}

/**
 * Поле «Первый неполный месяц» есть только у первой ставки «в месяц», которая действует с месяца
 * начала обслуживания, начатого не с 1-го числа (прототип `part`).
 */
export function firstMonthEditable(
  tariffs: readonly TariffEntry[],
  tariff: TariffEntry,
  start: IsoDate,
): boolean {
  return (
    isFirstTariff(tariffs, tariff.id) &&
    tariff.from === monthOf(start) &&
    start.slice(8) !== '01' &&
    tariff.period === 'M'
  );
}

/** Ставку можно удалить, пока она не начала действовать и в журнале есть другая (прототип `future`). */
export const tariffDeletable = (
  tariffs: readonly TariffEntry[],
  tariff: TariffEntry,
  today: IsoDate,
): boolean => tariff.from > monthOf(today) && tariffs.length > 1;

export interface TariffEdit {
  amount: Tyiyn | null;
  period: TariffPeriod;
  from: YearMonth | null;
  /** Задано, только когда поле есть в окне (`firstMonthEditable`). */
  firstMonth?: FirstMonthMode;
  reason: string;
}

export const TARIFF_EDIT_PROBLEMS = [
  'amount_required',
  'month_required',
  'edit_month_taken',
  'edit_before_start',
  'edit_reason_required',
] as const;
export type TariffEditProblem = (typeof TARIFF_EDIT_PROBLEMS)[number];

/**
 * Проверка окна «Изменить ставку» (прототип `tariffEditDlg`): сумма не меньше 0; месяц задан, не занят
 * другой ставкой, у первой ставки — не раньше месяца начала обслуживания; причина обязательна. Ошибка —
 * у каждого поля своя, как в окне.
 */
export function tariffEditProblems(
  tariffs: readonly TariffEntry[],
  tariff: TariffEntry,
  edit: TariffEdit,
  start: IsoDate,
): { amount?: TariffEditProblem; from?: TariffEditProblem; reason?: TariffEditProblem } {
  const out: ReturnType<typeof tariffEditProblems> = {};
  if (edit.amount === null || edit.amount < 0) out.amount = 'amount_required';
  if (!edit.from) out.from = 'month_required';
  else if (tariffs.some((t) => t.id !== tariff.id && t.from === edit.from))
    out.from = 'edit_month_taken';
  else if (isFirstTariff(tariffs, tariff.id) && edit.from < monthOf(start))
    out.from = 'edit_before_start';
  if (!edit.reason.trim()) out.reason = 'edit_reason_required';
  return out;
}

export const TARIFF_EDIT_FIELDS = ['amount', 'period', 'from', 'firstMonth'] as const;
export type TariffEditField = (typeof TARIFF_EDIT_FIELDS)[number];

/**
 * Что изменилось (прототип `ch`): пусто — «Изменений нет», запись не трогается. Правило первого
 * неполного месяца считается, только когда поле есть в окне.
 */
export function tariffEditChanges(
  tariff: Tariff,
  edit: Pick<TariffEdit, 'amount' | 'period' | 'from' | 'firstMonth'>,
  firstMonth: FirstMonthMode,
): TariffEditField[] {
  const out: TariffEditField[] = [];
  if (edit.amount !== tariff.amount) out.push('amount');
  if (edit.period !== tariff.period) out.push('period');
  if (edit.from !== tariff.from) out.push('from');
  if (edit.firstMonth !== undefined && edit.firstMonth !== firstMonth) out.push('firstMonth');
  return out;
}
