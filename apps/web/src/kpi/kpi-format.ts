import {
  indicatorNumberText,
  parseIndicatorValue,
  type IndicatorTotals,
  type IndicatorType,
  type UiTextKey,
  type YearMonth,
} from '@buhuchet/domain';
import type { KpiColumn } from '@buhuchet/shared';
import type { Translate } from '../l10n/translate';

/*
 * Подписи месяцев и чисел модуля «Показатели контрагентов» (прототип modules/kpi.js: ymLabel, ymS,
 * kNum, kFmt, kParse). Названия месяцев — из словаря.
 */

const monthNo = (m: YearMonth) => Number(m.slice(5, 7));

/** «октябрь 2026» (прототип `ymLabel`). */
export const monthName = (t: Translate, m: YearMonth) =>
  `${t(`month.${monthNo(m)}` as UiTextKey)} ${m.slice(0, 4)}`;

/** «октября 2026» — после «с» (прототип `ymG`). */
export const monthGenName = (t: Translate, m: YearMonth) =>
  `${t(`rule.month_gen.${monthNo(m)}` as UiTextKey)} ${m.slice(0, 4)}`;

/** «авг 26» — заголовок столбца месяца (прототип `ymS`). */
export const monthShortName = (t: Translate, m: YearMonth) =>
  `${t(`month.short.${monthNo(m)}` as UiTextKey)} ${m.slice(2, 4)}`;

/** Число значения без единицы; пусто — пустая строка (прототип `kNum`). */
export const numberText = (type: IndicatorType, value: number | null) =>
  value === null ? '' : indicatorNumberText(type, value);

/** Значение с единицей: «1 250 000 сом» (прототип `kFmt`). */
export const valueText = (column: Pick<KpiColumn, 'type' | 'unit'>, value: number | null) => {
  if (value === null) return '';
  const n = indicatorNumberText(column.type, value);
  return column.unit ? `${n} ${column.unit}` : n;
};

/** Единица под названием столбца; без единицы — тип значения. */
export const unitText = (t: Translate, column: Pick<KpiColumn, 'type' | 'unit'>) =>
  column.unit || t(`kpi.type.${column.type}`);

/** Подпись под названием столбца: «сом · необязательный». */
export const columnSub = (t: Translate, column: KpiColumn) =>
  column.required ? unitText(t, column) : `${unitText(t, column)} · ${t('kpi.optional')}`;

/** Итог для показа (среднее — до сотых, как `Math.round(avg*100)/100` прототипа); нет значений — «—». */
export function totalText(
  type: IndicatorType,
  totals: IndicatorTotals,
  key: 'sum' | 'avg' | 'max' | 'min' | 'last',
): string {
  return 'sum' in totals ? indicatorNumberText(type, totals[key]) : '—';
}

/** Разбор ввода ячейки: число в сотых, null — пусто, `undefined` — не число. */
export function parseCell(type: IndicatorType, text: string): number | null | undefined {
  const parsed = parseIndicatorValue(type, text);
  return parsed.ok ? parsed.value : undefined;
}

/**
 * Блок, вставленный из Excel (прототип `paste` в `kpiMonth`): строки по `\n`, ячейки по табуляции,
 * последний перевод строки отбрасывается. Одна ячейка без табуляции и переводов строки — не блок (null):
 * её вставляет само поле.
 */
export function pasteBlock(text: string): string[][] | null {
  if (!/[\t\n]/.test(text.trim())) return null;
  return text
    .replace(/\r/g, '')
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => line.split('\t'));
}
