import { describe, expect, it } from 'vitest';
import { addDays, type IsoDate } from '../common/dates';
import type { YearMonth } from '../common/months';
import fixture from './__fixtures__/series.json';
import type { TaskTerm } from './rules';
import {
  type SeriesFacts,
  type SeriesMonthMode,
  type SeriesPlan,
  type SeriesRule,
  type SeriesUnit,
  seriesDateInMonth,
  seriesNextDate,
  seriesRuleText,
  seriesRunStep,
  seriesUpcoming,
} from './series';

// Сверка повторяющихся задач с прототипом v168 (modules/task-series.js: tsText, tsNext, tsInMonth,
// tsUpcoming, tsRun) на 680 правилах: все единицы, 31-е и 29 февраля, «На месяц», окончание по дате и
// числу, ночи подряд и с пропусками. Эталон пишет scripts/oracle-series.mjs (скилл prototype-oracle).

interface ProtoRule {
  n: number;
  u: string;
  wd?: number[];
  mm?: string;
  end: { k: string; date?: string; count?: number };
}
interface Case {
  kind: string;
  start: string;
  rule: ProtoRule;
  text: string;
  froms: (string | null)[];
  next: (string | null)[];
  months: string[] | null;
  daily: Nights;
  gaps: Nights;
}
interface Nights {
  made: string;
  end: string | null;
  upcoming: string | null;
}

const cases = fixture.cases as Case[];

function planOf(c: Case): SeriesPlan {
  const r = c.rule;
  const rule: SeriesRule = {
    every: r.n,
    unit: r.u as SeriesUnit,
    end: {
      kind: r.end.k as SeriesRule['end']['kind'],
      date: (r.end.date as IsoDate | undefined) ?? null,
      count: r.end.count ?? null,
    },
    ...(r.wd ? { weekDays: r.wd } : {}),
    ...(r.mm ? { monthMode: r.mm as SeriesMonthMode } : {}),
  };
  return { rule, start: c.start as IsoDate, term: c.kind as TaskTerm };
}

/** Ночной запуск по дням: как `tsRun` прототипа, шаг — `seriesRunStep`. */
function nights(c: Case, step: number): Nights {
  const plan = planOf(c);
  let facts: SeriesFacts = { ...plan, state: 'active', lastDate: null, made: 0 };
  const made: string[] = [];
  let end: string | null = null;
  for (let d = 0; d <= 200; d += step) {
    const today = addDays(plan.start, d - 2);
    const next = seriesRunStep(facts, { stop: null, paused: false }, today);
    if (next.kind === 'make') {
      made.push(next.date);
      facts = { ...facts, lastDate: next.date, made: facts.made + 1 };
    }
    if (next.kind === 'finish' || (next.kind === 'make' && next.finish)) {
      facts = { ...facts, state: 'finished' };
      end = `fin:${today}`;
      break;
    }
    if (next.kind === 'stop') throw new Error('без причины остановки');
  }
  const last = addDays(plan.start, Math.floor(200 / step) * step - 2);
  return { made: made.join(' '), end, upcoming: end ? null : seriesUpcoming(facts, last) };
}

describe('повторяющиеся задачи — как в прототипе', () => {
  it('эталон не пуст и покрывает все единицы и «На месяц»', () => {
    expect(cases.length).toBeGreaterThan(600);
    const units = new Set(cases.map((c) => `${c.kind}:${c.rule.u}`));
    expect([...units].sort()).toEqual([
      'day:day',
      'day:month',
      'day:week',
      'day:year',
      'month:month',
      'month:year',
    ]);
  });

  it('правило словами', () => {
    for (const c of cases) expect(seriesRuleText(planOf(c)), c.text).toBe(c.text);
    expect(seriesRuleText(null)).toBe('Не повторять');
  });

  it('следующая дата не раньше «с» и начала, после окончания — нет', () => {
    for (const c of cases) {
      const plan = planOf(c);
      const got = c.froms.map((f) => seriesNextDate(plan, f as IsoDate | null));
      expect(got, `${c.text} с ${c.start}`).toEqual(c.next);
    }
  });

  it('дата в месяце: 31-е и 29 февраля — последний день, «На месяц» — последний день месяца', () => {
    for (const c of cases) {
      if (!c.months) continue;
      const plan = planOf(c);
      const got = ['2026-02', '2028-02', '2026-04', '2026-11'].map((m) =>
        seriesDateInMonth(plan, m as YearMonth),
      );
      expect(got, `${c.text} с ${c.start}`).toEqual(c.months);
    }
  });

  it('ночи подряд: одна ближайшая задача, окончание по дате и числу', () => {
    for (const c of cases) expect(nights(c, 1), `${c.text} с ${c.start}`).toEqual(c.daily);
  });

  it('пропущенные ночи: задним числом не ставится, только одна ближайшая дата', () => {
    for (const c of cases) expect(nights(c, 9), `${c.text} с ${c.start}`).toEqual(c.gaps);
  });
});
