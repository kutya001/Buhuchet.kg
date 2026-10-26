import {
  formatDateRu,
  formatSom,
  parseSom,
  type ListColumnType,
  type ListFilterValue,
} from '@buhuchet/domain';
import type { GridLabels } from './types';

/**
 * Правила фильтров у столбцов (прототип ui/grid.js: `filterPop`, `chipText`, `parseNum`) — чистые
 * функции. Сами фильтры живут на экране и уходят на сервер; список только рисует меню и чипы.
 */

/** Фильтры, у которых есть столбец в списке (фильтр по убранному столбцу не показывается). */
export function activeFilterKeys(
  filters: Readonly<Record<string, ListFilterValue>>,
  keys: readonly string[],
): string[] {
  return Object.keys(filters).filter((k) => keys.includes(k));
}

/**
 * Столбцы фильтров-галочек, у отмеченных значений которых нет подписи для чипа: фильтр поставлен не
 * из меню столбца (например, плашкой статистики) — подписи подгружаются методом значений столбца.
 */
export function unlabeledEnumFilters(
  filters: Readonly<Record<string, ListFilterValue>>,
  keys: readonly string[],
  known: Readonly<Record<string, Readonly<Record<string, string | null>>>>,
): string[] {
  return activeFilterKeys(filters, keys).filter((key) => {
    const filter = filters[key]!;
    if (filter.type !== 'enum') return false;
    const names = known[key] ?? {};
    return filter.vals.some((v) => v !== '' && !(v in names));
  });
}

/**
 * Граница «От» / «До» из поля: у денег — сомы, введённые человеком («1 250,50»), в тыйынах; у счётчика —
 * целое. Пусто — null; не число — 'bad'.
 */
export function parseFilterNumber(type: ListColumnType, input: string): number | null | 'bad' {
  const text = input.trim();
  if (!text) return null;
  if (type === 'money') return parseSom(text) ?? 'bad';
  const digits = text.replace(/[\s\u00a0]/g, '').replace('\u2212', '-');
  if (!/^-?\d+$/.test(digits)) return 'bad';
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : 'bad';
}

/** Граница фильтра строкой — в поле и в чипе: деньги — «1 250,50» (без «,00» у целых), счётчик — как есть. */
export function formatFilterNumber(type: ListColumnType, value: number): string {
  return type === 'money' ? formatSom(value, 'auto') : String(value);
}

/**
 * Фильтр-галочки: отмечены все значения — фильтра нет (прототип: `v.length < all.length`), иначе —
 * отмеченные.
 */
export function enumFilter(
  all: readonly string[],
  checked: ReadonlySet<string>,
): ListFilterValue | null {
  const vals = all.filter((v) => checked.has(v));
  return vals.length === all.length ? null : { type: 'enum', vals };
}

/**
 * Текст чипа фильтра (прототип `chipText`): текст — «запрос», галочки — первые два значения и «+N»,
 * число — «от 100 до 200», дата — «с 01.03.2026 по 31.03.2026». Подпись значения галочки — из
 * загруженных значений столбца (`valueLabel`), пустое — «(Пусто)».
 */
export function chipText(
  type: ListColumnType,
  filter: ListFilterValue,
  labels: GridLabels,
  valueLabel: (value: string) => string,
): string {
  switch (filter.type) {
    case 'text':
      return `«${filter.q}»`;
    case 'enum': {
      const names = filter.vals.map((v) => (v === '' ? labels.empty : valueLabel(v)));
      if (names.length <= 2) return names.join(', ');
      return `${names.slice(0, 2).join(', ')} ${labels.chipMore(names.length - 2)}`;
    }
    case 'num':
      return [
        filter.from != null ? labels.chipFrom(formatFilterNumber(type, filter.from)) : '',
        filter.to != null ? labels.chipTo(formatFilterNumber(type, filter.to)) : '',
      ]
        .filter(Boolean)
        .join(' ');
    case 'date':
      return [
        filter.from ? labels.chipSince(formatDateRu(filter.from)) : '',
        filter.to ? labels.chipUntil(formatDateRu(filter.to)) : '',
      ]
        .filter(Boolean)
        .join(' ');
  }
}
