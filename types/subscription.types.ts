import { z } from 'zod';
import { SubscriptionPlan, PaymentMethod } from './database.types';

export const mockPaymentSchema = z.object({
  planType: z.enum([
    'start',
    'business',
    'premium',
    'basic',
    'standard',
    'pro',
  ] as [SubscriptionPlan, ...SubscriptionPlan[]]),
  periodMonths: z.coerce.number().int().refine((val) => [1, 3, 6, 12].includes(val), {
    message: 'Некорректный период подписки (выберите 1, 3, 6 или 12 месяцев)',
  }),
  paymentMethod: z
    .enum(['qr_mbank', 'qr_optima', 'manual_admin'] as [PaymentMethod, ...PaymentMethod[]])
    .default('qr_mbank'),
});

export type MockPaymentInput = z.infer<typeof mockPaymentSchema>;

export const PLAN_PRICES: Record<string, { title: string; pricePerMonth: number; storageGb: number }> = {
  start: { title: 'Старт', pricePerMonth: 990, storageGb: 5 },
  business: { title: 'Бизнес', pricePerMonth: 2490, storageGb: 20 },
  premium: { title: 'Премиум', pricePerMonth: 4990, storageGb: 100 },
  basic: { title: 'Базовый', pricePerMonth: 990, storageGb: 5 },
  standard: { title: 'Стандарт', pricePerMonth: 2490, storageGb: 20 },
  pro: { title: 'Профи', pricePerMonth: 4990, storageGb: 100 },
};
