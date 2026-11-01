import { describe, expect, it } from 'vitest';
import {
  chartAxisLabel,
  chartStep,
  revenueGridRows,
  revenueLastMonth,
  revenueOverview,
  revenueRows,
  revenueYears,
  type RevenueContractor,
  type RevenuePayment,
} from './analytics';
import { HOME_PLATES, homePlateTarget, progressPercent } from './home';

const ctx = {
  week: { from: '2026-10-26', to: '2026-11-01' },
  today: '2026-10-28',
  tasksAll: false,
};

describe('Плашки «Сводки» открывают список с тем же фильтром (прототип renderHome → onclick)', () => {
  it('«Просрочено отчётов» и «Просрочено оплат» — «Просрочено» с фильтром «Просрочка»', () => {
    expect(homePlateTarget('ovr', ctx)).toEqual({
      module: 'reports',
      tab: 'overdue',
      filters: { overdue: { type: 'enum', vals: ['sub', 'both'] } },
    });
    expect(homePlateTarget('ovp', ctx).filters).toEqual({
      overdue: { type: 'enum', vals: ['pay', 'both'] },
    });
  });

  it('«Сдать» и «Оплатить на этой неделе» — «На неделе» со сроком недели; оплатить — с суммой от 0,01', () => {
    expect(homePlateTarget('wks', ctx)).toEqual({
      module: 'reports',
      tab: 'week',
      filters: {
        status: { type: 'enum', vals: ['todo', 'in_progress', 'needs_fix'] },
        due: { type: 'date', from: '2026-10-26', to: '2026-11-01' },
      },
    });
    expect(homePlateTarget('wkp', ctx)).toEqual({
      module: 'reports',
      tab: 'week',
      filters: {
        paymentStatus: { type: 'enum', vals: ['unpaid', 'partial'] },
        payDue: { type: 'date', from: '2026-10-26', to: '2026-11-01' },
        amount: { type: 'num', from: 1 },
      },
    });
  });

  it('«Ожидают подтверждения» и «Не заполнены показатели» — свои вкладки без фильтра', () => {
    expect(homePlateTarget('wait', ctx)).toEqual({
      module: 'reports',
      tab: 'waiting',
      filters: {},
    });
    expect(homePlateTarget('kmiss', ctx)).toEqual({ module: 'kpi', tab: 'missing', filters: {} });
  });

  it('«Ждут подтверждения» — «Задачи» → «Все» с правом «Видеть задачи всех», иначе «Мои»', () => {
    const pending = { status: { type: 'enum', vals: ['on_confirm'] } };
    expect(homePlateTarget('tpend', ctx)).toEqual({
      module: 'tasks',
      tab: 'mine',
      filters: pending,
    });
    expect(homePlateTarget('tpend', { ...ctx, tasksAll: true }).tab).toBe('all');
  });

  it('«Мои задачи на сегодня» — открытые мои со сроком не позже сегодня', () => {
    expect(homePlateTarget('tsk', ctx)).toEqual({
      module: 'tasks',
      tab: 'mine',
      filters: {
        date: { type: 'date', from: null, to: '2026-10-28' },
        open: { type: 'enum', vals: ['yes'] },
      },
    });
  });

  it('у каждой плашки есть список', () => {
    for (const p of HOME_PLATES) expect(homePlateTarget(p, ctx).module).toBeTruthy();
  });

  it('полоса «сдано»: доля в процентах, без отчётов — 0', () => {
    expect(progressPercent({ done: 1, all: 3 })).toBe(33);
    expect(progressPercent({ done: 0, all: 0 })).toBe(0);
  });
});

const cp = (over: Partial<RevenueContractor> & { id: string }): RevenueContractor => ({
  name: over.id,
  responsible: null,
  oneOff: false,
  archived: false,
  charges: [],
  feeDebt: 0,
  serviceDebt: 0,
  ...over,
});

