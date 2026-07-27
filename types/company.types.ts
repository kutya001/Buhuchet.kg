import { z } from 'zod';
import { kgPhoneRegex } from './profile.types';

// ИНН в Кыргызстане состоит строго из 14 цифр
export const kgInnRegex = /^\d{14}$/;

export const createCompanySchema = z.object({
  name: z.string().min(2, { message: 'Название организации должно содержать минимум 2 символа' }),
  inn: z.string().refine((val) => kgInnRegex.test(val), {
    message: 'ИНН организации в Кыргызстане должен состоять ровно из 14 цифр',
  }),
  address: z.string().optional().nullable(),
  phone: z
    .string()
    .transform((val) => val.replace(/[\s\(\)\-]/g, ''))
    .refine((val) => val === '' || kgPhoneRegex.test(val), {
      message: 'Введите корректный телефон в формате +996 XXX XX-XX-XX',
    })
    .optional()
    .nullable(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
