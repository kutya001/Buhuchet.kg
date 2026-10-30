import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/kpi.json';
import {
  DEFAULT_INDICATORS,
  INDICATOR_MESSAGES,
  INDICATOR_PROBLEMS,
  INDICATOR_VALUE_TEXT_MAX_LENGTH,
  indicatorNumberText,
  indicatorProblems,
  indicatorTotals,
  indicatorValueText,
  parseIndicatorValue,
  type IndicatorInput,
  type IndicatorType,
} from './indicators';

// Эталон — прототип (scripts/oracle-kpi.mjs). Прототип держит значения в единицах, продукт — в сотых.
const hundredths = (v: number) => Math.round(v * 100);

const revenue: IndicatorInput = { ...DEFAULT_INDICATORS[0]!, start: '2026-10' };
const ok = { otherNames: ['Количество сотрудников'], currentMonth: '2026-10' };

describe('показатели-примеры новой организации', () => {
  it('«Выручка» — сом, итог сумма; «Количество сотрудников» — чел., итог среднее', () => {
    expect(DEFAULT_INDICATORS.map((i) => [i.name, i.unit, i.type, i.total])).toEqual([
      ['Выручка', 'сом', 'som', 'sum'],
      ['Количество сотрудников', 'чел.', 'int', 'avg'],
    ]);
    for (const i of DEFAULT_INDICATORS) {
      expect(i).toMatchObject({ required: true, dueDay: 10, scope: 'all', autoNew: true });
      expect(
        indicatorProblems({ ...i, start: '2026-10' }, { otherNames: [], currentMonth: '2026-10' }),
      ).toEqual([]);
    }
  });
});

describe('проверка окна показателя', () => {
  const problems = (
    patch: Partial<IndicatorInput>,
    check: Partial<Parameters<typeof indicatorProblems>[1]> = {},
  ) =>
    indicatorProblems({ ...revenue, ...patch }, { ...ok, ...check }).map(
      (p) => `${p.field}:${p.problem}`,
    );

  it('верный показатель — без ошибок', () => {
    expect(problems({})).toEqual([]);
  });

  it('название: обязательно, не длиннее 100, не повторяет другой показатель без учёта регистра', () => {
    expect(problems({ name: '  ' })).toEqual(['name:name_required']);
    expect(problems({ name: 'В'.repeat(101) })).toEqual(['name:name_too_long']);
    expect(problems({ name: 'В'.repeat(100) })).toEqual([]);
    expect(problems({ name: ' количество СОТРУДНИКОВ ' })).toEqual(['name:name_taken']);
  });

  it('единица: своя подпись обязательна и не длиннее 20', () => {
    expect(problems({ unit: '' })).toEqual(['unit:unit_required']);
    expect(problems({ unit: 'м²' })).toEqual([]);
    expect(problems({ unit: 'x'.repeat(21) })).toEqual(['unit:unit_too_long']);
  });

  it('тип и единицу нельзя менять, если по показателю уже есть значения', () => {
    const before = { type: 'som' as const, unit: 'сом', hasValues: true };
    expect(problems({ type: 'dec', unit: 'шт.' }, { before })).toEqual([
      'unit:unit_locked',
      'type:type_locked',
    ]);
    expect(problems({}, { before })).toEqual([]);
    expect(
      problems({ type: 'dec', unit: 'шт.' }, { before: { ...before, hasValues: false } }),
    ).toEqual([]);
  });

  it('описание не длиннее 1000; срок — целое от 1 до 28', () => {
    expect(problems({ description: 'о'.repeat(1001) })).toEqual([
      'description:description_too_long',
    ]);
    expect(problems({ dueDay: 0 })).toEqual(['dueDay:due_day_invalid']);
    expect(problems({ dueDay: 29 })).toEqual(['dueDay:due_day_invalid']);
    expect(problems({ dueDay: 10.5 })).toEqual(['dueDay:due_day_invalid']);
    expect(problems({ dueDay: 1 })).toEqual([]);
    expect(problems({ dueDay: 28 })).toEqual([]);
  });

  it('«Вести с» — не позже текущего месяца', () => {
    expect(problems({ start: '2026-11' })).toEqual(['start:start_in_future']);
    expect(problems({ start: '2025-01' })).toEqual([]);
  });

  it('«Выбранным» — хотя бы один контрагент', () => {
    expect(problems({ scope: 'selected' })).toEqual(['scope:targets_required']);
    expect(problems({ scope: 'selected' }, { selected: 3 })).toEqual([]);
  });

  it('у каждой ошибки есть текст', () => {
    for (const p of INDICATOR_PROBLEMS) expect(INDICATOR_MESSAGES[p]).toBeTruthy();
    expect(INDICATOR_MESSAGES.due_day_invalid).toBe('От 1 до 28');
  });
});

