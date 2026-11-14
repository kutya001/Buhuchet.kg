import { describe, expect, it } from 'vitest';
import { monthPayList, monthPayText, monthToPay, PAY_MONTH_TEMPLATE } from './month-pay';
import { monthPlanGroup, monthPlanItem, type MonthPlanReport } from './month-plan';

// «К оплате клиенту» за месяц (доработки 13.11.2026, задача К4; прототип v94 modules/cp-telegram.js:
// rmToPay, rmPayList, rmPayText). Ответы на демо-данных сверяет month-plan-oracle.test.ts.

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

const pay = (reports: MonthPlanReport[], taxpay = true) =>
  monthToPay(
    monthPlanGroup(
      '2026-10',
      reports.map((r) => monthPlanItem(r, { taxpay })),
    ),
    { taxpay },
  );

describe('monthToPay — что клиенту оплатить за месяц', () => {
  it('налоги с остатком — от ближайшего срока оплаты; итог и срок', () => {
    const p = pay([
      report({ id: 'nds', amount: 500_000, paid: 120_000 }),
      report({ id: 'sf', amount: 87_050, payDue: '2026-11-20' }),
    ]);
    expect(p.rows.map((x) => [x.report.id, x.left, x.due])).toEqual([
      ['sf', 87_050, '2026-11-20'],
      ['nds', 380_000, '2026-11-25'],
    ]);
    expect(p).toMatchObject({ month: '2026-10', total: 467_050, noAmount: 0, due: '2026-11-20' });
  });

  it('оплаченный, с нулевой суммой и только «Сдача» не входят; без суммы — считаются отдельно', () => {
    const p = pay([
      report({ id: 'paid', paid: 500_000 }),
      report({ id: 'over', paid: 600_000 }),
      report({ id: 'zero', amount: 0 }),
      report({ id: 'sub', act: 'sub', amount: null }),
      report({ id: 'none', amount: null }),
      report({ id: 'one', amount: 10_000 }),
    ]);
    expect(p.rows.map((x) => x.report.id)).toEqual(['one']);
    expect(p).toMatchObject({ total: 10_000, noAmount: 1 });
  });

  it('платить нечего — строк и срока нет', () => {
    expect(pay([report({ paid: 500_000 })])).toMatchObject({ rows: [], total: 0, due: null });
    expect(pay([])).toMatchObject({ rows: [], total: 0, noAmount: 0, due: null });
  });

  it('без «Учёта оплаты налогов» входит вся сумма, даже у оплаченного', () => {
    const p = pay([report({ id: 'a', paid: 500_000 }), report({ id: 'b', paid: 100_000 })], false);
    expect(p.rows.map((x) => x.left)).toEqual([500_000, 500_000]);
    expect(p.total).toBe(1_000_000);
  });

  it('«Уплата» без срока оплаты — по сроку отчёта; при равном сроке — порядок плана или `tie`', () => {
    const reports = [
      report({ id: 'b', act: 'pay', payDue: null, dueDate: '2026-11-20' }),
      report({ id: 'a', payDue: '2026-11-20' }),
    ];
    expect(pay(reports).rows.map((x) => [x.report.id, x.due])).toEqual([
      ['b', '2026-11-20'],
      ['a', '2026-11-20'],
    ]);
    const group = monthPlanGroup(
      '2026-10',
      reports.map((r) => monthPlanItem(r, { taxpay: true })),
    );
    const tied = monthToPay(group, { taxpay: true, tie: (x, y) => (x.id < y.id ? -1 : 1) });
    expect(tied.rows.map((x) => x.report.id)).toEqual(['a', 'b']);
  });
});

describe('текст «Скопировать для клиента» (шаблон waPayMonth)', () => {
  const lines = [
    { name: 'Соцфонд', left: 87_050, due: '2026-11-20' as const },
    { name: 'НДС', left: 380_000, due: '2026-11-25' as const },
  ];

  it('список налогов: название, остаток и срок через запятую', () => {
    expect(monthPayList(lines)).toBe(
      'Соцфонд — 870,50 сом (до 20.11.2026), НДС — 3 800 сом (до 25.11.2026)',
    );
  });

  it('подстановки шаблона; без реквизита — «—»', () => {
    const values = {
      contractor: 'ОсОО «Ала-Тоо Трейд»',
      month: '2026-10' as const,
      lines,
      total: 467_050,
      due: '2026-11-20' as const,
    };
    expect(monthPayText(PAY_MONTH_TEMPLATE, { ...values, requisite: 'MBank 0555 123 456' })).toBe(
      'Уважаемые ОсОО «Ала-Тоо Трейд»! Налоги к оплате за октябрь 2026: Соцфонд — 870,50 сом (до 20.11.2026), НДС — 3 800 сом (до 25.11.2026). Итого — 4 670,50 сом. Просим перечислить до 20.11.2026 на: MBank 0555 123 456',
    );
    expect(monthPayText('{месяц}: {сумма} на {реквизиты}', { ...values, requisite: null })).toBe(
      'октябрь 2026: 4 670,50 сом на —',
    );
    // Метка в названии контрагента не заменяется, «$» остаётся, неизвестная метка — как в шаблоне.
    expect(
      monthPayText('{контрагент} — {реквизиты} {итого}', {
        ...values,
        contractor: 'ОсОО «{реквизиты} $& $$»',
        requisite: 'счёт $1',
      }),
    ).toBe('ОсОО «{реквизиты} $& $$» — счёт $1 {итого}');
  });
});
