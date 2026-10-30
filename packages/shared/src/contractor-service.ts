import { PAUSE_REASON_MAX, SERVICE_STATUSES } from '@buhuchet/domain';
import { z } from 'zod';
import { RecordVersion, Uuid } from './common';
import { ContractorSaved, ContractorTariffRequest } from './contractors';
import { YearMonth } from './kpi';
import { RollbackReason, StatusHistoryEntry } from './status';

/*
 * Обслуживание контрагента (задача 2.12; ТЗ «Остановка и возобновление обслуживания», «Непостоянные
 * контрагенты»): блок карточки и тела окон «Приостановить», «Возобновить», «Отменить приостановку»,
 * откат приостановки, «В архив», «Вернуть из архива», «Перевести в постоянное обслуживание».
 */

/** Период обслуживания: с месяца по месяц включительно; `to` пусто — обслуживается дальше. */
export const ServicePeriod = z.object({ from: YearMonth, to: YearMonth.nullable() });
export type ServicePeriod = z.infer<typeof ServicePeriod>;

/**
 * Обслуживание для карточки: статус на шкале, периоды («01.2026–10.2026, 05.2027–…»), запланированная
 * приостановка или возобновление, пропущенные месяцы для окна отката и «История статусов». Какие
 * пункты меню показать, считает экран теми же правилами (`serviceMenu` из @buhuchet/domain).
 */
export const ContractorService = z.object({
  id: Uuid,
  kind: z.enum(['regular', 'oneoff']),
  status: z.enum(SERVICE_STATUSES),
  periods: z.array(ServicePeriod),
  periodsText: z.string(),
  /** Идущий месяц по Бишкеку: от него правила меню и окон. */
  month: YearMonth,
  plannedPause: z.object({ from: YearMonth, resume: YearMonth.nullable() }).nullable(),
  plannedResume: YearMonth.nullable(),
  /** Пропущенные месяцы действующей приостановки (окно отката); пусто — не приостановлен. */
  skipped: z.array(YearMonth),
  statusHistory: z.array(StatusHistoryEntry),
  version: RecordVersion,
});
export type ContractorService = z.infer<typeof ContractorService>;

/** Причина приостановки: необязательна. */
const PauseReason = z
  .string()
  .trim()
  .max(PAUSE_REASON_MAX)
  .refine((s) => !s.includes('\u0000'));

/** «Приостановить»: с какого месяца, необязательное возобновление и причина. */
export const PauseServiceRequest = z.strictObject({
  from: YearMonth,
  resume: YearMonth.nullable().default(null),
  reason: PauseReason.default(''),
  version: RecordVersion,
});
export type PauseServiceRequest = z.infer<typeof PauseServiceRequest>;

/** «Возобновить» и «Изменить возобновление»: с какого месяца. */
export const ResumeServiceRequest = z.strictObject({ from: YearMonth, version: RecordVersion });
export type ResumeServiceRequest = z.infer<typeof ResumeServiceRequest>;

/** «Отменить приостановку»: только версия окна. */
export const ServiceVersionRequest = z.strictObject({ version: RecordVersion });
export type ServiceVersionRequest = z.infer<typeof ServiceVersionRequest>;

/** «Вернуть из архива»: версия необязательна — форма «Новый контрагент» знает только номер. */
export const UnarchiveContractorRequest = z.strictObject({ version: RecordVersion.optional() });
export type UnarchiveContractorRequest = z.infer<typeof UnarchiveContractorRequest>;

/** Откат действующей приостановки: причина и месяцы, за которые досоздать отчёты. */
export const RollbackPauseRequest = z.strictObject({
  reason: RollbackReason,
  fill: z.array(YearMonth).max(120).default([]),
  version: RecordVersion,
});
export type RollbackPauseRequest = z.infer<typeof RollbackPauseRequest>;

/** «Перевести в постоянное обслуживание»: начало, режим и ставка (тому, кто видит плату). */
export const ToRegularRequest = z.strictObject({
  from: YearMonth,
  /** Не передан — режим не меняется; null — «не указан». */
  regimeCode: z.string().trim().min(1).max(60).nullable().optional(),
  tariff: ContractorTariffRequest.strict().optional(),
  /** «Подтверждаю» на вопрос о праве на режим по ГКЭД (как в форме контрагента). */
  gkedConfirm: z.boolean().optional(),
  version: RecordVersion,
});
export type ToRegularRequest = z.infer<typeof ToRegularRequest>;

/** «В архив» выбранных (из карточки — один): все или никто. */
export const ArchiveContractorsRequest = z.strictObject({ ids: z.array(Uuid).min(1).max(500) });
export type ArchiveContractorsRequest = z.infer<typeof ArchiveContractorsRequest>;

/** Что действие сделало с отчётами. */
export const ServiceEffect = z.object({
  /** Стали «Не требуется». */
  notRequired: z.number().int().nonnegative(),
  /** Вернулись в «К сдаче». */
  restored: z.number().int().nonnegative(),
  /** Созданы. */
  created: z.number().int().nonnegative(),
  /** Открытых отчётов у контрагента после действия (прототип: «открытых отчётов: N»). */
  open: z.number().int().nonnegative(),
});
export type ServiceEffect = z.infer<typeof ServiceEffect>;

/** Ответ действия с одним контрагентом: обслуживание и что стало с отчётами. */
export const ContractorServiceSaved = z.object({
  service: ContractorService,
  effect: ServiceEffect,
});
export type ContractorServiceSaved = z.infer<typeof ContractorServiceSaved>;

/**
 * «Вернуть из архива»: карточка (`ContractorSaved` — после него форма 2.09 открывает «Изменить»),
 * обслуживание и отчёты.
 */
export const ContractorUnarchived = ContractorSaved.extend({
  service: ContractorService,
  effect: ServiceEffect,
});
export type ContractorUnarchived = z.infer<typeof ContractorUnarchived>;

/** «В архив»: сколько отправлено (уже архивные пропущены) и сколько отчётов стали «Не требуется». */
export const ArchiveContractorsResult = z.object({
  archived: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  notRequired: z.number().int().nonnegative(),
});
export type ArchiveContractorsResult = z.infer<typeof ArchiveContractorsResult>;
