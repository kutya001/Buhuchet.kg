import {
  clampPage,
  compactSearchText,
  DEFAULT_LIST_SORT,
  EXPORT_ROWS_LIMIT,
  filterTypeOf,
  isNumericColumn,
  listPageSize,
  pageLimit,
  PLATFORM_ADMIN_NAME,
  SEARCH_COMPACT_MIN,
  searchText,
  type GroupAgg,
  type ListColumnType,
  type ListFilterValue,
  type ListGroup,
  type ListQuery,
  type ListSearch,
  type ListSort,
} from '@buhuchet/domain';
import { and, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Страница списка на сервере (ТЗ «Списки записей»: «сортировка, страницы и фильтры на сервере»,
 * «итоги считает сервер и отдаёт вместе со страницей», «итоги групп считает сервер»): модуль
 * описывает столбцы своего списка выражениями SQL, а здесь из запроса получаются условие (фильтры и
 * поиск), порядок, страница, число записей, итоги и группы. В браузер попадает только текущая
 * страница; область «Свои контрагенты» модуль передаёт условием `scope`, RLS отсекает чужие
 * организации.
 */

type Expr = SQL | AnyColumn;

/** Столбец списка на сервере: тип (от него зависят фильтр и сортировка) и выражение значения. */
export interface ListColumn {
  type: ListColumnType;
  /**
   * Значение для фильтра: справочник сравнивается как текст (код значения), дата — по Бишкеку. По нему
   * же группируют `group by`, поэтому в `value` и `sort` — без параметров запроса (тексты словаря —
   * только в `display`).
   */
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
  /**
   * Текст, как на экране: по нему ищет поиск («по тому, что видно на экране»), из него подпись группы,
   * значения фильтра-галочек и ячейки выгрузки. Без него — по типу: дата «15.03.2026», момент
   * «15.03.2026 10:05» по Бишкеку, деньги «1 250,50», остальное — значение.
   */
  display?: Expr;
  /** Подпись столбца — ключ словаря (`staff.col.full_name`): заголовок в выгрузке Excel. */
  label: string;
}

export type ListColumns = Readonly<Record<string, ListColumn>>;

/** Тексты словаря по ключу — подписи значений-кодов («Активен», «Привязан») для поиска и выгрузки. */
export type ListTexts = (key: string) => string;

const PART_NAMES = {
  sort: 'столбец сортировки',
  filter: 'фильтр',
  search: 'столбец поиска',
  group: 'столбец группировки',
  agg: 'итог группы',
  column: 'столбец',
} as const;

/** Запрос ссылается на столбец, которого в списке нет, или фильтр не подходит к типу столбца. */
export class ListQueryError extends Error {
  constructor(
    readonly part: keyof typeof PART_NAMES,
    readonly key: string,
  ) {
    super(`Неверный ${PART_NAMES[part]}: ${key}`);
    this.name = 'ListQueryError';
  }
}

/**
 * Запрос модуля «select … from … join …» с любыми полями — для групп, значений фильтра и выгрузки
 * (страницу записей модуль выбирает своим `select` со своими полями). Модуль даёт те же таблицы и
 * соединения, что у страницы: `(fields) => tx.select(fields).from(t).innerJoin(…).$dynamic()`.
 */
export type ListFrom = (fields: Record<string, SQL>) => ListSelect;

export interface ListSelect extends PromiseLike<Record<string, unknown>[]> {
  where(where: SQL | undefined): ListSelect;
  groupBy(...by: SQL[]): ListSelect;
  orderBy(...by: SQL[]): ListSelect;
  limit(limit: number): ListSelect;
}

function columnOf(columns: ListColumns, key: string, part: ListQueryError['part']): ListColumn {
  const column = Object.hasOwn(columns, key) ? columns[key] : undefined;
  if (!column) throw new ListQueryError(part, key);
  return column;
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

/** Неразрывный пробел между разрядами суммы и знак минуса — как `formatSom` (@buhuchet/domain). */
const NBSP = sql.raw('chr(160)');
const MINUS = sql.raw('chr(8722)');

/** Сумма в тыйынах как на экране: «1 250,50», «−300,00» (`formatSom`). */
function moneyText(value: Expr): SQL {
  const whole = sql`(abs(${value}) / 100)::text`;
  return sql`case when ${value} is null then null else (case when ${value} < 0 then ${MINUS} else '' end) || regexp_replace(${whole}, '(\\d)(?=(\\d{3})+$)', '\\1' || ${NBSP}, 'g') || ',' || lpad((abs(${value}) % 100)::text, 2, '0') end`;
}

/** Текст столбца, как на экране (`display` или по типу); пусто — null. */
export function displayOf(column: ListColumn): SQL {
  if (column.display) return sql`nullif(${column.display}::text, '')`;
  switch (column.type) {
    case 'date':
      return sql`to_char(${column.value}, 'DD.MM.YYYY')`;
    case 'datetime':
      return sql`to_char(${column.value} at time zone 'Asia/Bishkek', 'DD.MM.YYYY HH24:MI')`;
    case 'money':
      return moneyText(column.value);
    default:
      return sql`nullif(${column.value}::text, '')`;
  }
}

/** Текст для поиска (`searchText` из @buhuchet/domain): нижний регистр, «ё» = «е», неразрывный пробел — обычный. */
function searchable(text: SQL): SQL {
  return sql`replace(replace(lower(coalesce(${text}, '') collate ${NATURAL}), 'ё', 'е'), ${NBSP}, ' ')`;
}

/**
 * Поиск по тому, что видно на экране (ТЗ «Поиск и фильтры»; прототип compute): подстрока в тексте
 * видимых столбцов без учёта регистра и «ё», а с трёх значащих символов — ещё и без пробелов,
 * дефисов, скобок и запятых с обеих сторон (телефон, ИНН, сумма). Эталон — `matchesSearch`.
 */
export function searchCondition(
  columns: ListColumns,
  search: ListSearch | undefined,
): SQL | undefined {
  const needle = searchText(search?.q.trim() ?? '');
  if (!search || !needle) return undefined;
  const compact = compactSearchText(search.q);
  const keys = search.keys.length ? search.keys : Object.keys(columns);
  const parts = keys.flatMap((key) => {
    const text = searchable(displayOf(columnOf(columns, key, 'search')));
    const found = [sql`${text} like ${likePattern(needle)} escape '\\'`];
    if (compact.length >= SEARCH_COMPACT_MIN) {
      found.push(
        sql`regexp_replace(${text}, '[\\s()+.,№«»"-]', '', 'g') like ${likePattern(compact)} escape '\\'`,
      );
    }
    return found;
  });
  return or(...parts);
}

/** Значение среди отмеченных ('' — «(Пусто)»). */
function valuesCondition(column: ListColumn, values: readonly string[]): SQL {
  const vals = values.filter((v) => v !== '');
  const parts: SQL[] = [];
  if (vals.length) {
    parts.push(
      sql`${column.value}::text in (${sql.join(
        vals.map((v) => sql`${v}`),
        sql`, `,
      )})`,
    );
  }
  if (values.includes('')) parts.push(sql`coalesce(${column.value}::text, '') = ''`);
  return parts.length ? sql`(${sql.join(parts, sql` or `)})` : sql`false`;
}

/**
 * Подпись значения, как на экране, содержит текст «Найти значение» без учёта регистра и «ё»; '' —
 * подходит любое значение. Эталон — `matchesValue`.
 */
function valueMatch(column: ListColumn, match: string): SQL {
  const needle = searchText(match.trim());
  if (!needle) return sql`true`;
  return sql`${searchable(displayOf(column))} like ${likePattern(needle)} escape '\\'`;
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
      // Решает последний шаг, который касается значения (эталон — `enumChecked`).
      const steps = filter.steps ?? [];
      if (!steps.length) return valuesCondition(column, filter.vals);
      const cases = steps
        .toReversed()
        .map(
          (s) =>
            sql`when ${'match' in s ? valueMatch(column, s.match) : valuesCondition(column, s.vals)} then ${sql.raw(s.on ? 'true' : 'false')}`,
        );
      return sql`(case ${sql.join(cases, sql` `)} else ${valuesCondition(column, filter.vals)} end)`;
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

/**
 * Постоянный текст прямо в запросе, а не параметром: Drizzle даёт параметру новый номер в каждом месте
 * запроса, и PostgreSQL не считает `select` и `group by` с ним одним выражением.
 */
function textLiteral(value: string): SQL {
  return sql.raw(`'${value.replace(/'/g, "''")}'`);
}

/**
 * Значение столбцов «Создал» и «Изменил» для фильтра, сортировки и группировки — как на экране
 * (`auditActorName`): краткое ФИО сотрудника; автор без записи сотрудника — «Администратор
 * платформы»; без автора — пусто.
 */
export function auditActorValue(userId: Expr, shortName: Expr): SQL {
  return sql`case when ${userId} is null then null else coalesce(${shortName}, ${textLiteral(PLATFORM_ADMIN_NAME)}::text) end`;
}

/** Условие по фильтрам столбцов и поиску (всё сразу — «И»). */
export function listWhere(
  columns: ListColumns,
  filters: ListQuery['filters'],
  search?: ListSearch,
): SQL | undefined {
  const parts = Object.entries(filters).map(([key, filter]) =>
    filterCondition(key, columnOf(columns, key, 'filter'), filter),
  );
  const found = searchCondition(columns, search);
  if (found) parts.push(found);
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
  const column = columnOf(columns, sort.key, 'sort');
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

/**
 * Поля, которые запрос страницы добавляет к полям строки: число записей и итоги по фильтру, а в
 * сгруппированном списке — ключи групп строки.
 */
export interface ListWindowFields {
  listTotal: SQL<number>;
  listTotals: SQL<Record<string, number> | null>;
  listGroups: SQL<string[] | null>;
}

export interface ListWindowRow {
  listTotal: number;
  listTotals: Record<string, number> | null;
  listGroups: string[] | null;
}

export interface ListPageResult<T> {
  rows: T[];
  total: number;
  /** Номер страницы с 1: запрошенной страницы за концом списка нет — последняя. */
  page: number;
  /** Записей на странице: в сгруппированном списке — «Все записи» (`listPageSize`). */
  size: ListQuery['size'];
  /** Итоги столбцов с `total` по всем отфильтрованным записям; у пустого списка — нули. */
  totals: Record<string, number>;
  /** Сгруппированный список: группы по всем отфильтрованным записям и ключи групп каждой строки. */
  groups?: ListGroup[];
  rowGroups?: string[][];
}

/** Групп одного уровня — не больше стольких (столько же, сколько строк за раз). */
const GROUPS_LIMIT = 5000;

/** Значение группы строкой: у момента — день по Бишкеку; пусто — ''. */
function groupKeyOf(column: ListColumn): SQL {
  if (column.type === 'datetime') return sql`coalesce(${dateOf(column)}::text, '')`;
  return sql`coalesce(${column.value}::text, '')`;
}

/** Подпись группы — как на экране; у момента — только день (прототип gLabel). */
function groupLabelOf(column: ListColumn): SQL {
  if (column.type === 'datetime') return sql`to_char(${dateOf(column)}, 'DD.MM.YYYY')`;
  return displayOf(column);
}

/**
 * Чем упорядочены группы (прототип groupTree): своим порядком столбца — роль по названию, статус
 * «Активен» выше «Заблокирован», момент по дню, текст по-русски с числами по значению.
 */
function groupSortOf(column: ListColumn): SQL {
  if (column.sort) {
    return column.sort.text
      ? sql`nullif(${column.sort.value}::text, '') collate ${NATURAL}`
      : sql`${column.sort.value}`;
  }
  if (column.type === 'datetime') return dateOf(column);
  if (column.type === 'text' || column.type === 'enum') {
    return sql`nullif(${column.value}::text, '') collate ${NATURAL}`;
  }
  return sql`${column.value}`;
}

/**
 * Порядок групп: по убыванию — если по этому столбцу сортировка по убыванию; пустая группа всегда
 * внизу; равные по порядку (одно название у разных ролей) — по значению.
 */
function groupOrderOf(column: ListColumn, key: string, sort: ListSort | null): SQL[] {
  const dir = sql.raw(sort?.key === key && sort.dir === 'desc' ? 'desc' : 'asc');
  const keyExpr = groupKeyOf(column);
  return [
    sql`(${keyExpr} = '') asc`,
    sql`${groupSortOf(column)} ${dir} nulls last`,
    sql`${keyExpr} collate ${NATURAL} asc`,
  ];
}

const AGG_SQL: Record<GroupAgg, (value: Expr) => SQL> = {
  sum: (v) => sql`sum(${v})`,
  avg: (v) => sql`avg(${v})`,
  min: (v) => sql`min(${v})`,
  max: (v) => sql`max(${v})`,
  count: (v) => sql`count(${v})`,
};

function aggsOf(columns: ListColumns, agg: ListQuery['agg']): SQL {
  const entries = Object.entries(agg ?? {}).map(([key, how]) => {
    const column = columnOf(columns, key, 'agg');
    if (!isNumericColumn(column.type)) throw new ListQueryError('agg', key);
    return sql`${key}::text, ${AGG_SQL[how](column.value)}`;
  });
  return entries.length ? sql`jsonb_build_object(${sql.join(entries, sql`, `)})` : sql`'{}'::jsonb`;
}

interface GroupLevel {
  column: ListColumn;
  key: string;
}

/**
 * Группы двух уровней с числом записей и итогами (ТЗ «Группировка»): по одному запросу на уровень,
 * порядок — `groupOrderOf`; второй уровень раскладывается по группам первого.
 */
async function selectGroups(options: {
  from: ListFrom;
  levels: GroupLevel[];
  where: SQL | undefined;
  sort: ListSort | null;
  aggs: SQL;
}): Promise<ListGroup[]> {
  const { from, levels, where, sort, aggs } = options;
  const level = async (depth: number) => {
    const used = levels.slice(0, depth + 1);
    const fields: Record<string, SQL> = {
      count: sql`count(*)::int`,
      aggs: sql`${aggs}`,
    };
    const groupBy: SQL[] = [];
    used.forEach((l, i) => {
      fields[`k${i}`] = groupKeyOf(l.column);
      // Подпись зависит только от значения; в подписи бывают тексты словаря (параметры запроса),
      // а параметры в GROUP BY и в списке полей у базы разные — поэтому подпись берётся через min.
      fields[`l${i}`] = sql`min(${groupLabelOf(l.column)})`;
      groupBy.push(groupKeyOf(l.column), groupSortOf(l.column));
    });
    const rows = await from(fields)
      .where(where)
      .groupBy(...groupBy)
      .orderBy(...used.flatMap((l) => groupOrderOf(l.column, l.key, sort)))
      .limit(GROUPS_LIMIT);
    return rows.map((r) => ({
      keys: used.map((_, i) => String(r[`k${i}`] ?? '')),
      label: (r[`l${used.length - 1}`] as string | null) ?? null,
      count: Number(r.count),
      aggs: mapNullableNumbers((r.aggs as Record<string, unknown> | null) ?? {}),
    }));
  };
  const top = await level(0);
  const groups: ListGroup[] = top.map((g) => ({
    key: g.keys[0]!,
    label: g.label,
    count: g.count,
    aggs: g.aggs,
  }));
  if (levels.length < 2) return groups;
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const subs = new Map<string, ListGroup[]>();
  for (const g of await level(1)) {
    const list = subs.get(g.keys[0]!) ?? [];
    list.push({ key: g.keys[1]!, label: g.label, count: g.count, aggs: g.aggs });
    subs.set(g.keys[0]!, list);
  }
  return groups.map((g) => ({ ...g, sub: subs.get(g.key) ?? [] })).filter((g) => byKey.has(g.key));
}

/**
 * Страница списка. Модуль даёт `select`: свой запрос с полями строки плюс `window` (число записей,
 * итоги и ключи групп считаются в том же запросе), условием, порядком и страницей; и `from` — те же
 * таблицы с любыми полями для групп. Если запрошенной страницы уже нет (записи удалили, фильтр
 * сузился), отдаётся последняя. Сгруппированный список (`group`) — по 5 000 записей за раз, по
 * порядку групп, с деревом групп по всем отфильтрованным записям.
 */
export async function selectListPage<T extends ListWindowRow>(options: {
  query: ListQuery;
  columns: ListColumns;
  /** Естественный порядок списка: без сортировки и для равных значений. */
  natural: Expr[];
  defaultSort?: ListSort | null;
  /**
   * Область «Свои контрагенты» и другие условия модуля — всегда явно (`undefined` — весь список
   * организации), чтобы модуль с областью не забыл её.
   */
  scope: SQL | undefined;
  select: (q: {
    window: ListWindowFields;
    where: SQL | undefined;
    orderBy: SQL[];
    limit: number;
    offset: number;
  }) => Promise<T[]>;
  /** Те же таблицы с любыми полями — нужен для группировки. */
  from?: ListFrom;
}): Promise<ListPageResult<Omit<T, keyof ListWindowRow>>> {
  const { query, columns } = options;
  const sort = query.sort === undefined ? (options.defaultSort ?? DEFAULT_LIST_SORT) : query.sort;
  const levels: GroupLevel[] = (query.group ?? []).map((key) => ({
    key,
    column: columnOf(columns, key, 'group'),
  }));
  const aggs = aggsOf(columns, query.agg);
  if (levels.length && !options.from) throw new ListQueryError('group', levels[0]!.key);
  const orderBy = [
    ...levels.flatMap((l) => groupOrderOf(l.column, l.key, sort)),
    ...listOrder(columns, sort, options.natural),
  ];
  const where = and(options.scope, listWhere(columns, query.filters, query.search));
  const totalKeys = Object.keys(columns).filter((k) => columns[k]?.total);
  const window: ListWindowFields = {
    listTotal: sql<number>`count(*) over ()`.mapWith(Number),
    listTotals: totalKeys.length
      ? sql<Record<string, number>>`jsonb_build_object(${sql.join(
          totalKeys.map((k) => sql`${k}::text, coalesce(sum(${columns[k]!.value}) over (), 0)`),
          sql`, `,
        )})`
      : sql<null>`null`,
    listGroups: levels.length
      ? sql<string[]>`array[${sql.join(
          levels.map((l) => groupKeyOf(l.column)),
          sql`, `,
        )}]::text[]`
      : sql<null>`null::text[]`,
  };
  const size = listPageSize(query);
  const limit = pageLimit(size);
  const fetch = (page: number) =>
    options.select({ window, where, orderBy, limit, offset: (page - 1) * limit });

  let page = Math.max(1, Math.floor(query.page));
  let rows = await fetch(page);
  if (!rows.length && page > 1) {
    const [probe] = await options.select({ window, where, orderBy, limit: 1, offset: 0 });
    page = clampPage(page, probe?.listTotal ?? 0, size);
    rows = probe ? await fetch(page) : [];
  }
  const first = rows[0];
  const zeros = Object.fromEntries(totalKeys.map((k) => [k, 0]));
  const totals = { ...zeros, ...mapNumbers(first?.listTotals ?? {}) };
  const result: ListPageResult<Omit<T, keyof ListWindowRow>> = {
    rows: rows.map(({ listTotal: _t, listTotals: _s, listGroups: _g, ...row }) => row),
    total: first?.listTotal ?? 0,
    page,
    size,
    totals,
  };
  if (levels.length && options.from) {
    result.groups = await selectGroups({ from: options.from, levels, where, sort, aggs });
    result.rowGroups = rows.map((r) => r.listGroups ?? []);
  }
  return result;
}

/** Значений для фильтра-галочек — не больше стольких; остальные найдутся поиском по списку. */
export const LIST_VALUES_LIMIT = 500;

export interface ListValue {
  value: string;
  label: string | null;
  count: number;
}

/**
 * Значения столбца для фильтра-галочек (прототип filterPop: значения со числом записей по всему
 * списку, «(Пусто)» внизу): код значения, подпись как на экране и число записей в области
 * пользователя. Порядок — как у сортировки столбца. `q` — «Найти значение»: только значения, подпись
 * которых его содержит, среди всех значений столбца (ТЗ «Поиск и фильтры»); `total` — сколько всего
 * подходящих значений.
 */
export async function selectListValues(options: {
  columns: ListColumns;
  key: string;
  /** Та же область, что у страницы списка: числа записей — только по ней. */
  scope: SQL | undefined;
  from: ListFrom;
  q?: string;
}): Promise<{ items: ListValue[]; total: number; more: boolean }> {
  const column = columnOf(options.columns, options.key, 'column');
  const value = sql`coalesce(${column.value}::text, '')`;
  const label = sql`min(${displayOf(column)})`;
  const rows = await options
    .from({ value, label, count: sql`count(*)::int`, total: sql`count(*) over ()` })
    .where(and(options.scope, valueMatch(column, options.q ?? '')))
    .groupBy(value, groupSortOf(column))
    .orderBy(...groupOrderOf(column, options.key, null))
    .limit(LIST_VALUES_LIMIT);
  const items = rows.map((r) => ({
    value: String(r.value ?? ''),
    label: (r.label as string | null) ?? null,
    count: Number(r.count),
  }));
  const total = rows.length ? Number(rows[0]!.total) : 0;
  return { items, total, more: total > items.length };
}

export type ExportCell = string | number | null;

/**
 * Записи для выгрузки в Excel (ТЗ «Экспорт в Excel всех отфильтрованных записей; файл формируется на
 * сервере»): все записи под поиском и фильтрами в порядке списка, столбцы `keys` по порядку экрана;
 * деньги и числа — числами (деньги в тыйынах), остальное — текстом, как на экране.
 */
export async function selectListExport(options: {
  query: ListQuery;
  columns: ListColumns;
  keys: readonly string[];
  natural: Expr[];
  defaultSort?: ListSort | null;
  /** Та же область, что у страницы списка: в файл — только её записи. */
  scope: SQL | undefined;
  from: ListFrom;
}): Promise<{
  columns: { key: string; label: string; type: ListColumnType }[];
  rows: ExportCell[][];
  more: boolean;
}> {
  const { query, columns } = options;
  const picked = options.keys.map((key) => ({ key, column: columnOf(columns, key, 'column') }));
  const sort = query.sort === undefined ? (options.defaultSort ?? DEFAULT_LIST_SORT) : query.sort;
  const fields: Record<string, SQL> = {};
  picked.forEach(({ column }, i) => {
    fields[`c${i}`] = isNumericColumn(column.type) ? sql`${column.value}` : displayOf(column);
  });
  const rows = await options
    .from(fields)
    .where(and(options.scope, listWhere(columns, query.filters, query.search)))
    .orderBy(...listOrder(columns, sort, options.natural))
    .limit(EXPORT_ROWS_LIMIT + 1);
  return {
    columns: picked.map(({ key, column }) => ({ key, label: column.label, type: column.type })),
    rows: rows.slice(0, EXPORT_ROWS_LIMIT).map((r) =>
      picked.map(({ column }, i) => {
        const v = r[`c${i}`];
        if (v == null) return null;
        return isNumericColumn(column.type) ? Number(v) : String(v);
      }),
    ),
    more: rows.length > EXPORT_ROWS_LIMIT,
  };
}

function mapNullableNumbers(values: Record<string, unknown>): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, v == null ? null : Number(v)]),
  );
}

function mapNumbers(values: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]));
}
