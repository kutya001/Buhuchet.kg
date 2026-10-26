import {
  ENUM_FILTER_STEPS_MAX,
  ENUM_FILTER_VALS_MAX,
  enumAll,
  enumChecked,
  enumSelectionSize,
  formatDateRu,
  formatSom,
  isEnumAll,
  parseSom,
  type EnumSelection,
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
    return enumValuesOf(filter).some((v) => v !== '' && !(v in names));
  });
}

/** Все отдельные значения выбора галочками: отмеченные и из шагов. */
function enumValuesOf(selection: EnumSelection): string[] {
  return [
    ...selection.vals,
    ...(selection.steps ?? []).flatMap((s) => ('vals' in s ? s.vals : [])),
  ];
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

/** Выбор галочками по фильтру столбца; фильтра нет — отмечено всё. */
export function enumSelectionOf(filter: ListFilterValue | undefined): EnumSelection {
  if (filter?.type !== 'enum') return enumAll();
  return filter.steps?.length ? { vals: filter.vals, steps: filter.steps } : { vals: filter.vals };
}

/**
 * Фильтр-галочки из выбора: отмечено всё — фильтра нет (прототип: `v.length < all.length`). Если
 * пришли все значения столбца (`all`), уходят отмеченные значения по порядку списка, как в прототипе;
 * не помещаются в адрес запроса (`enumFilterFits`) — выбор шагами или «все, кроме» снятых. Пришли не
 * все — выбор шагами «Выбрать все» по «Найти значение».
 */
export function enumFilterOf(
  selection: EnumSelection,
  all: readonly { value: string; label: string | null }[] | null,
): ListFilterValue | null {
  const stepped: ListFilterValue | null = isEnumAll(selection)
    ? null
    : selection.steps?.length
      ? { type: 'enum', vals: selection.vals, steps: selection.steps }
      : { type: 'enum', vals: selection.vals };
  if (!all) return stepped;
  const on = all.filter((i) => enumChecked(selection, i.value, i.label)).map((i) => i.value);
  if (on.length === all.length) return null;
  const listed: ListFilterValue = { type: 'enum', vals: on };
  if (enumFilterFits(listed)) return listed;
  if (enumFilterFits(stepped)) return stepped;
  const checked = new Set(on);
  const off = all.filter((i) => !checked.has(i.value)).map((i) => i.value);
  return {
    type: 'enum',
    vals: [],
    steps: [
      { on: true, match: '' },
      { on: false, vals: off },
    ],
  };
}

/** Фильтр уходит в адресе запроса: отдельных значений и шагов — не больше, чем примет сервер. */
export function enumFilterFits(filter: ListFilterValue | null): boolean {
  if (filter?.type !== 'enum') return true;
  return (
    enumSelectionSize(filter) <= ENUM_FILTER_VALS_MAX &&
    (filter.steps?.length ?? 0) <= ENUM_FILTER_STEPS_MAX
  );
}

/**
 * Текст чипа фильтра (прототип `chipText`): текст — «запрос», галочки — первые два значения и «+N»
 * (шаги «Выбрать все» по поиску — «все, кроме Стажёр», «содержит «ИП»»), число — «от 100 до 200»,
 * дата — «с 01.03.2026 по 31.03.2026». Подпись значения галочки — из загруженных значений столбца
 * (`valueLabel`), пустое — «(Пусто)».
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
      const listed = (vals: readonly string[]) => {
        const names = vals.map((v) => (v === '' ? labels.empty : valueLabel(v)));
        if (names.length <= 2) return names.join(', ');
        return `${names.slice(0, 2).join(', ')} ${labels.chipMore(names.length - 2)}`;
      };
      // ОТКЛОНЕНИЕ: docs/deviations.md#36 — выбор по поиску словами, в прототипе только перечень.
      const parts = (filter.steps ?? []).map((s) => {
        if ('vals' in s) return s.on ? listed(s.vals) : labels.chipExcept(listed(s.vals));
        const q = s.match.trim();
        if (!q) return s.on ? labels.chipAll : '';
        return s.on ? labels.chipMatch(q) : labels.chipExceptMatch(q);
      });
      return [filter.vals.length ? listed(filter.vals) : '', ...parts].filter(Boolean).join(', ');
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
