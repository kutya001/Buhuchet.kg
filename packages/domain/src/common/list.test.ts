import { describe, expect, it } from 'vitest';
import {
  ALL_ROWS_LIMIT,
  clampPage,
  filterTypeOf,
  groupAggOf,
  groupLevels,
  isGridKey,
  isListPageSize,
  isViewKey,
  listPageSize,
  matchesSearch,
  nextSort,
  pageCount,
  pageLimit,
  pluralForm,
  shownRange,
  statsShown,
  statsViewKey,
  toggleGroupLevel,
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

  it('«Статистика» — своя для каждого модуля меню; чужих ключей нет', () => {
    expect(statsViewKey('reports')).toBe('stats.reports');
    expect(isViewKey('stats.reports')).toBe(true);
    expect(isViewKey('stats.accounts')).toBe(true);
    expect(isViewKey('staff.list')).toBe(true);
    expect(isViewKey('stats.nope')).toBe(false);
    expect(isViewKey('stats.reports.x')).toBe(false);
    expect(isViewKey('stats')).toBe(false);
  });
});

describe('«Статистика» модуля (ТЗ «Статистика модуля»)', () => {
  it('по умолчанию показана на ПК и скрыта на телефоне', () => {
    expect(statsShown({}, false)).toBe(true);
    expect(statsShown({}, true)).toBe(false);
  });

  it('выбор на ПК и на телефоне — свой', () => {
    expect(statsShown({ stats: false }, false)).toBe(false);
    expect(statsShown({ stats: false }, true)).toBe(false);
    expect(statsShown({ phoneStats: true }, true)).toBe(true);
    expect(statsShown({ phoneStats: true }, false)).toBe(true);
    expect(statsShown({ stats: false, phoneStats: true }, false)).toBe(false);
  });
});

describe('поиск по тому, что видно (ТЗ «Поиск и фильтры», прототип compute)', () => {
  it('без учёта регистра, «ё» = «е», неразрывный пробел — обычный', () => {
    expect(matchesSearch('Алишер Тёмиров', 'темир')).toBe(true);
    expect(matchesSearch('Алишер Темиров', 'ТЁМ')).toBe(true);
    expect(matchesSearch('1\u00a0250,50', '1 250,50')).toBe(true);
    expect(matchesSearch('Алишер', 'Бакыт')).toBe(false);
  });

  it('в телефонах, ИНН и суммах пробелы, дефисы и скобки не мешают — с трёх символов', () => {
    expect(matchesSearch('+996 555 123 456', '555123')).toBe(true);
    expect(matchesSearch('+996 (555) 12-34-56', '555 1234')).toBe(true);
    expect(matchesSearch('1 250,50', '125050')).toBe(true);
    expect(matchesSearch('01234567891234', '0123 4567')).toBe(true);
    // Два значащих символа — только обычная подстрока: «5-5» не находит «555».
    expect(matchesSearch('555', '5-5')).toBe(false);
  });

  it('дата и статус — как на экране', () => {
    expect(matchesSearch('15.03.2026 10:05', '15.03.2026')).toBe(true);
    expect(matchesSearch('Заблокирован', 'заблок')).toBe(true);
  });

  it('пустой поиск подходит всем', () => {
    expect(matchesSearch('что угодно', '  ')).toBe(true);
  });
});

describe('группировка (ТЗ «Группировка», прототип groupPop и filterPop)', () => {
  it('из меню столбца: добавить, убрать, третий уровень заменяет второй', () => {
    expect(toggleGroupLevel([], 'role')).toEqual({ group: ['role'], replaced: false });
    expect(toggleGroupLevel(['role'], 'active')).toEqual({
      group: ['role', 'active'],
      replaced: false,
    });
    expect(toggleGroupLevel(['role', 'active'], 'role')).toEqual({
      group: ['active'],
      replaced: false,
    });
    expect(toggleGroupLevel(['role', 'active'], 'telegram')).toEqual({
      group: ['role', 'telegram'],
      replaced: true,
    });
  });

  it('из окна «Группировка»: второй уровень — только внутри первого и не тот же столбец', () => {
    expect(groupLevels('', 'role')).toEqual([]);
    expect(groupLevels('role', '')).toEqual(['role']);
    expect(groupLevels('role', 'role')).toEqual(['role']);
    expect(groupLevels('role', 'active')).toEqual(['role', 'active']);
  });

  it('итог в строке группы: у числовых по умолчанию сумма, «Не считать» — без итога', () => {
    expect(groupAggOf('money')).toBe('sum');
    expect(groupAggOf('int')).toBe('sum');
    expect(groupAggOf('money', 'avg')).toBe('avg');
    expect(groupAggOf('int', 'none')).toBeNull();
    expect(groupAggOf('text', 'sum')).toBeNull();
    expect(groupAggOf('date')).toBeNull();
  });

  it('сгруппированный список — без страниц по 25: все записи по 5 000 за раз', () => {
    expect(listPageSize({ size: 25 })).toBe(25);
    expect(listPageSize({ size: 25, group: [] })).toBe(25);
    expect(listPageSize({ size: 25, group: ['role'] })).toBe('all');
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
