import { describe, expect, it } from 'vitest';
import {
  addSubscriptionMonths,
  subscriptionCalc,
  subscriptionMemLimitBytes,
  subscriptionMinSeats,
  subscriptionMonthsLeft,
  subscriptionNextFrom,
  subscriptionPaidUntilAfter,
  subscriptionPayProblem,
  type SubscriptionCalcInput,
  type SubscriptionNow,
  type SubscriptionPlanTerms,
  type SubscriptionPrices,
} from './calc';

/** «Цены и реквизиты» по умолчанию (миграция 0165, прототип ref.subPrices). */
const PRICES: SubscriptionPrices = {
  seatPrice: 10_000,
  gbPrice: 10_000,
  seatStep: 10,
  baseMb: 2000,
  seatMb: 200,
  firstMonthPct: 50,
  extraDiscountOver: 150,
};
const PLANS: Record<string, SubscriptionPlanTerms> = {
  m1: { id: 'm1', months: 1, discountPct: 0 },
  m3: { id: 'm3', months: 3, discountPct: 5 },
  m6: { id: 'm6', months: 6, discountPct: 10 },
  m12: { id: 'm12', months: 12, discountPct: 20 },
};

const sub = (o: Partial<SubscriptionNow> & Pick<SubscriptionNow, 'planId'>): SubscriptionNow => ({
  seats: 10,
  extraGb: 0,
  paidUntil: '2027-01-20',
  extraDiscountPct: 0,
  firstPaid: true,
  ...o,
});

const calc = (
  o: Omit<SubscriptionCalcInput, 'prices' | 'plan' | 'startMode' | 'extraGb' | 'seats'> & {
    plan: string;
    seats?: number;
    extraGb?: number;
    startMode?: 'now' | 'next';
  },
) =>
  subscriptionCalc({
    ...o,
    prices: PRICES,
    plan: PLANS[o.plan]!,
    seats: o.seats ?? o.sub?.seats ?? 0,
    extraGb: o.extraGb ?? o.sub?.extraGb ?? 0,
    startMode: o.startMode ?? 'now',
  });

/*
 * Эталон — `subCalc`, `subMonthsLeft`, `subPaidToAfter` прототипа (`spec/prototype/src/js/core/subs.js`)
 * на этих же данных; сомы прототипа × 100 = тыйыны.
 */
