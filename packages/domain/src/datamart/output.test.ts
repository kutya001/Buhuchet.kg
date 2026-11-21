import { describe, expect, it } from 'vitest';
import type { ListQuery } from '../common/list';
import { DM_COLUMN_TYPES } from './datamart';
import {
  dmCopyText,
  dmListType,
  dmNumText,
  dmOutList,
  dmOutPage,
  dmOutRows,
  dmOutValues,
  dmShownColumns,
  dmStatNumber,
  dmText,
  dmValue,
  DM_VALUES_LIMIT,
  type DmOutColumn,
} from './output';

const T = { yes: 'Да', no: 'Нет' };
/** Разряды у сумм — неразрывным пробелом. */
const sp = (s: string) => s.replace(/\u00a0/g, ' ');

const COLS: DmOutColumn[] = [
  { code: 'contractor_id', name: 'Номер', type: 'cp', total: false },
  { code: 'name', name: 'Контрагент', type: 'text', total: false },
  { code: 'debt', name: 'Долг', type: 'money', total: true },
  { code: 'n', name: 'Отчётов', type: 'num', total: true },
  { code: 'due', name: 'Срок', type: 'date', total: false },
  { code: 'month', name: 'Месяц', type: 'month', total: false },
  { code: 'ok', name: 'Сдан', type: 'bool', total: false },
  { code: 'at', name: 'Изменено', type: 'datetime', total: false },
];

/** Строки «как из базы»: деньги и числа — строками, дата — моментом. */
const RAW: unknown[][] = [
  ['c1', 'Номер 10', '125050', '3', '2026-11-25', '2026-11-01', true, '2026-11-20T19:30:00Z'],
  ['c2', 'Номер 2', 50000, 1.5, '2026-11-20T00:00:00.000Z', '2026-10', 'f', '2026-11-20T10:00:00Z'],
  ['c3', 'Ёлка', null, null, null, null, null, null],
  ['c4', 'алма', '0', '7', '2026-12-01', '2026-11', 't', '2026-11-21T01:00:00+06:00'],
];
const ROWS = dmOutRows(COLS, RAW);

const query = (q: Partial<ListQuery> = {}): ListQuery => ({
  sort: null,
  page: 1,
  size: 25,
  filters: {},
  ...q,
});
const names = (q: Partial<ListQuery>) =>
  dmOutPage(ROWS, COLS, query(q), T).items.map((r) => r.v[1]);

describe('столбцы и значения «Вывода»', () => {
  it('служебный столбец «cp» не показывается, место в строке сохраняется', () => {
    const shown = dmShownColumns(COLS);
    expect(shown.map((s) => s.col.code)).toEqual(['name', 'debt', 'n', 'due', 'month', 'ok', 'at']);
    expect(shown[0]!.index).toBe(1);
  });

  it('тип столбца списка — как DM_GT прототипа', () => {
    expect(DM_COLUMN_TYPES.map(dmListType)).toEqual([
      'text',
      'int',
      'money',
      'date',
      'datetime',
      'enum',
      'enum',
      'text',
    ]);
  });

  it('значения из ответа базы приводятся к типу столбца', () => {
    expect(dmValue('money', '125050')).toBe(125050);
    expect(dmValue('money', 10.6)).toBe(11);
    expect(dmValue('money', 'много')).toBeNull();
    expect(dmValue('num', ' 1.25 ')).toBe(1.25);
    expect(dmValue('num', 12n)).toBe(12);
    expect(dmValue('num', Infinity)).toBeNull();
    expect(dmValue('bool', 't')).toBe(true);
    expect(dmValue('bool', 0)).toBe(false);
    expect(dmValue('bool', 'может быть')).toBeNull();
    expect(dmValue('date', '2026-11-20T00:00:00.000Z')).toBe('2026-11-20');
    expect(dmValue('date', '2026-02-30')).toBeNull();
    expect(dmValue('month', '2026-11-01')).toBe('2026-11');
    expect(dmValue('month', '2026-13')).toBeNull();
    expect(dmValue('datetime', '2026-11-21T01:00:00+06:00')).toBe('2026-11-20T19:00:00.000Z');
    expect(dmValue('datetime', 'вчера')).toBeNull();
    expect(dmValue('text', 5)).toBe('5');
    expect(dmValue('text', { a: 1 })).toBe('{"a":1}');
    expect(dmValue('text', '')).toBeNull();
    expect(dmValue('cp', undefined)).toBeNull();
  });

  it('текст ячейки — как на экране, для Excel — без разрядов', () => {
    const r = ROWS[0]!.v;
    expect(sp(dmText('money', r[2]!, T))).toBe('1 250,50');
    expect(dmText('num', 1.5, T)).toBe('1,50');
    expect(dmNumText(3)).toBe('3');
    expect(sp(dmNumText(1250))).toBe('1 250');
    expect(dmText('date', r[4]!, T)).toBe('25.11.2026');
    expect(dmText('month', r[5]!, T)).toBe('ноябрь 2026');
    expect(dmText('bool', true, T)).toBe('Да');
    expect(dmText('bool', false, T)).toBe('Нет');
    expect(dmText('datetime', r[7]!, T)).toBe('21.11.2026 01:30');
    expect(dmText('text', null, T)).toBe('');
    expect(dmCopyText('money', 125050, T)).toBe('1250,50');
    expect(dmCopyText('num', 1.5, T)).toBe('1,5');
    expect(dmCopyText('num', 1234567, T)).toBe('1234567');
    expect(dmCopyText('date', '2026-11-25', T)).toBe('25.11.2026');
    expect(dmCopyText('text', null, T)).toBe('');
    expect(dmStatNumber('money', 125050)).toBe(125050);
    expect(dmStatNumber('num', 1.5)).toBe(150);
    expect(dmStatNumber('text', 'x')).toBeNull();
    expect(dmStatNumber('num', null)).toBeNull();
  });
});

