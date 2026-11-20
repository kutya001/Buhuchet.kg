import { describe, expect, it } from 'vitest';
import {
  SUBSCRIPTION_PLAN_MESSAGES,
  SUBSCRIPTION_SETTINGS_MESSAGES,
  SUBSCRIPTION_STATUS_ORDER,
  subscriptionConfirm,
  subscriptionConfirmUntil,
  subscriptionEdit,
  subscriptionPayLate,
  subscriptionPerksOf,
  subscriptionPlanChanges,
  subscriptionPlanProblems,
  subscriptionPurposeText,
  subscriptionSettingsProblems,
  type SubscriptionPendingPayment,
  type SubscriptionPlanInput,
  type SubscriptionSettingsInput,
  type SubscriptionState,
} from './admin';
import { UI_TEXTS } from '../l10n/texts';

// Вкладка «Подписки» Админки — как admin/subs-admin.js и core/subs.js прототипа: порядок статусов,
// «ждёт проверки больше N дней», «Подтвердить оплату» (subPayOk), «Изменить подписку» (subSet), виды
// подписок (subKindDlg), цены и реквизиты (subPricesPart).

const TODAY = '2026-11-20';
const sub: SubscriptionState = {
  planId: 'm1',
  seats: 60,
  extraGb: 1,
  paidUntil: '2026-12-05',
  extraDiscountPct: 0,
  firstPaid: true,
  free: false,
  nextSeats: null,
  nextExtraGb: null,
  nextFrom: null,
};
const pay = (x: Partial<SubscriptionPendingPayment>): SubscriptionPendingPayment => ({
  kind: 'renew',
  startMode: 'now',
  planId: 'm3',
  months: 3,
  seats: 70,
  extraGb: 2,
  sentDay: '2026-11-18',
  ...x,
});

describe('список «Организации»: порядок и срок проверки чека', () => {
  it('порядок статусов — как SUB_ST прототипа', () => {
    const order = Object.entries(SUBSCRIPTION_STATUS_ORDER)
      .sort((a, b) => a[1] - b[1])
      .map(([k]) => k);
    expect(order).toEqual(['pending', 'overdue', 'expiring', 'none', 'active', 'demo']);
  });

  it('чек ждёт проверки дольше срока — со следующего дня после N дней (subPayLate)', () => {
    expect(subscriptionPayLate('2026-11-17', TODAY, 3)).toBe(false);
    expect(subscriptionPayLate('2026-11-16', TODAY, 3)).toBe(true);
  });
});

