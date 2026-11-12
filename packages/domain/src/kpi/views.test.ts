import { describe, expect, it } from 'vitest';
import type { KpiBook, KpiContractor, KpiIndicator, KpiTarget } from './fill';
import {
  cardRows,
  cellState,
  columnTotals,
  gridMonths,
  gridRows,
  KPI_GRID_MAX_MONTHS,
  monthCells,
  monthContractors,
  offSince,
  periodRows,
  type KpiValueOf,
} from './views';

const indicator = (id: string, extra: Partial<KpiIndicator> = {}): KpiIndicator => ({
  id,
  required: true,
  dueDay: 10,
  start: '2026-01',
  archived: false,
  scope: 'all',
  autoNew: true,
  order: Number(id.slice(1)),
  ...extra,
});

const contractor = (id: string, extra: Partial<KpiContractor> = {}): KpiContractor => ({
  id,
  oneOff: false,
  archived: false,
  periods: [{ from: '2025-06', to: null }],
  ...extra,
});

function bookOf(
  indicators: KpiIndicator[],
  targets: Record<string, KpiTarget> = {},
  values: Record<string, number> = {},
): { book: KpiBook; valueOf: KpiValueOf } {
  const valueOf: KpiValueOf = (c, i, m) => values[`${c}|${i}|${m}`] ?? null;
  return {
    book: {
      indicators,
      target: (i, c) => targets[`${i}|${c}`],
      hasValue: (c, i, m) => valueOf(c, i, m) !== null,
    },
    valueOf,
  };
}

describe('ячейки «Ввода за месяц»', () => {
  // п. 44 приёмки: «Выбранным», отмечены только контрагенты на ОНР — у остальных ячейка серая.
  const revenue = indicator('k1', { scope: 'selected', autoNew: true });
  const onr = contractor('c1');
  const single = contractor('c2');
  const fresh = contractor('c3');
  const { book, valueOf } = bookOf([revenue, indicator('k2', { required: false })], {
    'k1|c1': { on: true, from: null, offSince: null },
    'k1|c2': { on: false, from: null, offSince: '2026-08' },
  });

  it('отмеченный — требуется, снятый — серая ячейка с «Не ведётся с …», новый — по «автоматически»', () => {
    expect(cellState(book, revenue, onr, '2026-09')).toBe('required');
    expect(cellState(book, revenue, single, '2026-09')).toBe('off');
    expect(offSince(revenue, book, 'c2')).toBe('2026-08');
    expect(offSince(revenue, book, 'c1')).toBeNull();
    expect(cellState(book, revenue, fresh, '2026-09')).toBe('required');
  });

  it('месяц раньше «с <месяц>» — необязательная ячейка, а без показателей контрагента в «Вводе» нет', () => {
    expect(cellState(book, revenue, onr, '2025-12')).toBe('early');
    const cells = monthCells(book, onr, '2025-12', valueOf);
    expect(cells.map((c) => [c.indicatorId, c.state, c.start])).toEqual([
      ['k1', 'early', '2026-01'],
      ['k2', 'early', '2026-01'],
    ]);
    expect(
      monthContractors(book, [onr, single, contractor('c4', { oneOff: true })], '2026-09'),
    ).toEqual([onr, single]);
  });

  it('у разового и архивного ячеек для ввода нет', () => {
    expect(cellState(book, revenue, contractor('c5', { oneOff: true }), '2026-09')).toBe('off');
    expect(cellState(book, revenue, contractor('c6', { archived: true }), '2026-09')).toBe('off');
  });
});

