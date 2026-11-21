/*
 * Таблица «Вывода» «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 4, пункты 2–3; прототип
 * v155 `modules/vitrina.js`: `DM_GT`, `dmCol`, `dmNumTxt`, `dmEx`). Результат шаблона приходит целиком
 * (до 50 000 строк), поэтому сортировка, фильтры, поиск, группы и итоги считаются здесь — по всему
 * результату, а не по показанной странице, теми же правилами, что общий список на сервере
 * (`selectListPage` в `@buhuchet/db`): пустые — в конце, текст — по-русски с числами по значению,
 * фильтр-галочки — `enumChecked`, поиск — `matchesSearch`. Тем же правилом сервер собирает «В Excel».
 */
import { bishkekDate, formatDateRu, formatMomentRu, isIsoDate } from '../common/dates';
import {
  clampPage,
  enumChecked,
  listPageSize,
  matchesSearch,
  matchesValue,
  pageLimit,
  searchText,
  type GroupAgg,
  type ListColumnType,
  type ListFilterValue,
  type ListGroup,
  type ListQuery,
  type ListSort,
} from '../common/list';
import { formatSom } from '../common/money';
import type { DM_COLUMN_TYPES } from './datamart';
import { isYearMonth, monthLabel } from '../common/months';

/** Тип столбца шаблона (`DM_COLUMN_TYPES`); `cp` — служебный номер контрагента для области «Свои». */
export type DmCellType = (typeof DM_COLUMN_TYPES)[number];

/** Столбец шаблона: код (ключ в результате), русское название, тип, нужен ли итог. */
export interface DmOutColumn {
  code: string;
  name: string;
  type: DmCellType;
  total: boolean;
}

/** Значение ячейки после разбора ответа: деньги — тыйыны, число — как есть, дата — `YYYY-MM-DD`. */
export type DmValue = string | number | boolean | null;

/** Строка результата: номер по порядку ответа (он же «естественный» порядок) и значения по столбцам. */
export interface DmOutRow {
  i: number;
  v: readonly DmValue[];
}

/** Подписи «да или нет» из словаря. */
export interface DmOutTexts {
  yes: string;
  no: string;
}

/** Столбец на экране и его место в строке результата. */
export interface DmShownColumn {
  col: DmOutColumn;
  index: number;
}

/** Столбцы на экране: все, кроме служебного `cp` (прототип `t.cols.filter(c => c.type !== 'cp')`). */
export function dmShownColumns(columns: readonly DmOutColumn[]): DmShownColumn[] {
  return columns.flatMap((col, index) => (col.type === 'cp' ? [] : [{ col, index }]));
}

/** Тип столбца общего списка (прототип `DM_GT`): месяц и «да или нет» — фильтр-галочки. */
export function dmListType(type: DmCellType): ListColumnType {
  switch (type) {
    case 'num':
      return 'int';
    case 'money':
      return 'money';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'month':
    case 'bool':
      return 'enum';
    default:
      return 'text';
  }
}

const NUMERIC = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;

function numberOf(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'bigint') return Number(raw);
  if (typeof raw === 'string' && NUMERIC.test(raw.trim())) return Number(raw.trim());
  return null;
}

/**
 * Значение ячейки из ответа базы (числа `numeric` и `bigint` приходят строкой, дата — строкой или
 * моментом): не того типа — пусто.
 */
export function dmValue(type: DmCellType, raw: unknown): DmValue {
  if (raw === null || raw === undefined || raw === '') return null;
  switch (type) {
    case 'num':
      return numberOf(raw);
    case 'money': {
      const n = numberOf(raw);
      return n === null ? null : Math.round(n);
    }
    case 'bool':
      if (typeof raw === 'boolean') return raw;
      if (raw === 't' || raw === 'true' || raw === 1) return true;
      if (raw === 'f' || raw === 'false' || raw === 0) return false;
      return null;
    case 'date': {
      const day = String(raw).slice(0, 10);
      return isIsoDate(day) ? day : null;
    }
    case 'month': {
      const month = String(raw).slice(0, 7);
      return isYearMonth(month) ? month : null;
    }
    case 'datetime': {
      const at = new Date(String(raw));
      return Number.isNaN(at.getTime()) ? null : at.toISOString();
    }
    default:
      return typeof raw === 'string' ? raw : typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  }
}

/** Строки ответа исполнителя (`{ columns, rows }`, строка — массив значений) по столбцам шаблона. */
export function dmOutRows(
  columns: readonly DmOutColumn[],
  rows: readonly (readonly unknown[])[],
): DmOutRow[] {
  return rows.map((row, i) => ({ i, v: columns.map((c, k) => dmValue(c.type, row[k])) }));
}

