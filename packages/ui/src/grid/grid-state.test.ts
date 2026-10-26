import { describe, expect, it } from 'vitest';
import {
  clampWidth,
  columnWidth,
  dropColumn,
  effectiveSort,
  effectiveView,
  setView,
  isHidden,
  moveColumn,
  orderedKeys,
  pageSizeOf,
  setColumnVisible,
  setColumnWidth,
  toggleSort,
  visibleKeys,
} from './grid-state';

const KEYS = ['fullName', 'login', 'phone', 'role', 'active', 'createdAt'];
const DEFAULT_VISIBLE = ['fullName', 'phone', 'role', 'active'];
const BY_CREATED = { key: 'createdAt', dir: 'desc' } as const;

describe('столбцы: видимость по умолчанию и выбор пользователя (прототип vis, defHidden)', () => {
  it('по умолчанию видны основные столбцы, остальные скрыты', () => {
    expect(visibleKeys(KEYS, {}, DEFAULT_VISIBLE)).toEqual(['fullName', 'phone', 'role', 'active']);
    expect(isHidden('login', {}, DEFAULT_VISIBLE)).toBe(true);
    expect(isHidden('createdAt', {}, DEFAULT_VISIBLE)).toBe(true);
  });

  it('скрыть и показать столбец — сохраняется выбор по всем столбцам', () => {
    const noPhone = setColumnVisible(KEYS, {}, DEFAULT_VISIBLE, 'phone', false);
    expect(noPhone.hidden).toEqual(['login', 'phone', 'createdAt']);
    expect(noPhone.shown).toEqual(['fullName', 'role', 'active']);
    const withLogin = setColumnVisible(KEYS, noPhone, DEFAULT_VISIBLE, 'login', true);
    expect(visibleKeys(KEYS, withLogin, DEFAULT_VISIBLE)).toEqual([
      'fullName',
      'login',
      'role',
      'active',
    ]);
  });

  it('столбец, появившийся позже, получает видимость по умолчанию', () => {
    const saved = setColumnVisible(KEYS, {}, DEFAULT_VISIBLE, 'phone', false);
    const later = [...KEYS, 'cps', 'kb'];
    expect(visibleKeys(later, saved, [...DEFAULT_VISIBLE, 'cps'])).toEqual([
      'fullName',
      'role',
      'active',
      'cps',
    ]);
  });

  it('последний видимый столбец скрыть нельзя', () => {
    let s = {};
    for (const k of ['phone', 'role', 'active'])
      s = setColumnVisible(KEYS, s, DEFAULT_VISIBLE, k, false);
    expect(visibleKeys(KEYS, s, DEFAULT_VISIBLE)).toEqual(['fullName']);
    expect(setColumnVisible(KEYS, s, DEFAULT_VISIBLE, 'fullName', false)).toBe(s);
    // Если скрыто всё (настройки из старой версии), виден первый столбец.
    expect(visibleKeys(KEYS, { hidden: KEYS }, DEFAULT_VISIBLE)).toEqual(['fullName']);
  });

  it('неизвестный столбец не меняет настройки', () => {
    const s = {};
    expect(setColumnVisible(KEYS, s, DEFAULT_VISIBLE, 'nope', true)).toBe(s);
  });
});

