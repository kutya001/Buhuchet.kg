import {
  clampPage,
  DEFAULT_LIST_SORT,
  filterTypeOf,
  pageLimit,
  type ListColumnType,
  type ListFilterValue,
  type ListQuery,
  type ListSort,
} from '@buhuchet/domain';
import { and, sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Страница списка на сервере (ТЗ «Списки записей»: «сортировка, страницы и фильтры на сервере»,
 * «итоги считает сервер и отдаёт вместе со страницей»): модуль описывает столбцы своего списка
 * выражениями SQL, а здесь из запроса получаются условие, порядок, страница, число записей и итоги.
 * В браузер попадает только текущая страница; область «Свои контрагенты» модуль передаёт условием
 * `scope`, RLS отсекает чужие организации.
 */

type Expr = SQL | AnyColumn;

/** Столбец списка на сервере: тип (от него зависят фильтр и сортировка) и выражение значения. */
export interface ListColumn {
  type: ListColumnType;
  /** Значение для фильтра: справочник сравнивается как текст (код значения), дата — по Бишкеку. */
  value: Expr;
  /**
   * Сортировка, если не по значению: роль — по названию, статус — «Активен» выше «Заблокирован».
   * `text` — сравнивать как текст (по-русски, числа по значению).
   */
  sort?: { value: Expr; text: boolean };
  /** Текстовый фильтр без пробелов, дефисов, скобок и «+» с обеих сторон (телефон, ИНН). */
  compact?: boolean;
  /** Итог по всем отфильтрованным записям — сумма (деньги, числа). */
  total?: boolean;
}

export type ListColumns = Readonly<Record<string, ListColumn>>;

/** Запрос ссылается на столбец, которого в списке нет, или фильтр не подходит к типу столбца. */
export class ListQueryError extends Error {
  constructor(
    readonly part: 'sort' | 'filter',
    readonly key: string,
  ) {
    super(`Неверный ${part === 'sort' ? 'столбец сортировки' : 'фильтр'}: ${key}`);
    this.name = 'ListQueryError';
  }
}

/** Порядок текста списков: русский, «Док 2» перед «Док 10» (миграция 0019). */
const NATURAL = sql.raw('app.ru_natural');
const COMPACT_CHARS = /[\s\-()+.]/g;

/** Нижний регистр и «ё» = «е» — так текстовый фильтр не зависит от написания (ТЗ «Поиск и фильтры»). */
export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е');
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function textOf(expr: Expr, compact: boolean): SQL {
  const plain = sql`replace(lower(coalesce(${expr}::text, '') collate ${NATURAL}), 'ё', 'е')`;
  return compact ? sql`regexp_replace(${plain}, '[\\s()+.-]', '', 'g')` : plain;
}

function dateOf(column: ListColumn): SQL {
  return column.type === 'datetime'
    ? sql`(${column.value} at time zone 'Asia/Bishkek')::date`
    : sql`${column.value}::date`;
}

function filterCondition(key: string, column: ListColumn, filter: ListFilterValue): SQL {
  if (filterTypeOf(column.type) !== filter.type) throw new ListQueryError('filter', key);
  switch (filter.type) {
    case 'text': {
      const q = normalizeText(filter.q.trim());
      const needle = column.compact ? q.replace(COMPACT_CHARS, '') : q;
      return sql`${textOf(column.value, column.compact === true)} like ${likePattern(needle)} escape '\\'`;
    }
    case 'enum': {
      const empty = filter.vals.includes('');
      const vals = filter.vals.filter((v) => v !== '');
      const parts: SQL[] = [];
      if (vals.length) {
        parts.push(
          sql`${column.value}::text in (${sql.join(
            vals.map((v) => sql`${v}`),
            sql`, `,
          )})`,
        );
      }
      if (empty) parts.push(sql`coalesce(${column.value}::text, '') = ''`);
      return parts.length ? sql`(${sql.join(parts, sql` or `)})` : sql`false`;
    }
    case 'num': {
      const parts: SQL[] = [sql`${column.value} is not null`];
      if (filter.from != null) parts.push(sql`${column.value} >= ${filter.from}`);
      if (filter.to != null) parts.push(sql`${column.value} <= ${filter.to}`);
      return sql`(${sql.join(parts, sql` and `)})`;
    }
    case 'date': {
      const day = dateOf(column);
      const parts: SQL[] = [sql`${column.value} is not null`];
      if (filter.from) parts.push(sql`${day} >= ${filter.from}::date`);
      if (filter.to) parts.push(sql`${day} <= ${filter.to}::date`);
      return sql`(${sql.join(parts, sql` and `)})`;
    }
  }
}

/** Условие по фильтрам столбцов (все сразу — «И»). */
export function listWhere(columns: ListColumns, filters: ListQuery['filters']): SQL | undefined {
  const parts = Object.entries(filters).map(([key, filter]) => {
    const column = Object.hasOwn(columns, key) ? columns[key] : undefined;
    if (!column) throw new ListQueryError('filter', key);
    return filterCondition(key, column, filter);
  });
  return parts.length ? and(...parts) : undefined;
}

/**
 * Порядок строк (ТЗ «Сортировка»): текст — по-русски, числа внутри по значению («Док 2» перед
 * «Док 10»), без учёта регистра; пустые значения всегда внизу; равные — в естественном порядке
 * списка (`natural`, обычно «Создано» и номер записи), чтобы страницы не перемешивались.
 */
export function listOrder(columns: ListColumns, sort: ListSort | null, natural: Expr[]): SQL[] {
  const tail = natural.map((e) => sql`${e} asc`);
  if (!sort) return tail;
  const column = Object.hasOwn(columns, sort.key) ? columns[sort.key] : undefined;
  if (!column) throw new ListQueryError('sort', sort.key);
  const by = column.sort ?? {
    value: column.value,
    text: column.type === 'text' || column.type === 'enum',
  };
  const dir = sql.raw(sort.dir === 'desc' ? 'desc' : 'asc');
  const head = by.text
    ? sql`nullif(${by.value}::text, '') collate ${NATURAL} ${dir} nulls last`
    : sql`${by.value} ${dir} nulls last`;
  return [head, ...tail];
}

/** Поля, которые запрос страницы добавляет к полям строки: число записей и итоги по фильтру. */
export interface ListWindowFields {
  listTotal: SQL<number>;
  listTotals: SQL<Record<string, number> | null>;
}

export interface ListWindowRow {
  listTotal: number;
  listTotals: Record<string, number> | null;
}

export interface ListPageResult<T> {
  rows: T[];
  total: number;
  /** Номер страницы с 1: запрошенной страницы за концом списка нет — последняя. */
  page: number;
  /** Итоги столбцов с `total` по всем отфильтрованным записям; у пустого списка — нули. */
  totals: Record<string, number>;
}

/**
 * Страница списка. Модуль даёт `select`: свой запрос с полями строки плюс `window` (число записей и
 * итоги считаются оконными функциями в том же запросе), условием, порядком и страницей. Если
 * запрошенной страницы уже нет (записи удалили, фильтр сузился), отдаётся последняя.
 */
export async function selectListPage<T extends ListWindowRow>(options: {
  query: ListQuery;
  columns: ListColumns;
  /** Естественный порядок списка: без сортировки и для равных значений. */
  natural: Expr[];
  defaultSort?: ListSort | null;
  /** Область «Свои контрагенты» и другие условия модуля. */
  scope?: SQL;
  select: (q: {
    window: ListWindowFields;
    where: SQL | undefined;
    orderBy: SQL[];
    limit: number;
    offset: number;
  }) => Promise<T[]>;
}): Promise<ListPageResult<Omit<T, keyof ListWindowRow>>> {
  const { query, columns } = options;
  const sort = query.sort === undefined ? (options.defaultSort ?? DEFAULT_LIST_SORT) : query.sort;
  const orderBy = listOrder(columns, sort, options.natural);
  const where = and(options.scope, listWhere(columns, query.filters));
  const totalKeys = Object.keys(columns).filter((k) => columns[k]?.total);
  const window: ListWindowFields = {
    listTotal: sql<number>`count(*) over ()`.mapWith(Number),
    listTotals: totalKeys.length
      ? sql<Record<string, number>>`jsonb_build_object(${sql.join(
          totalKeys.map((k) => sql`${k}::text, coalesce(sum(${columns[k]!.value}) over (), 0)`),
          sql`, `,
        )})`
      : sql<null>`null`,
  };
  const limit = pageLimit(query.size);
  const fetch = (page: number) =>
    options.select({ window, where, orderBy, limit, offset: (page - 1) * limit });

  let page = Math.max(1, Math.floor(query.page));
  let rows = await fetch(page);
  if (!rows.length && page > 1) {
    const [probe] = await options.select({ window, where, orderBy, limit: 1, offset: 0 });
    page = clampPage(page, probe?.listTotal ?? 0, query.size);
    rows = probe ? await fetch(page) : [];
  }
  const first = rows[0];
  const zeros = Object.fromEntries(totalKeys.map((k) => [k, 0]));
  const totals = { ...zeros, ...mapNumbers(first?.listTotals ?? {}) };
  return {
    rows: rows.map(({ listTotal: _t, listTotals: _s, ...row }) => row),
    total: first?.listTotal ?? 0,
    page,
    totals,
  };
}

function mapNumbers(values: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]));
}
