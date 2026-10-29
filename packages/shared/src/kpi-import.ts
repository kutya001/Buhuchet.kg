import { IMPORT_PROBLEMS, INDICATOR_TYPES, KPI_IMPORT_FILE_MAX_LENGTH } from '@buhuchet/domain';
import { z } from 'zod';
import { Uuid } from './common';
import { IndicatorValue, YearMonth } from './kpi';

/*
 * «Ввод из Excel» модуля «Показатели контрагентов» (задача 2.28; ТЗ «Ввод из Excel»): шаг 1 — шаблон за
 * период с фильтром, шаг 2 — предпросмотр загруженного файла и «Применить», «История загрузок».
 * Значения — целые сотые, как в остальных методах показателей.
 */

/** Выбор для шага 1: показатели, ответственные и режимы контрагентов в области, период по умолчанию. */
export const KpiImportOptions = z.object({
  indicators: z.array(z.object({ id: Uuid, name: z.string() })),
  responsibles: z.array(z.object({ id: Uuid, name: z.string() })),
  regimes: z.array(z.object({ code: z.string(), name: z.string() })),
  /** Прошлый месяц — период шаблона по умолчанию; идущий — последний, который можно выбрать. */
  defaultMonth: YearMonth,
  currentMonth: YearMonth,
});

/** Период и фильтр шаблона: показатели — номера через запятую. */
export const KpiImportTemplateQuery = z.object({
  from: YearMonth,
  to: YearMonth,
  inds: z
    .string()
    .max(100 * 37)
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(Uuid).max(100)),
  resp: Uuid.optional(),
  reg: z.string().max(20).optional(),
  q: z.string().max(200).optional(),
});

/** Предпросмотр листа «Показатели»: сколько строк и столбцов, первые строки. */
export const KpiImportTemplatePreview = z.object({
  contractors: z.number().int().nonnegative(),
  columns: z.number().int().nonnegative(),
  /** Шаблон не собирается: больше 24 месяцев или 1 000 контрагентов. */
  tooMany: z.enum(['months', 'contractors']).nullable(),
  head: z.array(
    z.object({
      indicatorId: Uuid,
      month: YearMonth,
      title: z.string(),
      unit: z.string(),
      type: z.enum(INDICATOR_TYPES),
    }),
  ),
  rows: z.array(
    z.object({
      inn: z.string(),
      name: z.string(),
      cells: z.array(
        z.object({ kind: z.enum(['off', 'input', 'checked']), value: IndicatorValue }),
      ),
    }),
  ),
});

/** Загрузка файла: имя — для «Истории загрузок»; при «Применить» — с изменениями проверенных или без. */
export const KpiImportFileQuery = z.object({
  file: z
    .string()
    .min(1)
    .max(KPI_IMPORT_FILE_MAX_LENGTH * 2),
});
export const KpiImportApplyQuery = KpiImportFileQuery.extend({
  withChecked: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

export const KpiImportError = z.object({
  ref: z.string(),
  row: z.number().int().positive(),
  col: z.string(),
  /** Название контрагента строки, если он найден и доступен. */
  contractor: z.string().nullable(),
  value: z.string(),
  problem: z.enum(IMPORT_PROBLEMS),
});

export const KpiImportItem = z.object({
  ref: z.string(),
  contractor: z.string(),
  indicator: z.string(),
  type: z.enum(INDICATOR_TYPES),
  unit: z.string(),
  month: YearMonth,
  old: IndicatorValue,
  value: IndicatorValue,
  checked: z.boolean(),
});

/** Предпросмотр: числа плашек и строки таблиц (первые 500 каждого вида). */
export const KpiImportPreview = z.object({
  added: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  changedChecked: z.number().int().nonnegative(),
  same: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errors: z.array(KpiImportError),
  addedItems: z.array(KpiImportItem),
  changedItems: z.array(KpiImportItem),
});

/** Запись «Истории загрузок». */
export const KpiImportRecord = z.object({
  id: Uuid,
  at: z.string(),
  actor: z.string().nullable(),
  fileName: z.string(),
  from: YearMonth.nullable(),
  to: YearMonth.nullable(),
  added: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  skippedChecked: z.number().int().nonnegative(),
});

export const KpiImportHistory = z.object({ items: z.array(KpiImportRecord) });

/** «Применить»: что записано (запись «Истории загрузок») и ошибки, которые остались в файле. */
export const KpiImportApplied = z.object({
  record: KpiImportRecord,
  preview: KpiImportPreview,
});

export type KpiImportOptions = z.infer<typeof KpiImportOptions>;
export type KpiImportTemplatePreview = z.infer<typeof KpiImportTemplatePreview>;
export type KpiImportPreview = z.infer<typeof KpiImportPreview>;
export type KpiImportRecord = z.infer<typeof KpiImportRecord>;
export type KpiImportError = z.infer<typeof KpiImportError>;
export type KpiImportItem = z.infer<typeof KpiImportItem>;
