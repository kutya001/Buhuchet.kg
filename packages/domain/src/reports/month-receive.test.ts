import { describe, expect, it } from 'vitest';
import { monthPlan, type MonthPlanReport } from './month-plan';
import {
  allocateInOrder,
  monthReceiveOffer,
  monthReceivePlan,
  receiveLeft,
  receiveMonths,
} from './month-receive';

// «Принять деньги» за месяц и за весь период (доработки 14.11.2026, блок 5; прототип v110
// modules/report-months.js: rmRecvLeft, rmRecvMonths, rmRecvPlan, rmRecvWhy; modules/contractors.js:
// inDlg, reAlloc). Суммы — тыйыны.

type Row = MonthPlanReport & { received: number };

const report = (over: Partial<Row> = {}): Row => ({
  id: 'r1',
  act: 'both',
  status: 'todo',
  period: 'M',
  periodStart: '2026-09-01',
  eventDate: null,
  dueDate: '2026-10-25',
  payDue: '2026-10-25',
  amount: 500_000,
  paid: 0,
  overdue: false,
  payOverdue: false,
  received: 0,
  ...over,
});

const plan = (rows: Row[]) => monthPlan(rows, { taxpay: true });
const received = (r: Row) => r.received;

describe('receiveLeft — сколько ещё принять по отчёту (прототип rmRecvLeft)', () => {
  it('к уплате минус большее из оплаченного и полученного; не меньше нуля', () => {
    expect(receiveLeft(500_000, 0, 0)).toBe(500_000);
    expect(receiveLeft(500_000, 120_000, 0)).toBe(380_000);
    expect(receiveLeft(500_000, 120_000, 200_000)).toBe(300_000);
    expect(receiveLeft(500_000, 300_000, 200_000)).toBe(200_000);
    expect(receiveLeft(500_000, 0, 600_000)).toBe(0);
  });
});

describe('monthReceivePlan — распределение от старых месяцев к новым', () => {
  it('месяцы от старых к новым, внутри месяца — по сроку оплаты; частичная оплата и полученное учтены', () => {
    const groups = plan([
      report({ id: 'oct-nds', periodStart: '2026-10-01', payDue: '2026-11-25', amount: 300_000 }),
      report({ id: 'sep-nds', amount: 500_000, paid: 120_000 }),
      report({ id: 'sep-sf', payDue: '2026-10-15', amount: 87_050, received: 50_000 }),
      report({ id: 'oct-sf', periodStart: '2026-10-01', payDue: '2026-11-15', amount: 10_000 }),
    ]);
    const p = monthReceivePlan(groups, { received });
    expect(p.lines.map((x) => [x.report.id, x.amount])).toEqual([
      ['sep-sf', 37_050],
      ['sep-nds', 380_000],
      ['oct-sf', 10_000],
      ['oct-nds', 300_000],
    ]);
    expect(p.total).toBe(727_050);
  });

  it('уже полученные, оплаченные, без суммы, с нулевой суммой и «только сдача» не входят', () => {
    const p = monthReceivePlan(
      plan([
        report({ id: 'got', received: 500_000 }),
        report({ id: 'paid', paid: 500_000 }),
        report({ id: 'none', amount: null }),
        report({ id: 'zero', amount: 0 }),
        report({ id: 'sub', act: 'sub', amount: null }),
        report({ id: 'one', amount: 10_000 }),
      ]),
      { received },
    );
    expect(p.lines.map((x) => x.report.id)).toEqual(['one']);
    expect(p.total).toBe(10_000);
  });

  it('при равном сроке оплаты — по `tie`; без срока оплаты — по сроку сдачи', () => {
    const groups = plan([
      report({ id: 'b', amount: 1_000 }),
      report({ id: 'a', amount: 2_000 }),
      report({ id: 'early', payDue: null, dueDate: '2026-10-10', amount: 3_000 }),
    ]);
    const tie = (x: Row, y: Row) => x.id.localeCompare(y.id);
    expect(monthReceivePlan(groups, { received, tie }).lines.map((x) => x.report.id)).toEqual([
      'early',
      'a',
      'b',
    ]);
  });
});