describe('«За период» и вкладка «Показатели» карточки', () => {
  const revenue = indicator('k1');
  const staff = indicator('k2', { required: false });
  const old = indicator('k3', { archived: true });
  const months = ['2026-07', '2026-08', '2026-09'];
  const { book, valueOf } = bookOf(
    [revenue, staff, old],
    { 'k2|c1': { on: false, from: null, offSince: '2026-09' } },
    {
      'c1|k1|2026-07': 10_000_000,
      'c1|k1|2026-08': 15_000_000,
      'c1|k1|2026-09': 20_000_000,
      'c1|k2|2026-07': 500,
      'c1|k3|2026-08': 100,
    },
  );

  it('п. 22: итоги по трём месяцам — сумма, среднее, максимум, минимум', () => {
    const [row] = periodRows(book, [contractor('c1')], months, valueOf);
    expect(row).toMatchObject({
      indicatorId: 'k1',
      need: 3,
      totals: { count: 3, sum: 45_000_000, avg: 15_000_000, max: 20_000_000, min: 10_000_000 },
    });
  });

  it('п. 23: пустой месяц не ноль — среднее по заполненным, «по 1 из 2»', () => {
    const { book: b, valueOf: v } = bookOf([revenue], {}, { 'c1|k1|2026-08': 10_000 });
    const [row] = periodRows(b, [contractor('c1')], ['2026-08', '2026-09'], v);
    expect(row!.values).toEqual([10_000, null]);
    expect(row!.need).toBe(2);
    expect(row!.totals).toMatchObject({ count: 1, avg: 10_000 });
  });

  it('выключенный и архивный показатель видны, пока за период есть значения', () => {
    const rows = periodRows(
      book,
      [contractor('c1'), contractor('c2', { oneOff: true })],
      months,
      valueOf,
    );
    expect(rows.map((r) => [r.indicatorId, r.need, r.offSince])).toEqual([
      ['k1', 3, null],
      ['k2', 0, '2026-09'],
      ['k3', 0, null],
    ]);
    const empty = periodRows(book, [contractor('c1')], ['2026-10'], valueOf);
    expect(empty.map((r) => r.indicatorId)).toEqual(['k1']);
  });

  it('карточка: ведущиеся показатели и те, по которым есть значения', () => {
    expect(
      cardRows(book, contractor('c1'), ['2026-10'], valueOf).map((r) => r.indicatorId),
    ).toEqual(['k1']);
    expect(cardRows(book, contractor('c1'), months, valueOf).map((r) => r.indicatorId)).toEqual([
      'k1',
      'k2',
      'k3',
    ]);
    expect(cardRows(book, contractor('c9', { archived: true }), months, valueOf)).toEqual([]);
  });

  it('итоги столбца «Ввода за месяц» — по заполненным из всех строк, без невключённых (В-7)', () => {
    const on = (value: number | null) => ({ value, state: 'required' as const });
    expect(columnTotals([on(100), on(null), on(300)])).toMatchObject({
      count: 2,
      sum: 400,
      avg: 200,
      of: 3,
    });
    expect(columnTotals([on(null)])).toEqual({ count: 0, of: 1 });
    // Значение выключенного у контрагента показателя в итоги не входит и в «из N» не считается.
    expect(
      columnTotals([on(100), { value: 900, state: 'off' }, { value: 50, state: 'early' }]),
    ).toMatchObject({ count: 2, sum: 150, of: 2 });
  });
});

describe('(v80) «Ввод по месяцам»', () => {
  const revenue = indicator('k1');
  const staff = indicator('k2', { start: '2026-09' });
  const old = indicator('k3', { archived: true });
  const onr = contractor('c1');
  const off = contractor('c2');
  const once = contractor('c3', { oneOff: true });
  const { book, valueOf } = bookOf(
    [revenue, staff, old],
    {
      'k1|c2': { on: false, from: null, offSince: '2026-07' },
      'k2|c2': { on: false, from: null, offSince: null },
    },
    { 'c2|k1|2026-06': 700, 'c1|k3|2026-08': 5 },
  );

  it('период: «с» позже «по» — местами; длиннее 24 месяцев — последние 24', () => {
    expect(gridMonths('2026-03', '2026-01')).toEqual({
      from: '2026-01',
      to: '2026-03',
      months: ['2026-01', '2026-02', '2026-03'],
      cut: false,
    });
    const long = gridMonths('2020-01', '2026-08');
    expect(long.cut).toBe(true);
    expect(long.months).toHaveLength(KPI_GRID_MAX_MONTHS);
    expect([long.months[0], long.months.at(-1)]).toEqual(['2024-09', '2026-08']);
    expect(gridMonths('2024-09', '2026-08').cut).toBe(false);
  });

  it('строки — контрагент × действующий показатель: ведётся хоть в одном месяце или есть значения', () => {
    const rows = gridRows(book, [onr, off, once], ['2026-06', '2026-07', '2026-08'], valueOf);
    // Архивный показатель — не в таблице, разовый контрагент — тоже; у c2 «Выручка» выключена, но есть значение.
    expect(rows.map((r) => [r.contractorId, r.indicatorId])).toEqual([
      ['c1', 'k1'],
      ['c1', 'k2'],
      ['c2', 'k1'],
    ]);
    expect(rows[0]!.states).toEqual(['required', 'required', 'required']);
    // «с 09.2026»: раньше — необязательно.
    expect(rows[1]).toMatchObject({ states: ['early', 'early', 'early'], start: '2026-09' });
    expect(rows[2]).toMatchObject({
      values: [700, null, null],
      states: ['off', 'off', 'off'],
      offSince: '2026-07',
    });
  });
});
