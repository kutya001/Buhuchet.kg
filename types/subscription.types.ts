import { z } from 'zod';
import { SubscriptionPlan, PaymentMethod } from './database.types';

export const mockPaymentSchema = z.object({
  planType: z.enum(['basic', 'standard', 'pro'] as [SubscriptionPlan, ...SubscriptionPlan[]]),
  periodMonths: z.coerce.number().int().refine((val) => [1, 3, 6, 12].includes(val), {
    message: 'Некорректный период подписки (выберите 1, 3, 6 или 12 месяцев)',
  }),
  paymentMethod: z
    .enum(['qr_mbank', 'qr_optima', 'manual_admin'] as [PaymentMethod, ...PaymentMethod[]])
    .default('qr_mbank'),
});

export type MockPaymentInput = z.infer<typeof mockPaymentSchema>;

export const PLAN_PRICES: Record<SubscriptionPlan, { title: string; pricePerMonth: number; storageGb: number }> = {
  basic: { title: 'Базовый', pricePerMonth: 3000, storageGb: 10 },
  standard: { title: 'Стандарт', pricePerMonth: 7000, storageGb: 25 },
  pro: { title: 'Профи', pricePerMonth: 15000, storageGb: 100 },
};