describe('Выручка по контрагентам (прототип revenueData, renderAnalytics)', () => {
  const contractors = [
    cp({
      id: 'a',
      responsible: 'Иванова А.',
      charges: [
        { month: '2025-12', charge: 500_000 },
        { month: '2026-09', charge: 500_000 },
        { month: '2026-10', charge: 500_000 },
      ],
      feeDebt: 200_000,
    }),
    cp({ id: 'b', oneOff: true, charges: [{ month: '2026-10', charge: 99 }], serviceDebt: 30_000 }),
    cp({ id: 'c', archived: true, feeDebt: 70_000 }),
    cp({ id: 'd' }),
  ];
  const payments: RevenuePayment[] = [
    { contractorId: 'a', kind: 'fee', date: '2026-09-10', amount: 500_000 },
    { contractorId: 'a', kind: 'fee', date: '2026-10-05', amount: 300_000 },
    { contractorId: 'a', kind: 'proj', date: '2026-10-20', amount: 1_000_000 },
    { contractorId: 'b', kind: 'svc', date: '2026-03-01', amount: 200_000 },
    { contractorId: 'a', kind: 'fee', date: '2025-10-01', amount: 400_000 },
    { contractorId: 'c', kind: 'fee', date: '2025-03-01', amount: 100_000 },
    // Чужой контрагент (вне области) — не считается.
    { contractorId: 'x', kind: 'fee', date: '2026-10-01', amount: 9_999_999 },
  ];
  const today = '2026-10-28';
  const rows = revenueRows(contractors, payments, 2026, today);
  const prev = revenueRows(contractors, payments, 2025, today);

  it('оплаты — по видам и месяцам года; начислено — за месяцы года; долг — обслуживание и услуги', () => {
    const a = rows.find((r) => r.id === 'a')!;
    expect(a).toMatchObject({
      feeCh: 1_000_000,
      fee: 800_000,
      proj: 1_000_000,
      svc: 0,
      total: 1_800_000,
      debt: 200_000,
    });
    expect(a.months[8]).toEqual([500_000, 0, 0]);
    expect(a.months[9]).toEqual([300_000, 1_000_000, 0]);
    // У разового контрагента начислений за обслуживание нет.
    expect(rows.find((r) => r.id === 'b')).toMatchObject({ feeCh: 0, svc: 200_000, debt: 30_000 });
    expect(prev.find((r) => r.id === 'a')).toMatchObject({ feeCh: 500_000, fee: 400_000 });
  });

  it('последний наступивший месяц: текущий в текущем году, иначе декабрь', () => {
    expect(revenueLastMonth(2026, today)).toBe('2026-10');
    expect(revenueLastMonth(2025, today)).toBe('2025-12');
    expect(revenueYears(today)).toEqual([2026, 2025]);
  });

  it('список — только с выручкой, начислениями, долгом или выручкой в прошлом году; доля и изменение', () => {
    const grid = revenueGridRows(rows, prev);
    expect(grid.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    const a = grid.find((r) => r.id === 'a')!;
    // 1 800 000 из 2 000 000 — 90 %; к прошлому году 400 000 → +350 %.
    expect(a).toMatchObject({ share: 90, prev: 400_000, change: 350 });
    expect(grid.find((r) => r.id === 'b')).toMatchObject({ share: 10, prev: 0, change: null });
    // Архивный с выручкой в прошлом году и долгом.
    expect(grid.find((r) => r.id === 'c')).toMatchObject({ total: 0, prev: 100_000, change: -100 });
    expect('months' in a).toBe(false);
  });

  it('итоги: начислено и оплачено %, доли видов, изменение к тому же периоду, топ, концентрация', () => {
    const o = revenueOverview(rows, prev, contractors, 2026, today);
    expect(o).toMatchObject({
      year: 2026,
      current: true,
      lastMonth: 9,
      feeCh: 1_000_000,
      fee: 800_000,
      proj: 1_000_000,
      svc: 200_000,
      total: 2_000_000,
      debt: 300_000,
      feePaidPercent: 80,
      shares: { fee: 40, proj: 50, svc: 10 },
      // Прошлый год по октябрь: 400 000 + 100 000 = 500 000 → +300 %.
      change: 300,
      paid: 2,
      top5Percent: 100,
      average: 1_000_000,
      // Архивный не входит в «Долг за обслуживание сейчас».
      feeDebt: 200_000,
    });
    expect(o.months[9]).toEqual([300_000, 1_000_000, 0]);
    expect(o.months[2]).toEqual([0, 0, 200_000]);
    expect(o.prevMonths[9]).toBe(400_000);
    expect(o.prevMonths[2]).toBe(100_000);
    expect(o.top.map((t) => t.id)).toEqual(['a', 'b']);
    expect(o.top[0]).toEqual({
      id: 'a',
      name: 'a',
      fee: 800_000,
      proj: 1_000_000,
      svc: 0,
      total: 1_800_000,
    });
  });

  it('пустой год: долей и изменения нет, нули', () => {
    const o = revenueOverview(
      revenueRows([], [], 2025, today),
      revenueRows([], [], 2024, today),
      [],
      2025,
      today,
    );
    expect(o).toMatchObject({
      current: false,
      lastMonth: 11,
      total: 0,
      feePaidPercent: 0,
      shares: null,
      change: null,
      paid: 0,
      top5Percent: 0,
      average: 0,
      top: [],
    });
  });

  it('сетка графика и подписи оси (прототип niceStep, kSom)', () => {
    expect(chartStep(0)).toBe(1);
    expect(chartStep(100)).toBe(25);
    expect(chartStep(1_000)).toBe(250);
    expect(chartStep(30_000)).toBe(10_000);
    expect(chartStep(170_000)).toBe(50_000);
    expect(chartStep(500)).toBe(200);
    expect(chartAxisLabel(1_500_000)).toEqual({ n: '1,5', unit: 'mln' });
    expect(chartAxisLabel(2_000_000)).toEqual({ n: '2', unit: 'mln' });
    expect(chartAxisLabel(25_000)).toEqual({ n: '25', unit: 'k' });
    expect(chartAxisLabel(250)).toEqual({ n: '250', unit: null });
  });
});