describe('порядок столбцов (прототип cols, colsPop, th.ondrop)', () => {
  it('сохранённый порядок; новые и пропавшие столбцы', () => {
    // Новый столбец встаёт на свой номер по умолчанию (прототип: `ord.splice(keys.indexOf(k), 0, k)`).
    expect(orderedKeys(KEYS, ['role', 'fullName', 'gone', 'role'])).toEqual([
      'role',
      'login',
      'phone',
      'fullName',
      'active',
      'createdAt',
    ]);
    expect(orderedKeys(['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'b', 'a']);
  });

  it('стрелки «Выше» и «Ниже» в меню «Столбцы»', () => {
    const up = moveColumn(KEYS, {}, 'role', 0);
    expect(up.order).toEqual(['role', 'fullName', 'login', 'phone', 'active', 'createdAt']);
    const down = moveColumn(KEYS, up, 'role', 1);
    expect(down.order).toEqual(['fullName', 'role', 'login', 'phone', 'active', 'createdAt']);
    expect(moveColumn(KEYS, down, 'role', 1)).toBe(down);
    expect(moveColumn(KEYS, {}, 'createdAt', 99).order).toBeUndefined();
  });

  it('перетащить заголовок на другой — встаёт перед ним', () => {
    expect(dropColumn(KEYS, {}, 'active', 'phone').order).toEqual([
      'fullName',
      'login',
      'active',
      'phone',
      'role',
      'createdAt',
    ]);
    expect(dropColumn(KEYS, {}, 'fullName', 'role').order).toEqual([
      'login',
      'phone',
      'fullName',
      'role',
      'active',
      'createdAt',
    ]);
    const s = {};
    expect(dropColumn(KEYS, s, 'role', 'role')).toBe(s);
  });

  it('порядок видимых столбцов следует общему порядку', () => {
    const s = moveColumn(KEYS, {}, 'active', 0);
    expect(visibleKeys(KEYS, s, DEFAULT_VISIBLE)).toEqual(['active', 'fullName', 'phone', 'role']);
  });
});

describe('ширина столбцов', () => {
  it('по умолчанию из описания столбца или 140 px; не уже 70 и не шире 1200', () => {
    expect(columnWidth({ key: 'fullName', width: 270 }, {})).toBe(270);
    expect(columnWidth({ key: 'login' }, {})).toBe(140);
    const s = setColumnWidth({}, 'fullName', 31.6);
    expect(columnWidth({ key: 'fullName', width: 270 }, s)).toBe(70);
    expect(clampWidth(5000)).toBe(1200);
    expect(clampWidth(300.4)).toBe(300);
  });
});

describe('сортировка (ТЗ «Сортировка»)', () => {
  it('по умолчанию — «Создано» от новых к старым; выбор пользователя запоминается', () => {
    expect(effectiveSort({}, BY_CREATED, KEYS)).toEqual(BY_CREATED);
    const s1 = toggleSort({}, BY_CREATED, KEYS, 'fullName');
    expect(s1.sort).toEqual({ key: 'fullName', dir: 'asc' });
    const s2 = toggleSort(s1, BY_CREATED, KEYS, 'fullName');
    expect(s2.sort).toEqual({ key: 'fullName', dir: 'desc' });
    const s3 = toggleSort(s2, BY_CREATED, KEYS, 'fullName');
    expect(s3.sort).toBeNull();
    expect(effectiveSort(s3, BY_CREATED, KEYS)).toBeNull();
  });

  it('клик по «Создано» при сортировке по умолчанию (по убыванию) выключает сортировку', () => {
    const off = toggleSort({}, BY_CREATED, KEYS, 'createdAt');
    expect(off.sort).toBeNull();
    expect(toggleSort(off, BY_CREATED, KEYS, 'createdAt').sort).toEqual({
      key: 'createdAt',
      dir: 'asc',
    });
  });

  it('столбца сортировки больше нет — по умолчанию', () => {
    expect(effectiveSort({ sort: { key: 'gone', dir: 'asc' } }, BY_CREATED, KEYS)).toEqual(
      BY_CREATED,
    );
  });
});

describe('вид и страница', () => {
  it('«Таблица» на ПК, «Карточки» на телефоне; выбор пользователя; закреплённый вид', () => {
    expect(effectiveView({}, false)).toBe('table');
    expect(effectiveView({}, true)).toBe('cards');
    // Выбор на ПК телефону не мешает, и наоборот.
    expect(effectiveView({ view: 'table' }, true)).toBe('cards');
    expect(effectiveView({ phoneView: 'table' }, true)).toBe('table');
    expect(effectiveView({ phoneView: 'table' }, false)).toBe('table');
    expect(effectiveView({ view: 'cards', phoneView: 'table' }, false)).toBe('cards');
    expect(setView({ density: 'compact' }, true, 'table')).toEqual({
      density: 'compact',
      phoneView: 'table',
    });
    expect(setView({}, false, 'cards')).toEqual({ view: 'cards' });
    expect(effectiveView({ view: 'cards' }, false, 'table')).toBe('table');
  });

  it('записей на странице — 25 по умолчанию', () => {
    expect(pageSizeOf({})).toBe(25);
    expect(pageSizeOf({ size: 'all' })).toBe('all');
  });
});
