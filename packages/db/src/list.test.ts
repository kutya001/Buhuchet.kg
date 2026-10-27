import {
  enumChecked,
  EXPORT_ROWS_LIMIT,
  formatSom,
  formatSomWithUnit,
  matchesSearch,
  matchesValue,
  type EnumSelection,
  type ListFilterValue,
  type ListQuery,
} from '@buhuchet/domain';
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { bigint, date, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  displayOf,
  LIST_VALUES_LIMIT,
  ListQueryError,
  normalizeText,
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
} from './list';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

/** Таблица только для этого теста: создаётся во временной базе, в схеме приложения её нет. */
const items = pgTable('list_test_items', {
  id: integer('id').primaryKey(),
  name: text('name'),
  phone: text('phone'),
  kind: text('kind'),
  amount: bigint('amount', { mode: 'number' }),
  due: date('due', { mode: 'string' }),
  at: timestamp('at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

const COLUMNS: ListColumns = {
  name: { type: 'text', label: 'test.name', value: items.name },
  phone: { type: 'text', label: 'test.phone', value: items.phone, compact: true },
  kind: { type: 'enum', label: 'test.kind', value: items.kind },
  amount: { type: 'money', label: 'test.amount', value: items.amount, total: true },
  due: { type: 'date', label: 'test.due', value: items.due },
  at: { type: 'datetime', label: 'test.at', value: items.at },
  createdAt: { type: 'datetime', label: 'test.created_at', value: items.createdAt },
};

/** Название как справочник: «Найти значение» и шаги «Выбрать все» по подписи значения. */
const NAME_ENUM: ListColumns = {
  name: { type: 'enum', label: 'test.name', value: items.name },
};

/** Столбец с 620 значениями — больше, чем приходит в фильтр-галочки (`LIST_VALUES_LIMIT`). */
const MANY = 620;
const many = pgTable('list_test_many', { id: integer('id').primaryKey(), name: text('name') });
const MANY_COLUMNS: ListColumns = {
  name: { type: 'enum', label: 'test.name', value: many.name },
};

/** Записей больше, чем входит в выгрузку «В Excel» (`EXPORT_ROWS_LIMIT`). */
const BIG = EXPORT_ROWS_LIMIT + 12;
const big = pgTable('list_test_big', { id: integer('id').primaryKey() });
const BIG_COLUMNS: ListColumns = { id: { type: 'int', label: 'test.id', value: big.id } };

/** Отчёты для пункта приёмки «компания А, 09.2026 — 10 500 сом»: только для этого теста. */
const reports = pgTable('list_test_reports', {
  id: integer('id').primaryKey(),
  company: text('company').notNull(),
  kind: text('kind').notNull(),
  period: date('period', { mode: 'string' }).notNull(),
  sum: bigint('sum', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

const REPORT_COLUMNS: ListColumns = {
  company: { type: 'enum', label: 'test.company', value: reports.company },
  kind: { type: 'enum', label: 'test.kind', value: reports.kind },
  period: { type: 'date', label: 'test.period', value: reports.period },
  sum: { type: 'money', label: 'test.sum', value: reports.sum, total: true },
  createdAt: { type: 'datetime', label: 'test.created_at', value: reports.createdAt },
};

const ROWS = [
  { id: 1, name: 'Док 10', phone: '+996555100200', kind: 'a', amount: 1000, due: '2026-10-01' },
  { id: 2, name: 'док 2', phone: '+996700123456', kind: 'b', amount: 2500, due: '2026-10-15' },
  { id: 3, name: 'Док 1', phone: null, kind: null, amount: null, due: null },
  { id: 4, name: 'Ёлка 50%', phone: '', kind: '', amount: 300, due: '2026-10-31' },
  { id: 5, name: '', phone: '+996555999000', kind: 'a', amount: 0, due: '2026-11-01' },
  { id: 6, name: null, phone: null, kind: 'b', amount: 5000, due: '2026-09-30' },
  { id: 7, name: 'Ель_синяя', phone: null, kind: 'a', amount: 700, due: null },
];

describe.skipIf(!databaseAvailable())('страница списка на сервере (selectListPage)', () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await createTestDatabase();
    await t.admin.sql`create table list_test_items (
      id integer primary key, name text, phone text, kind text, amount bigint, due date,
      at timestamptz, created_at timestamptz not null)`;
    await t.admin.sql`grant select on list_test_items to buhuchet_app`;
    await t.admin.sql`create table list_test_reports (
      id integer primary key, company text not null, kind text not null, period date not null,
      sum bigint not null, created_at timestamptz not null)`;
    await t.admin.sql`grant select on list_test_reports to buhuchet_app`;
    await t.admin.sql.unsafe(`create table list_test_many as
      select i as id, 'Значение ' || i as name from generate_series(1, ${MANY}) i`);
    await t.admin.sql`grant select on list_test_many to buhuchet_app`;
    await t.admin.sql.unsafe(
      `create table list_test_big as select i as id from generate_series(1, ${BIG}) i`,
    );
    await t.admin.sql`grant select on list_test_big to buhuchet_app`;
    await t.admin.db.insert(reports).values(
      [
        { id: 1, company: 'Компания А', kind: 'Соцфонд', period: '2026-09-01', sum: 250_000 },
        { id: 2, company: 'Компания А', kind: 'ГНС', period: '2026-09-01', sum: 300_000 },
        { id: 3, company: 'Компания А', kind: 'НДС', period: '2026-09-01', sum: 500_000 },
        { id: 4, company: 'Компания А', kind: 'НДС', period: '2026-08-01', sum: 100_000 },
        { id: 5, company: 'Компания Б', kind: 'ГНС', period: '2026-09-01', sum: 700_000 },
      ].map((r) => ({ ...r, createdAt: new Date(Date.UTC(2026, 9, 1, 0, r.id)) })),
    );
    await t.admin.db.insert(items).values(
      ROWS.map((r, i) => ({
        ...r,
        // Создано по порядку: id 1 — самая старая запись.
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)),
        at: r.id === 1 ? new Date('2026-10-25T19:00:00Z') : new Date('2026-10-25T17:59:00Z'),
      })),
    );
  });

  afterAll(async () => {
    await t?.drop();
  });

  const from: ListFrom = (fields) => t.app.db.select(fields).from(items).$dynamic();
  const manyFrom: ListFrom = (fields) => t.app.db.select(fields).from(many).$dynamic();
  const bigFrom: ListFrom = (fields) => t.app.db.select(fields).from(big).$dynamic();
  const page = (query: Partial<ListQuery>) =>
    selectListPage({
      query: { sort: undefined, page: 1, size: 25, filters: {}, ...query },
      columns: COLUMNS,
      natural: [items.createdAt, items.id],
      scope: undefined,
      select: ({ window, where, orderBy, limit, offset }) =>
        t.app.db
          .select({ id: items.id, name: items.name, ...window })
          .from(items)
          .where(where)
          .orderBy(...orderBy)
          .limit(limit)
          .offset(offset),
      from,
    });
  const found = (q: string, keys: string[] = []) => ids({ search: { q, keys } });
  const ids = async (query: Partial<ListQuery>) => (await page(query)).rows.map((r) => r.id);
  const filtered = (key: string, filter: ListFilterValue) => ids({ filters: { [key]: filter } });

  it('по умолчанию — от новых к старым по «Создано»', async () => {
    expect(await ids({})).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });

  it('«Док 2» перед «Док 10», регистр не важен, «ё» рядом с «е», пустые всегда внизу', async () => {
    // «Ёлка» перед «Ель»: «ё» сравнивается как «е», дальше «к» раньше «ь».
    expect(await ids({ sort: { key: 'name', dir: 'asc' } })).toEqual([3, 2, 1, 4, 7, 5, 6]);
    const desc = await ids({ sort: { key: 'name', dir: 'desc' } });
    expect(desc.slice(0, 5)).toEqual([7, 4, 1, 2, 3]);
    expect(desc.slice(5)).toEqual([5, 6]);
  });

  it('числа и даты: пустые внизу при любом направлении; без сортировки — естественный порядок', async () => {
    expect(await ids({ sort: { key: 'amount', dir: 'asc' } })).toEqual([5, 4, 7, 1, 2, 6, 3]);
    expect(await ids({ sort: { key: 'amount', dir: 'desc' } })).toEqual([6, 2, 1, 7, 4, 5, 3]);
    expect((await ids({ sort: { key: 'due', dir: 'desc' } })).slice(-2)).toEqual([3, 7]);
    expect(await ids({ sort: null })).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('страница, всего записей и последняя страница вместо несуществующей', async () => {
    const first = await page({ size: 25, sort: null });
    expect(first).toMatchObject({ total: 7, page: 1 });
    const limited = await selectListPage({
      query: { sort: null, page: 2, size: 25, filters: {} },
      columns: COLUMNS,
      natural: [items.id],
      scope: undefined,
      select: ({ window, where, orderBy, offset }) =>
        t.app.db
          .select({ id: items.id, ...window })
          .from(items)
          .where(where)
          .orderBy(...orderBy)
          .limit(3)
          .offset(offset === 25 ? 3 : offset),
    });
    expect(limited.rows.map((r) => r.id)).toEqual([4, 5, 6]);
    expect(limited.total).toBe(7);
    const beyond = await page({ page: 9, sort: null });
    expect(beyond.page).toBe(1);
    expect(beyond.rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(await page({ size: 'all' })).toMatchObject({ total: 7, page: 1 });
  });

  it('итоги — по всем отфильтрованным записям; у пустого списка — нули', async () => {
    expect((await page({})).totals).toEqual({ amount: 9500 });
    const a = await page({ filters: { kind: { type: 'enum', vals: ['a'] } } });
    expect(a.totals).toEqual({ amount: 1700 });
    const none = await page({ filters: { kind: { type: 'enum', vals: [] } } });
    expect(none).toMatchObject({ rows: [], total: 0, page: 1, totals: { amount: 0 } });
  });

  it('текст — по подстроке без учёта регистра, «ё» = «е», знаки % и _ — обычные буквы', async () => {
    expect(await filtered('name', { type: 'text', q: 'ДОК' })).toEqual([3, 2, 1]);
    expect(await filtered('name', { type: 'text', q: 'елка' })).toEqual([4]);
    expect(await filtered('name', { type: 'text', q: 'ёл' })).toEqual([7, 4]);
    expect(await filtered('name', { type: 'text', q: '%' })).toEqual([4]);
    expect(await filtered('name', { type: 'text', q: '_' })).toEqual([7]);
    expect(normalizeText('ЁЛКА Ель')).toBe('елка ель');
  });

  it('телефон — пробелы, дефисы и скобки в фильтре не мешают', async () => {
    expect(await filtered('phone', { type: 'text', q: '555 100-200' })).toEqual([1]);
    expect(await filtered('phone', { type: 'text', q: '(555)' })).toEqual([5, 1]);
  });

  it('справочник — отмеченные значения и «(Пусто)»', async () => {
    expect(await filtered('kind', { type: 'enum', vals: ['b'] })).toEqual([6, 2]);
    expect(await filtered('kind', { type: 'enum', vals: [''] })).toEqual([4, 3]);
    expect(await filtered('kind', { type: 'enum', vals: ['a', ''] })).toEqual([7, 5, 4, 3, 1]);
  });

  it('число — «От» и «До» включительно, пустые не проходят', async () => {
    expect(await filtered('amount', { type: 'num', from: 700, to: 2500 })).toEqual([7, 2, 1]);
    expect(await filtered('amount', { type: 'num', to: 0 })).toEqual([5]);
  });

  it('дата — «С даты» и «По дату» включительно; момент — по дате в Бишкеке', async () => {
    expect(await filtered('due', { type: 'date', from: '2026-10-01', to: '2026-10-31' })).toEqual([
      4, 2, 1,
    ]);
    // 25.10 19:00 UTC — уже 26.10 в Бишкеке (UTC+6), 17:59 UTC — ещё 25.10.
    expect(await filtered('at', { type: 'date', from: '2026-10-26' })).toEqual([1]);
    expect(await filtered('at', { type: 'date', to: '2026-10-25' })).toEqual([7, 6, 5, 4, 3, 2]);
  });

  it('несколько фильтров — «И»', async () => {
    expect(
      await ids({
        filters: {
          kind: { type: 'enum', vals: ['a'] },
          amount: { type: 'num', from: 500 },
        },
      }),
    ).toEqual([7, 1]);
  });

  it('столбца нет или фильтр не по его типу — ошибка запроса', async () => {
    await expect(ids({ sort: { key: 'nope', dir: 'asc' } })).rejects.toBeInstanceOf(ListQueryError);
    await expect(ids({ sort: { key: 'toString', dir: 'asc' } })).rejects.toBeInstanceOf(
      ListQueryError,
    );
    await expect(filtered('nope', { type: 'text', q: 'a' })).rejects.toMatchObject({
      part: 'filter',
      key: 'nope',
    });
    await expect(filtered('amount', { type: 'text', q: '1' })).rejects.toBeInstanceOf(
      ListQueryError,
    );
    await expect(filtered('__proto__', { type: 'text', q: 'a' })).rejects.toBeInstanceOf(
      ListQueryError,
    );
  });

  it('поиск — по тексту видимых столбцов, как на экране: сумма, дата, момент по Бишкеку', async () => {
    expect(await found('док', ['name'])).toEqual([3, 2, 1]);
    expect(await found('ЁЛ', ['name'])).toEqual([7, 4]);
    // Ищется только в видимых столбцах.
    expect(await found('док', ['phone'])).toEqual([]);
    // Сумма — «25,00» (2 500 тыйынов), дата — «01.10.2026», момент — «26.10.2026 01:00» в Бишкеке.
    expect(await found('25,00', ['amount'])).toEqual([2]);
    expect(await found('01.10.2026', ['due'])).toEqual([1]);
    expect(await found('26.10.2026', ['at'])).toEqual([1]);
    // Без столбцов — по всем.
    expect(await found('+996700')).toEqual([2]);
    expect(await found('   ')).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });

  it('поиск: в телефоне пробелы, дефисы и скобки не мешают; совпадает с эталоном matchesSearch', async () => {
    expect(await found('555 100-200', ['phone'])).toEqual([1]);
    expect(await found('(555) 999', ['phone'])).toEqual([5]);
    for (const q of [
      'док',
      'Док 1',
      'ё',
      '%',
      '_',
      '55',
      '5-5',
      '555 1',
      '996 700',
      'ель с',
      '50%',
    ]) {
      const expected = ROWS.filter((r) => [r.name, r.phone].some((v) => matchesSearch(v ?? '', q)))
        .map((r) => r.id)
        .sort((a, b) => b - a);
      expect(await found(q, ['name', 'phone']), q).toEqual(expected);
    }
  });

  it('поиск и фильтр сочетаются («И»); неизвестный столбец поиска — ошибка запроса', async () => {
    expect(
      await ids({
        filters: { kind: { type: 'enum', vals: ['a'] } },
        search: { q: 'док', keys: ['name'] },
      }),
    ).toEqual([1]);
    await expect(found('a', ['nope'])).rejects.toMatchObject({ part: 'search', key: 'nope' });
  });

  it('деньги на экране — как formatSom: «1 250,50», «−300,00»', async () => {
    for (const v of [0, 5, 100, 125_050, 100_000_000, -30_000, 123_456_789_012]) {
      const column = { type: 'money' as const, label: '', value: sql`${v}::bigint` };
      const [row] = await t.app.db
        .select({ text: displayOf(column) as SQL<string> })
        .from(sql`(select 1) x`);
      expect(row?.text, String(v)).toBe(formatSom(v));
    }
  });

  it('группировка: группы по порядку, пустая внизу, число записей и итоги; записи по группам', async () => {
    const grouped = await page({ group: ['kind'], agg: { amount: 'sum' } });
    expect(grouped.size).toBe('all');
    expect(grouped.groups).toEqual([
      { key: 'a', label: 'a', count: 3, aggs: { amount: 1700 } },
      { key: 'b', label: 'b', count: 2, aggs: { amount: 7500 } },
      { key: '', label: null, count: 2, aggs: { amount: 300 } },
    ]);
    expect(grouped.rows.map((r) => r.id)).toEqual([7, 5, 1, 6, 2, 4, 3]);
    expect(grouped.rowGroups).toEqual([['a'], ['a'], ['a'], ['b'], ['b'], [''], ['']]);
    // Сортировка по столбцу группы по убыванию — группы тоже; пустая всё равно внизу.
    const desc = await page({ group: ['kind'], sort: { key: 'kind', dir: 'desc' } });
    expect(desc.groups?.map((g) => g.key)).toEqual(['b', 'a', '']);
  });

  it('два уровня: группы внутри групп; момент группируется по дню в Бишкеке', async () => {
    const grouped = await page({
      group: ['kind', 'at'],
      agg: { amount: 'avg' },
      filters: { kind: { type: 'enum', vals: ['a', 'b'] } },
    });
    expect(grouped.groups).toEqual([
      {
        key: 'a',
        label: 'a',
        count: 3,
        aggs: { amount: 1700 / 3 },
        sub: [
          { key: '2026-10-25', label: '25.10.2026', count: 2, aggs: { amount: 350 } },
          { key: '2026-10-26', label: '26.10.2026', count: 1, aggs: { amount: 1000 } },
        ],
      },
      {
        key: 'b',
        label: 'b',
        count: 2,
        aggs: { amount: 3750 },
        sub: [{ key: '2026-10-25', label: '25.10.2026', count: 2, aggs: { amount: 3750 } }],
      },
    ]);
    expect(grouped.rowGroups?.[0]).toEqual(['a', '2026-10-25']);
    const counts = await page({ group: ['kind'], agg: { amount: 'count' } });
    expect(counts.groups?.map((g) => g.aggs.amount)).toEqual([3, 2, 1]);
    const extremes = await page({ group: ['kind'], agg: { amount: 'max' } });
    expect(extremes.groups?.map((g) => g.aggs.amount)).toEqual([1000, 5000, 300]);
  });

  it('группа по неизвестному столбцу или итог у не-числа — ошибка запроса', async () => {
    await expect(page({ group: ['nope'] })).rejects.toMatchObject({ part: 'group' });
    await expect(page({ group: ['kind'], agg: { name: 'sum' } })).rejects.toMatchObject({
      part: 'agg',
      key: 'name',
    });
  });

  it('значения для фильтра-галочек: подпись и число записей по всему списку, пустые внизу', async () => {
    const values = (key: string, scope?: SQL) =>
      selectListValues({ columns: COLUMNS, key, scope, from });
    expect(await values('kind')).toEqual({
      items: [
        { value: 'a', label: 'a', count: 3 },
        { value: 'b', label: 'b', count: 2 },
        { value: '', label: null, count: 2 },
      ],
      total: 3,
      more: false,
    });
    // Область модуля («Свои контрагенты») сужает и значения, и их числа.
    expect((await values('kind', eq(items.kind, 'b'))).items).toEqual([
      { value: 'b', label: 'b', count: 2 },
    ]);
    await expect(values('nope')).rejects.toBeInstanceOf(ListQueryError);
  });

  it('«Найти значение» ищет по всем значениям: подстрока подписи без учёта регистра и «ё», как matchesValue', async () => {
    const found = async (q: string) =>
      selectListValues({ columns: NAME_ENUM, key: 'name', scope: undefined, from, q });
    expect(await found('ДОК')).toEqual({
      items: [
        { value: 'Док 1', label: 'Док 1', count: 1 },
        { value: 'док 2', label: 'док 2', count: 1 },
        { value: 'Док 10', label: 'Док 10', count: 1 },
      ],
      total: 3,
      more: false,
    });
    for (const q of ['ел', 'ёл', '%', '_', 'пусто', '  ']) {
      const labels = ROWS.map((r) => r.name || null).filter((l) => matchesValue(l, q));
      const res = await found(q);
      expect(res.items.map((i) => i.label).sort(), q).toEqual([...new Set(labels)].sort());
    }
  });

  it('значений больше 500 — пришли первые 500, всего — сколько подходит; поиск находит и не пришедшие', async () => {
    const values = (q?: string) =>
      selectListValues({ columns: MANY_COLUMNS, key: 'name', scope: undefined, from: manyFrom, q });
    const all = await values();
    expect(all.items).toHaveLength(LIST_VALUES_LIMIT);
    expect(all).toMatchObject({ total: MANY, more: true });
    expect(all.items.map((i) => i.label)).not.toContain('Значение 610');
    const found = await values('значение 61');
    expect(found).toMatchObject({ total: 11, more: false });
    expect(found.items.map((i) => i.label)).toContain('Значение 610');
  });

  it('галочки с шагами «Выбрать все» по поиску — те же записи, что эталон enumChecked', async () => {
    const selections: EnumSelection[] = [
      { vals: ['Док 1'] },
      { vals: [], steps: [{ on: true, match: 'док' }] },
      {
        vals: [],
        steps: [
          { on: true, match: 'Е' },
          { on: false, vals: ['Ель_синяя'] },
        ],
      },
      {
        vals: [''],
        steps: [
          { on: true, match: '' },
          { on: false, match: 'ДОК 1' },
        ],
      },
      {
        vals: ['Ёлка 50%'],
        steps: [
          { on: false, match: '%' },
          { on: true, vals: ['док 2', ''] },
        ],
      },
      { vals: [], steps: [{ on: true, match: '_' }] },
    ];
    for (const selection of selections) {
      const res = await selectListPage({
        query: { sort: null, page: 1, size: 25, filters: { name: { type: 'enum', ...selection } } },
        columns: NAME_ENUM,
        natural: [items.id],
        scope: undefined,
        select: ({ window, where, orderBy, limit, offset }) =>
          t.app.db
            .select({ id: items.id, ...window })
            .from(items)
            .where(where)
            .orderBy(...orderBy)
            .limit(limit)
            .offset(offset),
      });
      const expected = ROWS.filter((r) => enumChecked(selection, r.name ?? '', r.name || null));
      expect(
        res.rows.map((r) => r.id),
        JSON.stringify(selection),
      ).toEqual(expected.map((r) => r.id));
    }
  });

  it('выгрузка: все записи под фильтром, видимые столбцы по порядку, деньги — числом', async () => {
    const exported = await selectListExport({
      query: { sort: null, page: 1, size: 25, filters: { kind: { type: 'enum', vals: ['a'] } } },
      columns: COLUMNS,
      keys: ['name', 'amount', 'due'],
      natural: [items.createdAt, items.id],
      scope: undefined,
      from,
    });
    expect(exported).toEqual({
      columns: [
        { key: 'name', label: 'test.name', type: 'text' },
        { key: 'amount', label: 'test.amount', type: 'money' },
        { key: 'due', label: 'test.due', type: 'date' },
      ],
      rows: [
        ['Док 10', 1000, '01.10.2026'],
        [null, 0, '01.11.2026'],
        ['Ель_синяя', 700, null],
      ],
      more: false,
      total: 3,
    });
    // В файл — только записи области модуля.
    const scoped = await selectListExport({
      query: { sort: null, page: 1, size: 25, filters: {} },
      columns: COLUMNS,
      keys: ['kind'],
      natural: [items.id],
      scope: eq(items.kind, 'b'),
      from,
    });
    expect(scoped.rows).toEqual([['b'], ['b']]);
  });

  it('выгрузка больше 50 000 записей: в файл — первые 50 000, всего под фильтром — для уведомления', async () => {
    const query = { sort: null, page: 1, size: 25 as const, filters: {} };
    const exported = await selectListExport({
      query,
      columns: BIG_COLUMNS,
      keys: ['id'],
      natural: [big.id],
      scope: undefined,
      from: bigFrom,
    });
    expect(exported.rows).toHaveLength(EXPORT_ROWS_LIMIT);
    expect(exported.rows.at(-1)).toEqual([EXPORT_ROWS_LIMIT]);
    expect(exported).toMatchObject({ more: true, total: BIG });
    // Под фильтром — столько, сколько подходит, а не сколько в таблице.
    const filtered = await selectListExport({
      query: { ...query, filters: { id: { type: 'num', from: 11 } } },
      columns: BIG_COLUMNS,
      keys: ['id'],
      natural: [big.id],
      scope: undefined,
      from: bigFrom,
    });
    expect(filtered).toMatchObject({ more: true, total: BIG - 10 });
    // И только в области модуля: записи вне области не считаются.
    const scoped = await selectListExport({
      query,
      columns: BIG_COLUMNS,
      keys: ['id'],
      natural: [big.id],
      scope: sql`${big.id} > 5`,
      from: bigFrom,
    });
    expect(scoped).toMatchObject({ more: true, total: BIG - 5 });
  });

  it('итог по любому фильтру: «компания А, 09.2026» — 10 500 сом (механизм итогов пункта приёмки)', async () => {
    const result = await selectListPage({
      query: {
        sort: undefined,
        page: 1,
        size: 25,
        filters: {
          company: { type: 'enum', vals: ['Компания А'] },
          period: { type: 'date', from: '2026-09-01', to: '2026-09-30' },
        },
      },
      columns: REPORT_COLUMNS,
      natural: [reports.createdAt, reports.id],
      scope: undefined,
      select: ({ window, where, orderBy, limit, offset }) =>
        t.app.db
          .select({ id: reports.id, ...window })
          .from(reports)
          .where(where)
          .orderBy(...orderBy)
          .limit(limit)
          .offset(offset),
    });
    expect(result.total).toBe(3);
    expect(result.totals).toEqual({ sum: 1_050_000 });
    expect(formatSomWithUnit(result.totals.sum!)).toBe('10\u00a0500\u00a0сом');
  });

  it('сравнение текста — русское с числами по значению (миграция 0019)', async () => {
    const rows = await t.app.db
      .select({ v: sql<string>`v` })
      .from(sql`(values ('Док 10'), ('Док 9'), ('док 1')) as x(v)`)
      .orderBy(asc(sql`v collate app.ru_natural`));
    expect(rows.map((r) => r.v)).toEqual(['док 1', 'Док 9', 'Док 10']);
  });
});