describe('«Подтвердить оплату» — subPayOk', () => {
  it('«Оплачено до» в окне: продление — от дня после срока, после закрытия — от дня чека', () => {
    expect(subscriptionConfirmUntil(sub, pay({}), 3, TODAY)).toBe('2027-03-05');
    expect(
      subscriptionConfirmUntil(
        { paidUntil: '2026-11-10' },
        pay({ sentDay: '2026-11-18' }),
        1,
        TODAY,
      ),
    ).toBe('2026-12-17');
    expect(subscriptionConfirmUntil(sub, pay({ kind: 'grow' }), 0, TODAY)).toBe('2026-12-05');
    expect(subscriptionConfirmUntil(null, pay({ kind: 'mem' }), 0, TODAY)).toBe(TODAY);
  });

  it('продление: вид, пакет, память и срок из заявки, первый месяц оплачен, бесплатный и «следующий» сняты', () => {
    const r = subscriptionConfirm(
      {
        ...sub,
        free: true,
        firstPaid: false,
        nextSeats: 80,
        nextExtraGb: 1,
        nextFrom: '2026-12-01',
      },
      pay({}),
      { months: 6, paidUntil: '2027-06-05' },
      TODAY,
    );
    expect(r).toEqual({
      sub: {
        ...sub,
        planId: 'm3',
        seats: 70,
        extraGb: 2,
        paidUntil: '2027-06-05',
        firstPaid: true,
        free: false,
      },
      months: 6,
      paidUntil: '2027-06-05',
    });
  });

  it('первая оплата без подписки ставит подписку', () => {
    const r = subscriptionConfirm(
      null,
      pay({ months: 1 }),
      { months: 1, paidUntil: '2026-12-17' },
      TODAY,
    );
    expect(r.sub).toMatchObject({
      planId: 'm3',
      seats: 70,
      extraGb: 2,
      paidUntil: '2026-12-17',
      firstPaid: true,
    });
  });

  it('расширение «Сейчас» — пакет сразу; память «Сейчас» — память сразу; «Оплачено до» из окна', () => {
    const g = subscriptionConfirm(
      sub,
      pay({ kind: 'grow', seats: 80 }),
      { months: 1, paidUntil: '2026-12-05' },
      TODAY,
    );
    expect(g.sub).toMatchObject({ seats: 80, extraGb: 1, paidUntil: '2026-12-05' });
    expect(g.months).toBe(3);
    const m = subscriptionConfirm(
      sub,
      pay({ kind: 'mem', extraGb: 5 }),
      { months: 1, paidUntil: '2026-12-10' },
      TODAY,
    );
    expect(m.sub).toMatchObject({ seats: 60, extraGb: 5, paidUntil: '2026-12-10' });
  });

  it('«Со следующего месяца» ждёт с начала следующего месяца подписки', () => {
    const long = { ...sub, paidUntil: '2027-02-05' };
    const g = subscriptionConfirm(
      long,
      pay({ kind: 'grow', startMode: 'next', seats: 90 }),
      { months: 2, paidUntil: '2027-02-05' },
      TODAY,
    );
    expect(g.sub).toMatchObject({
      seats: 60,
      nextSeats: 90,
      nextExtraGb: 1,
      nextFrom: '2026-12-06',
    });
  });

  it('наступивший «Со следующего месяца» сначала становится пакетом (п. О-91)', () => {
    const r = subscriptionConfirm(
      { ...sub, nextSeats: 80, nextExtraGb: 3, nextFrom: '2026-11-06' },
      pay({ kind: 'mem', extraGb: 4 }),
      { months: 1, paidUntil: '2026-12-05' },
      TODAY,
    );
    expect(r.sub).toMatchObject({ seats: 80, extraGb: 4, nextSeats: null, nextFrom: null });
  });
});

describe('«Изменить подписку» — subSet', () => {
  const x = {
    planId: 'm1',
    seats: 60,
    extraGb: 1,
    paidUntil: '2026-12-05',
    extraDiscountPct: 0,
    free: false,
  };

  it('без изменений — null («Изменений нет»)', () => {
    expect(subscriptionEdit(sub, x, 150)).toBeNull();
  });

  it('«было → стало» по изменённым полям; доп. скидка при пакете не больше порога — 0', () => {
    const r = subscriptionEdit(sub, { ...x, seats: 100, extraDiscountPct: 10 }, 150)!;
    expect(r.changes).toEqual([{ field: 'seats', from: 60, to: 100 }]);
    const big = subscriptionEdit(sub, { ...x, seats: 160, extraDiscountPct: 10 }, 150)!;
    expect(big.sub.extraDiscountPct).toBe(10);
  });

  it('бесплатный период — строка всегда, даже без других изменений; снимается сменой срока без него', () => {
    expect(subscriptionEdit(sub, { ...x, free: true }, 150)).toEqual({
      sub: { ...sub, free: true },
      changes: [{ field: 'free', to: true }],
    });
    const off = subscriptionEdit({ ...sub, free: true }, { ...x, paidUntil: '2027-01-05' }, 150)!;
    expect(off.sub.free).toBe(false);
    const keep = subscriptionEdit({ ...sub, free: true }, { ...x, seats: 70 }, 150)!;
    expect(keep.sub.free).toBe(true);
  });

  it('без подписки — «Поставить подписку»: все поля «стало»', () => {
    const r = subscriptionEdit(null, x, 150)!;
    expect(r.changes.map((c) => c.field)).toEqual([
      'planId',
      'seats',
      'extraGb',
      'paidUntil',
      'extraDiscountPct',
    ]);
    expect(r.sub).toMatchObject({ planId: 'm1', seats: 60, extraGb: 1, firstPaid: false });
  });
});

