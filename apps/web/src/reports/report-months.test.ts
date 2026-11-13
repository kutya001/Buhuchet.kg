import { defaultUiTexts, type MonthPlanReport } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  contractorPlan,
  monthDueText,
  monthPills,
  monthTitle,
  parseReportsMode,
  REPORTS_MODE_COOKIE,
  reportsModeCookie,
  type MonthTotals,
} from './report-months-model';

// «К сдаче и к оплате по месяцам» на экране (решение заказчика 13.11.2026, прототип v90
// modules/report-months.js: rmTitle, rmSumHtml, rmCardHtml).

const t = makeTranslate(defaultUiTexts());

/** Сумма на экране — с неразрывным пробелом между разрядами: в сравнении — обычный. */
const plain = (s: string) => s.replace(/\s/g, ' ');

const totals = (over: Partial<MonthTotals> = {}): MonthTotals => ({
  late: 0,
  submitCount: 0,
  submitDone: 0,
  amount: 0,
  left: 0,
  noAmount: 0,
  from: null,
  to: null,
  ...over,
});

type Row = MonthPlanReport & { type: { shortName: string } };

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  act: 'both',
  status: 'todo',
  period: 'M',
  periodStart: '2026-10-01',
  eventDate: null,
  dueDate: '2026-11-20',
  payDue: '2026-11-20',
  amount: 100_000,
  paid: 0,
  overdue: false,
  payOverdue: false,
  type: { shortName: 'НДС' },
  ...over,
});

describe('monthTitle — заголовок месяца', () => {
  it('«За октябрь 2026»: месяц строчными', () => {
    expect(monthTitle(t, '2026-10')).toBe('За октябрь 2026');
    expect(monthTitle(t, '2027-01')).toBe('За январь 2027');
  });
});

describe('monthPills — итог месяца одной строкой', () => {
  it('просрочка, сдача, сумма с остатком и «без суммы» — по порядку', () => {
    const pills = monthPills(
      t,
      totals({
        late: 2,
        submitCount: 5,
        submitDone: 3,
        amount: 5_219_000,
        left: 1_119_000,
        noAmount: 1,
      }),
      true,
    );
    expect(pills.map((p) => [p.key, p.tone, plain(p.text)])).toEqual([
      ['late', 'bad', 'просрочено 2'],
      ['submitted', 'info', 'сдано 3 из 5'],
      ['amount', 'violet', 'к уплате 52 190,00 · осталось 11 190,00'],
      ['no_amount', 'warn', 'без суммы 1'],
    ]);
    expect(pills[3]!.title).toBe('Сумма к уплате ещё не указана');
  });

  it('всё сдано и оплачено — зелёным; без «Учёта оплаты налогов» — только сумма', () => {
    const g = totals({ submitCount: 2, submitDone: 2, amount: 358_000, left: 0 });
    expect(monthPills(t, g, true).map((p) => [p.tone, plain(p.text)])).toEqual([
      ['ok', 'сдано 2 из 2'],
      ['ok', 'к уплате 3 580,00 · оплачено'],
    ]);
    expect(
      monthPills(t, { ...g, left: 358_000 }, false).map((p) => [p.tone, plain(p.text)]),
    ).toEqual([
      ['ok', 'сдано 2 из 2'],
      ['violet', 'к уплате 3 580,00'],
    ]);
  });

  it('пустой месяц — без меток', () => {
    expect(monthPills(t, totals(), true)).toEqual([]);
  });
});

describe('monthDueText — сроки месяца', () => {
  it('один срок, несколько сроков, сроков нет', () => {
    expect(monthDueText(t, { from: '2026-11-20', to: '2026-11-20' })).toBe('срок 20.11');
    expect(monthDueText(t, { from: '2026-11-20', to: '2026-11-25' })).toBe(
      'сроки 20.11–25.11.2026',
    );
    expect(monthDueText(t, { from: null, to: null })).toBe('');
  });
});

describe('contractorPlan — план вкладки «Отчёты к сдаче» карточки', () => {
  const rows: Row[] = [
    row('nds-10'),
    row('t1-10', { act: 'sub', amount: null, payDue: null, type: { shortName: '1-Т' } }),
    row('nds-09', {
      periodStart: '2026-09-01',
      dueDate: '2026-10-20',
      payDue: '2026-10-20',
      status: 'submitted',
      paid: 100_000,
    }),
    row('skip', { status: 'not_required' }),
    row('old', { superseded: true }),
  ];

  it('«Все»: закрытые месяцы — только по галочке; числа плашек и «Осталось оплатить»', () => {
    const plan = contractorPlan(rows, { taxpay: true, quick: 'all', showClosed: false });
    expect(plan.none).toBe(false);
    expect(plan.months.map((g) => g.month)).toEqual(['2026-10']);
    expect(plan.closed).toBe(1);
    expect(plan.left).toBe(100_000);
    expect(plan.counts).toEqual({ all: 3, sub: 2, pay: 1 });
    const withClosed = contractorPlan(rows, { taxpay: true, quick: 'all', showClosed: true });
    expect(withClosed.months.map((g) => g.month)).toEqual(['2026-09', '2026-10']);
  });

  it('при равном сроке — по краткому названию вида', () => {
    const plan = contractorPlan(rows, { taxpay: true, quick: 'all', showClosed: false });
    expect(plan.months[0]!.items.map((x) => x.report.id)).toEqual(['t1-10', 'nds-10']);
  });

  it('«Сдать» и «Уплатить» — только несделанное, закрытых месяцев нет', () => {
    const sub = contractorPlan(rows, { taxpay: true, quick: 'sub', showClosed: false });
    expect(sub.months.flatMap((g) => g.items.map((x) => x.report.id))).toEqual(['t1-10', 'nds-10']);
    const pay = contractorPlan(rows, { taxpay: true, quick: 'pay', showClosed: true });
    expect(pay.months.flatMap((g) => g.items.map((x) => x.report.id))).toEqual(['nds-10']);
  });

  it('без «Учёта оплаты налогов» месяц закрывает сдача', () => {
    const plan = contractorPlan(
      [row('a', { status: 'submitted' }), row('b', { act: 'sub', status: 'submitted' })],
      { taxpay: false, quick: 'all', showClosed: false },
    );
    expect(plan.months).toEqual([]);
    expect(plan.closed).toBe(1);
  });

  it('отчётов нет — «none»', () => {
    const plan = contractorPlan([row('x', { status: 'not_required' })], {
      taxpay: true,
      quick: 'all',
      showClosed: false,
    });
    expect(plan).toMatchObject({ none: true, months: [], closed: 0, left: 0 });
  });
});

describe('вид вкладки «Отчёты к сдаче» запоминает браузер', () => {
  it('по умолчанию — «По месяцам»; «Списком» — из cookie', () => {
    expect(parseReportsMode('')).toBe('months');
    expect(parseReportsMode(`bh_theme=dark; ${REPORTS_MODE_COOKIE}=list`)).toBe('list');
    expect(parseReportsMode(`${REPORTS_MODE_COOKIE}=months; bh_nav=hidden`)).toBe('months');
    expect(parseReportsMode(`${REPORTS_MODE_COOKIE}=что-то`)).toBe('months');
  });

  it('cookie — на год, для всего сайта; по https — только по https', () => {
    expect(reportsModeCookie('list', false)).toMatch(/^bh_repmode=list; Path=\/; Max-Age=\d+/);
    expect(reportsModeCookie('months', true)).toContain('; Secure');
  });
});
