import { z } from 'zod';
import { SubscriptionPlan } from './database.types';

export const toggleCompanyActiveSchema = z.object({
  companyId: z.string().uuid({ message: 'Некорректный ID компании' }),
  isActive: z.boolean(),
});

export const updateCompanySubscriptionSchema = z.object({
  companyId: z.string().uuid({ message: 'Некорректный ID компании' }),
  planType: z.enum(['basic', 'standard', 'pro'] as [SubscriptionPlan, ...SubscriptionPlan[]]),
  daysToAdd: z.number().int().min(0, { message: 'Количество дней не может быть отрицательным' }),
  storageLimitGb: z.number().int().positive({ message: 'Лимит ГБ должен быть больше 0' }),
});

export type ToggleCompanyActiveInput = z.infer<typeof toggleCompanyActiveSchema>;
export type UpdateCompanySubscriptionInput = z.infer<typeof updateCompanySubscriptionSchema>;
