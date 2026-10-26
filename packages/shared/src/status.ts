import { ROLLBACK_REASON_MAX, STATUS_SCALES } from '@buhuchet/domain';
import { z } from 'zod';

/**
 * Общие схемы статусов (задача #17): шкала, запись «Истории статусов» в ответе API и тело отката.
 * Методы смены статуса и отката — у модулей (отчёты, задачи, проекты, …): они берут эти схемы,
 * проверяют право «Откат статусов» и шаг назад (`rollbackRefusal` из @buhuchet/domain).
 */
export const StatusScaleKey = z.enum(STATUS_SCALES);

/** Код статуса шкалы (`todo`, `in_progress`, …): латиница и «_». */
export const StatusCode = z.string().regex(/^[a-z_]{1,40}$/);

/** Запись «Истории статусов»: когда, было → стало, откат, причина или комментарий, кто (null — система). */
export const StatusHistoryEntry = z.object({
  at: z.iso.datetime(),
  from: StatusCode.nullable(),
  to: StatusCode,
  rollback: z.boolean(),
  reason: z.string().nullable(),
  actor: z.string().nullable(),
});
export type StatusHistoryEntry = z.infer<typeof StatusHistoryEntry>;

/**
 * Причина отката: обязательна, не длиннее `ROLLBACK_REASON_MAX`; ошибки — ключи словаря
 * (`status.rollback_reason_required`).
 */
export const RollbackReason = z
  .string()
  .trim()
  .min(1, 'status.rollback_reason_required')
  .max(ROLLBACK_REASON_MAX)
  .refine((s) => !s.includes('\u0000'));

/** Тело отката статуса на шаг назад: куда и почему. */
export const StatusRollback = z.strictObject({ to: StatusCode, reason: RollbackReason });
export type StatusRollback = z.infer<typeof StatusRollback>;
