import { BIZ_SIZES } from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordVersion, Uuid } from './common';
import { ContractorSocfundRequest } from './contractors';
import { AssignmentEnRate } from './reports';

/*
 * «Подбор отчётов» и окно «Льготы и особые статусы» (задача 2.07; ТЗ «Контрагенты» → «Подбор отчётов и
 * налогов, льгот и статусов»): что нужно окну о контрагенте или черновике формы и применение выбора у
 * созданного контрагента. Наборы считает `@buhuchet/domain` (`reportPick`) — на экране и при применении.
 */

/** Без нулевого символа: PostgreSQL его в тексте не принимает. */
const noNul = (s: string) => !s.includes('\u0000');
const Code = z.string().trim().min(1).max(60).refine(noNul);
const Codes = (max: number) => z.array(Code).max(max);

/**
 * Для кого открывается подбор: созданный контрагент (`contractorId`) и/или набранные в форме значения —
 * переданное поле важнее сохранённого (основания из шапки окна, черновик формы создания).
 */
export const ReportPickRequest = z.object({
  contractorId: Uuid.optional(),
  formCode: Code.nullable().optional(),
  regimeCode: Code.nullable().optional(),
  regime2Code: Code.nullable().optional(),
  gked: Code.nullable().optional(),
  gkedExtra: Codes(200).optional(),
  taxOfficeCode: Code.nullable().optional(),
  bizSize: z.enum(BIZ_SIZES).optional(),
  benefits: Codes(100).optional(),
  bases: Codes(50).optional(),
  /** Строки ЕНС, выбранные в форме; пусто — подобранные по ГКЭД. */
  enRates: z.array(AssignmentEnRate).max(20).optional(),
  /**
   * Признаки и выбор тарифа Соцфонда из формы (как у `socfund-check`): пояснение о тарифе у вида со
   * взносами — и у черновика; не передано — сохранённые у контрагента.
   */
  socfund: ContractorSocfundRequest.pick({ flags: true, tariff: true }).optional(),
});
export type ReportPickRequest = z.input<typeof ReportPickRequest>;

/** Контрагент для подбора — поля `PickSubject` из @buhuchet/domain, кроме подключённых видов. */
export const ReportPickSubject = z.object({
  form: z.object({ code: z.string(), declarationFor: z.enum(['org', 'ip']) }).nullable(),
  regimes: z.array(z.object({ code: z.string(), name: z.string() })),
  benefits: z.array(z.string()),
  bases: z.array(z.string()),
  bizSize: z.enum(BIZ_SIZES),
  gked: z.string().nullable(),
  gkedExtra: z.array(z.string()),
  enCodes: z.array(z.string()),
  singleTax: z.array(z.object({ code: z.string(), variant: z.number().int().nullable() })),
});
export type ReportPickSubject = z.infer<typeof ReportPickSubject>;

/**
 * Что нужно окну: контрагент для подбора, подключённые в организации и назначенные виды, версия записи
 * (для оснований), можно ли менять отчёты и основания, сегодняшняя дата сервера, справочник ГКЭД по
 * кодам контрагента, ставки единого налога (и отключённые — как у сервера при применении), строки
 * описания вида для этого контрагента («Ближайший срок», «Срок по статусу»), ставки ЕН по ГКЭД,
 * пояснение о тарифе Соцфонда у вида со взносами и статус тарифа СПиНО (в окне «Льготы и особые
 * статусы» его нет: тариф выбирается в блоке «Тариф Соцфонда»).
 */
export const ReportPickContext = z.object({
  subject: ReportPickSubject,
  connected: z.array(z.string()),
  assigned: z.array(z.string()),
  version: z.number().int().nullable(),
  /** Можно отмечать виды, менять основания, подключать виды в «Справочниках» («Выбрать налоги»). */
  edit: z.object({ types: z.boolean(), bases: z.boolean(), connect: z.boolean() }),
  today: IsoDate,
  gkedIndex: z.array(
    z.object({
      code: z.string(),
      level: z.string(),
      parent: z.string().nullable(),
      active: z.boolean(),
    }),
  ),
  rates: z.array(
    z.object({
      code: z.string(),
      rate: z.string(),
      rateCashless: z.string(),
      rateCash: z.string(),
      addsTo: z.array(z.string()),
    }),
  ),
  details: z.array(z.object({ code: z.string(), near: z.string(), statusDue: z.string() })),
  enRates: z.string(),
  socfund: z
    .object({ types: z.array(z.string()), warn: z.boolean(), title: z.string(), text: z.string() })
    .nullable(),
  socfundStatus: z.string().nullable(),
});
export type ReportPickContext = z.infer<typeof ReportPickContext>;

/** Что сделает «Применить»: какие виды добавятся и снимутся, сколько отчётов удалится и сколько останется. */
export const ReportPickPreviewRequest = z.object({
  codes: Codes(300),
});
export const ReportPickPreview = z.object({
  add: z.array(z.string()),
  remove: z.array(z.string()),
  deleted: z.number().int().nonnegative(),
  kept: z.number().int().nonnegative(),
});
export type ReportPickPreview = z.infer<typeof ReportPickPreview>;

/**
 * «Применить» у созданного контрагента: отмеченные виды (`codes`), назначенные, какими их видело окно
 * (`assigned` — другой пользователь мог изменить их раньше), основания с версией записи и обязательные
 * виды, снятые после подтверждения (`forced`).
 */
export const ReportPickApply = z.object({
  assigned: Codes(300),
  codes: Codes(300),
  bases: Codes(50).optional(),
  version: RecordVersion.optional(),
  forced: Codes(300).default([]),
});
export type ReportPickApply = z.input<typeof ReportPickApply>;

export const ReportPickApplied = z.object({
  add: z.array(z.string()),
  remove: z.array(z.string()),
  deleted: z.number().int().nonnegative(),
  /** Версия контрагента после сохранения оснований. */
  version: z.number().int(),
});
export type ReportPickApplied = z.infer<typeof ReportPickApplied>;
