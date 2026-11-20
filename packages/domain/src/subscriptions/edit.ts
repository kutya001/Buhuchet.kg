import type { SubscriptionPrices } from './calc';

/**
 * Подписку ставит или меняет администратор платформы (доработки 20.11.2026, блок 6, пункт 4; блок 4,
 * пункт 5): блок «Подписка» окна «Новая организация» и «Изменить подписку» (прототип subEditRead):
 * вид, пакет с шагом, память сверх, «Оплачено до» и дополнительная скидка — только при пакете больше
 * порога и вместе со скидкой за срок не больше 100 %.
 */
export interface SubscriptionEdit {
  planId: string;
  seats: number;
  extraGb: number;
  /** «Оплачено до», ГГГГ-ММ-ДД. */
  paidUntil: string;
  extraDiscountPct: number;
}

/** Вид подписки, который можно выбрать: скидка за срок и действует ли. */
export interface SubscriptionEditPlan {
  id: string;
  discountPct: number;
  active: boolean;
}

export const SUBSCRIPTION_EDIT_FIELDS = [
  'planId',
  'seats',
  'extraGb',
  'paidUntil',
  'extraDiscountPct',
] as const;
export type SubscriptionEditField = (typeof SUBSCRIPTION_EDIT_FIELDS)[number];

/** Код ошибки — ключ словаря `err.<код>`; подстановки — в `params`. */
export interface SubscriptionEditProblem {
  field: SubscriptionEditField;
  code: 'sub_plan' | 'sub_seats' | 'sub_gb' | 'sub_paid_until' | 'sub_discount';
  params?: Record<string, number>;
}

/** Тексты сервера для отказов (`err.<код>` словаря — те же). */
export const SUBSCRIPTION_EDIT_MESSAGES: Record<SubscriptionEditProblem['code'], string> = {
  sub_plan: 'Выберите действующий вид подписки',
  sub_seats: 'Пакет — число мест с шагом {step}: {step}, {step2}, {step3}…',
  sub_gb: 'Целое число ГБ, 0 и больше',
  sub_paid_until: 'Укажите дату',
  sub_discount: 'От 0 %; вместе со скидкой за срок — не больше 100 %',
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (s: string) =>
  DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Дополнительная скидка, которая сохранится: при пакете не больше порога — 0 (прототип subEditBind). */
export const subscriptionEditDiscount = (
  x: Pick<SubscriptionEdit, 'seats' | 'extraDiscountPct'>,
  prices: Pick<SubscriptionPrices, 'extraDiscountOver'>,
): number => (x.seats > prices.extraDiscountOver ? x.extraDiscountPct : 0);

/**
 * Что не так в подписке от администратора; пусто — можно сохранять. Вид — действующий или тот, что уже
 * стоит у организации (`current`: выключенный вид остаётся, пока его не сменят).
 */
export function subscriptionEditProblems(
  x: SubscriptionEdit,
  prices: Pick<SubscriptionPrices, 'seatStep' | 'extraDiscountOver'>,
  plans: readonly SubscriptionEditPlan[],
  current: string | null = null,
): SubscriptionEditProblem[] {
  const out: SubscriptionEditProblem[] = [];
  const plan = plans.find((p) => p.id === x.planId && (p.active || p.id === current));
  if (!plan) out.push({ field: 'planId', code: 'sub_plan' });
  const step = prices.seatStep;
  if (!Number.isInteger(x.seats) || x.seats < step || x.seats % step !== 0 || x.seats > 100000) {
    out.push({
      field: 'seats',
      code: 'sub_seats',
      params: { step, step2: step * 2, step3: step * 3 },
    });
  }
  if (!Number.isInteger(x.extraGb) || x.extraGb < 0 || x.extraGb > 100000) {
    out.push({ field: 'extraGb', code: 'sub_gb' });
  }
  if (!realDate(x.paidUntil)) out.push({ field: 'paidUntil', code: 'sub_paid_until' });
  const discount = subscriptionEditDiscount(x, prices);
  if (!Number.isInteger(discount) || discount < 0 || discount + (plan?.discountPct ?? 0) > 100) {
    out.push({ field: 'extraDiscountPct', code: 'sub_discount' });
  }
  return out;
}
