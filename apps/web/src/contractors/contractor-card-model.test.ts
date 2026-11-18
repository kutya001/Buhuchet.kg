import { describe, expect, it } from 'vitest';
import { hotPlates } from './contractor-card-model';

const ALL = new Set(['main', 'reports', 'money', 'fee']);

describe('hotPlates — маленькие карточки «что горит» на «Основном» (прототип v142)', () => {
  it('всё в порядке — карточек нет', () => {
    expect(hotPlates({ overdue: 0, owe: 0, avail: 0, feeDebt: 0, tabs: ALL })).toEqual([]);
    expect(hotPlates({ overdue: 0, owe: null, avail: null, feeDebt: null, tabs: ALL })).toEqual([]);
  });

  it('порядок: просрочено, осталось оплатить, на счёте, долг; каждая открывает свою вкладку', () => {
    const hot = hotPlates({
      overdue: 2,
      owe: 500_000,
      avail: 300_000,
      feeDebt: 1_000_000,
      tabs: ALL,
    });
    expect(hot.map((p) => [p.kind, p.tab, p.value])).toEqual([
      ['overdue', 'reports', 2],
      ['owe', 'money', 500_000],
      ['avail', 'money', 300_000],
      ['fee', 'fee', 1_000_000],
    ]);
    // Красные с красным числом — просрочка и долг за обслуживание.
    expect(hot.filter((p) => p.danger).map((p) => p.kind)).toEqual(['overdue', 'fee']);
  });

  it('«Осталось оплатить» больше, чем на счёте, — отметка «не хватает»; денег хватает — без неё', () => {
    const owe = (avail: number) =>
      hotPlates({ overdue: 0, owe: 500_000, avail, feeDebt: 0, tabs: ALL })[0];
    expect(owe(300_000)).toMatchObject({ kind: 'owe', short: true });
    expect(owe(500_000)).toMatchObject({ kind: 'owe', short: false });
  });

  it('нет вкладки — нет карточки: числа без права или функции не показываются', () => {
    const o = { overdue: 3, owe: 500_000, avail: 300_000, feeDebt: 1_000_000 };
    expect(hotPlates({ ...o, tabs: new Set(['main']) })).toEqual([]);
    expect(hotPlates({ ...o, tabs: new Set(['main', 'reports']) }).map((p) => p.kind)).toEqual([
      'overdue',
    ]);
    expect(hotPlates({ ...o, tabs: new Set(['main', 'fee']) }).map((p) => p.kind)).toEqual(['fee']);
  });
});