describe('receiveMonths и monthReceiveOffer — кнопка «Принять деньги» (прототип rmRecvBtn, rmRecvWhy)', () => {
  const rows = [
    report({ id: 'sep', amount: 500_000 }),
    report({ id: 'oct', periodStart: '2026-10-01', payDue: '2026-11-25', amount: 200_000 }),
    // Ноябрь: суммы ещё не рассчитаны, неоплаченного нет — в период не входит и кнопку не запирает.
    report({ id: 'nov', periodStart: '2026-11-01', payDue: '2026-12-25', amount: null }),
  ];

  it('весь период — месяцы с неоплаченным остатком; будущий месяц без суммы не запирает', () => {
    const groups = plan(rows);
    expect(receiveMonths(groups, 'all').map((g) => g.month)).toEqual(['2026-09', '2026-10']);
    const offer = monthReceiveOffer(groups, 'all', { received });
    expect(offer).toMatchObject({
      scope: 'all',
      months: ['2026-09', '2026-10'],
      total: 700_000,
      refusal: null,
    });
    expect(offer!.lines.map((x) => x.report.id)).toEqual(['sep', 'oct']);
  });

  it('за месяц — только его отчёты; месяца без остатка нет — кнопки нет', () => {
    const groups = plan(rows);
    expect(monthReceiveOffer(groups, '2026-10', { received })).toMatchObject({
      months: ['2026-10'],
      total: 200_000,
      refusal: null,
    });
    expect(monthReceiveOffer(groups, '2026-11', { received })).toBeNull();
    expect(monthReceiveOffer(plan([report({ paid: 500_000 })]), 'all', { received })).toBeNull();
  });

  it('у отчёта месяца с остатком нет суммы — заперто: за месяц названы отчёты, за период — месяцы', () => {
    const groups = plan([
      ...rows,
      report({ id: 'sep-none', amount: null }),
      report({ id: 'oct-none', periodStart: '2026-10-01', amount: null }),
    ]);
    const month = monthReceiveOffer(groups, '2026-09', { received });
    expect(month!.refusal).toMatchObject({ code: 'no_amount', months: ['2026-09'] });
    expect(month!.refusal?.code === 'no_amount' && month!.refusal.reports.map((r) => r.id)).toEqual(
      ['sep-none'],
    );
    expect(monthReceiveOffer(groups, 'all', { received })!.refusal).toMatchObject({
      code: 'no_amount',
      months: ['2026-09', '2026-10'],
    });
  });

  it('деньги на налоги уже получены от контрагента — заперто, хотя в бюджет ещё не оплачено', () => {
    const groups = plan([report({ received: 500_000 })]);
    expect(monthReceiveOffer(groups, '2026-09', { received })).toMatchObject({
      lines: [],
      total: 0,
      refusal: { code: 'received' },
    });
    expect(monthReceiveOffer(groups, 'all', { received })!.refusal).toEqual({ code: 'received' });
  });
});

describe('allocateInOrder — распределение заново после правки общей суммы (прототип reAlloc)', () => {
  const lines = [
    { id: 'sep', amount: 380_000 },
    { id: 'oct', amount: 200_000 },
    { id: 'nov', amount: 10_000 },
  ];
  const ids = (total: number | null) =>
    allocateInOrder(lines, total).map((x) => [x.line.id, x.amount]);

  it('меньше итога — старые месяцы закрываются первыми, остальное пропадает', () => {
    expect(ids(450_000)).toEqual([
      ['sep', 380_000],
      ['oct', 70_000],
    ]);
  });

  it('больше итога — всё распределено, излишек остаётся авансом', () => {
    expect(ids(1_000_000)).toEqual([
      ['sep', 380_000],
      ['oct', 200_000],
      ['nov', 10_000],
    ]);
  });

  it('пусто, ноль или меньше нуля — ничего не распределено', () => {
    expect(ids(null)).toEqual([]);
    expect(ids(0)).toEqual([]);
    expect(ids(-5)).toEqual([]);
  });
});
