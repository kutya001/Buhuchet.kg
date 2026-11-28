import { describe, expect, it } from 'vitest';
import {
  defaultSeriesRule,
  SERIES_RULE_MESSAGES,
  type SeriesFacts,
  type SeriesPlan,
  seriesFirstDate,
  seriesMonthModes,
  seriesMonthText,
  seriesRuleProblems,
  seriesRuleText,
  seriesBossRefusal,
  seriesDayMonthText,
  seriesRuleEqual,
  seriesRunStep,
  seriesStopText,
  seriesUnitLabel,
} from './series';

// Правила повтора, которых нет в сверке с прототипом (series-oracle.test.ts): окно «Повтор»,
// остановка без человека и пауза ночного запуска (ТЗ «Доработки 28.11.2026: повторяющиеся задачи»).

const week = (start: string, days: number[]): SeriesPlan => ({
  rule: { every: 1, unit: 'week', weekDays: days, end: { kind: 'never' } },
  start,
  term: 'day',
});
const facts = (plan: SeriesPlan, over: Partial<SeriesFacts> = {}): SeriesFacts => ({
  ...plan,
  state: 'active',
  lastDate: null,
  made: 0,
  ...over,
});
const go = { stop: null, paused: false } as const;

describe('правило повтора', () => {
  it('по умолчанию — каждую неделю в день срока, у «На месяц» — каждый месяц', () => {
    expect(defaultSeriesRule('2026-12-02', 'day')).toEqual({
      every: 1,
      unit: 'week',
      weekDays: [2],
      end: { kind: 'never' },
    });
    expect(defaultSeriesRule('2026-12-31', 'month')).toEqual({
      every: 1,
      unit: 'month',
      end: { kind: 'never' },
    });
  });

  it('«Когда» у месяца: N-й день недели — до 28-го, «последний» — в последнюю неделю', () => {
    expect(seriesMonthModes('2026-12-05')).toEqual(['date', 'nth']);
    expect(seriesMonthModes('2026-12-26')).toEqual(['date', 'nth', 'last']);
    expect(seriesMonthModes('2026-12-30')).toEqual(['date', 'last']);
    expect(seriesMonthText('nth', '2026-12-05')).toBe('в первую субботу');
    expect(seriesMonthText('last', '2026-12-30')).toBe('в последнюю среду');
    expect(seriesMonthText(undefined, '2026-12-05')).toBe('5-го числа');
  });

  it('словами — примеры ТЗ', () => {
    expect(
      seriesRuleText({
        rule: {
          every: 1,
          unit: 'week',
          weekDays: [2, 0],
          end: { kind: 'date', date: '2027-02-27' },
        },
        start: '2026-11-30',
        term: 'day',
      }),
    ).toBe('Каждую неделю: пн, ср · до 27.02.2027');
    expect(seriesRuleText(week('2026-11-30', [0, 1, 2, 3, 4]))).toBe('Каждый будний день');
    expect(
      seriesRuleText({
        rule: { every: 2, unit: 'month', monthMode: 'date', end: { kind: 'never' } },
        start: '2026-12-05',
        term: 'day',
      }),
    ).toBe('Каждые 2 месяца, 5-го числа');
    expect(
      seriesRuleText({
        rule: { every: 1, unit: 'day', end: { kind: 'count', count: 30 } },
        start: '2026-12-05',
        term: 'day',
      }),
    ).toBe('Каждый день · 30 повторов');
  });
});

