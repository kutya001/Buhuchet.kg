import { z } from 'zod';

// Телефон КР: формат +996XXXXXXXXX (всего 13 символов с кодом +996 и 9 цифрами) или очищенный от пробелов/скобок
export const kgPhoneRegex = /^\+996\d{9}$/;

export const updateProfileSchema = z.object({
  full_name: z.string().min(2, { message: 'ФИО должно содержать минимум 2 символа' }),
  phone: z
    .string()
    .transform((val) => val.replace(/[\s\(\)\-]/g, ''))
    .refine((val) => val === '' || kgPhoneRegex.test(val), {
      message: 'Введите корректный номер Кыргызстана (+996 XXX XX-XX-XX)',
    })
    .optional()
    .nullable(),
  secondary_email: z
    .string()
    .transform((val) => (val.trim() === '' ? null : val.trim()))
    .refine((val) => val === null || z.string().email().safeParse(val).success, {
      message: 'Введите корректный адрес дополнительной почты',
    })
    .optional()
    .nullable(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