describe('subscriptionCalc — как subCalc прототипа', () => {
  it('новая организация, пакет 60 помесячно: первый месяц за половину (ТЗ: 3 000 вместо 6 000)', () => {
    const r = calc({ kind: 'renew', plan: 'm1', sub: null, seats: 60, today: '2027-01-05' });
    expect(r.lines.map((l) => l.sum)).toEqual([600_000, -300_000]);
    expect(r.lines.map((l) => l.k)).toEqual(['seats', 'first']);
    expect(r.total).toBe(300_000);
    expect(r.months).toBe(1);
  });

  it('новая организация, пакет 60 на 3 месяца: 2 850 + 5 700 + 5 700 = 14 250 сом', () => {
    const r = calc({ kind: 'renew', plan: 'm3', sub: null, seats: 60, today: '2027-01-05' });
    expect(r.lines).toEqual([
      { k: 'seats', n: 60, price: 9500, months: 3, sum: 1_710_000 },
      { k: 'first', pct: 50, sum: -285_000 },
    ]);
    expect(r.total).toBe(1_425_000);
  });

  it('12 месяцев и дополнительная скидка 10 % с пакета 160: 70 сом за контрагента, на память не действует', () => {
    const s = sub({ planId: 'm12', seats: 160, extraGb: 2, extraDiscountPct: 10 });
    const r = calc({ kind: 'renew', plan: 'm12', sub: s, today: '2027-01-05' });
    expect(r.lines.map((l) => l.sum)).toEqual([15_360_000, 192_000, -1_920_000]);
    expect(r.total).toBe(13_632_000);
    expect(r.extraDiscountPct).toBe(10);
    expect((r.total - 192_000) / 160 / 12).toBe(7000);
  });

  it('первый месяц после бесплатных дней — от цены со всеми скидками', () => {
    const s = sub({ planId: 'm12', seats: 170, extraDiscountPct: 10, firstPaid: false });
    const r = calc({ kind: 'renew', plan: 'm12', sub: s, extraGb: 3, today: '2027-01-05' });
    expect(r.lines.map((l) => l.sum)).toEqual([16_320_000, 288_000, -2_040_000, -595_000]);
    expect(r.total).toBe(13_973_000);
  });

  it('дополнительная скидка у пакета 150 и меньше не действует', () => {
    const s = sub({ planId: 'm1', seats: 150, extraDiscountPct: 10 });
    const r = calc({ kind: 'renew', plan: 'm1', sub: s, today: '2027-01-05' });
    expect(r.extraDiscountPct).toBe(0);
    expect(r.total).toBe(1_500_000);
  });

  it('расширение 60 → 70 20 января: доплата за весь месяц — 1 000 сом', () => {
    const s = sub({ planId: 'm1', seats: 60, paidUntil: '2027-02-04' });
    const r = calc({ kind: 'grow', plan: 'm1', sub: s, seats: 70, today: '2027-01-20' });
    expect(r.lines).toEqual([{ k: 'grow', n: 10, price: 10_000, months: 1, sum: 100_000 }]);
    expect(r.total).toBe(100_000);
  });

  it('расширение на 3 месяца: за текущий и оставшиеся по цене вида; «Со следующего месяца» — без текущего', () => {
    const s = sub({ planId: 'm3', seats: 60, paidUntil: '2027-04-04' });
    const now = calc({ kind: 'grow', plan: 'm3', sub: s, seats: 80, today: '2027-02-10' });
    expect([now.total, now.months]).toEqual([380_000, 2]);
    const next = calc({
      kind: 'grow',
      plan: 'm3',
      sub: s,
      seats: 80,
      today: '2027-02-10',
      startMode: 'next',
    });
    expect([next.total, next.months]).toEqual([190_000, 1]);
  });

  it('память сверх: доплата за разницу ГБ', () => {
    const s = sub({ planId: 'm3', seats: 60, extraGb: 1, paidUntil: '2027-04-04' });
    const r = calc({ kind: 'mem', plan: 'm3', sub: s, extraGb: 4, today: '2027-02-10' });
    expect(r.lines).toEqual([{ k: 'mem', n: 3, price: 9500, months: 2, sum: 57_000 }]);
  });

  it('расширение больше 150: дополнительная скидка на добавленные места', () => {
    const s = sub({ planId: 'm6', seats: 150, paidUntil: '2027-07-31', extraDiscountPct: 7 });
    const r = calc({ kind: 'grow', plan: 'm6', sub: s, seats: 200, today: '2027-02-10' });
    expect(r.lines.map((l) => l.sum)).toEqual([2_700_000, -210_000]);
    expect(r.total).toBe(2_490_000);
  });

  it('сумма не меньше нуля; без доплаты — 0', () => {
    const s = sub({ planId: 'm1', seats: 60, paidUntil: '2027-02-04' });
    expect(calc({ kind: 'grow', plan: 'm1', sub: s, seats: 60, today: '2027-01-20' }).total).toBe(
      0,
    );
  });
});