/** Число с разрядами, дробная часть — только если есть (прототип `dmNumTxt`): «1 250», «12,5». */
export function dmNumText(value: number): string {
  const hundredths = Math.round(value * 100);
  return formatSom(hundredths, 'auto');
}

/** Текст ячейки, как на экране: деньги — «1 250,50», дата — «20.11.2026», месяц — «ноябрь 2026». */
export function dmText(type: DmCellType, value: DmValue, texts: DmOutTexts): string {
  if (value === null) return '';
  switch (type) {
    case 'num':
      return dmNumText(value as number);
    case 'money':
      return formatSom(value as number);
    case 'date':
      return formatDateRu(value as string);
    case 'datetime':
      return formatMomentRu(new Date(value as string));
    case 'month':
      return monthLabel(value as string);
    case 'bool':
      return value ? texts.yes : texts.no;
    default:
      return String(value);
  }
}

/**
 * Текст для Ctrl+C (вставка в Excel): числа — без разрядов, дробная часть через запятую, как в таблице
 * «Показателей» (`cellText`), — так их понимает Excel; остальное — как на экране.
 */
export function dmCopyText(type: DmCellType, value: DmValue, texts: DmOutTexts): string {
  if (value === null) return '';
  if (type === 'money') return ((value as number) / 100).toFixed(2).replace('.', ',');
  if (type === 'num') return String(Math.round((value as number) * 100) / 100).replace('.', ',');
  return dmText(type, value, texts);
}

/** Число ячейки в сотых для строки состояния таблицы (количество, сумма, среднее); не число — null. */
export function dmStatNumber(type: DmCellType, value: DmValue): number | null {
  if (value === null) return null;
  if (type === 'money') return value as number;
  if (type === 'num') return Math.round((value as number) * 100);
  return null;
}

/** Значение для фильтра-галочек и группы строкой: пусто — '', момент — день по Бишкеку. */
function keyOf(type: DmCellType, value: DmValue): string {
  if (value === null) return '';
  if (type === 'datetime') return bishkekDate(new Date(value as string));
  return String(value);
}

/** Подпись группы и значения фильтра: у момента — только день (как `groupLabelOf` на сервере). */
function labelOf(type: DmCellType, value: DmValue, texts: DmOutTexts): string | null {
  if (value === null) return null;
  if (type === 'datetime') return formatDateRu(bishkekDate(new Date(value as string)));
  return dmText(type, value, texts);
}

const COLLATOR = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

/** Сравнение значений столбца без направления; пустые здесь не встречаются. */
function compareValues(
  type: DmCellType,
  a: Exclude<DmValue, null>,
  b: Exclude<DmValue, null>,
  texts: DmOutTexts,
): number {
  switch (type) {
    case 'num':
    case 'money':
      return (a as number) - (b as number);
    case 'date':
    case 'datetime':
    case 'month':
      return a < b ? -1 : a > b ? 1 : 0;
    case 'bool':
      return COLLATOR.compare(dmText(type, a, texts), dmText(type, b, texts));
    default:
      return COLLATOR.compare(String(a), String(b));
  }
}

/** Пустое значение: нет или текст без знаков (как `nullif(…, '')` на сервере). */
const isEmpty = (v: DmValue) => v === null || (typeof v === 'string' && v.trim() === '');

/** Порядок по столбцу: пустые — в конце при любом направлении (`nulls last`). */
function compareBy(type: DmCellType, dir: 1 | -1, texts: DmOutTexts) {
  return (a: DmValue, b: DmValue): number => {
    const ea = isEmpty(a);
    const eb = isEmpty(b);
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
    return compareValues(type, a!, b!, texts) * dir;
  };
}

/** Столбец по ключу списка (код столбца); служебный `cp` в список не входит. */
function shownByCode(columns: readonly DmOutColumn[]): Map<string, DmShownColumn> {
  return new Map(dmShownColumns(columns).map((s) => [s.col.code, s]));
}

function matchesFilter(
  s: DmShownColumn,
  row: DmOutRow,
  filter: ListFilterValue,
  texts: DmOutTexts,
): boolean {
  const value = row.v[s.index] ?? null;
  switch (filter.type) {
    case 'text': {
      const needle = searchText(filter.q.trim());
      if (!needle) return true;
      return searchText(dmText(s.col.type, value, texts)).includes(needle);
    }
    case 'enum':
      return enumChecked(filter, keyOf(s.col.type, value), labelOf(s.col.type, value, texts));
    case 'num': {
      const n = typeof value === 'number' ? value : null;
      if (n === null) return false;
      if (filter.from != null && n < filter.from) return false;
      return !(filter.to != null && n > filter.to);
    }
    case 'date': {
      if (value === null) return false;
      const day = keyOf(s.col.type, value).slice(0, 10);
      if (filter.from && day < filter.from) return false;
      return !(filter.to && day > filter.to);
    }
  }
}

