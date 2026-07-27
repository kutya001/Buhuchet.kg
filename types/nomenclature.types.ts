import { z } from 'zod';

export const UNITS = ['шт', 'кг', 'литр', 'услуга', 'комплект', 'метр', 'упаковка'] as const;

export const nomenclatureSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(2, { message: 'Наименование товара/услуги должно содержать минимум 2 символа' }),
  code: z.string().optional().nullable(),
  unit: z.string().default('шт'),
  price: z.coerce.number().min(0, { message: 'Цена не может быть отрицательной' }).default(0),
});

export type NomenclatureInput = z.infer<typeof nomenclatureSchema>;
