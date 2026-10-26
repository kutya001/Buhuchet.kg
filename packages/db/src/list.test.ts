import type { ListFilterValue, ListQuery } from '@buhuchet/domain';
import { asc, sql } from 'drizzle-orm';
import { bigint, date, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ListQueryError, normalizeText, selectListPage, type ListColumns } from './list';
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
  name: { type: 'text', value: items.name },
  phone: { type: 'text', value: items.phone, compact: true },
  kind: { type: 'enum', value: items.kind },
  amount: { type: 'money', value: items.amount, total: true },
  due: { type: 'date', value: items.due },
  at: { type: 'datetime', value: items.at },
  createdAt: { type: 'datetime', value: items.createdAt },
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

  const page = (query: Partial<ListQuery>) =>
    selectListPage({
      query: { sort: undefined, page: 1, size: 25, filters: {}, ...query },
      columns: COLUMNS,
      natural: [items.createdAt, items.id],
      select: ({ window, where, orderBy, limit, offset }) =>
        t.app.db
          .select({ id: items.id, name: items.name, ...window })
          .from(items)
          .where(where)
          .orderBy(...orderBy)
          .limit(limit)
          .offset(offset),
    });
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

  it('сравнение текста — русское с числами по значению (миграция 0019)', async () => {
    const rows = await t.app.db
      .select({ v: sql<string>`v` })
      .from(sql`(values ('Док 10'), ('Док 9'), ('док 1')) as x(v)`)
      .orderBy(asc(sql`v collate app.ru_natural`));
    expect(rows.map((r) => r.v)).toEqual(['док 1', 'Док 9', 'Док 10']);
  });
});
