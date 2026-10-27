import { indicatorTotals, type IndicatorTotals, type IndicatorValue } from './indicators';
import {
  activeIndicators,
  indicatorApplies,
  indicatorEarly,
  indicatorOn,
  indicatorStart,
  monthIndicators,
  type KpiBook,
  type KpiContractor,
  type KpiIndicator,
} from './fill';
import type { YearMonth } from '../common/months';

/*
 * Что показывают экраны модуля «Показатели контрагентов»: ячейки «Ввода за месяц», строки «За период»,
 * вкладка «Показатели» карточки контрагента (прототип modules/kpi.js: kCpsIn, kCanVal, kOffLbl, kpiMonth,
 * kpiPeriod, kpiCardHtml). Значения приходят функцией `valueOf`: null — «не заполнено».
 */

/** Значение контрагента по показателю за месяц; null — пусто («не заполнено»), 0 — внесён ноль. */
export type KpiValueOf = (
  contractorId: string,
  indicatorId: string,
  month: YearMonth,
) => IndicatorValue | null;

/**
 * Ячейка показателя у контрагента за месяц:
 * - `required` — показатель требуется (ячейка для ввода, пустая подсвечивается, если он обязательный);
 * - `early` — месяц раньше «с <месяц>»: ввести можно, но значение необязательно («Ведётся с 01.2026»);
 * - `off` — не ведётся или не нужен в этом месяце: ячейка серая и недоступна.
 */
export type KpiCellState = 'required' | 'early' | 'off';

export function cellState(
  book: KpiBook,
  indicator: KpiIndicator,
  contractor: KpiContractor,
  month: YearMonth,
): KpiCellState {
  const target = book.target(indicator.id, contractor.id);
  if (indicatorApplies(indicator, target, contractor, month)) return 'required';
  return indicatorEarly(indicator, target, contractor, month) ? 'early' : 'off';
}

/**
 * Пометка «Не ведётся с <месяц>» у выключенного показателя (прототип `kOffLbl`): месяц выключения;
 * null — ведётся или выключен без месяца (контрагент не был отмечен при «Выбранным»).
 */
export function offSince(indicator: KpiIndicator, book: KpiBook, contractorId: string) {
  const target = book.target(indicator.id, contractorId);
  return !indicatorOn(indicator, target) && target?.offSince ? target.offSince : null;
}

/**
 * Контрагенты «Ввода за месяц» (прототип `kCpsIn`): неразовые, у которых за месяц требуется хотя бы один
 * показатель или месяц раньше их «с <месяц>» (значения можно внести заранее, но они необязательны).
 */
export function monthContractors(
  book: KpiBook,
  contractors: readonly KpiContractor[],
  month: YearMonth,
): KpiContractor[] {
  const list = activeIndicators(book);
  return contractors.filter(
    (c) =>
      !c.oneOff &&
      (monthIndicators(book, c, month).length > 0 ||
        list.some((i) => indicatorEarly(i, book.target(i.id, c.id), c, month))),
  );
}

/** Ячейка «Ввода за месяц» и окна значения контрагента за месяц. */
export interface KpiCell {
  indicatorId: string;
  state: KpiCellState;
  value: IndicatorValue | null;
  /** «с <месяц>» у контрагента — для подписи «Ведётся с 01.2026». */
  start: YearMonth;
  /** «Не ведётся с <месяц>»; null — ведётся. */
  offSince: YearMonth | null;
}

/** Ячейки действующих показателей контрагента за месяц — по порядку показателей. */
export function monthCells(
  book: KpiBook,
  contractor: KpiContractor,
  month: YearMonth,
  valueOf: KpiValueOf,
): KpiCell[] {
  return activeIndicators(book).map((i) => ({
    indicatorId: i.id,
    state: cellState(book, i, contractor, month),
    value: valueOf(contractor.id, i.id, month),
    start: indicatorStart(i, book.target(i.id, contractor.id), contractor),
    offSince: offSince(i, book, contractor.id),
  }));
}

/** Строка «За период» и вкладки «Показатели» карточки: показатель контрагента по месяцам периода. */
export interface KpiPeriodRow {
  contractorId: string;
  indicatorId: string;
  /** Значения по месяцам периода — по порядку `months`. */
  values: (IndicatorValue | null)[];
  /** Требовался ли показатель в месяце: пустая ячейка — «пусто», иначе «—». */
  applies: boolean[];
  /** Сколько месяцев периода показатель требовался — знаменатель «среднее по 9 из 12». */
  need: number;
  /** Итоги только по заполненным месяцам. */
  totals: IndicatorTotals;
  offSince: YearMonth | null;
}

function periodRow(
  book: KpiBook,
  indicator: KpiIndicator,
  contractor: KpiContractor,
  months: readonly YearMonth[],
  valueOf: KpiValueOf,
): KpiPeriodRow {
  const target = book.target(indicator.id, contractor.id);
  const values = months.map((m) => valueOf(contractor.id, indicator.id, m));
  const applies = months.map((m) => indicatorApplies(indicator, target, contractor, m));
  return {
    contractorId: contractor.id,
    indicatorId: indicator.id,
    values,
    applies,
    need: applies.filter(Boolean).length,
    totals: indicatorTotals(values),
    offSince: offSince(indicator, book, contractor.id),
  };
}

/** Все показатели (и в архиве) по порядку. */
const allIndicators = (book: KpiBook) => [...book.indicators].sort((a, b) => a.order - b.order);

/**
 * Строки «За период» (прототип `kpiPeriod`): контрагент × показатель (и в архиве), если показатель
 * требовался хоть в одном месяце периода или по нему есть значения; разовых контрагентов нет.
 */
export function periodRows(
  book: KpiBook,
  contractors: readonly KpiContractor[],
  months: readonly YearMonth[],
  valueOf: KpiValueOf,
): KpiPeriodRow[] {
  const indicators = allIndicators(book);
  return contractors
    .filter((c) => !c.oneOff)
    .flatMap((c) =>
      indicators
        .map((i) => periodRow(book, i, c, months, valueOf))
        .filter((r) => r.need > 0 || r.values.some((v) => v !== null)),
    );
}

/**
 * Показатели вкладки «Показатели» карточки контрагента (прототип `kpiCardHtml`): которые ведутся у
 * контрагента, и те, по которым за период есть значения (выключенные и в архиве).
 */
export function cardRows(
  book: KpiBook,
  contractor: KpiContractor,
  months: readonly YearMonth[],
  valueOf: KpiValueOf,
): KpiPeriodRow[] {
  return allIndicators(book)
    .map((i) => ({ i, row: periodRow(book, i, contractor, months, valueOf) }))
    .filter(
      ({ i, row }) =>
        (!i.archived &&
          !contractor.oneOff &&
          !contractor.archived &&
          indicatorOn(i, book.target(i.id, contractor.id))) ||
        row.values.some((v) => v !== null),
    )
    .map(({ row }) => row);
}

/**
 * Итоги столбца «Ввода за месяц» по всем контрагентам в фильтре (прототип `foot`): «по 3 из 5».
 * ОТКЛОНЕНИЕ: docs/deviations.md#В-7 — ячейки, где показатель у контрагента не ведётся, в итоги не
 * входят (как в ТЗ).
 */
export function columnTotals(
  cells: readonly { value: IndicatorValue | null; state: KpiCellState }[],
): IndicatorTotals & { of: number } {
  const counted = cells.filter((c) => c.state !== 'off').map((c) => c.value);
  return { ...indicatorTotals(counted), of: counted.length };
}
