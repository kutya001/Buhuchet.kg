import type { ListGroup } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import {
  aggText,
  effectiveGroup,
  groupAggs,
  groupLabelSpan,
  groupPaths,
  groupTree,
  withGroup,
} from './grid-groups';

describe('группировка', () => {
  it('столбцы группировки: только существующие, без повторов, не больше двух', () => {
    const keys = ['name', 'role', 'active'];
    expect(effectiveGroup(keys, {})).toEqual([]);
    expect(effectiveGroup(keys, { group: ['role', 'gone', 'role', 'active'] })).toEqual([
      'role',
      'active',
    ]);
    expect(effectiveGroup(keys, { group: ['name', 'role', 'active'] })).toEqual(['name', 'role']);
  });

  it('пустая группировка убирается из настроек вида, остальное не трогается', () => {
    expect(withGroup({ group: ['role'], density: 'compact' }, [])).toEqual({ density: 'compact' });
    expect(withGroup({}, ['role', 'active'])).toEqual({ group: ['role', 'active'] });
  });

  it('итоги групп: у видимых числовых — выбор или сумма по умолчанию; «Не считать» — без итога', () => {
    const columns = [
      { key: 'name', type: 'text' as const },
      { key: 'clients', type: 'int' as const },
      { key: 'overdue', type: 'int' as const },
      { key: 'balance', type: 'money' as const },
      { key: 'debt', type: 'money' as const },
    ];
    const visible = ['name', 'clients', 'overdue', 'balance'];
    expect(groupAggs(columns, visible, {})).toEqual({
      clients: 'sum',
      overdue: 'sum',
      balance: 'sum',
    });
    expect(
      groupAggs(columns, visible, { agg: { clients: 'avg', overdue: 'none', debt: 'max' } }),
    ).toEqual({ clients: 'avg', balance: 'sum' });
  });

  it('дерево групп: строки страницы раскладываются по своим группам двух уровней', () => {
    const groups: ListGroup[] = [
      {
        key: 'r1',
        label: 'Бухгалтер',
        count: 3,
        aggs: {},
        sub: [
          { key: 'true', label: 'Активен', count: 2, aggs: {} },
          { key: 'false', label: 'Заблокирован', count: 1, aggs: {} },
        ],
      },
      {
        key: '',
        label: null,
        count: 1,
        aggs: {},
        sub: [{ key: 'true', label: 'Активен', count: 1, aggs: {} }],
      },
    ];
    const rows = ['a', 'b', 'c', 'd'];
    const tree = groupTree(groups, rows, [
      ['r1', 'true'],
      ['r1', 'true'],
      ['r1', 'false'],
      ['', 'true'],
    ]);
    expect(tree.map((n) => [n.path, n.level, n.rows])).toEqual([
      ['›r1', 0, []],
      ['›', 0, []],
    ]);
    expect(tree[0]!.sub!.map((n) => [n.path, n.level, n.rows])).toEqual([
      ['›r1›true', 1, ['a', 'b']],
      ['›r1›false', 1, ['c']],
    ]);
    expect(tree[1]!.sub![0]!.rows).toEqual(['d']);
    expect(groupPaths(tree)).toEqual(['›r1', '›r1›true', '›r1›false', '›', '››true']);
  });

  it('один уровень: строки — прямо в группах', () => {
    const tree = groupTree(
      [
        { key: 'x', label: 'X', count: 1, aggs: {} },
        { key: 'y', label: 'Y', count: 1, aggs: {} },
      ],
      [1, 2],
      [['y'], ['x']],
    );
    expect(tree.map((n) => n.rows)).toEqual([[2], [1]]);
    expect(tree[0]!.sub).toBeUndefined();
  });

  it('итог строкой: «—» без значения, количество и счётчик — целым, деньги и среднее — с копейками', () => {
    expect(aggText('money', 'sum', null)).toBe('—');
    expect(aggText('money', 'count', 4)).toBe('4');
    expect(aggText('int', 'sum', 42)).toBe('42');
    expect(aggText('int', 'avg', 2.5)).toBe('2,50');
    expect(aggText('money', 'sum', 125050)).toBe('1 250,50');
    expect(aggText('money', 'avg', 33333.4)).toBe('333,33');
  });

  it('название группы занимает столбцы до первого числового (хотя бы один)', () => {
    expect(groupLabelSpan([{ type: 'text' }, { type: 'enum' }, { type: 'money' }])).toBe(2);
    expect(groupLabelSpan([{ type: 'int' }, { type: 'text' }])).toBe(1);
    expect(groupLabelSpan([{ type: 'text' }, { type: 'date' }])).toBe(2);
  });
});