describe('проверка окна «Повтор»', () => {
  it('верное правило — без замечаний', () => {
    expect(seriesRuleProblems(week('2026-12-02', [0, 2]))).toEqual({});
  });

  it('интервал 1–99, целый', () => {
    for (const every of [0, 100, 1.5, Number.NaN])
      expect(
        seriesRuleProblems({
          ...week('2026-12-02', [2]),
          rule: { ...week('2026-12-02', [2]).rule, every },
        }),
      ).toEqual({ every: 'series_every' });
  });

  it('неделя — хотя бы один день, без повторов и чужих чисел; у других единиц дней нет', () => {
    expect(seriesRuleProblems(week('2026-12-02', []))).toEqual({ weekDays: 'series_week_days' });
    expect(seriesRuleProblems(week('2026-12-02', [1, 1]))).toEqual({
      weekDays: 'series_week_days',
    });
    expect(seriesRuleProblems(week('2026-12-02', [7]))).toEqual({ weekDays: 'series_week_days' });
    expect(
      seriesRuleProblems({
        rule: { every: 1, unit: 'day', weekDays: [1], end: { kind: 'never' } },
        start: '2026-12-02',
        term: 'day',
      }),
    ).toEqual({ weekDays: 'series_week_days' });
  });

  it('у «На месяц» — только месяцы и годы, «Когда» не выбирается', () => {
    const plan: SeriesPlan = {
      rule: { every: 1, unit: 'week', weekDays: [1], end: { kind: 'never' } },
      start: '2026-12-31',
      term: 'month',
    };
    expect(seriesRuleProblems(plan)).toEqual({ unit: 'series_unit' });
    expect(
      seriesRuleProblems({
        ...plan,
        rule: { every: 1, unit: 'month', monthMode: 'nth', end: { kind: 'never' } },
      }),
    ).toEqual({ monthMode: 'series_month_mode' });
  });

  it('«Когда» у месяца — из доступных для начала', () => {
    expect(
      seriesRuleProblems({
        rule: { every: 1, unit: 'month', monthMode: 'nth', end: { kind: 'never' } },
        start: '2026-12-30',
        term: 'day',
      }),
    ).toEqual({ monthMode: 'series_month_mode' });
  });

  it('окончание: дата не раньше начала, число 1–999', () => {
    const base = week('2026-12-02', [2]);
    const withEnd = (end: SeriesPlan['rule']['end']) =>
      seriesRuleProblems({ ...base, rule: { ...base.rule, end } });
    expect(withEnd({ kind: 'date' })).toEqual({ end: 'series_end_date' });
    expect(withEnd({ kind: 'date', date: '2026-12-01' })).toEqual({
      end: 'series_end_before_start',
    });
    expect(withEnd({ kind: 'date', date: '2026-12-02' })).toEqual({});
    expect(withEnd({ kind: 'count', count: 0 })).toEqual({ end: 'series_end_count' });
    expect(withEnd({ kind: 'count', count: 1000 })).toEqual({ end: 'series_end_count' });
    expect(withEnd({ kind: 'count', count: 999 })).toEqual({});
  });

  it('тексты замечаний — как в прототипе', () => {
    expect(SERIES_RULE_MESSAGES.series_every).toBe('Интервал — целое число от 1 до 99');
    expect(SERIES_RULE_MESSAGES.series_week_days).toBe('Отметьте хотя бы один день недели');
    expect(SERIES_RULE_MESSAGES.series_end_before_start).toBe('Окончание раньше начала');
    expect(SERIES_RULE_MESSAGES.series_end_count).toBe('Число повторов — от 1 до 999');
  });
});

describe('ночной запуск', () => {
  const plan = week('2026-12-02', [2]);

  it('первая задача: начало в прошлом — ближайшая дата по правилу, не раньше сегодня', () => {
    expect(seriesFirstDate(plan, '2026-12-01')).toBe('2026-12-02');
    expect(seriesFirstDate(plan, '2026-12-03')).toBe('2026-12-09');
    expect(seriesFirstDate(week('2026-12-01', [2]), '2026-11-20')).toBe('2026-12-02');
  });

  it('исполнитель заблокирован, контрагент в архиве, проект неактивен — остановить без человека', () => {
    for (const reason of ['executor', 'contractor', 'archive', 'project'] as const)
      expect(seriesRunStep(facts(plan), { stop: reason, paused: false }, '2026-12-02')).toEqual({
        kind: 'stop',
        reason,
      });
  });

  it('контрагент приостановлен или «Задачи» выключены — ничего, серия остаётся', () => {
    expect(seriesRunStep(facts(plan), { stop: null, paused: true }, '2026-12-02')).toEqual({
      kind: 'none',
    });
  });

  it('остановленная и законченная серия ничего не ставят', () => {
    for (const state of ['stopped', 'finished'] as const)
      expect(
        seriesRunStep(facts(plan, { state }), { stop: 'executor', paused: false }, '2026-12-02'),
      ).toEqual({
        kind: 'none',
      });
  });

  it('у серии одна ближайшая задача: пока её срок не прошёл, следующая не ставится', () => {
    expect(
      seriesRunStep(facts(plan, { lastDate: '2026-12-09', made: 2 }), go, '2026-12-09'),
    ).toEqual({
      kind: 'none',
    });
    expect(
      seriesRunStep(facts(plan, { lastDate: '2026-12-09', made: 2 }), go, '2026-12-10'),
    ).toEqual({
      kind: 'make',
      date: '2026-12-16',
      finish: false,
    });
  });

  it('месяц пропущенных ночей — одна задача на ближайшую дату, задним числом не ставится', () => {
    expect(
      seriesRunStep(facts(plan, { lastDate: '2026-12-02', made: 1 }), go, '2027-01-08'),
    ).toEqual({
      kind: 'make',
      date: '2027-01-13',
      finish: false,
    });
  });

  it('после N повторов — последняя задача с отметкой «закончится», затем «закончился»', () => {
    const three = { ...plan, rule: { ...plan.rule, end: { kind: 'count' as const, count: 3 } } };
    expect(
      seriesRunStep(facts(three, { lastDate: '2026-12-09', made: 2 }), go, '2026-12-10'),
    ).toEqual({
      kind: 'make',
      date: '2026-12-16',
      finish: true,
    });
    expect(
      seriesRunStep(facts(three, { lastDate: '2026-12-16', made: 3 }), go, '2026-12-17'),
    ).toEqual({
      kind: 'finish',
    });
  });

  it('после даты окончания дат нет — серия закончилась', () => {
    const until = {
      ...plan,
      rule: { ...plan.rule, end: { kind: 'date' as const, date: '2026-12-10' } },
    };
    expect(
      seriesRunStep(facts(until, { lastDate: '2026-12-09', made: 2 }), go, '2026-12-10'),
    ).toEqual({
      kind: 'finish',
    });
  });
});

