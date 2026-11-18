import type { PublicPageBody } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { paidDefaults, payPlan, payView, waitingDay } from './page-pay-model';

// «Оплата» простыми словами (прототип v135 `pubBody`, `pubPayPlan`, `pubPaidDlg`).

const TODAY = '2026-11-18';
const account = (waiting: { at: string; amount: number | null } | null = null) => ({
  kind: 'phone',
  number: '+996 555 123 456',
  waiting,
});
const money = {
  monthEnd: '2026-11-30',
  verdict: 'short',
  amount: 600_000,
  dueSum: 1_000_000,
  got: 5_000_000,
  paid: 4_600_000,
  due: [
    { id: 'r1', type: 'Единый налог', period: '3 кв. 2026', left: 700_000, payDue: '2026-11-15' },
    { id: 'r2', type: 'Соцфонд', period: 'Октябрь 2026', left: 300_000, payDue: '2026-11-25' },
  ],
};
const fee = {
  tariff: { amount: 500_000, period: 'M' },
  feeDay: 10,
  debt: 800_000,
  paidTill: '2026-08',
  // Как в ответе страницы — сначала новые.
  months: [
    { month: '2026-11', charge: 500_000, got: 0, status: 'unpaid' },
    { month: '2026-10', charge: 500_000, got: 200_000, status: 'partial' },
    { month: '2026-09', charge: 500_000, got: 500_000, status: 'paid' },
  ],
};
const reports = {
  types: [{ code: 'EN', short: 'ЕН', name: 'Единый налог' }],
  months: [
    {
      month: '2026-10',
      sum: 900_000,
      got: 400_000,
      left: 500_000,
      status: 'partial',
      rows: [
        { id: 'r1', type: 'EN', period: '3 кв. 2026', left: 450_000, payDue: '2026-11-15' },
        { id: 'r9', type: 'XX', period: 'Октябрь 2026', left: 50_000, payDue: null },
      ],
    },
    { month: '2026-09', sum: 100_000, got: 100_000, left: 0, status: 'paid', rows: [] },
  ],
};
const pageOf = (p: Record<string, unknown>) =>
  ({
    today: TODAY,
    pay: null,
    money: null,
    fee: null,
    reports: null,
    ...p,
  }) as unknown as PublicPageBody;

describe('payView — строки «Что нужно сделать» и «Оплаты»', () => {
  it('налоги: «не хватает», просрочка по сроку оплаты, реквизит и ждущий чек', () => {
    const waiting = { at: '2026-11-17T04:00:00.000Z', amount: 600_000 };
    const v = payView(pageOf({ money, pay: { tax: account(waiting), fee: null } }));
    expect(v.tax).toMatchObject({ due: 600_000, late: true, waiting });
    expect(v.tax?.account).toMatchObject({ kind: 'phone' });
    expect(v.tax?.money).toEqual({ due: 600_000, ours: 400_000, spare: 0, late: true });
    expect(v.fee).toBeNull();
  });

  it('«Деньги на налоги» скрыты, реквизит есть — строка «куда переводить» без суммы', () => {
    const v = payView(pageOf({ pay: { tax: account(), fee: null } }));
    expect(v.tax).toMatchObject({ due: 0, late: false, money: null, waiting: null });
  });

  it('ни расчёта, ни реквизита — строки «Налоги» нет', () => {
    expect(payView(pageOf({})).tax).toBeNull();
  });

  it('услуги бухгалтера — только при показанной оплате услуг; реквизит без неё не берётся', () => {
    expect(payView(pageOf({ pay: { tax: null, fee: account() } })).fee).toBeNull();
    const v = payView(pageOf({ fee, pay: { tax: null, fee: account() } }));
    // Срок октября — 10 октября — прошёл.
    expect(v.fee).toMatchObject({ due: 800_000, late: true, waiting: null });
    expect(v.fee?.account).not.toBeNull();
    // «Как оплатить» скрыто — строка есть, реквизита нет.
    expect(payView(pageOf({ fee })).fee).toMatchObject({ due: 800_000, account: null });
    // Переплата не показывается отрицательной суммой.
    expect(payView(pageOf({ fee: { ...fee, debt: -100 } })).fee?.due).toBe(0);
  });
});