describe('страница «Вывода»: сортировка, фильтры, поиск по всему результату', () => {
  it('без сортировки — порядок ответа', () => {
    expect(names({})).toEqual(['Номер 10', 'Номер 2', 'Ёлка', 'алма']);
  });

  it('текст — по-русски, числа внутри по значению, без регистра', () => {
    expect(names({ sort: { key: 'name', dir: 'asc' } })).toEqual([
      'алма',
      'Ёлка',
      'Номер 2',
      'Номер 10',
    ]);
  });

  it('пустые — в конце при любом направлении', () => {
    expect(names({ sort: { key: 'debt', dir: 'asc' } })).toEqual([
      'алма',
      'Номер 2',
      'Номер 10',
      'Ёлка',
    ]);
    expect(names({ sort: { key: 'debt', dir: 'desc' } })).toEqual([
      'Номер 10',
      'Номер 2',
      'алма',
      'Ёлка',
    ]);
    expect(names({ sort: { key: 'due', dir: 'desc' } })).toEqual([
      'алма',
      'Номер 10',
      'Номер 2',
      'Ёлка',
    ]);
    expect(names({ sort: { key: 'ok', dir: 'asc' } })).toEqual(['Номер 10', 'алма', 'Номер 2', 'Ёлка']);
    expect(names({ sort: { key: 'at', dir: 'asc' } })).toEqual(['Номер 2', 'алма', 'Номер 10', 'Ёлка']);
  });

  it('сортировка по неизвестному и служебному столбцу не меняет порядок', () => {
    expect(names({ sort: { key: 'contractor_id', dir: 'desc' } })).toEqual(names({}));
    expect(names({ sort: { key: 'nope', dir: 'asc' } })).toEqual(names({}));
  });

  it('фильтры: текст, число, дата (момент — по дню Бишкека), галочки', () => {
    expect(names({ filters: { name: { type: 'text', q: 'елк' } } })).toEqual(['Ёлка']);
    expect(names({ filters: { name: { type: 'text', q: ' ' } } })).toHaveLength(4);
    expect(names({ filters: { debt: { type: 'num', from: 1, to: 60000 } } })).toEqual(['Номер 2']);
    expect(names({ filters: { n: { type: 'num', to: 3 } } })).toEqual(['Номер 10', 'Номер 2']);
    expect(names({ filters: { due: { type: 'date', from: '2026-11-21' } } })).toEqual([
      'Номер 10',
      'алма',
    ]);
    expect(names({ filters: { due: { type: 'date', to: '2026-11-20' } } })).toEqual(['Номер 2']);
    expect(names({ filters: { at: { type: 'date', from: '2026-11-21', to: '2026-11-21' } } })).toEqual(
      ['Номер 10', 'алма'],
    );
    expect(names({ filters: { month: { type: 'enum', vals: ['2026-10'] } } })).toEqual(['Номер 2']);
    expect(names({ filters: { ok: { type: 'enum', vals: [''] } } })).toEqual(['Ёлка']);
    expect(
      names({ filters: { ok: { type: 'enum', vals: [], steps: [{ on: true, match: 'да' }] } } }),
    ).toEqual(['Номер 10', 'алма']);
    expect(names({ filters: { nope: { type: 'text', q: 'x' } } })).toHaveLength(4);
  });

  it('поиск — по указанным столбцам, текстом как на экране', () => {
    expect(names({ search: { q: '1 250,50', keys: ['debt'] } })).toEqual(['Номер 10']);
    expect(names({ search: { q: 'ноябрь', keys: ['name', 'month'] } })).toEqual([
      'Номер 10',
      'алма',
    ]);
    expect(names({ search: { q: 'ноябрь', keys: ['name'] } })).toEqual([]);
    expect(names({ search: { q: '  ', keys: ['name'] } })).toHaveLength(4);
  });

  it('страницы: за концом — последняя, итоги — по всем строкам под фильтром', () => {
    const many = dmOutRows(
      COLS,
      Array.from({ length: 60 }, (_, i) => [null, `Р${i}`, 100, 0.5, null, null, null, null]),
    );
    const second = dmOutPage(many, COLS, query({ page: 2 }), T);
    expect(second.items.map((r) => r.i)).toEqual(Array.from({ length: 25 }, (_, i) => 25 + i));
    expect(second.total).toBe(60);
    expect(second.totals).toEqual({ debt: 6000, n: 30 });
    expect(dmOutPage(many, COLS, query({ page: 9 }), T).page).toBe(3);
    expect(dmOutPage(many, COLS, query({ size: 'all' }), T).items).toHaveLength(60);
    expect(dmOutPage([], COLS, query(), T)).toEqual({
      items: [],
      total: 0,
      page: 1,
      totals: { debt: 0, n: 0 },
    });
  });

  it('группы до двух уровней: порядок, число строк, итоги и ключи строк', () => {
    const page = dmOutPage(
      ROWS,
      COLS,
      query({ group: ['month', 'ok'], agg: { debt: 'sum', n: 'avg', name: 'sum' } }),
      T,
    );
    expect(page.groups!.map((g) => [g.key, g.label, g.count])).toEqual([
      ['2026-10', 'октябрь 2026', 1],
      ['2026-11', 'ноябрь 2026', 2],
      ['', null, 1],
    ]);
    expect(page.groups![1]!.aggs).toEqual({ debt: 125050, n: 5 });
    expect(page.groups![1]!.sub!.map((g) => [g.key, g.label, g.count])).toEqual([['true', 'Да', 2]]);
    expect(page.groups![2]!.aggs).toEqual({ debt: null, n: null });
    expect(page.rowGroups).toEqual([
      ['2026-10', 'false'],
      ['2026-11', 'true'],
      ['2026-11', 'true'],
      ['', ''],
    ]);
    expect(page.items.map((r) => r.v[1])).toEqual(['Номер 2', 'Номер 10', 'алма', 'Ёлка']);
  });

  it('группа по моменту — день; порядок групп — по направлению сортировки их столбца', () => {
    const page = dmOutPage(
      ROWS,
      COLS,
      query({ group: ['at'], sort: { key: 'at', dir: 'desc' }, agg: { n: 'count' } }),
      T,
    );
    expect(page.groups!.map((g) => [g.key, g.label, g.count, g.aggs.n])).toEqual([
      ['2026-11-21', '21.11.2026', 2, 2],
      ['2026-11-20', '20.11.2026', 1, 1],
      ['', null, 1, 0],
    ]);
  });

  it('min и max итогов группы; неизвестный столбец группировки пропускается', () => {
    const page = dmOutPage(
      ROWS,
      COLS,
      query({ group: ['nope', 'ok'], agg: { n: 'max', debt: 'min' } }),
      T,
    );
    expect(page.groups!.map((g) => [g.key, g.aggs])).toEqual([
      ['true', { n: 7, debt: 0 }],
      ['false', { n: 1.5, debt: 50000 }],
      ['', { n: null, debt: null }],
    ]);
  });

  it('весь список для «В Excel» — тот же порядок, что на экране', () => {
    const list = dmOutList(
      ROWS,
      COLS,
      { filters: { n: { type: 'num', from: 1 } }, sort: { key: 'n', dir: 'desc' } },
      T,
    );
    expect(list.map((r) => r.v[1])).toEqual(['алма', 'Номер 10', 'Номер 2']);
  });
});

