import { z } from 'zod';
import { IsoDate } from './common';

/**
 * Подписка от администратора платформы (доработки 20.11.2026, блок 6, пункт 4; прототип
 * admin/subs-admin.js, `subEditFields`): вид, пакет мест, память сверх, «Оплачено до» и
 * дополнительная скидка. Шаг пакета, порог скидки и действующий ли вид проверяет сервер
 * (`subscriptionEditProblems` из `@buhuchet/domain`): неверное поле — 400 с кодом и `details.field`.
 */
export const SubscriptionEditFields = z.object({
  planId: z.string().trim().min(1).max(32),
  seats: z.number().int().min(1).max(100000),
  extraGb: z.number().int().min(0).max(100000).default(0),
  paidUntil: IsoDate,
  extraDiscountPct: z.number().int().min(0).max(100).default(0),
});
export type SubscriptionEditFields = z.infer<typeof SubscriptionEditFields>;

/**
 * Блок «Подписка» окна «Новая организация» (прототип `subNewOrgHtml`): необязательный — без него у
 * организации «Нет подписки». «Бесплатный период» в окне отмечен по умолчанию.
 */
export const NewOrgSubscriptionRequest = SubscriptionEditFields.extend({
  free: z.boolean().default(true),
});
export type NewOrgSubscriptionRequest = z.infer<typeof NewOrgSubscriptionRequest>;