/** Строки под фильтрами и поиском (поиск — по столбцам `search.keys`, текстом как на экране). */
function filtered(
  rows: readonly DmOutRow[],
  columns: readonly DmOutColumn[],
  query: Pick<ListQuery, 'filters' | 'search'>,
  texts: DmOutTexts,
): DmOutRow[] {
  const byCode = shownByCode(columns);
  const filters = Object.entries(query.filters).flatMap(([key, f]) => {
    const s = byCode.get(key);
    return s ? [{ s, f }] : [];
  });
  const search = query.search;
  const searchCols = search?.q.trim()
    ? search.keys.flatMap((k) => byCode.get(k) ?? [])
    : [];
  return rows.filter(
    (r) =>
      filters.every(({ s, f }) => matchesFilter(s, r, f, texts)) &&
      (!search?.q.trim() ||
        searchCols.some((s) => matchesSearch(dmText(s.col.type, r.v[s.index] ?? null, texts), search.q))),
  );
}

/** Сортировка; без неё и при равных — порядок ответа. Группы идут первыми (`groupOrder`). */
function sorted(
  rows: readonly DmOutRow[],
  columns: readonly DmOutColumn[],
  sort: ListSort | null,
  group: readonly string[],
  texts: DmOutTexts,
): DmOutRow[] {
  const byCode = shownByCode(columns);
  const keys: ((a: DmOutRow, b: DmOutRow) => number)[] = [];
  for (const g of group) {
    const s = byCode.get(g);
    if (!s) continue;
    const dir = sort?.key === g && sort.dir === 'desc' ? -1 : 1;
    const cmp = compareBy(s.col.type, dir, texts);
    keys.push((a, b) => cmp(groupValue(s, a), groupValue(s, b)));
  }
  const s = sort ? byCode.get(sort.key) : undefined;
  if (sort && s) {
    const cmp = compareBy(s.col.type, sort.dir === 'desc' ? -1 : 1, texts);
    keys.push((a, b) => cmp(a.v[s.index] ?? null, b.v[s.index] ?? null));
  }
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const d = k(a, b);
      if (d) return d;
    }
    return a.i - b.i;
  });
}

/** Значение группы: у момента — день по Бишкеку (группа — день, а не секунда). */
function groupValue(s: DmShownColumn, row: DmOutRow): DmValue {
  const v = row.v[s.index] ?? null;
  return s.col.type === 'datetime' && v !== null ? keyOf('datetime', v) : v;
}

/**
 * Все строки результата под поиском и фильтрами в порядке списка (сортировка, группы): для страницы
 * экрана и для «В Excel» сервера.
 */
export function dmOutList(
  rows: readonly DmOutRow[],
  columns: readonly DmOutColumn[],
  query: Pick<ListQuery, 'filters' | 'search' | 'sort' | 'group'>,
  texts: DmOutTexts,
): DmOutRow[] {
  return sorted(filtered(rows, columns, query, texts), columns, query.sort ?? null, query.group ?? [], texts);
}

function aggOf(how: GroupAgg, values: readonly number[]): number | null {
  if (how === 'count') return values.length;
  if (!values.length) return null;
  if (how === 'sum') return values.reduce((a, b) => a + b, 0);
  if (how === 'avg') return values.reduce((a, b) => a + b, 0) / values.length;
  return how === 'min' ? Math.min(...values) : Math.max(...values);
}

function aggsOf(
  rows: readonly DmOutRow[],
  byCode: ReadonlyMap<string, DmShownColumn>,
  agg: Readonly<Record<string, GroupAgg>>,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [key, how] of Object.entries(agg)) {
    const s = byCode.get(key);
    if (!s || (s.col.type !== 'num' && s.col.type !== 'money')) continue;
    const values = rows.flatMap((r) => {
      const v = r.v[s.index];
      return typeof v === 'number' ? [v] : [];
    });
    out[key] = aggOf(how, values);
  }
  return out;
}

