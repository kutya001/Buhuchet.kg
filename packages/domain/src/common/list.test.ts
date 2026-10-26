import { describe, expect, it } from 'vitest';
import {
  ALL_ROWS_LIMIT,
  clampPage,
  filterTypeOf,
  isGridKey,
  isListPageSize,
  nextSort,
  pageCount,
  pageLimit,
  pluralForm,
  shownRange,
} from './list';

describe('страницы списка (ТЗ «Страницы»)', () => {
  it('по 25, 50, 100 или «Все записи»', () => {
    expect([25, 50, 100, 'all'].every(isListPageSize)).toBe(true);
    expect([10, 0, '25', null].some(isListPageSize)).toBe(false);
    expect(pageLimit(50)).toBe(50);
    expect(pageLimit('all')).toBe(ALL_ROWS_LIMIT);
  });

  it('250 записей по 25 — 10 страниц; пустой список — одна страница', () => {
    expect(pageCount(250, 25)).toBe(10);
    expect(pageCount(251, 25)).toBe(11);
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(250, 'all')).toBe(1);
    expect(pageCount(ALL_ROWS_LIMIT + 1, 'all')).toBe(2);
  });

  it('страница за концом списка становится последней (прототип refresh)', () => {
    expect(clampPage(12, 250, 25)).toBe(10);
    expect(clampPage(0, 250, 25)).toBe(1);
    expect(clampPage(-3, 250, 25)).toBe(1);
    expect(clampPage(2.7, 250, 25)).toBe(2);
    expect(clampPage(Number.NaN, 250, 25)).toBe(1);
    expect(clampPage(3, 0, 25)).toBe(1);
  });

  it('«Показано 1 – 25 из 140»', () => {
    expect(shownRange(1, 25, 140)).toEqual({ from: 1, to: 25 });
    expect(shownRange(6, 25, 140)).toEqual({ from: 126, to: 140 });
    expect(shownRange(9, 25, 140)).toEqual({ from: 126, to: 140 });
    expect(shownRange(1, 'all', 140)).toEqual({ from: 1, to: 140 });
    expect(shownRange(1, 25, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe('сортировка по клику на заголовок (ТЗ «Сортировка»)', () => {
  it('по возрастанию → по убыванию → без сортировки', () => {
    const asc = nextSort(null, 'fullName');
    expect(asc).toEqual({ key: 'fullName', dir: 'asc' });
    const desc = nextSort(asc, 'fullName');
    expect(desc).toEqual({ key: 'fullName', dir: 'desc' });
    expect(nextSort(desc, 'fullName')).toBeNull();
  });

  it('другой столбец начинает с возрастания', () => {
    expect(nextSort({ key: 'createdAt', dir: 'desc' }, 'role')).toEqual({
      key: 'role',
      dir: 'asc',
    });
  });
});

describe('ключи списков с настройками вида', () => {
  it('сервер принимает только известные списки', () => {
    expect(isGridKey('staff.list')).toBe(true);
    expect(isGridKey('staff')).toBe(false);
    expect(isGridKey('__proto__')).toBe(false);
  });
});

describe('pluralForm — как plural прототипа', () => {
  it.each([
    [1, 'one'],
    [21, 'one'],
    [101, 'one'],
    [2, 'few'],
    [4, 'few'],
    [22, 'few'],
    [0, 'many'],
    [5, 'many'],
    [11, 'many'],
    [12, 'many'],
    [14, 'many'],
    [111, 'many'],
    [250, 'many'],
  ] as const)('%i → %s', (n, form) => {
    expect(pluralForm(n)).toBe(form);
  });
});

describe('фильтр столбца по его типу (прототип ftype)', () => {
  it.each([
    ['text', 'text'],
    ['enum', 'enum'],
    ['int', 'num'],
    ['money', 'num'],
    ['date', 'date'],
    ['datetime', 'date'],
  ] as const)('%s → %s', (type, filter) => {
    expect(filterTypeOf(type)).toBe(filter);
  });
});
