import { describe, expect, it } from 'vitest';
import { formatText } from '../l10n/texts';
import { REPORTS_TEXTS } from '../l10n/reports-texts';
import type { ReportPeriod } from '../platform-dicts/catalog';
import { calendarKindOf, productionCalendar, type CalendarEntry } from '../platform-dicts/calendar';
import refDB from '../../../../spec/data/refDB.json';
import fixture from './__fixtures__/due.json';
import {
  defaultAssignmentFrom,
  effectiveRule,
  periodInAssignment,
  periodsDue,
  reportDue,
  type StatusDueRule,
  type EffectiveRule,
  type ReportTypeRule,
} from './due';
import {
  dateOf,
  pastPeriods,
  periodEnd,
  periodLabel,
  periodStartOf,
  periodWindow,
  type PeriodRef,
} from './periods';

// Эталон — прототип (scripts/oracle-due.mjs): окно периодов, подписи, сроки сдачи и оплаты всех видов
// каталога refDB.json на шести датах, «Вариант срока» и статус «Крупный налогоплательщик», периодичность
// в назначении, разовые виды; календарь и виды — так, как их раскладывает наполнение базы.

interface ProtoType {
  id: string;
  per: ReportPeriod;
  day: number;
  after?: number;
  ym?: number;
  from?: 'start';
  pay?: { day: number; after: number; ym?: number };
  inst?: [number, number][];
  shift: boolean;
  skipQ?: number[];
  oneOff?: boolean;
  perAssign?: boolean;
  act: 'sub' | 'pay' | 'both';
  kind: 'regime' | 'cross' | 'internal';
}
interface ProtoBenefit {
  name: string;
  code: string;
  dueOverride?: Record<
    string,
    {
      day?: number | 'last';
      after?: number;
      ym?: number;
      pay?: { day: number | 'last'; after?: number };
    }
  >;
}
const ref = refDB as unknown as {
  reportTypes: ProtoType[];
  dictionaries: { benefits: { items: ProtoBenefit[] } };
};

/** Вид отчёта так, как его кладёт в `report_types` наполнение (packages/db/src/seed/platform-dicts.ts). */
const typeRule = (t: ProtoType): ReportTypeRule => ({
  code: t.id,
  kind: t.kind,
  period: t.per,
  dueDay: t.day,
  dueAfter: t.after ?? null,
  dueMonth: t.ym ?? null,
  dueFrom: t.from ?? 'end',
  payDay: t.pay?.day ?? null,
  payAfter: t.pay?.after ?? null,
  payMonth: t.pay?.ym ?? null,
  paySchedule: t.inst ?? null,
  shiftToWorkday: t.shift,
  skipQuarters: t.skipQ ?? [],
  oneOff: t.oneOff ?? false,
  periodPerAssignment: t.perAssign ?? false,
  act: t.act,
});
const TYPES = new Map(ref.reportTypes.map((t) => [t.id, typeRule(t)]));
const type = (code: string) => TYPES.get(code)!;

const day = (v: number | 'last' | undefined) => (v === undefined ? null : v === 'last' ? 31 : v);
const statusRule = (name: string, typeCode: string): StatusDueRule | null => {
  const b = ref.dictionaries.benefits.items.find((x) => x.name === name)!;
  const o = b.dueOverride?.[typeCode];
  if (!o) return null;
  return {
    benefitCode: b.code,
    dueDay: day(o.day),
    dueAfter: o.after ?? null,
    dueMonth: o.ym ?? null,
    payDay: day(o.pay?.day),
    payAfter: o.pay?.after ?? null,
  };
};

const entries: CalendarEntry[] = [
  ...Object.entries(fixture.holidays as Record<string, string>).map(([d, name]) => ({
    day: d,
    kind: calendarKindOf(name, false),
    name,
  })),
  ...fixture.workingSaturdays.map((d) => ({ day: d, kind: calendarKindOf('', true), name: '' })),
];
const calendar = productionCalendar(entries);
const texts = REPORTS_TEXTS as Record<string, { ru: string }>;
const t = (key: string, params?: Record<string, string | number>) =>
  formatText(texts[key]?.ru ?? key, params);

interface ProtoRow {
  start: string;
  end: string;
  label: string;
  base: string;
  due: string;
  payDue: string | null;
}

