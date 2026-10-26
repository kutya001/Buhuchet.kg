import { describe, expect, it } from 'vitest';
import {
  activeFilterKeys,
  chipText,
  enumFilter,
  formatFilterNumber,
  parseFilterNumber,
} from './grid-filters';
import type { GridLabels } from './types';

const LABELS = {
  empty: '(Пусто)',
  chipFrom: (v: string) => `от ${v}`,
  chipTo: (v: string) => `до ${v}`,
  chipSince: (v: string) => `с ${v}`,
  chipUntil: (v: string) => `по ${v}`,
  chipMore: (n: number) => `+${n}`,
} as GridLabels;

describe('фильтры у столбцов', () => {
  it('чипы — только у фильтров существующих столбцов', () => {
    const filters = { name: { type: 'text', q: 'ив' }, gone: { type: 'text', q: 'x' } } as const;
    expect(activeFilterKeys(filters, ['name', 'role'])).toEqual(['name']);
  });

  it('«От» и «До»: деньги — сомы в тыйынах, счётчик — целое; пусто — null, мусор — bad', () => {
    expect(parseFilterNumber('money', '1 250,50')).toBe(125050);
    expect(parseFilterNumber('money', '1250.5')).toBe(125050);
    expect(parseFilterNumber('money', '  ')).toBeNull();
    expect(parseFilterNumber('money', '12,345')).toBe('bad');
    expect(parseFilterNumber('int', '1 000')).toBe(1000);
    expect(parseFilterNumber('int', '−5')).toBe(-5);
    expect(parseFilterNumber('int', '2,5')).toBe('bad');
    expect(parseFilterNumber('int', 'много')).toBe('bad');
  });

  it('граница в поле и в чипе: деньги — «1 250,50», целые сомы без «,00»; счётчик — как есть', () => {
    expect(formatFilterNumber('money', 125050)).toBe('1 250,50');
    expect(formatFilterNumber('money', 10000)).toBe('100');
    expect(formatFilterNumber('int', 1000)).toBe('1000');
  });

  it('галочки: отмечены все — фильтра нет; иначе отмеченные в порядке значений', () => {
    expect(enumFilter(['a', 'b', ''], new Set(['', 'a', 'b']))).toBeNull();
    expect(enumFilter(['a', 'b', ''], new Set(['', 'a']))).toEqual({
      type: 'enum',
      vals: ['a', ''],
    });
    expect(enumFilter(['a', 'b'], new Set())).toEqual({ type: 'enum', vals: [] });
  });

  it('текст чипа: «запрос», два значения и «+N», «(Пусто)», от — до, с — по', () => {
    const name = (v: string) =>
      ({ r1: 'Бухгалтер', r2: 'Главный бухгалтер', r3: 'Стажёр' })[v] ?? v;
    expect(chipText('text', { type: 'text', q: 'ив' }, LABELS, name)).toBe('«ив»');
    expect(chipText('enum', { type: 'enum', vals: ['r1', ''] }, LABELS, name)).toBe(
      'Бухгалтер, (Пусто)',
    );
    expect(chipText('enum', { type: 'enum', vals: ['r1', 'r2', 'r3'] }, LABELS, name)).toBe(
      'Бухгалтер, Главный бухгалтер +1',
    );
    expect(chipText('money', { type: 'num', from: 10000, to: 125050 }, LABELS, name)).toBe(
      'от 100 до 1 250,50',
    );
    expect(chipText('int', { type: 'num', to: 3 }, LABELS, name)).toBe('до 3');
    expect(
      chipText('date', { type: 'date', from: '2026-03-01', to: '2026-03-31' }, LABELS, name),
    ).toBe('с 01.03.2026 по 31.03.2026');
    expect(chipText('datetime', { type: 'date', from: '2026-03-01' }, LABELS, name)).toBe(
      'с 01.03.2026',
    );
  });
});
