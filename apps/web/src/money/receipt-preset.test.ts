import { describe, expect, it } from 'vitest';
import { presetLines, reallocate } from './receipt-preset';

// Окно «Поступление от контрагента» с распределением «за месяц» и «за весь период» (доработки
// 14.11.2026, блок 5; прототип v110 modules/contractors.js: inDlg с pre.list, reAlloc).

/** Сумма на экране — с неразрывным пробелом между разрядами: в сравнении — обычный. */
const plain = (alloc: Record<string, string>) =>
  Object.fromEntries(Object.entries(alloc).map(([k, v]) => [k, v.replace(/\s/g, ' ')]));

const preset = {
  list: [
    { reportId: 'sep', amount: 380_000 },
    { reportId: 'oct', amount: 200_000 },
    { reportId: 'gone', amount: 5_000 },
  ],
  note: 'Деньги за весь период: сентябрь 2026, октябрь 2026',
};

describe('presetLines — что окно распределяет сразу', () => {
  it('отчёты, которые ещё ждут денег, — не больше их остатка в форме; порядок списка', () => {
    const rows = [
      { reportId: 'oct', left: 200_000 },
      { reportId: 'sep', left: 300_000 },
    ];
    expect(presetLines(preset, rows)).toEqual([
      { reportId: 'sep', amount: 300_000 },
      { reportId: 'oct', amount: 200_000 },
    ]);
  });

  it('один отчёт («Принять деньги» у отчёта) и без распределения — список пуст', () => {
    expect(presetLines({ reportId: 'sep', amount: 100 }, [{ reportId: 'sep', left: 100 }])).toEqual(
      [],
    );
    expect(presetLines(null, [])).toEqual([]);
    expect(presetLines(preset, [{ reportId: 'sep', left: 0 }])).toEqual([]);
  });
});

describe('reallocate — правка общей суммы пересчитывает распределение', () => {
  const lines = [
    { reportId: 'sep', amount: 380_000 },
    { reportId: 'oct', amount: 200_000 },
  ];
  const start = { sep: '3 800', oct: '2 000', other: '100' };

  it('меньше — старый месяц первым, новый получает остаток', () => {
    expect(plain(reallocate(start, lines, '4 500'))).toEqual({
      sep: '3 800',
      oct: '700',
      other: '100',
    });
  });

  it('совсем мало — у нового месяца пусто; больше итога — излишек остаётся авансом', () => {
    expect(plain(reallocate(start, lines, '1 000,50'))).toEqual({ sep: '1 000,50', other: '100' });
    expect(plain(reallocate(start, lines, '10 000'))).toEqual({
      sep: '3 800',
      oct: '2 000',
      other: '100',
    });
  });

  it('пусто или не число — распределение списка снято, чужие строки остаются', () => {
    expect(reallocate(start, lines, '')).toEqual({ other: '100' });
    expect(reallocate(start, lines, 'abc')).toEqual({ other: '100' });
  });
});
