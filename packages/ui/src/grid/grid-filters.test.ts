import { enumAll, type EnumStep, type ListFilterValue } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import {
  activeFilterKeys,
  chipText,
  enumFilterFits,
  enumFilterOf,
  enumSelectionOf,
  formatFilterNumber,
  parseFilterNumber,
  unlabeledEnumFilters,
} from './grid-filters';
import type { GridLabels } from './types';

const LABELS = {
  empty: '(Пусто)',
  chipFrom: (v: string) => `от ${v}`,
  chipTo: (v: string) => `до ${v}`,
  chipSince: (v: string) => `с ${v}`,
  chipUntil: (v: string) => `по ${v}`,
  chipMore: (n: number) => `+${n}`,
  chipAll: 'все',
  chipMatch: (q: string) => `содержит «${q}»`,
  chipExcept: (v: string) => `кроме ${v}`,
  chipExceptMatch: (q: string) => `кроме содержащих «${q}»`,
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

  it('галочки, пришли все значения: отмечены все — фильтра нет; иначе отмеченные по порядку, как в прототипе', () => {
    const all = [
      { value: 'a', label: 'А' },
      { value: 'b', label: 'Б' },
      { value: 'c', label: 'В' },
      { value: '', label: null },
    ];
    expect(enumFilterOf(enumAll(), all)).toBeNull();
    expect(enumFilterOf({ vals: ['', 'a'] }, all)).toEqual({ type: 'enum', vals: ['a', ''] });
    expect(enumFilterOf({ vals: [] }, all)).toEqual({ type: 'enum', vals: [] });
    expect(enumFilterOf({ vals: ['a', 'b', ''] }, all)).toEqual({
      type: 'enum',
      vals: ['a', 'b', ''],
    });
  });

  it('галочки, пришли все 450 значений и отмечено больше 200: шаг по поиску или «все, кроме» снятых', () => {
    const all = Array.from({ length: 450 }, (_, i) => ({
      value: `v${i}`,
      label: i < 300 ? `Найдётся ${i}` : `Другое ${i}`,
    }));
    const found = { vals: [], steps: [{ on: true, match: 'найдется' }] };
    expect(enumFilterOf(found, all)).toEqual({ type: 'enum', ...found });
    const off = all.slice(0, 210).map((i) => i.value);
    const many = { vals: all.slice(210).map((i) => i.value) };
    expect(enumFilterOf(many, all)).toEqual({
      type: 'enum',
      vals: [],
      steps: [
        { on: true, match: '' },
        { on: false, vals: off },
      ],
    });
    // И отмеченных, и снятых больше 200 отдельными галочками — не помещается, окно об этом скажет.
    expect(enumFilterFits(enumFilterOf({ vals: all.slice(0, 220).map((i) => i.value) }, all))).toBe(
      false,
    );
  });

  it('галочки, пришли не все значения: уходит выбор с шагами по поиску; всё отмечено — фильтра нет', () => {
    const steps = [
      { on: true, match: '' },
      { on: false, match: 'ип' },
    ];
    expect(enumFilterOf(enumAll(), null)).toBeNull();
    expect(enumFilterOf({ vals: ['a'] }, null)).toEqual({ type: 'enum', vals: ['a'] });
    expect(enumFilterOf({ vals: [], steps }, null)).toEqual({ type: 'enum', vals: [], steps });
    // Выбор по фильтру столбца: фильтра нет — отмечено всё.
    expect(enumSelectionOf(undefined)).toEqual(enumAll());
    expect(enumSelectionOf({ type: 'enum', vals: [], steps })).toEqual({ vals: [], steps });
    expect(enumSelectionOf({ type: 'enum', vals: ['a'] })).toEqual({ vals: ['a'] });
  });

  it('в адресе запроса — не больше 200 отдельных значений и 20 шагов', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
    expect(enumFilterFits({ type: 'enum', vals: many(200) })).toBe(true);
    expect(enumFilterFits({ type: 'enum', vals: many(201) })).toBe(false);
    expect(
      enumFilterFits({ type: 'enum', vals: many(150), steps: [{ on: false, vals: many(51) }] }),
    ).toBe(false);
    const steps = Array.from({ length: 21 }, () => ({ on: true, match: 'а' }));
    expect(enumFilterFits({ type: 'enum', vals: [], steps })).toBe(false);
    expect(enumFilterFits(null)).toBe(true);
    expect(enumFilterFits({ type: 'text', q: 'а' })).toBe(true);
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
    const steps = (...list: EnumStep[]): ListFilterValue => ({
      type: 'enum',
      vals: [],
      steps: list,
    });
    expect(
      chipText('enum', steps({ on: true, match: '' }, { on: false, vals: ['r3'] }), LABELS, name),
    ).toBe('все, кроме Стажёр');
    expect(
      chipText('enum', steps({ on: true, match: '' }, { on: false, match: ' ип ' }), LABELS, name),
    ).toBe('все, кроме содержащих «ип»');
    expect(
      chipText(
        'enum',
        { type: 'enum', vals: ['r1'], steps: [{ on: true, match: 'бух' }] },
        LABELS,
        name,
      ),
    ).toBe('Бухгалтер, содержит «бух»');
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

  it('подписи для чипа подгружаются у галочек, поставленных не из меню столбца', () => {
    const filters: Record<string, ListFilterValue> = {
      active: { type: 'enum', vals: ['blocked'] },
      role: { type: 'enum', vals: ['r1', ''] },
      fullName: { type: 'text', q: 'ив' },
      gone: { type: 'enum', vals: ['x'] },
    };
    const keys = ['active', 'role', 'fullName'];
    expect(unlabeledEnumFilters(filters, keys, {})).toEqual(['active', 'role']);
    // «(Пусто)» подписи не требует; известные подписи повторно не грузятся.
    expect(unlabeledEnumFilters(filters, keys, { role: { r1: 'Бухгалтер' } })).toEqual(['active']);
    // Значения из шагов «Выбрать все» тоже нужны чипу; шаг по поиску подписи не требует.
    const stepped: Record<string, ListFilterValue> = {
      role: {
        type: 'enum',
        vals: [],
        steps: [
          { on: true, match: 'бух' },
          { on: false, vals: ['r2'] },
        ],
      },
    };
    expect(unlabeledEnumFilters(stepped, keys, { role: { r1: 'Бухгалтер' } })).toEqual(['role']);
    expect(unlabeledEnumFilters(stepped, keys, { role: { r2: 'Главный бухгалтер' } })).toEqual([]);
  });
});