describe('месяцы подписки', () => {
  it('дата + n месяцев с тем же числом: 31 января + 1 = 28 февраля', () => {
    expect(addSubscriptionMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addSubscriptionMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addSubscriptionMonths('2027-03-15', -2)).toBe('2027-01-15');
    expect(addSubscriptionMonths('2027-11-30', 3)).toBe('2028-02-29');
  });

  it('сколько месяцев срока осталось, считая текущий', () => {
    expect(subscriptionMonthsLeft(null, '2027-01-01')).toBe(0);
    expect(subscriptionMonthsLeft('2026-12-31', '2027-01-01')).toBe(0);
    expect(subscriptionMonthsLeft('2027-02-04', '2027-01-20')).toBe(1);
    expect(subscriptionMonthsLeft('2027-04-04', '2027-02-10')).toBe(2);
    expect(subscriptionMonthsLeft('2027-07-31', '2027-02-10')).toBe(6);
    expect(subscriptionMonthsLeft('2027-01-20', '2027-01-20')).toBe(1);
  });

  it('«Оплачено до» после продления: до конца срока — со дня после, после закрытия — со дня чека', () => {
    expect(subscriptionPaidUntilAfter(null, 1, '2027-01-05')).toBe('2027-02-04');
    expect(subscriptionPaidUntilAfter('2027-01-20', 12, '2027-01-05')).toBe('2028-01-20');
    expect(subscriptionPaidUntilAfter('2027-02-27', 1, '2027-01-31')).toBe('2027-03-27');
    expect(subscriptionPaidUntilAfter('2027-02-27', 3, '2027-03-10')).toBe('2027-06-09');
  });

  it('«Со следующего месяца» — с начала следующего месяца подписки', () => {
    expect(subscriptionNextFrom('2027-04-04', '2027-02-10')).toBe('2027-03-05');
    expect(subscriptionNextFrom('2027-02-04', '2027-01-20')).toBe('2027-02-05');
  });
});

describe('проверка окна оплаты', () => {
  const base = {
    prices: PRICES,
    planOk: true,
    nowSeats: 60,
    nowExtraGb: 1,
    active: 57,
    usedBytes: 0,
  };

  it('пакет — по 10, не меньше активных, расширение — больше нынешнего', () => {
    expect(subscriptionPayProblem({ ...base, kind: 'renew', seats: 65, extraGb: 0 })).toEqual({
      field: 'seats',
      code: 'sub_seats_step',
      step: 10,
    });
    expect(subscriptionPayProblem({ ...base, kind: 'renew', seats: 50, extraGb: 0 })).toEqual({
      field: 'seats',
      code: 'sub_seats_active',
      n: 7,
      active: 57,
    });
    expect(subscriptionPayProblem({ ...base, kind: 'grow', seats: 60, extraGb: 0 })).toEqual({
      field: 'seats',
      code: 'sub_seats_not_more',
      now: 60,
    });
    expect(subscriptionPayProblem({ ...base, kind: 'grow', seats: 70, extraGb: 0 })).toBeNull();
  });

  it('вид продления выбран; память — целое число, докупка — больше нынешней, занятое помещается', () => {
    expect(
      subscriptionPayProblem({ ...base, planOk: false, kind: 'renew', seats: 60, extraGb: 0 }),
    ).toEqual({ field: 'plan', code: 'sub_plan_required' });
    expect(subscriptionPayProblem({ ...base, kind: 'mem', seats: 60, extraGb: 1.5 })).toEqual({
      field: 'extraGb',
      code: 'sub_gb_invalid',
    });
    expect(subscriptionPayProblem({ ...base, kind: 'mem', seats: 60, extraGb: 1 })).toEqual({
      field: 'extraGb',
      code: 'sub_gb_not_more',
      now: 1,
    });
    const used = subscriptionMemLimitBytes(PRICES, 60, 0) + 1;
    expect(
      subscriptionPayProblem({ ...base, usedBytes: used, kind: 'renew', seats: 60, extraGb: 0 }),
    ).toMatchObject({ field: 'extraGb', code: 'sub_gb_used', limitMb: 14_000 });
    expect(
      subscriptionPayProblem({ ...base, usedBytes: used, kind: 'renew', seats: 60, extraGb: 1 }),
    ).toBeNull();
  });

  it('наименьший пакет и предел памяти (пакет 60 — 14 ГБ)', () => {
    expect(subscriptionMinSeats(0, 10)).toBe(10);
    expect(subscriptionMinSeats(57, 10)).toBe(60);
    expect(subscriptionMemLimitBytes(PRICES, 60, 0)).toBe(14_000 * 1024 * 1024);
  });
});