/** Период и сроки продукта в том же виде, что у прототипа. */
function row(rule: EffectiveRule, ref: PeriodRef): ProtoRow {
  const d = reportDue(rule, ref, calendar);
  return {
    start: ref.event ?? ref.start,
    end: periodEnd(ref),
    label: periodLabel(ref, t),
    base: d.base,
    due: d.due,
    payDue: d.payDue,
  };
}
const rows = (rule: EffectiveRule, today: string) =>
  periodWindow(rule.period, today, rule.skipQuarters).map((start) =>
    row(rule, { period: rule.period, start }),
  );

describe('периоды и сроки отчётов — как в прототипе', () => {
  it('каждый вид каталога на шести датах: окно периодов, подписи, сроки сдачи и оплаты, что создаётся при назначении', () => {
    expect(fixture.catalog.length).toBeGreaterThan(800);
    for (const c of fixture.catalog) {
      const rule = effectiveRule(type(c.type), null, null);
      expect([c.type, c.today, rows(rule, c.today)]).toEqual([c.type, c.today, c.periods]);
      expect([
        c.type,
        c.today,
        periodsDue(rule, { today: c.today, from: null, until: null }, calendar),
      ]).toEqual([c.type, c.today, c.created]);
    }
  });

  it('«Вариант срока» в назначении и статус «Крупный налогоплательщик»: назначение важнее статуса, статус действует в свои даты', () => {
    for (const v of fixture.variants) {
      const today = '2026-10-18';
      const benDates = v.benDates as Record<string, { from?: string; to?: string }>;
      // Статус действует, пока не истёк (прототип benLive): даты «Действует с / по» — относительно сегодня.
      const live = v.benefits.filter((name) => {
        const d = benDates[name] ?? {};
        return (!d.from || d.from <= today) && (!d.to || d.to >= today);
      });
      const benefit = live.map((name) => statusRule(name, v.type)).find(Boolean) ?? null;
      const assign = v.assign
        ? { dueDay: v.assign.dueDay, ownPeriod: null, ownDay: null, ownMonth: null }
        : null;
      const rule = effectiveRule(type(v.type), assign, benefit);
      expect([v.type, v.assign, v.benefits, rows(rule, today)]).toEqual([
        v.type,
        v.assign,
        v.benefits,
        v.periods,
      ]);
    }
  });

  it('п. 52 приёмки: у крупного налогоплательщика НДС за октябрь 2026 — сдать до 30.11.2026, оплатить до 25.11.2026; без статуса — 25.11.2026', () => {
    const october = { period: 'M' as const, start: '2026-10-01' };
    const large = effectiveRule(type('nds'), null, statusRule('Крупный налогоплательщик', 'nds'));
    expect(large.benefitCode).toBe('ЛЬГ-30');
    expect(reportDue(large, october, calendar)).toEqual({
      base: '2026-11-30',
      due: '2026-11-30',
      payDue: '2026-11-25',
    });
    expect(reportDue(effectiveRule(type('nds'), null, null), october, calendar)).toMatchObject({
      due: '2026-11-25',
      payDue: '2026-11-25',
    });
  });

  it('«До какого периода»: отчёты позже не создаются; «с какого периода» — раньше не создаются', () => {
    for (const u of fixture.until) {
      const rule = effectiveRule(type(u.type), null, null);
      const until = `${u.until}-01`;
      expect(periodsDue(rule, { today: '2026-10-18', from: null, until }, calendar)).toEqual(
        u.created,
      );
    }
    const inv = effectiveRule(type('inv1q'), null, null);
    expect(
      periodsDue(inv, { today: '2026-10-18', from: '2026-10-01', until: null }, calendar),
    ).toEqual(['2026-10-01']);
    // По умолчанию «с какого периода» — первый период, отчёт за который ещё впереди: III квартал (до 20.10).
    expect(defaultAssignmentFrom(inv, '2026-10-18', calendar)).toBe('2026-07-01');
    expect(
      defaultAssignmentFrom(effectiveRule(type('nds'), null, null), '2026-10-18', calendar),
    ).toBe('2026-10-01');
    // Налог на имущество за 2026 год уже прошёл (20.03), за 2027 ещё рано: отчётов нет, начало — 2026.
    const imn = effectiveRule(type('imn'), null, null);
    expect(periodsDue(imn, { today: '2026-10-18', from: null, until: null }, calendar)).toEqual([]);
    expect(defaultAssignmentFrom(imn, '2026-10-18', calendar)).toBe('2026-01-01');
  });

  it('периодичность и срок в назначении (внутренняя отчётность, патент)', () => {
    expect(fixture.own.length).toBe(30);
    for (const o of fixture.own) {
      const base = type(o.type);
      expect(periodInAssignment(base)).toBe(true);
      const rule = effectiveRule(
        base,
        {
          dueDay: null,
          ownPeriod: o.cfg.per as ReportPeriod,
          ownDay: o.cfg.day,
          ownMonth: o.cfg.mo,
        },
        null,
      );
      expect([o.type, o.cfg, rows(rule, '2026-10-18')]).toEqual([o.type, o.cfg, o.periods]);
      expect(periodsDue(rule, { today: '2026-10-18', from: null, until: null }, calendar)).toEqual(
        o.created,
      );
    }
  });

  it('разовые виды: период — месяц даты события, срок — от неё (п. 55: ввоз 05.11.2026 → 20.11.2026, 18.11.2026 → 03.12.2026)', () => {
    for (const o of fixture.oneOff) {
      const rule = effectiveRule(type(o.type), null, null);
      const ref = { period: 'M' as const, start: periodStartOf('M', o.event), event: o.event };
      expect([o.type, o.event, row(rule, ref)]).toEqual([
        o.type,
        o.event,
        { start: o.start, end: o.end, label: o.label, base: o.base, due: o.due, payDue: o.payDue },
      ]);
      expect(periodsDue(rule, { today: '2026-10-18', from: null, until: null }, calendar)).toEqual(
        [],
      );
    }
    const utli = effectiveRule(type('utli'), null, null);
    const ev = (event: string) => ({
      period: 'M' as const,
      start: periodStartOf('M', event),
      event,
    });
    expect(reportDue(utli, ev('2026-11-05'), calendar).payDue).toBe('2026-11-20');
    expect(reportDue(utli, ev('2026-11-18'), calendar).payDue).toBe('2026-12-03');
  });

  it('п. 5 приёмки: срок на нерабочем дне переносится на ближайший рабочий, на рабочей субботе — нет', () => {
    // НДС за сентябрь 2026: 25.10.2026 — воскресенье → 26.10.2026.
    const nds = effectiveRule(type('nds'), null, null);
    expect(reportDue(nds, { period: 'M', start: '2026-09-01' }, calendar)).toMatchObject({
      base: '2026-10-25',
      due: '2026-10-26',
    });
    // Праздник и рабочая суббота из календаря — на правиле «до N-го числа» назначения.
    const saturday = fixture.workingSaturdays[0]!;
    const onSaturday = effectiveRule(
      type('nds'),
      { dueDay: Number(saturday.slice(8, 10)), ownPeriod: null, ownDay: null, ownMonth: null },
      null,
    );
    const month = dateOf(Number(saturday.slice(0, 4)), Number(saturday.slice(5, 7)) - 1, 1);
    expect(reportDue(onSaturday, { period: 'M', start: month }, calendar).due).toBe(saturday);
  });

  it('прошлые периоды назначения: закончились до сегодня, с месяца «с какого периода»; без пропущенных кварталов', () => {
    expect(pastPeriods('M', '2026-07-01', '2026-10-18')).toEqual([
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
    ]);
    expect(pastPeriods('Q', '2026-02-01', '2026-10-18')).toEqual([
      '2026-01-01',
      '2026-04-01',
      '2026-07-01',
    ]);
    expect(pastPeriods('Q', '2025-08-01', '2026-10-18', [4])).toEqual([
      '2025-07-01',
      '2026-01-01',
      '2026-04-01',
      '2026-07-01',
    ]);
    expect(pastPeriods('Y', '2025-01-01', '2026-10-18')).toEqual(['2025-01-01']);
  });

  it('дата по году, месяцу и числу: месяц за пределами года, число больше дней месяца — последний день', () => {
    expect(dateOf(2026, 13, 25)).toBe('2027-01-25');
    expect(dateOf(2026, 2, 31)).toBe('2026-02-28');
    expect(dateOf(2028, 2, 30)).toBe('2028-02-29');
    expect(dateOf(2026, 0, 31)).toBe('2025-12-31');
  });
});
