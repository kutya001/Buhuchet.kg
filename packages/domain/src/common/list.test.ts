import { describe, expect, it } from 'vitest';
import {
  addEnumStep,
  ALL_ROWS_LIMIT,
  clampPage,
  enumAll,
  enumChecked,
  enumMatchChecked,
  enumSelectionSize,
  filterTypeOf,
  groupAggOf,
  groupLevels,
  isGridKey,
  isEnumAll,
  isListPageSize,
  isViewKey,
  listPageSize,
  matchesSearch,
  matchesValue,
  nextSort,
  pageCount,
  pageLimit,
  pluralForm,
  shownRange,
  statsShown,
  statsViewKey,
  toggleGroupLevel,
  type EnumSelection,
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

describe('фильтр-галочки: «Найти значение» и «Выбрать все» по всем значениям (ТЗ «Поиск и фильтры»)', () => {
  const VALUES = [
    { value: 'r1', label: 'Бухгалтер' },
    { value: 'r2', label: 'Главный бухгалтер' },
    { value: 'r3', label: 'Стажёр' },
    { value: 'r4', label: 'Ёлкин Пётр' },
    { value: 'r5', label: 'Елкин Иван' },
    { value: '', label: null },
  ];
  const labelOf = (v: string) => VALUES.find((x) => x.value === v)?.label;
  const checked = (s: EnumSelection) =>
    VALUES.filter((x) => enumChecked(s, x.value, x.label)).map((x) => x.value);

  it('поиск значения — подстрока подписи без учёта регистра и «ё»; «(Пусто)» поиском не находится', () => {
    expect(matchesValue('Ёлкин Пётр', 'елкин')).toBe(true);
    expect(matchesValue('Главный бухгалтер', 'БУХ')).toBe(true);
    expect(matchesValue('Стажёр', 'бух')).toBe(false);
    expect(matchesValue(null, 'пусто')).toBe(false);
    expect(matchesValue(null, '  ')).toBe(true);
  });

  it('без шагов — отмеченные значения; решает последний шаг, который касается значения', () => {
    expect(checked({ vals: ['r1', ''] })).toEqual(['r1', '']);
    expect(checked(enumAll())).toEqual(VALUES.map((x) => x.value));
    const s: EnumSelection = {
      vals: ['r3'],
      steps: [
        { on: true, match: 'бух' },
        { on: false, vals: ['r2'] },
      ],
    };
    expect(checked(s)).toEqual(['r1', 'r3']);
    expect(isEnumAll(enumAll())).toBe(true);
    expect(isEnumAll(s)).toBe(false);
    expect(enumSelectionSize(s)).toBe(2);
  });

  it('«Выбрать все» по поиску отмечает и снимает все подходящие, в том числе не показанные', () => {
    let s = addEnumStep(enumAll(), { on: false, match: '' }, labelOf);
    expect(s).toEqual({ vals: [] });
    s = addEnumStep(s, { on: true, match: 'елкин' }, () => undefined);
    expect(s).toEqual({ vals: [], steps: [{ on: true, match: 'елкин' }] });
    expect(checked(s)).toEqual(['r4', 'r5']);
    s = addEnumStep(s, { on: false, vals: ['r5'] }, labelOf);
    expect(checked(s)).toEqual(['r4']);
    // Более широкий поиск перекрывает прежний, более узкий, и отметки внутри него.
    s = addEnumStep(s, { on: true, match: 'ёлки' }, labelOf);
    expect(s).toEqual({ vals: [], steps: [{ on: true, match: 'ёлки' }] });
    s = addEnumStep(s, { on: true, match: '' }, labelOf);
    expect(s).toEqual(enumAll());
  });

  it('без поиска выбор остаётся набором значений; снятие при пустом выборе ничего не меняет', () => {
    let s = addEnumStep({ vals: ['r1'] }, { on: true, vals: ['r2', 'r3'] }, labelOf);
    s = addEnumStep(s, { on: false, vals: ['r1'] }, labelOf);
    expect(s).toEqual({ vals: ['r2', 'r3'] });
    expect(addEnumStep(s, { on: true, vals: [] }, labelOf)).toBe(s);
    let t = addEnumStep({ vals: [] }, { on: false, match: 'бух' }, labelOf);
    expect(t).toEqual({ vals: [] });
    t = addEnumStep(enumAll(), { on: false, vals: ['r3'] }, labelOf);
    expect(t).toEqual({
      vals: [],
      steps: [
        { on: true, match: '' },
        { on: false, vals: ['r3'] },
      ],
    });
  });

  it('любая последовательность действий даёт тот же выбор, что прототип со всеми значениями', () => {
    // Прототип знает все значения: «Выбрать все» отмечает каждое подходящее (fmatch), галочка — одно.
    const NEEDLES = ['', 'бух', 'елкин', 'ёлкин п', 'стаж', 'главный', 'ер', 'ив'];
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % n;
    };
    for (let run = 0; run < 300; run++) {
      const proto = new Set(rnd(2) ? VALUES.map((x) => x.value) : []);
      let s: EnumSelection = proto.size ? enumAll() : { vals: [] };
      // Подписи приходят с сервера не все: часть значений ещё не показывалась.
      const seen = new Set(VALUES.filter(() => rnd(2)).map((x) => x.value));
      for (let step = 0; step < 8; step++) {
        const on = rnd(2) === 1;
        if (rnd(3)) {
          const x = VALUES[rnd(VALUES.length)]!;
          seen.add(x.value);
          if (on) proto.add(x.value);
          else proto.delete(x.value);
          s = addEnumStep(s, { on, vals: [x.value] }, (v) =>
            seen.has(v) ? labelOf(v) : undefined,
          );
        } else {
          const match = NEEDLES[rnd(NEEDLES.length)]!;
          for (const x of VALUES) {
            if (matchesValue(x.label, match)) {
              if (on) proto.add(x.value);
              else proto.delete(x.value);
            }
          }
          s = addEnumStep(s, { on, match }, (v) => (seen.has(v) ? labelOf(v) : undefined));
        }
        expect(checked(s)).toEqual(VALUES.map((x) => x.value).filter((v) => proto.has(v)));
        // Галочка «Выбрать все» не врёт: «все отмечены» — только если в прототипе так и есть.
        for (const match of NEEDLES) {
          if (enumMatchChecked(s, match, (v) => (seen.has(v) ? labelOf(v) : undefined))) {
            const matching = VALUES.filter((x) => matchesValue(x.label, match));
            expect(
              matching.every((x) => proto.has(x.value)),
              match,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('«Выбрать все» отмечена, только если отмечены все подходящие, в том числе не показанные', () => {
    expect(enumMatchChecked(enumAll(), 'бух', () => undefined)).toBe(true);
    expect(
      enumMatchChecked({ vals: [], steps: [{ on: true, match: 'бух' }] }, 'главный бух', labelOf),
    ).toBe(true);
    // Поиск шире отмеченного — среди подходящих могут быть не отмеченные.
    expect(
      enumMatchChecked({ vals: [], steps: [{ on: true, match: 'главный' }] }, 'бух', labelOf),
    ).toBe(false);
    // Снятое значение подходит под поиск или его подпись не известна — уже не все.
    const except = (v: string): EnumSelection => ({
      vals: [],
      steps: [
        { on: true, match: '' },
        { on: false, vals: [v] },
      ],
    });
    expect(enumMatchChecked(except('r3'), 'бух', labelOf)).toBe(true);
    expect(enumMatchChecked(except('r1'), 'бух', labelOf)).toBe(false);
    expect(enumMatchChecked(except('r3'), 'бух', () => undefined)).toBe(false);
    expect(enumMatchChecked(except('r3'), '', labelOf)).toBe(false);
    expect(enumMatchChecked({ vals: ['r1', 'r2'] }, 'бух', labelOf)).toBe(false);
  });

  it('снять и снова отметить — фильтра нет, как в прототипе; шаг, который ничего не меняет, не добавляется', () => {
    let s = addEnumStep(enumAll(), { on: false, vals: ['r3'] }, labelOf);
    s = addEnumStep(s, { on: true, vals: ['r3'] }, labelOf);
    expect(isEnumAll(s)).toBe(true);
    s = addEnumStep(enumAll(), { on: false, match: 'бух' }, () => undefined);
    s = addEnumStep(s, { on: true, match: 'бух' }, () => undefined);
    expect(isEnumAll(s)).toBe(true);
    // Отметить по поиску то, что уже отмечено, — ничего не меняет; подпись не известна — шаг остаётся.
    expect(addEnumStep(enumAll(), { on: true, match: 'ёлкин' }, labelOf)).toEqual(enumAll());
    expect(addEnumStep(enumAll(), { on: true, vals: ['r9'] }, () => undefined)).toEqual({
      vals: [],
      steps: [
        { on: true, match: '' },
        { on: true, vals: ['r9'] },
      ],
    });
  });
});
