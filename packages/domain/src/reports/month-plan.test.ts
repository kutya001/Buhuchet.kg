import { describe, expect, it } from 'vitest';
import {
  currentPlanMonth,
  inMonthPlan,
  monthPlan,
  monthPlanGroup,
  monthPlanItem,
  monthPlanQuick,
  reportMonth,
  type MonthPlanReport,
} from './month-plan';

// Правило «к сдаче и к оплате по месяцам» (решение заказчика 13.11.2026, прототип v90
// modules/report-months.js: rmYm, rmItem, rmGroup, rmPlan).

const report = (over: Partial<MonthPlanReport> = {}): MonthPlanReport => ({
  id: 'r1',
  act: 'both',
  status: 'todo',
  period: 'M',
  periodStart: '2026-10-01',
  eventDate: null,
  dueDate: '2026-11-25',
  payDue: '2026-11-25',
  amount: 500_000,
  paid: 0,
  overdue: false,
  payOverdue: false,
  ...over,
});

describe('reportMonth — месяц отчёта: месяц, которым заканчивается период', () => {
  it('месячный отчёт — свой месяц: НДС за 10.2026 — октябрь', () => {
    expect(reportMonth({ period: 'M', periodStart: '2026-10-01' })).toBe('2026-10');
  });

  it('квартальный — последний месяц квартала: III кв. 2026 — сентябрь', () => {
    expect(reportMonth({ period: 'Q', periodStart: '2026-07-01' })).toBe('2026-09');
    expect(reportMonth({ period: 'Q', periodStart: '2026-10-01' })).toBe('2026-12');
  });

  it('полугодовой — июнь и декабрь, годовой — декабрь', () => {
    expect(reportMonth({ period: 'H', periodStart: '2026-01-01' })).toBe('2026-06');
    expect(reportMonth({ period: 'H', periodStart: '2026-07-01' })).toBe('2026-12');
    expect(reportMonth({ period: 'Y', periodStart: '2025-01-01' })).toBe('2025-12');
  });

  it('отчёт по событию — месяц события', () => {
    expect(reportMonth({ period: 'M', periodStart: '2026-08-01', eventDate: '2026-08-17' })).toBe(
      '2026-08',
    );
  });
});

describe('monthPlanItem — что по отчёту нужно сделать', () => {
  it('«Сдача + уплата» с суммой без оплаты: сдать и уплатить, осталась вся сумма', () => {
    const x = monthPlanItem(report(), { taxpay: true });
    expect(x).toMatchObject({
      submit: true,
      pay: true,
      submitDone: false,
      payDone: false,
      noAmount: false,
      amount: 500_000,
      paid: 0,
      left: 500_000,
      late: false,
      when: '2026-11-25',
    });
  });

  it('«Сдача»: платить нечего, сдан — строка закрыта', () => {
    const x = monthPlanItem(
      report({ act: 'sub', amount: null, payDue: null, status: 'submitted' }),
      {
        taxpay: true,
      },
    );
    expect(x).toMatchObject({
      submit: true,
      pay: false,
      submitDone: true,
      payDone: true,
      amount: 0,
    });
  });

  it('«Уплата»: сдавать нечего, закрывает полная оплата', () => {
    const open = monthPlanItem(report({ act: 'pay', paid: 100_000 }), { taxpay: true });
    expect(open).toMatchObject({ submit: false, submitDone: true, pay: true, payDone: false });
    expect(open.left).toBe(400_000);
    const done = monthPlanItem(report({ act: 'pay', paid: 500_000 }), { taxpay: true });
    expect(done.payDone).toBe(true);
    expect(done.left).toBe(0);
  });

  it('сумма не указана — тоже «уплатить», с отметкой «без суммы»; сумма 0 — платить нечего', () => {
    const none = monthPlanItem(report({ amount: null }), { taxpay: true });
    expect(none).toMatchObject({ pay: true, payDone: false, noAmount: true, amount: 0, left: 0 });
    const zero = monthPlanItem(report({ amount: 0 }), { taxpay: true });
    expect(zero).toMatchObject({ pay: false, payDone: true, noAmount: false });
  });

  it('без «Учёта оплаты налогов» оплата не отмечается: строку закрывает сдача', () => {
    const x = monthPlanItem(report({ status: 'submitted' }), { taxpay: false });
    expect(x).toMatchObject({ pay: true, payDone: true, submitDone: true, amount: 500_000 });
  });

  it('переплата не даёт «оплачено» больше суммы', () => {
    const x = monthPlanItem(report({ paid: 700_000 }), { taxpay: true });
    expect(x).toMatchObject({ paid: 500_000, left: 0, payDone: true });
  });

  it('«когда» — ближайший срок несделанного: сдан, но не оплачен — срок оплаты', () => {
    const x = monthPlanItem(
      report({ status: 'submitted', dueDate: '2026-11-20', payDue: '2026-11-25' }),
      { taxpay: true },
    );
    expect(x.when).toBe('2026-11-25');
    const both = monthPlanItem(report({ dueDate: '2026-11-20', payDue: '2026-11-15' }), {
      taxpay: true,
    });
    expect(both.when).toBe('2026-11-15');
  });

  it('просрочка сдачи или оплаты — «просрочено»', () => {
    expect(monthPlanItem(report({ overdue: true }), { taxpay: true }).late).toBe(true);
    expect(monthPlanItem(report({ payOverdue: true }), { taxpay: true }).late).toBe(true);
  });
});