describe('payPlan — окно «Оплатить» (pubPayPlan)', () => {
  it('услуги бухгалтера: долг, месяцы с остатком от старых, месяц сообщения — самый старый', () => {
    const p = payPlan(pageOf({ fee }), 'fee', null);
    expect(p).toMatchObject({ purpose: 'fee', sum: 800_000, month: '2026-10', titleMonth: null });
    expect(p.rows).toEqual([
      {
        id: '2026-10',
        type: null,
        period: null,
        month: '2026-10',
        sum: 300_000,
        due: '2026-10-10',
      },
      {
        id: '2026-11',
        type: null,
        period: null,
        month: '2026-11',
        sum: 500_000,
        due: '2026-11-10',
      },
    ]);
    expect(p.calc).toBeNull();
  });

  it('услуги бухгалтера без долга и без раздела — сумма 0, строк нет', () => {
    expect(payPlan(pageOf({ fee: { ...fee, debt: 0, months: [] } }), 'fee', null)).toMatchObject({
      sum: 0,
      month: null,
      rows: [],
    });
    expect(payPlan(pageOf({}), 'fee', null)).toMatchObject({ sum: 0, month: null, rows: [] });
  });

  it('налоги за месяц: остаток месяца и его отчёты; вид — коротко, не из каталога — кодом', () => {
    const p = payPlan(pageOf({ reports, money }), 'tax', '2026-10');
    expect(p).toMatchObject({ sum: 500_000, month: '2026-10', titleMonth: '2026-10', calc: null });
    expect(p.rows).toEqual([
      { id: 'r1', type: 'ЕН', period: '3 кв. 2026', month: null, sum: 450_000, due: '2026-11-15' },
      { id: 'r9', type: 'XX', period: 'Октябрь 2026', month: null, sum: 50_000, due: null },
    ]);
  });

  it('налоги за оплаченный или чужой месяц — сумма 0', () => {
    expect(payPlan(pageOf({ reports }), 'tax', '2026-09').sum).toBe(0);
    expect(payPlan(pageOf({ reports }), 'tax', '2026-01')).toMatchObject({ sum: 0, rows: [] });
    expect(payPlan(pageOf({}), 'tax', '2026-10')).toMatchObject({ sum: 0, rows: [] });
  });

  it('налоги без месяца: «Не хватает», отчёты до конца месяца и строка расчёта', () => {
    const p = payPlan(pageOf({ money }), 'tax', null);
    expect(p).toMatchObject({ sum: 600_000, month: null, titleMonth: null });
    expect(p.rows.map((r) => [r.type, r.sum, r.due])).toEqual([
      ['Единый налог', 700_000, '2026-11-15'],
      ['Соцфонд', 300_000, '2026-11-25'],
    ]);
    expect(p.calc).toEqual({ until: '2026-11-30', need: 1_000_000, ours: 400_000 });
    // «Деньги на налоги» скрыты — ни суммы, ни расчёта.
    expect(payPlan(pageOf({}), 'tax', null)).toMatchObject({ sum: 0, rows: [], calc: null });
  });
});

describe('paidDefaults — «Я оплатил» (pubPaidDlg, reset)', () => {
  it('налоги — «Не хватает» или остаток месяца; услуги — долг и самый старый месяц', () => {
    const page = pageOf({ money, fee, reports });
    expect(paidDefaults(page, 'tax', null)).toEqual({ month: null, sum: 600_000 });
    expect(paidDefaults(page, 'tax', '2026-10')).toEqual({ month: '2026-10', sum: 500_000 });
    // Месяц налогов услугам не передаётся.
    expect(paidDefaults(page, 'fee', '2026-09')).toEqual({ month: '2026-10', sum: 800_000 });
  });
});

describe('waitingDay — «Чек отправлен 17 ноября»', () => {
  it('день по Бишкеку: вечер по UTC — уже следующий день', () => {
    expect(waitingDay({ at: '2026-11-17T04:00:00.000Z', amount: 1 })).toBe('2026-11-17');
    expect(waitingDay({ at: '2026-11-17T19:30:00.000Z', amount: null })).toBe('2026-11-18');
  });
});