/** Группы уровня по уже упорядоченным строкам: порядок групп — порядок их первых строк. */
function groupsOf(
  rows: readonly DmOutRow[],
  levels: readonly DmShownColumn[],
  depth: number,
  byCode: ReadonlyMap<string, DmShownColumn>,
  agg: Readonly<Record<string, GroupAgg>>,
  texts: DmOutTexts,
): ListGroup[] {
  const level = levels[depth];
  if (!level) return [];
  const order: string[] = [];
  const parts = new Map<string, { label: string | null; rows: DmOutRow[] }>();
  for (const r of rows) {
    const v = r.v[level.index] ?? null;
    const key = keyOf(level.col.type, v);
    let part = parts.get(key);
    if (!part) {
      part = { label: labelOf(level.col.type, v, texts), rows: [] };
      parts.set(key, part);
      order.push(key);
    }
    part.rows.push(r);
  }
  return order.map((key) => {
    const part = parts.get(key)!;
    const group: ListGroup = {
      key,
      label: part.label,
      count: part.rows.length,
      aggs: aggsOf(part.rows, byCode, agg),
    };
    if (depth + 1 < levels.length) {
      group.sub = groupsOf(part.rows, levels, depth + 1, byCode, agg, texts);
    }
    return group;
  });
}

/** Страница таблицы «Вывода» — как ответ общего списка (`GridPage`). */
export interface DmOutPage {
  items: DmOutRow[];
  total: number;
  page: number;
  /** Итоги столбцов с отметкой «итог» по всем строкам под фильтрами. */
  totals: Record<string, number>;
  groups?: ListGroup[];
  rowGroups?: string[][];
}

/**
 * Страница результата по запросу списка (сортировка, страница, фильтры, поиск, группы до двух уровней
 * с итогами). Страница за концом — последняя (`clampPage`); «Все записи» — по 5 000 (блок 4, пункт 3).
 */
export function dmOutPage(
  rows: readonly DmOutRow[],
  columns: readonly DmOutColumn[],
  query: ListQuery,
  texts: DmOutTexts,
): DmOutPage {
  const byCode = shownByCode(columns);
  const group = (query.group ?? []).filter((k) => byCode.has(k));
  const list = dmOutList(rows, columns, { ...query, group }, texts);
  const size = listPageSize({ size: query.size, group });
  const limit = pageLimit(size);
  const page = clampPage(Math.max(1, Math.floor(query.page)), list.length, size);
  const items = list.slice((page - 1) * limit, page * limit);
  const totals: Record<string, number> = {};
  for (const { col, index } of byCode.values()) {
    if (!col.total || (col.type !== 'num' && col.type !== 'money')) continue;
    const sum = list.reduce((a, r) => a + (typeof r.v[index] === 'number' ? (r.v[index] as number) : 0), 0);
    totals[col.code] = col.type === 'money' ? sum : Math.round(sum * 100) / 100;
  }
  const out: DmOutPage = { items, total: list.length, page, totals };
  if (group.length) {
    const levels = group.map((k) => byCode.get(k)!);
    out.groups = groupsOf(list, levels, 0, byCode, query.agg ?? {}, texts);
    out.rowGroups = items.map((r) => levels.map((s) => keyOf(s.col.type, r.v[s.index] ?? null)));
  }
  return out;
}

/** Значений для фильтра-галочек — не больше стольких (как `LIST_VALUES_LIMIT` сервера). */
export const DM_VALUES_LIMIT = 500;

/**
 * Значения столбца для фильтра-галочек со числом строк по всему результату (как `selectListValues`):
 * код, подпись как на экране, «(Пусто)» внизу; `q` — «Найти значение» по подписи.
 */
export function dmOutValues(
  rows: readonly DmOutRow[],
  columns: readonly DmOutColumn[],
  key: string,
  texts: DmOutTexts,
  q = '',
): { items: { value: string; label: string | null; count: number }[]; total: number; more: boolean } {
  const s = shownByCode(columns).get(key);
  if (!s) return { items: [], total: 0, more: false };
  const counts = new Map<string, { label: string | null; count: number; v: DmValue }>();
  for (const r of rows) {
    const v = groupValue(s, r);
    const value = keyOf(s.col.type, r.v[s.index] ?? null);
    const label = labelOf(s.col.type, r.v[s.index] ?? null, texts);
    if (!matchesValue(label, q)) continue;
    const seen = counts.get(value);
    if (seen) seen.count += 1;
    else counts.set(value, { label, count: 1, v });
  }
  const cmp = compareBy(s.col.type, 1, texts);
  const all = [...counts.entries()]
    .sort((a, b) => cmp(a[1].v, b[1].v) || COLLATOR.compare(a[0], b[0]))
    .map(([value, x]) => ({ value, label: x.label, count: x.count }));
  const items = all.slice(0, DM_VALUES_LIMIT);
  return { items, total: all.length, more: all.length > items.length };
}
