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

/** Код ошибки из ответа API; null — ответ не в общем формате ошибки. */
export function apiErrorCode(body: unknown): string | null {
  const parsed = ApiError.safeParse(body);
  return parsed.success ? parsed.data.error.code : null;
}

/**
 * Ответ 409 «Запись изменена другим пользователем»: пока пользователь правил, запись сохранил
 * кто-то другой. Интерфейс показывает предупреждение и перечитывает запись, правка не сохраняется.
 */
export function isRecordChanged(body: unknown): boolean {
  return apiErrorCode(body) === 'record_changed';
}

/**
 * «Создал» и «Изменил» в карточке записи (прототип core/session.js, auditKv): кто и когда. Кто —
 * короткое имя сотрудника или «Администратор платформы»; null — система.
 */
export const RecordAudit = z.object({
  createdAt: z.iso.datetime(),
  createdBy: z.string().nullable(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string().nullable(),
});
export type RecordAudit = z.infer<typeof RecordAudit>;
