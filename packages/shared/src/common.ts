import { z } from 'zod';

/** Идентификатор записи. */
export const Uuid = z.uuid();

/** Дата без времени `YYYY-MM-DD` (сроки, даты документов). */
export const IsoDate = z.iso.date();

/** Деньги в тыйынах: целое число, 1 сом = 100 тыйын. */
export const Tyiyn = z
  .number()
  .int()
  .refine(Number.isSafeInteger, 'Сумма вне допустимого диапазона');

/** Номер версии записи для защиты от одновременной правки. */
export const RecordVersion = z.number().int().nonnegative();

/** Ответ API с ошибкой: код для словаря интерфейса и подробности для журнала. */
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
