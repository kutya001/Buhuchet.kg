import type { ListGroup } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import {
  activeBoardKey,
  BOARD_COLUMNS_MAX,
  BOARD_STEP,
  boardColumns,
  boardKey,
  boardKeys,
  boardLimit,
  boardMore,
  boardTargets,
} from './grid-board';

const KEYS = ['title', 'status', 'exec', 'cp'];
const KANBAN = { by: ['status', 'exec', 'gone', 'status'], def: 'status' };

const group = (key: string, label: string | null, count: number, sum?: number): ListGroup => ({
  key,
  label,
  count,
  aggs: sum === undefined ? {} : { fee: sum },
});

describe('доска', () => {
  it('столбцы списка для «Столбцы: …» — только существующие, без повторов, по порядку доски', () => {
    expect(boardKeys(KANBAN, KEYS)).toEqual(['status', 'exec']);
    expect(boardKeys({ by: ['gone'], def: 'gone' }, KEYS)).toEqual([]);
  });

  it('столбец доски: выбор пользователя, иначе по умолчанию, иначе первый возможный', () => {
    expect(boardKey(KANBAN, KEYS, {})).toBe('status');
    expect(boardKey(KANBAN, KEYS, { kb: 'exec' })).toBe('exec');
    // Выбранного столбца больше нет или по нему доску не раскладывают — по умолчанию.
    expect(boardKey(KANBAN, KEYS, { kb: 'cp' })).toBe('status');
    expect(boardKey({ by: ['exec', 'cp'], def: 'gone' }, KEYS, {})).toBe('exec');
    expect(boardKey({ by: ['gone'], def: 'gone' }, KEYS, {})).toBeNull();
  });

  it('доска включена, когда вид на этом устройстве — «Доска» и есть по чему раскладывать', () => {
    expect(activeBoardKey(KANBAN, KEYS, { view: 'kanban' }, false)).toBe('status');
    expect(activeBoardKey(KANBAN, KEYS, { view: 'kanban', kb: 'exec' }, false)).toBe('exec');
    // Вид помнится отдельно для ПК и телефона.
    expect(activeBoardKey(KANBAN, KEYS, { view: 'kanban' }, true)).toBeNull();
    expect(activeBoardKey(KANBAN, KEYS, { phoneView: 'kanban' }, true)).toBe('status');
    expect(activeBoardKey(KANBAN, KEYS, {}, false)).toBeNull();
    expect(activeBoardKey(KANBAN, KEYS, { view: 'kanban' }, false, 'table')).toBeNull();
    // У списка нет доски или раскладывать не по чему — сохранённая «Доска» не действует.
    expect(activeBoardKey(undefined, KEYS, { view: 'kanban' }, false)).toBeNull();
    expect(
      activeBoardKey({ by: ['gone'], def: 'gone' }, KEYS, { view: 'kanban' }, false),
    ).toBeNull();
  });

  it('столбцы доски — группы сервера с их записями, числом и суммой', () => {
    const { columns, cut } = boardColumns({
      groups: [group('В работе', 'В работе', 12, 5000), group('Выполнена', 'Выполнена', 1, 100)],
      rows: ['a', 'b', 'c'],
      rowGroups: [['В работе'], ['Выполнена'], ['В работе']],
    });
    expect(cut).toBe(0);
    expect(columns).toEqual([
      { key: 'В работе', label: 'В работе', count: 12, aggs: { fee: 5000 }, rows: ['a', 'c'] },
      { key: 'Выполнена', label: 'Выполнена', count: 1, aggs: { fee: 100 }, rows: ['b'] },
    ]);
  });

  it('порядок — как задан доской, остальные — по подписи (и пустые добавленные), «(Пусто)» — последним', () => {
    const { columns } = boardColumns({
      groups: [
        group('', null, 2),
        group('Отменена', 'Отменена', 1),
        group('Выполнена', 'Выполнена', 3),
        group('В работе', 'В работе', 4),
      ],
      rows: [],
      rowGroups: [],
      order: ['К выполнению', 'В работе', 'На подтверждении', 'Выполнена'],
      show: [
        { key: 'К выполнению', label: 'К выполнению' },
        { key: 'В работе', label: 'В работе' },
        { key: 'Яя', label: 'Яя' },
        { key: 'Аа', label: 'Аа' },
      ],
    });
    expect(columns.map((c) => c.key)).toEqual([
      'К выполнению',
      'В работе',
      'Выполнена',
      'Аа',
      'Отменена',
      'Яя',
      '',
    ]);
    expect(columns[0]).toEqual({
      key: 'К выполнению',
      label: 'К выполнению',
      count: 0,
      aggs: {},
      rows: [],
    });
    expect(columns.at(-1)?.label).toBeNull();
  });

  it('ключ группы с сервера вида «constructor» — обычный столбец, а не свойство объекта', () => {
    const { columns } = boardColumns({
      groups: [group('constructor', 'constructor', 1), group('toString', 'toString', 2)],
      rows: ['a'],
      rowGroups: [['constructor']],
      merge: { x: 'y' },
    });
    expect(columns.map((c) => [c.key, c.count, c.rows])).toEqual([
      ['constructor', 1, ['a']],
      ['toString', 2, []],
    ]);
    expect(boardLimit({}, 'constructor')).toBe(30);
    expect(boardLimit({ constructor: 60 } as Record<string, number>, 'constructor')).toBe(60);
  });

  it('пустые столбцы не добавляются при поиске и для значений, снятых фильтром столбца доски', () => {
    const base = {
      groups: [group('В работе', 'В работе', 1)],
      rows: [],
      rowGroups: [],
      show: [
        { key: 'К выполнению', label: 'К выполнению' },
        { key: 'Выполнена', label: 'Выполнена' },
      ],
    };
    expect(boardColumns({ ...base, searching: true }).columns.map((c) => c.key)).toEqual([
      'В работе',
    ]);
    expect(
      boardColumns({ ...base, allowed: (v) => v.key !== 'Выполнена' }).columns.map((c) => c.key),
    ).toEqual(['В работе', 'К выполнению']);
  });

  it('столбцов больше 60 — показаны первые 60 и сколько всего', () => {
    const groups = Array.from({ length: BOARD_COLUMNS_MAX + 5 }, (_, i) =>
      group(`g${i}`, `g${i}`, 1),
    );
    const { columns, cut } = boardColumns({ groups, rows: [], rowGroups: [] });
    expect(columns).toHaveLength(BOARD_COLUMNS_MAX);
    expect(cut).toBe(BOARD_COLUMNS_MAX + 5);
    expect(
      boardColumns({ groups: groups.slice(0, BOARD_COLUMNS_MAX), rows: [], rowGroups: [] }).cut,
    ).toBe(0);
  });

  it('слитые значения — один столбец: записи вместе, число и суммы складываются', () => {
    const { columns } = boardColumns({
      groups: [
        group('in_progress', 'В работе', 2, 300),
        group('done', 'Выполнена', 1, 50),
        group('rep:in_progress', 'В работе', 3, 700),
      ],
      rows: ['a', 'b', 'c'],
      rowGroups: [['in_progress'], ['done'], ['rep:in_progress']],
      merge: { 'rep:in_progress': 'in_progress' },
    });
    expect(columns).toEqual([
      { key: 'in_progress', label: 'В работе', count: 5, aggs: { fee: 1000 }, rows: ['a', 'c'] },
      { key: 'done', label: 'Выполнена', count: 1, aggs: { fee: 50 }, rows: ['b'] },
    ]);
    // Столбца, в который сливают, в ответе нет — он появляется со слитым значением.
    const only = boardColumns({
      groups: [group('rep:in_progress', 'В работе', 3)],
      rows: ['x'],
      rowGroups: [['rep:in_progress']],
      merge: { 'rep:in_progress': 'in_progress' },
    });
    expect(only.columns).toEqual([
      { key: 'in_progress', label: 'В работе', count: 3, aggs: {}, rows: ['x'] },
    ]);
  });

  it('запись без группы в ответе в столбцы не попадает', () => {
    const { columns } = boardColumns({
      groups: [group('a', 'a', 1)],
      rows: ['x', 'y'],
      rowGroups: [['zzz']],
    });
    expect(columns[0]?.rows).toEqual([]);
  });

  it('в столбце — первые 30 карточек и «Показать ещё» по 30', () => {
    expect(boardLimit({}, 'a')).toBe(BOARD_STEP);
    expect(boardLimit({ a: 60 }, 'a')).toBe(60);
    expect(boardMore(30, 30)).toBeNull();
    expect(boardMore(45, 30)).toEqual({ next: 15, left: 15 });
    expect(boardMore(100, 30)).toEqual({ next: 30, left: 70 });
  });

  it('перенести карточку можно в любой столбец, кроме её собственного', () => {
    const { columns } = boardColumns({
      groups: [group('a', 'a', 1), group('b', 'b', 1), group('', null, 1)],
      rows: [],
      rowGroups: [],
    });
    expect(boardTargets(columns, 'a').map((c) => c.key)).toEqual(['b', '']);
  });
});