describe('кто управляет серией и что считается сменой правила', () => {
  it('изменить, остановить и возобновить — владелец или постановщик с «Ставить задачи»', () => {
    expect(seriesBossRefusal('e1', { employeeId: 'e9', isOwner: true, canCreate: false })).toBeNull();
    expect(seriesBossRefusal('e1', { employeeId: 'e1', isOwner: false, canCreate: true })).toBeNull();
    expect(seriesBossRefusal('e1', { employeeId: 'e2', isOwner: false, canCreate: true })).toBe(
      'series_author_only',
    );
    expect(seriesBossRefusal('e1', { employeeId: 'e1', isOwner: false, canCreate: false })).toBe(
      'series_create_right',
    );
  });

  it('порядок дней недели и лишние поля правило не меняют; интервал, дни, «Когда» и окончание — меняют', () => {
    const a = { every: 1, unit: 'week', weekDays: [2, 0], end: { kind: 'never' } } as const;
    expect(seriesRuleEqual(a, { ...a, weekDays: [0, 2] })).toBe(true);
    expect(seriesRuleEqual(a, { ...a, monthMode: 'last' })).toBe(true);
    expect(seriesRuleEqual(a, { ...a, weekDays: [0] })).toBe(false);
    expect(seriesRuleEqual(a, { ...a, every: 2 })).toBe(false);
    expect(seriesRuleEqual(a, { ...a, end: { kind: 'count', count: 3 } })).toBe(false);
    const m = { every: 1, unit: 'month', monthMode: 'date', end: { kind: 'date', date: '2027-01-31' } } as const;
    expect(seriesRuleEqual(m, { ...m, monthMode: 'nth' })).toBe(false);
    expect(seriesRuleEqual(m, { ...m, end: { kind: 'date', date: '2027-02-28' } })).toBe(false);
    expect(seriesRuleEqual(m, { ...m, unit: 'year' })).toBe(false);
  });

  it('причина остановки словами — только у остановки без человека', () => {
    expect(seriesStopText('manual')).toBe('');
    expect(seriesStopText(null)).toBe('');
    expect(seriesStopText('executor')).toBe('Исполнитель заблокирован');
    expect(seriesStopText('archive')).toBe('Контрагент в архиве');
  });
});

describe('подписи окна «Повтор»', () => {
  it('единица — по интервалу, «неделя» вместо «неделю»; год — день и месяц начала', () => {
    expect(seriesUnitLabel('week', 1)).toBe('неделя');
    expect(seriesUnitLabel('week', 3)).toBe('недели');
    expect(seriesUnitLabel('day', 5)).toBe('дней');
    expect(seriesUnitLabel('year', 0)).toBe('год');
    expect(seriesDayMonthText('2026-03-05')).toBe('5 марта');
  });
});