describe('monthPlan — месяцы от старых к новым, внутри — от ближайшего срока', () => {
  const reports: MonthPlanReport[] = [
    report({ id: 'nds-10', dueDate: '2026-11-25', payDue: '2026-11-25' }),
    report({ id: 'sf-10', dueDate: '2026-11-20', payDue: '2026-11-20', amount: null }),
    report({
      id: 'en-q3',
      period: 'Q',
      periodStart: '2026-07-01',
      dueDate: '2026-10-20',
      payDue: '2026-10-20',
      status: 'submitted',
      amount: 300_000,
      paid: 300_000,
    }),
    report({
      id: 't1-09',
      act: 'sub',
      periodStart: '2026-09-01',
      dueDate: '2026-10-12',
      payDue: null,
      amount: null,
      overdue: true,
    }),
    report({ id: 'old', superseded: true }),
    report({ id: 'skip', status: 'not_required' }),
  ];

  it('прежние версии и «Не требуется» в план не входят', () => {
    expect(inMonthPlan({ status: 'todo', superseded: true })).toBe(false);
    expect(inMonthPlan({ status: 'not_required' })).toBe(false);
    const ids = monthPlan(reports, { taxpay: true }).flatMap((g) =>
      g.items.map((x) => x.report.id),
    );
    expect(ids).toEqual(['t1-09', 'en-q3', 'sf-10', 'nds-10']);
  });

  it('квартальный отчёт стоит в последнем месяце квартала рядом с месячными', () => {
    const plan = monthPlan(reports, { taxpay: true });
    expect(plan.map((g) => g.month)).toEqual(['2026-09', '2026-10']);
    expect(plan[0]).toMatchObject({
      submitCount: 2,
      submitDone: 1,
      payCount: 1,
      payDone: 1,
      amount: 300_000,
      paid: 300_000,
      left: 0,
      late: 1,
      done: false,
      from: '2026-10-12',
      to: '2026-10-20',
    });
  });

  it('итог месяца: к уплате, осталось, без суммы, сроки', () => {
    const october = monthPlan(reports, { taxpay: true })[1];
    expect(october).toMatchObject({
      month: '2026-10',
      submitCount: 2,
      submitDone: 0,
      payCount: 2,
      payDone: 0,
      noAmount: 1,
      amount: 500_000,
      paid: 0,
      left: 500_000,
      late: 0,
      done: false,
      from: '2026-11-20',
      to: '2026-11-25',
    });
  });

  it('месяц закрыт, когда всё сдано и оплачено', () => {
    const plan = monthPlan(
      [
        report({ status: 'submitted', paid: 500_000 }),
        report({ id: 'r2', act: 'sub', status: 'submitted' }),
      ],
      { taxpay: true },
    );
    expect(plan[0]!.done).toBe(true);
  });

  it('при равном сроке — по порядку видов', () => {
    const order = (r: MonthPlanReport) => ['b', 'a'].indexOf(r.id);
    const plan = monthPlan([report({ id: 'a' }), report({ id: 'b' })], { taxpay: true, order });
    expect(plan[0]!.items.map((x) => x.report.id)).toEqual(['b', 'a']);
  });

  it('пустой месяц: сроков нет, месяц закрыт', () => {
    expect(monthPlanGroup('2026-10', [])).toMatchObject({
      items: [],
      done: true,
      from: null,
      to: null,
    });
  });
});

describe('monthPlanQuick — «Все / Сдать / Уплатить»', () => {
  it('«Сдать» — несданные, кроме «Уплаты»', () => {
    expect(monthPlanQuick(report(), 'sub')).toBe(true);
    expect(monthPlanQuick(report({ status: 'submitted' }), 'sub')).toBe(false);
    expect(monthPlanQuick(report({ act: 'pay' }), 'sub')).toBe(false);
  });

  it('«Уплатить» — без суммы или не оплачено полностью', () => {
    expect(monthPlanQuick(report({ amount: null }), 'pay')).toBe(true);
    expect(monthPlanQuick(report({ paid: 100 }), 'pay')).toBe(true);
    expect(monthPlanQuick(report({ paid: 500_000 }), 'pay')).toBe(false);
    expect(monthPlanQuick(report({ amount: 0 }), 'pay')).toBe(false);
    expect(monthPlanQuick(report({ act: 'sub' }), 'pay')).toBe(false);
    expect(monthPlanQuick(report({ status: 'not_required' }), 'all')).toBe(true);
  });
});

describe('currentPlanMonth — месяц, отчёты за который сдаются сейчас', () => {
  it('прошлый месяц, в январе — декабрь прошлого года', () => {
    expect(currentPlanMonth('2026-11-13')).toBe('2026-10');
    expect(currentPlanMonth('2027-01-05')).toBe('2026-12');
  });
});
