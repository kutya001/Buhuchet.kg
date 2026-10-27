import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/kpi.json';
import {
  activeIndicators,
  fillDue,
  fillMonth,
  fillStats,
  indicatorApplies,
  indicatorEarly,
  indicatorOn,
  indicatorStart,
  missingByMonth,
  missingMonths,
  missingSummary,
  monthChoices,
  monthFilled,
  monthIndicators,
  nextFillStatus,
  periodPresets,
  type FillStatus,
  type KpiBook,
  type KpiContractor,
  type KpiIndicator,
  type KpiTarget,
} from './fill';

// Эталон — прототип (scripts/oracle-kpi.mjs): показатели, значения и статусы месяцев demoDB.json и тот
// же набор с правками; строки эталона — поля через «|», списки — через запятую.
type Dataset = (typeof fixture.datasets)[number];
interface Scenario {
  today: string;
  employee: string | null;
  fillMonth: string;
  missing: string[];
  summary: { count: number; overdue: boolean; byContractor: string[] };
  byMonth: Record<string, number>;
  monthChoices: string[];
  stats: Record<
    string,
    { all: number; filled: number; empty: number; over: number; checked: number }
  >;
  presets: { from: string; to: string }[];
}

const values = new Set(fixture.values.map((v) => v.split('|').slice(0, 3).join('|')));
const statuses = new Map(
  fixture.statuses.map((s) => {
    const [cp, month, status] = s.split('|');
    return [`${cp}|${month}`, status as FillStatus];
  }),
);

function bookOf(d: Dataset): KpiBook {
  const targets = new Map(
    d.targets.map((t) => [`${t.indicatorId}|${t.contractorId}`, t as KpiTarget]),
  );
  return {
    indicators: d.indicators as KpiIndicator[],
    target: (indicatorId, contractorId) => targets.get(`${indicatorId}|${contractorId}`),
    hasValue: (contractorId, indicatorId, month) =>
      values.has(`${contractorId}|${indicatorId}|${month}`),
  };
}

const ids = (list: readonly { id: string }[]) => list.map((i) => i.id).join(',');

describe.each(fixture.datasets)('$name — как в прототипе', (d) => {
  const book = bookOf(d);
  const contractors = d.contractors as (KpiContractor & { responsible: string | null })[];
  const contractor = (id: string) => contractors.find((c) => c.id === id)!;

  it('«Кому вести»: ведётся ли и месяц «с <месяц>» у каждого контрагента', () => {
    const got = contractors.flatMap((c) =>
      [...d.indicators]
        .sort((a, b) => a.order - b.order)
        .map((i) => {
          const t = book.target(i.id, c.id);
          return [
            c.id,
            i.id,
            indicatorOn(i as KpiIndicator, t) ? 1 : 0,
            indicatorStart(i as KpiIndicator, t, c),
          ].join('|');
        }),
    );
    expect(got).toEqual(d.expected.grid);
  });

  it('по месяцам: требуемые, раньше «с <месяц>», для статуса, срок, заполнен ли', () => {
    for (const row of d.expected.months) {
      const [cp, month] = row.split('|') as [string, string];
      const c = contractor(cp);
      const live = activeIndicators(book);
      const target = (i: KpiIndicator) => book.target(i.id, c.id);
      const got = [
        cp,
        month,
        ids(live.filter((i) => indicatorApplies(i, target(i), c, month))),
        ids(live.filter((i) => indicatorEarly(i, target(i), c, month))),
        ids(monthIndicators(book, c, month)),
        fillDue(book, c, month),
        monthFilled(book, c, month) ? 1 : 0,
      ].join('|');
      expect(got).toBe(row);
    }
  });

  it('вне эталонных месяцев показатели не требуются', () => {
    const listed = new Set(d.expected.months.map((r) => r.split('|').slice(0, 2).join('|')));
    for (const c of contractors)
      for (const month of ['2025-08', '2026-06', '2027-06']) {
        if (listed.has(`${c.id}|${month}`)) continue;
        expect(monthIndicators(book, c, month)).toEqual([]);
        expect(
          activeIndicators(book).some((i) => indicatorEarly(i, book.target(i.id, c.id), c, month)),
        ).toBe(false);
      }
  });

  it.each(d.expected.scenarios as unknown as Scenario[])(
    'сегодня $today, сотрудник $employee: «Не заполнено», счётчик, месяцы, статистика',
    (s) => {
      const mine = s.employee
        ? contractors.filter((c) => c.responsible === s.employee)
        : contractors;
      expect(fillMonth(s.today)).toBe(s.fillMonth);

      const rows = missingMonths(book, mine, s.today);
      expect(
        rows.map((r) =>
          [r.contractorId, r.month, r.missing.join(','), r.due, r.overdueDays].join('|'),
        ),
      ).toEqual(s.missing);

      const summary = missingSummary(rows);
      expect(summary.count).toBe(s.summary.count);
      expect(summary.overdue).toBe(s.summary.overdue);
      expect(
        [...summary.byContractor]
          .map(([id, x]) => [id, x.months.join(','), x.overdue ? 1 : 0].join('|'))
          .sort(),
      ).toEqual([...s.summary.byContractor].sort());

      expect(Object.fromEntries(missingByMonth(rows))).toEqual(s.byMonth);
      expect(monthChoices(rows, s.today)).toEqual(s.monthChoices);

      for (const [month, e] of Object.entries(s.stats)) {
        const got = fillStats(book, mine, month, s.today, (cp) => statuses.get(`${cp}|${month}`));
        expect(got).toEqual({
          all: e.all,
          filled: e.filled,
          empty: e.empty,
          overdue: e.over,
          checked: e.checked,
        });
      }

      expect(periodPresets(s.today).map(({ from, to }) => ({ from, to }))).toEqual(s.presets);
    },
  );
});

