import { describe, expect, it } from 'vitest';
import type { KpiBook, KpiContractor, KpiIndicator, KpiTarget } from './fill';
import {
  cardRows,
  cellState,
  columnTotals,
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
    expect(monthContractors(book, [onr, single, contractor('c4', { oneOff: true })], '2026-09'))
      .toEqual([onr, single]);
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
    const rows = periodRows(book, [contractor('c1'), contractor('c2', { oneOff: true })], months, valueOf);
    expect(rows.map((r) => [r.indicatorId, r.need, r.offSince])).toEqual([
      ['k1', 3, null],
      ['k2', 0, '2026-09'],
      ['k3', 0, null],
    ]);
    const empty = periodRows(book, [contractor('c1')], ['2026-10'], valueOf);
    expect(empty.map((r) => r.indicatorId)).toEqual(['k1']);
  });

  it('карточка: ведущиеся показатели и те, по которым есть значения', () => {
    expect(cardRows(book, contractor('c1'), ['2026-10'], valueOf).map((r) => r.indicatorId)).toEqual(
      ['k1'],
    );
    expect(cardRows(book, contractor('c1'), months, valueOf).map((r) => r.indicatorId)).toEqual([
      'k1',
      'k2',
      'k3',
    ]);
    expect(cardRows(book, contractor('c9', { archived: true }), months, valueOf)).toEqual([]);
  });

  it('итоги столбца «Ввода за месяц» — по заполненным из всех строк', () => {
    expect(columnTotals([100, null, 300])).toMatchObject({ count: 2, sum: 400, avg: 200, of: 3 });
    expect(columnTotals([null])).toEqual({ count: 0, of: 1 });
  });
});
