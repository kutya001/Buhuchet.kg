import { describe, expect, it } from 'vitest';
import { UI_TEXTS } from '../l10n/texts';
import {
  SUBSCRIPTION_EDIT_MESSAGES,
  subscriptionEditDiscount,
  subscriptionEditProblems,
  type SubscriptionEdit,
} from './edit';

// Блок «Подписка» окна «Новая организация» и «Изменить подписку» — как subEditRead прототипа
// (admin/subs-admin.js): пакет с шагом, память — целое от 0, дата обязательна, дополнительная скидка —
// только при пакете больше порога и вместе со скидкой за срок не больше 100 %.
describe('подписка от администратора — проверки subEditRead', () => {
  const prices = { seatStep: 10, extraDiscountOver: 150 };
  const plans = [
    { id: 'm1', discountPct: 0, active: true },
    { id: 'm12', discountPct: 25, active: true },
    { id: 'old', discountPct: 10, active: false },
  ];
  const ok: SubscriptionEdit = {
    planId: 'm1',
    seats: 10,
    extraGb: 0,
    paidUntil: '2026-12-20',
    extraDiscountPct: 0,
  };
  const codes = (x: Partial<SubscriptionEdit>, current: string | null = null) =>
    subscriptionEditProblems({ ...ok, ...x }, prices, plans, current).map((p) => p.code);

  it('верная подписка — без замечаний', () => {
    expect(codes({})).toEqual([]);
    expect(codes({ planId: 'm12', seats: 160, extraGb: 3, extraDiscountPct: 75 })).toEqual([]);
  });

  it('вид — только действующий; выключенный остаётся у организации, где уже стоит', () => {
    expect(codes({ planId: 'old' })).toEqual(['sub_plan']);
    expect(codes({ planId: 'nope' })).toEqual(['sub_plan']);
    expect(codes({ planId: 'old' }, 'old')).toEqual([]);
  });

  it('пакет — целое число мест с шагом, не меньше шага', () => {
    for (const seats of [0, 5, 15, 10.5, -10, 100010]) {
      expect(codes({ seats })).toEqual(['sub_seats']);
    }
    const [problem] = subscriptionEditProblems({ ...ok, seats: 15 }, prices, plans);
    expect(problem).toEqual({
      field: 'seats',
      code: 'sub_seats',
      params: { step: 10, step2: 20, step3: 30 },
    });
    expect(SUBSCRIPTION_EDIT_MESSAGES.sub_seats).toBe(
      'Пакет — число мест с шагом {step}: {step}, {step2}, {step3}…',
    );
  });

  it('память — целое число ГБ от 0; дата — настоящая', () => {
    expect(codes({ extraGb: -1 })).toEqual(['sub_gb']);
    expect(codes({ extraGb: 1.5 })).toEqual(['sub_gb']);
    expect(codes({ paidUntil: '' })).toEqual(['sub_paid_until']);
    expect(codes({ paidUntil: '2026-02-30' })).toEqual(['sub_paid_until']);
    expect(codes({ paidUntil: '20.12.2026' })).toEqual(['sub_paid_until']);
  });

  it('дополнительная скидка — только при пакете больше порога и вместе со скидкой за срок до 100 %', () => {
    // Пакет 150 — не больше порога: скидка не сохраняется и не проверяется (поле выключено).
    expect(subscriptionEditDiscount({ seats: 150, extraDiscountPct: 30 }, prices)).toBe(0);
    expect(codes({ seats: 150, extraDiscountPct: 500 })).toEqual([]);
    expect(subscriptionEditDiscount({ seats: 160, extraDiscountPct: 30 }, prices)).toBe(30);
    expect(codes({ planId: 'm12', seats: 160, extraDiscountPct: 76 })).toEqual(['sub_discount']);
    expect(codes({ seats: 160, extraDiscountPct: -1 })).toEqual(['sub_discount']);
    expect(codes({ seats: 160, extraDiscountPct: 2.5 })).toEqual(['sub_discount']);
    expect(codes({ seats: 160, extraDiscountPct: 100 })).toEqual([]);
  });

  it('несколько ошибок — у каждого поля своя', () => {
    expect(
      subscriptionEditProblems(
        { planId: 'x', seats: 3, extraGb: -2, paidUntil: '', extraDiscountPct: 0 },
        prices,
        plans,
      ).map((p) => p.field),
    ).toEqual(['planId', 'seats', 'extraGb', 'paidUntil']);
  });

  it('тексты словаря err.<код> — те же, что у сервера', () => {
    for (const [code, text] of Object.entries(SUBSCRIPTION_EDIT_MESSAGES)) {
      expect(UI_TEXTS[`err.${code}` as keyof typeof UI_TEXTS]?.ru).toBe(text);
    }
  });
});