describe('«Виды подписок» — subKindDlg', () => {
  const plan: SubscriptionPlanInput = {
    name: 'Квартал',
    months: 3,
    discountPct: 5,
    perks: [],
    sortOrder: 2,
    active: true,
  };
  const codes = (x: Partial<SubscriptionPlanInput>, others: string[] = ['Месяц']) =>
    subscriptionPlanProblems({ ...plan, ...x }, others).map((p) => p.code);

  it('проверки окна', () => {
    expect(codes({})).toEqual([]);
    expect(codes({ name: ' ' })).toEqual(['sub_kind_name']);
    expect(codes({ name: 'x'.repeat(41) })).toEqual(['sub_kind_name_long']);
    expect(codes({ name: 'месяц' })).toEqual(['sub_kind_name_taken']);
    expect(codes({ months: 0 })).toEqual(['sub_kind_months']);
    expect(codes({ months: 37 })).toEqual(['sub_kind_months']);
    expect(codes({ months: 36, discountPct: 90 })).toEqual([]);
    expect(codes({ discountPct: 91 })).toEqual(['sub_kind_discount']);
    expect(codes({ perks: Array(11).fill('a') })).toEqual(['sub_kind_perks']);
    expect(codes({ perks: ['a'.repeat(121)] })).toEqual(['sub_kind_perks']);
    expect(codes({ sortOrder: 0 })).toEqual(['sub_kind_order']);
  });

  it('преимущества — по строкам без пустых; изменения — по полям', () => {
    expect(subscriptionPerksOf(' a \n\n b ')).toEqual(['a', 'b']);
    expect(
      subscriptionPlanChanges(plan, { ...plan, months: 6, perks: ['a'], active: false }),
    ).toEqual([
      { field: 'months', from: 3, to: 6 },
      { field: 'perks', from: '', to: 'a' },
      { field: 'active', from: true, to: false },
    ]);
  });

  it('тексты отказов — в словаре', () => {
    for (const [code, text] of Object.entries(SUBSCRIPTION_PLAN_MESSAGES)) {
      expect(UI_TEXTS[`err.${code}` as keyof typeof UI_TEXTS]?.ru).toBe(text);
    }
  });
});

describe('«Цены и реквизиты» — subPricesPart', () => {
  const ok: SubscriptionSettingsInput = {
    seatPrice: 10_000,
    seatStep: 10,
    gbPrice: 10_050,
    baseGb: 2,
    seatMb: 200,
    firstMonthPct: 50,
    extraDiscountOver: 150,
    remindDays: 7,
    checkDays: 3,
    recipient: 'ОсОО «Бухучет»',
    recipientInn: '',
    bank: 'Банк',
    bik: '123456',
    account: '1234567890123456',
    purpose: 'Подписка Buhuchet.kg: {организация}, ИНН {ИНН}',
  };
  const codes = (x: Partial<SubscriptionSettingsInput>) =>
    subscriptionSettingsProblems({ ...ok, ...x }).map((p) => `${p.field}:${p.code}`);

  it('верные — без замечаний', () => expect(codes({})).toEqual([]));

  it('пределы чисел, цена — от 1 сома, целые — без дробей', () => {
    expect(codes({ seatPrice: 99 })).toEqual(['seatPrice:sub_cfg_range']);
    expect(codes({ seatStep: 0, checkDays: 31, remindDays: 1.5 })).toEqual([
      'seatStep:sub_cfg_range_int',
      'remindDays:sub_cfg_range_int',
      'checkDays:sub_cfg_range_int',
    ]);
  });

  it('реквизиты: обязательные, БИК, ИНН, подстановки', () => {
    expect(codes({ recipient: ' ', bik: '12345', recipientInn: '123' })).toEqual([
      'recipient:sub_cfg_required',
      'recipientInn:sub_cfg_inn',
      'bik:sub_cfg_bik',
    ]);
    const [p] = subscriptionSettingsProblems({ ...ok, purpose: 'За {месяц} {ИНН} {org}' });
    expect(p).toEqual({
      field: 'purpose',
      code: 'sub_cfg_purpose',
      params: { bad: '{месяц}, {org}' },
    });
  });

  it('назначение платежа организации', () => {
    expect(
      subscriptionPurposeText(ok.purpose, { name: 'ОсОО «Альфа»', inn: '01234567891234' }),
    ).toBe('Подписка Buhuchet.kg: ОсОО «Альфа», ИНН 01234567891234');
  });

  it('тексты отказов — в словаре', () => {
    for (const [code, text] of Object.entries(SUBSCRIPTION_SETTINGS_MESSAGES)) {
      expect(UI_TEXTS[`err.${code}` as keyof typeof UI_TEXTS]?.ru).toBe(text);
    }
  });
});
