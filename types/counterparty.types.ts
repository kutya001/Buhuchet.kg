import { z } from 'zod';
import { kgInnRegex } from './company.types';
import { kgPhoneRegex } from './profile.types';

export const counterpartySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2, { message: 'Название контрагента должно содержать минимум 2 символа' }),
  inn: z.string().refine((val) => kgInnRegex.test(val), {
    message: 'ИНН контрагента в Кыргызстане должен состоять ровно из 14 цифр',
  }),
  is_vat_payer: z.boolean().default(false),
  phone: z
    .string()
    .transform((val) => val.replace(/[\s\(\)\-]/g, ''))
    .refine((val) => val === '' || kgPhoneRegex.test(val), {
      message: 'Введите корректный телефон в формате +996 XXX XX-XX-XX',
    })
    .optional()
    .nullable(),
  comment: z.string().optional().nullable(),
});

export type CounterpartyInput = z.infer<typeof counterpartySchema>;