describe('разбор введённого значения', () => {
  it.each(fixture.parse)('$type «$text» — как в прототипе', ({ type, text, expected }) => {
    const got = parseIndicatorValue(type as IndicatorType, text);
    if (expected === 'error') expect(got).toEqual({ ok: false });
    else
      expect(got).toEqual({
        ok: true,
        value: expected === null ? null : hundredths(expected as number),
      });
  });

  it('пусто — «не заполнено», 0 — внесённый ноль', () => {
    expect(parseIndicatorValue('som', '')).toEqual({ ok: true, value: null });
    expect(parseIndicatorValue('som', '0')).toEqual({ ok: true, value: 0 });
    expect(parseIndicatorValue('int', '-0,4')).toEqual({ ok: true, value: 0 });
  });

  it('минус «−», как его показывает экран, принимается; «1e3», «0x10», «Infinity» — нет', () => {
    expect(parseIndicatorValue('som', '−1 250,50')).toEqual({ ok: true, value: -125050 });
    for (const text of ['1e3', '0x10', 'Infinity', '9'.repeat(20)]) {
      expect(parseIndicatorValue('som', text)).toEqual({ ok: false });
    }
  });

  it('длинный текст — не число и не разбирается; пробелы по краям в длину не входят', () => {
    const spaces = ' '.repeat(INDICATOR_VALUE_TEXT_MAX_LENGTH);
    expect(parseIndicatorValue('som', `${spaces}1 250${spaces}`)).toEqual({
      ok: true,
      value: 125_000,
    });
    expect(parseIndicatorValue('som', `1${spaces}x`)).toEqual({ ok: false });
    expect(parseIndicatorValue('som', `1${' '.repeat(INDICATOR_VALUE_TEXT_MAX_LENGTH)}`)).toEqual({
      ok: true,
      value: 100,
    });
  });
});

describe('показ значения', () => {
  it.each(fixture.show)('$type $value — как в прототипе', ({ type, unit, value, number, text }) => {
    const t = type as IndicatorType;
    expect(indicatorNumberText(t, value * 100)).toBe(number);
    expect(indicatorValueText({ type: t, unit }, value * 100)).toBe(text);
  });

  it('пусто — пустая строка', () => {
    expect(indicatorValueText({ type: 'som', unit: 'сом' }, null)).toBe('');
  });
});

describe('итоги по заполненным месяцам', () => {
  it.each(fixture.totals.map((x, i) => ({ ...x, i })))(
    'ряд $i — как в прототипе',
    ({ values, expected }) => {
      const got = indicatorTotals(values.map((v) => (v === null ? null : hundredths(v))));
      if (expected.n === 0) return expect(got).toEqual({ count: 0 });
      const e = expected as {
        n: number;
        sum: number;
        avg: number;
        max: number;
        min: number;
        last: number;
      };
      expect(got).toMatchObject({
        count: e.n,
        sum: hundredths(e.sum),
        max: hundredths(e.max),
        min: hundredths(e.min),
        last: hundredths(e.last),
      });
      if ('avg' in got) expect(got.avg).toBeCloseTo(e.avg * 100, 6);
    },
  );

  it('пустой месяц — не ноль: «среднее по 2 из 3»', () => {
    expect(indicatorTotals([1000, null, 3000])).toEqual({
      count: 2,
      sum: 4000,
      avg: 2000,
      max: 3000,
      min: 1000,
      last: 3000,
    });
    expect(indicatorTotals([null, null])).toEqual({ count: 0 });
  });
});