describe('статус месяца после изменения — как в прототипе (kSync)', () => {
  it.each(fixture.sync)(
    '$current, всё внесено: $filled, значение изменено: $edited → $expected',
    ({ current, filled, edited, expected }) => {
      expect(nextFillStatus(current as FillStatus, filled, edited)).toBe(expected);
    },
  );
});

describe('правила ТЗ на коротких примерах', () => {
  const ind = (patch: Partial<KpiIndicator> = {}): KpiIndicator => ({
    id: 'k1',
    required: true,
    dueDay: 10,
    start: '2026-01',
    archived: false,
    scope: 'all',
    autoNew: true,
    order: 1,
    ...patch,
  });
  const cp = (patch: Partial<KpiContractor> = {}): KpiContractor => ({
    id: '1',
    oneOff: false,
    archived: false,
    periods: [{ from: '2026-03', to: null }],
    ...patch,
  });
  const book = (
    indicators: KpiIndicator[],
    filled: string[] = [],
    targets: Record<string, KpiTarget> = {},
  ): KpiBook => ({
    indicators,
    target: (i, c) => targets[`${i}|${c}`],
    hasValue: (c, i, m) => filled.includes(`${c}|${i}|${m}`),
  });

  it('«с <месяц>» по умолчанию — поздний из «Вести с» и начала обслуживания; свой — важнее', () => {
    expect(indicatorStart(ind(), undefined, cp())).toBe('2026-03');
    expect(indicatorStart(ind({ start: '2026-05' }), undefined, cp())).toBe('2026-05');
    expect(indicatorStart(ind(), { on: true, from: '2025-12', offSince: null }, cp())).toBe(
      '2025-12',
    );
    expect(indicatorStart(ind(), undefined, cp({ periods: [] }))).toBe('2026-01');
  });

  it('новый контрагент: «Всем» — ведётся; «Выбранным» — только с «Включать новых автоматически»', () => {
    expect(indicatorOn(ind(), undefined)).toBe(true);
    expect(indicatorOn(ind({ scope: 'selected', autoNew: false }), undefined)).toBe(false);
    expect(indicatorOn(ind({ scope: 'selected', autoNew: true }), undefined)).toBe(true);
    expect(indicatorOn(ind(), { on: false, from: null, offSince: '2026-08' })).toBe(false);
  });

  it('разовые, архивные контрагенты и показатели в архиве — не требуются; приостановленный месяц — тоже', () => {
    const c = cp({
      periods: [
        { from: '2026-01', to: '2026-04' },
        { from: '2026-08', to: null },
      ],
    });
    expect(indicatorApplies(ind(), undefined, c, '2026-04')).toBe(true);
    expect(indicatorApplies(ind(), undefined, c, '2026-05')).toBe(false);
    expect(indicatorApplies(ind(), undefined, c, '2026-08')).toBe(true);
    expect(indicatorApplies(ind(), undefined, cp({ oneOff: true }), '2026-05')).toBe(false);
    expect(indicatorApplies(ind(), undefined, cp({ archived: true }), '2026-05')).toBe(false);
    expect(indicatorApplies(ind({ archived: true }), undefined, cp(), '2026-05')).toBe(false);
  });

  it('раньше «с <месяц>» внести можно, но месяц не обязателен', () => {
    expect(indicatorEarly(ind(), undefined, cp(), '2026-02')).toBe(true);
    expect(indicatorApplies(ind(), undefined, cp(), '2026-02')).toBe(false);
    expect(indicatorEarly(ind(), undefined, cp(), '2026-03')).toBe(false);
  });

  it('статус месяца считается по обязательным, а если их нет — по всем ведущимся', () => {
    const a = ind({ id: 'a', required: false, order: 1 });
    const b = ind({ id: 'b', required: true, order: 2 });
    expect(ids(monthIndicators(book([a, b]), cp(), '2026-05'))).toBe('b');
    expect(ids(monthIndicators(book([a]), cp(), '2026-05'))).toBe('a');
    expect(monthFilled(book([a]), cp(), '2026-05')).toBe(false);
    expect(monthFilled(book([a, b], ['1|b|2026-05']), cp(), '2026-05')).toBe(true);
  });

  it('срок месяца — ранний срок его показателей в следующем месяце; без показателей — 10-е', () => {
    const a = ind({ id: 'a', dueDay: 15 });
    const b = ind({ id: 'b', dueDay: 5 });
    expect(fillDue(book([a, b]), cp(), '2026-12')).toBe('2027-01-05');
    expect(fillDue(book([]), cp(), '2026-12')).toBe('2027-01-10');
  });

  it('текущий месяц заполнения — прошлый календарный, даже если в нём никто не обслуживался', () => {
    expect(fillMonth('2026-01-03')).toBe('2025-12');
    const fresh = cp({ periods: [{ from: '2026-10', to: null }] });
    expect(missingMonths(book([ind()]), [fresh], '2026-10-18')).toEqual([]);
    expect(missingMonths(book([ind()]), [fresh], '2026-11-12')).toEqual([
      { contractorId: '1', month: '2026-10', missing: ['k1'], due: '2026-11-10', overdueDays: 2 },
    ]);
  });

  it('не дальше 35 месяцев назад', () => {
    const rows = missingMonths(
      book([ind({ start: '2020-01' })]),
      [cp({ periods: [{ from: '2020-01', to: null }] })],
      '2026-10-18',
    );
    expect(rows[0]!.month).toBe('2023-10');
    expect(rows.at(-1)!.month).toBe('2026-09');
    expect(rows).toHaveLength(36);
  });

  it('счётчик: жёлтый, пока не прошёл срок текущего месяца; красный — есть просроченные', () => {
    const b = book([ind()]);
    const c = cp({ periods: [{ from: '2026-09', to: null }] });
    expect(missingSummary(missingMonths(b, [c], '2026-10-10'))).toMatchObject({
      count: 1,
      overdue: false,
    });
    expect(missingSummary(missingMonths(b, [c], '2026-10-11'))).toMatchObject({
      count: 1,
      overdue: true,
    });
    expect(missingSummary([])).toMatchObject({ count: 0, overdue: false });
  });

  it('быстрые периоды «За период»', () => {
    expect(periodPresets('2026-10-18')).toEqual([
      { preset: 'year', from: '2026-01', to: '2026-12' },
      { preset: 'prev_year', from: '2025-01', to: '2025-12' },
      { preset: 'last_12', from: '2025-10', to: '2026-09' },
      { preset: 'quarter', from: '2026-10', to: '2026-12' },
    ]);
  });
});
