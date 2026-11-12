import type { ListQuery, ListSort } from '@buhuchet/domain';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from './client';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
} from './list';

// Админка → «Техническая документация» → «API» (прототип admin/techdocs.js, tdApiTab): список методов.
// Методы — не таблица базы, а собранное при сборке сайта описание API; строки идут в общий механизм
// списков одним параметром (`jsonb_to_recordset`), как справочники платформы глазами организации:
// поиск, фильтры, сортировка, группы и выгрузка — те же, что у всех списков.

/** Строка списка методов: значения столбцов и подписи, как на экране. */
export interface ApiMethodListRow {
  id: string;
  /** GET, POST… */
  m: string;
  /** Адрес: `/admin/users/{id}`. */
  p: string;
  /** Раздел: код и название. */
  sec: string;
  secText: string;
  sum: string;
  /** Доступ: код и подпись. */
  acc: string;
  accText: string;
  /** Права названиями через запятую. */
  perm: string;
  /** «Меняет данные». */
  writes: boolean;
  writesText: string;
  /** Таблицы метода: имена (столбец «Таблицы») и русские названия (для поиска). */
  tables: readonly string[];
  tablesRu: readonly string[];
  rate: string;
  file: string;
}

/** Столбец строки из `jsonb_to_recordset`: ключи — постоянные имена столбцов, не ввод пользователя. */
const field = (key: string) => sql.raw(`"r"."${key}"`);

const DEFS = [
  'id text',
  'ord integer',
  'm text',
  'p text',
  'sec text',
  'sec_text text',
  'sum text',
  'acc text',
  'acc_text text',
  'perm text',
  'n integer',
  'w text',
  'w_text text',
  'tb text',
  'tb_search text',
  'rate text',
  'file text',
  'tbl jsonb',
].join(', ');

function recordset(rows: readonly ApiMethodListRow[]): SQL {
  const json = rows.map((r, ord) => ({
    id: r.id,
    ord,
    m: r.m,
    p: r.p,
    sec: r.sec,
    sec_text: r.secText,
    sum: r.sum,
    acc: r.acc,
    acc_text: r.accText,
    perm: r.perm,
    n: r.tables.length,
    w: r.writes ? 'yes' : 'no',
    w_text: r.writesText,
    tb: r.tables.join(', '),
    tb_search: [...r.tables, ...r.tablesRu].join(' '),
    rate: r.rate,
    file: r.file,
    tbl: r.tables,
  }));
  return sql`jsonb_to_recordset(${JSON.stringify(json)}::jsonb) as r(${sql.raw(DEFS)})`;
}

/** Столбцы списка (прототип grid `adm-api`): ключи — как у столбцов экрана. */
export const API_METHOD_COLUMNS: ListColumns = {
  m: { type: 'enum', label: 'tdocs.col.m', value: field('m') },
  // Поиск по имени и русскому названию таблицы — всегда (прототип searchText): столбец «Таблицы» по
  // умолчанию скрыт, а экран ищет только по видимым столбцам, поэтому таблицы ищутся и через «Адрес».
  p: {
    type: 'text',
    label: 'tdocs.col.p',
    value: field('p'),
    searchDisplay: sql`concat_ws(' ', ${field('p')}, ${field('tb_search')})`,
  },
  sec: {
    type: 'enum',
    label: 'tdocs.col.sec',
    value: field('sec'),
    display: field('sec_text'),
    sort: { value: field('sec_text'), text: true },
  },
  sum: { type: 'text', label: 'tdocs.col.sum', value: field('sum') },
  acc: { type: 'enum', label: 'tdocs.col.acc', value: field('acc'), display: field('acc_text') },
  perm: { type: 'text', label: 'tdocs.col.perm', value: field('perm') },
  n: { type: 'int', label: 'tdocs.col.n', value: field('n') },
  w: { type: 'enum', label: 'tdocs.col.w', value: field('w'), display: field('w_text') },
  // Поиск — по имени таблицы и по её русскому названию.
  tb: {
    type: 'text',
    label: 'tdocs.col.tb',
    value: field('tb'),
    searchDisplay: field('tb_search'),
  },
  rate: { type: 'text', label: 'tdocs.col.rate', value: field('rate') },
  file: { type: 'text', label: 'tdocs.col.file', value: field('file') },
};

const SORT: ListSort = { key: 'p', dir: 'asc' };
const NATURAL = [field('ord')];

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

/** Фильтр «Таблица»: методы, которые читают или меняют таблицу. */
const tableScope = (table: string | undefined): SQL | undefined =>
  table ? sql`jsonb_exists(${field('tbl')}, ${table})` : undefined;

export interface ApiMethodPageRow {
  id: string;
  m: string;
  p: string;
  sec: string;
  sum: string;
  acc: string;
  perm: string;
  n: number;
  w: string;
  tb: string;
  rate: string;
  file: string;
}

/** Страница списка методов API. */
export async function listApiMethodsPage(
  tx: Tx,
  rows: readonly ApiMethodListRow[],
  query: ListQuery,
  table?: string,
) {
  const source = recordset(rows);
  return selectListPage({
    query,
    columns: API_METHOD_COLUMNS,
    natural: NATURAL,
    defaultSort: SORT,
    scope: tableScope(table),
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({
          id: sql<string>`${field('id')}`,
          m: sql<string>`${field('m')}`,
          p: sql<string>`${field('p')}`,
          sec: sql<string>`${field('sec')}`,
          sum: sql<string>`${field('sum')}`,
          acc: sql<string>`${field('acc')}`,
          perm: sql<string>`${field('perm')}`,
          n: sql<number>`${field('n')}`,
          w: sql<string>`${field('w')}`,
          tb: sql<string>`${field('tb')}`,
          rate: sql<string>`${field('rate')}`,
          file: sql<string>`${field('file')}`,
          ...window,
        })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: fromOf(tx, source),
  });
}

/** Значения столбца списка методов для фильтра-галочек. */
export async function listApiMethodValues(
  tx: Tx,
  rows: readonly ApiMethodListRow[],
  key: string,
  q?: string,
  table?: string,
) {
  return selectListValues({
    columns: API_METHOD_COLUMNS,
    key,
    scope: tableScope(table),
    from: fromOf(tx, recordset(rows)),
    q,
  });
}

/** Список методов для выгрузки в Excel. */
export async function exportApiMethods(
  tx: Tx,
  rows: readonly ApiMethodListRow[],
  query: ListQuery,
  keys: readonly string[],
  table?: string,
) {
  return selectListExport({
    query,
    columns: API_METHOD_COLUMNS,
    keys,
    natural: NATURAL,
    defaultSort: SORT,
    scope: tableScope(table),
    from: fromOf(tx, recordset(rows)),
  });
}
