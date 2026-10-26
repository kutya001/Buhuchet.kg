import { describe, expect, it } from 'vitest';
import {
  GridKeyParam,
  ListFilter,
  ListFilters,
  ListQueryParams,
  listPageSchema,
  listQueryParams,
  parseListQuery,
  ViewSettings,
} from './list';
import { z } from 'zod';

const parse = (raw: Record<string, string>) => {
  const params = ListQueryParams.parse(raw);
  return parseListQuery(params);
};

describe('запрос страницы списка', () => {
  it('без параметров — первая страница по 25, сортировка списка по умолчанию', () => {
    expect(parse({})).toEqual({
      ok: true,
      query: { sort: undefined, page: 1, size: 25, filters: {} },
    });
  });

  it('сортировка, страница, размер и фильтры', () => {
    const filters = { role: { type: 'enum', vals: ['a', ''] } };
    expect(
      parse({ sort: 'fullName.desc', page: '3', size: 'all', filters: JSON.stringify(filters) }),
    ).toEqual({
      ok: true,
      query: { sort: { key: 'fullName', dir: 'desc' }, page: 3, size: 'all', filters },
    });
    expect(parse({ sort: 'none' })).toMatchObject({ ok: true, query: { sort: null } });
  });

  it('обратное преобразование для клиента', () => {
    const query = {
      sort: { key: 'createdAt', dir: 'desc' as const },
      page: 2,
      size: 50 as const,
      filters: { fullName: { type: 'text' as const, q: 'Алиев' } },
    };
    const params = listQueryParams(query);
    expect(params).toEqual({
      page: '2',
      size: '50',
      sort: 'createdAt.desc',
      filters: '{"fullName":{"type":"text","q":"Алиев"}}',
    });
    expect(parse(params)).toEqual({ ok: true, query });
    expect(listQueryParams({ ...query, sort: null, filters: {} })).toEqual({
      page: '2',
      size: '50',
      sort: 'none',
    });
    expect(listQueryParams({ ...query, sort: undefined, filters: {} })).not.toHaveProperty('sort');
  });

  it('неверные параметры не проходят', () => {
    for (const raw of [
      { sort: 'fullName' },
      { sort: 'full name.asc' },
      { sort: 'fullName.up' },
      { page: '0' },
      { page: 'x' },
      { size: '10' },
      { filters: 'x'.repeat(8001) },
    ]) {
      expect(ListQueryParams.safeParse(raw).success, JSON.stringify(raw).slice(0, 40)).toBe(false);
    }
    expect(parse({ filters: '{' })).toEqual({ ok: false });
    expect(parse({ filters: '{"fullName":{"type":"text","q":""}}' })).toEqual({ ok: false });
    expect(parse({ filters: '{"bad key":{"type":"text","q":"a"}}' })).toEqual({ ok: false });
    expect(parse({ filters: '[1]' })).toEqual({ ok: false });
  });
});

describe('фильтры столбцов (ТЗ «Поиск и фильтры»)', () => {
  it('по типам столбцов', () => {
    for (const f of [
      { type: 'text', q: 'Алиев' },
      { type: 'enum', vals: [] },
      { type: 'num', from: 100 },
      { type: 'num', to: 0 },
      { type: 'date', from: '2026-10-01', to: '2026-10-31' },
    ]) {
      expect(ListFilter.safeParse(f).success, JSON.stringify(f)).toBe(true);
    }
  });

  it('пустой диапазон, дробное число, год 0000 и чужой формат даты не принимаются', () => {
    for (const f of [
      { type: 'num' },
      { type: 'num', from: null, to: null },
      { type: 'num', from: 1.5 },
      { type: 'num', to: 1e300 },
      { type: 'date', from: '01.10.2026' },
      { type: 'date', from: '0000-01-01' },
      { type: 'date' },
      { type: 'text', q: '   ' },
      { type: 'like', q: 'a' },
    ]) {
      expect(ListFilter.safeParse(f).success, JSON.stringify(f)).toBe(false);
    }
  });

  it('не больше 30 фильтров', () => {
    const many = Object.fromEntries(
      Array.from({ length: 31 }, (_, i) => [`c${i}`, { type: 'text', q: 'a' }]),
    );
    expect(ListFilters.safeParse(many).success).toBe(false);
  });
});

describe('ответ со страницей', () => {
  it('записи, всего, страница, размер и итоги', () => {
    const page = listPageSchema(z.object({ id: z.string() }));
    expect(
      page.safeParse({
        items: [{ id: 'a' }],
        total: 140,
        page: 2,
        size: 25,
        totals: { sum: 125050 },
      }).success,
    ).toBe(true);
    expect(page.safeParse({ items: [], total: 0, page: 0, size: 25, totals: {} }).success).toBe(
      false,
    );
  });
});

describe('настройки вида', () => {
  it('принимает сохранённый вид списка', () => {
    const settings = {
      view: 'cards',
      density: 'compact',
      width: 'center',
      shown: ['fullName', 'role'],
      hidden: ['phone'],
      order: ['role', 'fullName', 'phone'],
      widths: { fullName: 300 },
      sort: { key: 'fullName', dir: 'asc' },
      size: 100,
    };
    expect(ViewSettings.parse(settings)).toEqual(settings);
    expect(ViewSettings.parse({ sort: null })).toEqual({ sort: null });
  });

  it('ширина от 70 до 1200 px, ключи столбцов — только латиница', () => {
    expect(ViewSettings.safeParse({ widths: { fullName: 40 } }).success).toBe(false);
    expect(ViewSettings.safeParse({ widths: { fullName: 5000 } }).success).toBe(false);
    expect(ViewSettings.safeParse({ hidden: ['<script>'] }).success).toBe(false);
    expect(ViewSettings.safeParse({ size: 10 }).success).toBe(false);
  });

  it('ключ списка — «модуль.вкладка»', () => {
    expect(GridKeyParam.safeParse('staff.list').success).toBe(true);
    expect(GridKeyParam.safeParse('staff').success).toBe(false);
    expect(GridKeyParam.safeParse('Staff.List').success).toBe(false);
    expect(GridKeyParam.safeParse('staff.list/../x').success).toBe(false);
  });
});
