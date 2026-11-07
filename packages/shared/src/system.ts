import { z } from 'zod';
import { IsoDate } from './common';

export const CheckState = z.enum(['ok', 'error']);

/**
 * Ответ GET /api/health без подробностей: работает ли всё (для проверок Docker и наблюдения за сайтом).
 * Версия, окружение и состояние базы и хранилища — только администратору платформы
 * (GET /api/admin/health, docs/deviations.md п. О-9).
 */
export const HealthPublicResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  /** Только серверу сайта при показе страницы (в том же процессе): снаружи не приходит. */
  environment: z.string().optional(),
});
export type HealthPublicResponse = z.infer<typeof HealthPublicResponse>;

/** Ответ GET /api/admin/health — подробно, только администратору платформы. */
export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  environment: z.string(),
  time: z.iso.datetime(),
  todayBishkek: IsoDate,
  checks: z.object({
    database: CheckState,
    storage: CheckState,
  }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Ответ запуска задач по расписанию. */
export const CronTickResponse = z.object({
  ran: z.array(z.object({ job: z.string(), slot: z.iso.datetime(), ok: z.boolean() })),
  skipped: z.array(z.string()),
});
export type CronTickResponse = z.infer<typeof CronTickResponse>;