describe('значения столбца для фильтра-галочек', () => {
  it('по порядку значения, «(Пусто)» внизу, со числом строк', () => {
    expect(dmOutValues(ROWS, COLS, 'month', T)).toEqual({
      items: [
        { value: '2026-10', label: 'октябрь 2026', count: 1 },
        { value: '2026-11', label: 'ноябрь 2026', count: 2 },
        { value: '', label: null, count: 1 },
      ],
      total: 3,
      more: false,
    });
  });

  it('«Найти значение» — по подписи; у момента — день', () => {
    expect(dmOutValues(ROWS, COLS, 'ok', T, 'не').items).toEqual([
      { value: 'false', label: 'Нет', count: 1 },
    ]);
    expect(dmOutValues(ROWS, COLS, 'at', T).items.map((x) => x.value)).toEqual([
      '2026-11-20',
      '2026-11-21',
      '',
    ]);
    expect(dmOutValues(ROWS, COLS, 'nope', T)).toEqual({ items: [], total: 0, more: false });
  });

  it('не больше DM_VALUES_LIMIT значений, `more` — пришли не все', () => {
    const many = dmOutRows(
      COLS,
      Array.from({ length: DM_VALUES_LIMIT + 3 }, (_, i) => [null, `Р${i}`]),
    );
    const values = dmOutValues(many, COLS, 'name', T);
    expect(values.items).toHaveLength(DM_VALUES_LIMIT);
    expect(values.total).toBe(DM_VALUES_LIMIT + 3);
    expect(values.more).toBe(true);
    expect(values.items[0]!.value).toBe('Р0');
    expect(values.items[2]!.value).toBe('Р2');
  });
});
